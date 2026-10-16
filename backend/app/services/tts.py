"""Text-to-speech: MMS (fast default), OmniVoice (quality-first), or VoxCPM2.

MMS pipeline: pick primary language -> normalize numbers/symbols -> split into
Khmer/English runs -> split runs into sentences -> synthesize each chunk with
the matching model -> join with short pauses.

VoxCPM2 (BONDETH_TTS_ENGINE=voxcpm) is multilingual, so mixed Khmer/English
sentences go to it whole, in the house voice (see services/voxcpm.py).

Models load lazily per language. Inference is blocking, so callers must run
`synthesize` in a worker thread.
"""

import io
import logging
import threading
import unicodedata
from dataclasses import dataclass

import numpy as np
import scipy.io.wavfile

from app.config import Settings
from app.services import voxcpm
from app.services.errors import EngineUnavailable, SpeechGenerationError
from app.text.english_normalizer import normalize_english
from app.text.khmer_normalizer import normalize_khmer
from app.text.script_split import dominant_lang, split_runs, split_sentences

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16_000  # both MMS models output 16 kHz
SENTENCE_PAUSE_S = 0.25
MAX_CHUNK_CHARS = 400  # VITS quality and memory degrade on very long inputs
SHORT_KHMER_FALLBACK_CHARS = 40  # normalized letters, marks and digits; independent of speed


@dataclass(frozen=True)
class SpeechResult:
    wave: np.ndarray
    sample_rate: int
    engine: str
    fallback: str = "none"


class NothingToSpeak(ValueError):
    pass


class _Voice:
    def __init__(self, repo: str, cache_dir: str, noise_scale: float | None = None,
                 noise_scale_duration: float | None = None):
        from transformers import AutoTokenizer, VitsModel

        self.tokenizer = AutoTokenizer.from_pretrained(repo, cache_dir=cache_dir)
        self.model = VitsModel.from_pretrained(repo, cache_dir=cache_dir).eval()
        if noise_scale is not None:
            self.model.noise_scale = noise_scale
        if noise_scale_duration is not None:
            self.model.noise_scale_duration = noise_scale_duration
        self.lock = threading.Lock()

    def speak(self, text: str, speed: float) -> np.ndarray | None:
        import torch

        inputs = self.tokenizer(text, return_tensors="pt")
        if inputs.input_ids.shape[-1] == 0:
            return None  # nothing this voice can pronounce
        with self.lock, torch.inference_mode():
            wave = self.model(**inputs, speaking_rate=speed).waveform
        return wave.squeeze().cpu().numpy().astype(np.float32)


class TtsService:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._repos = {"km": settings.tts_model_km, "en": settings.tts_model_en}
        self._voices: dict[str, _Voice] = {}
        self._load_lock = threading.Lock()
        self._voxcpm: voxcpm.VoxCpm | None = None
        self._omni_tts = None

    @property
    def engine(self) -> str:
        return self._settings.tts_engine

    def loaded_languages(self) -> list[str]:
        if self.engine == "omnivoice":
            return ["omnivoice"] if self._omni_tts is not None and self._omni_tts.loaded else []
        if self.engine == "voxcpm":
            return ["voxcpm"] if voxcpm.is_loaded() else []
        return sorted(self._voices)

    def preload(self) -> None:
        if self.engine == "omnivoice":
            # Load weights, but leave reference generation to the first TTS request.
            # A slow first generation must not block API startup/readiness.
            _ = self._omni().engine
        elif self.engine == "voxcpm":
            self._vox().house_voice()
        else:
            for lang in ("km", "en"):
                self.load(lang)

    def _vox(self) -> voxcpm.VoxCpm:
        if self._voxcpm is None:
            self._voxcpm = voxcpm.VoxCpm(self._settings)
        return self._voxcpm

    def _omni(self):
        if self._omni_tts is None:
            from app.services.omni_tts import OmniTts
            self._omni_tts = OmniTts(self._settings)
        return self._omni_tts

    def load(self, lang: str) -> _Voice:
        if lang not in self._voices:
            with self._load_lock:
                if lang not in self._voices:
                    logger.info("Loading TTS model %s", self._repos[lang])
                    cache = str(self._settings.model_dir / "hf" / "hub")
                    s = self._settings
                    self._voices[lang] = _Voice(
                        self._repos[lang], cache,
                        s.tts_km_noise_scale if lang == "km" else None,
                        s.tts_km_noise_scale_duration if lang == "km" else None)
        return self._voices[lang]

    def prepare(self, text: str, lang: str) -> tuple[str, list[tuple[str, str]]]:
        """Return (primary_lang, [(lang, chunk_text), ...]) without running any model."""
        # Invisible Khmer word breaks are useful pronunciation boundaries, not
        # unknown symbols to silently drop. Join controls only affect display.
        text = unicodedata.normalize("NFC", text).translate(str.maketrans({
            "\u200b": " ", "\u00a0": " ", "\ufeff": "", "\u200c": "", "\u200d": "", "\u2060": ""}))
        primary = dominant_lang(text) if lang == "auto" else lang
        if self.engine == "omnivoice":
            normalized = normalize_khmer(text) if primary == "km" else normalize_english(text, lowercase=False)
            # Preserve sentence-level context, punctuation and mixed-language names.
            return primary, [(primary, piece) for piece in _limit_length(normalized.strip())]
        if self.engine == "voxcpm":
            # One multilingual voice: keep mixed scripts (and English casing) together.
            normalized = normalize_khmer(text) if primary == "km" else normalize_english(text, lowercase=False)
            return primary, [(primary, piece) for s in split_sentences(normalized) for piece in _limit_length(s)]
        normalized = normalize_khmer(text) if primary == "km" else normalize_english(text)

        chunks: list[tuple[str, str]] = []
        for run in split_runs(normalized, default=primary):
            run_text = run.text.lower() if run.lang == "en" else run.text
            for sentence in split_sentences(run_text):
                chunks.extend((run.lang, piece) for piece in _limit_length(sentence))
        return primary, chunks

    def synthesize(self, text: str, lang: str = "auto", speed: float = 1.0) -> tuple[np.ndarray, int]:
        _, chunks = self.prepare(text, lang)
        if self.engine == "omnivoice":
            return self._synthesize_omni(chunks, speed)
        if self.engine == "voxcpm":
            return self._synthesize_voxcpm(chunks, speed)
        pieces: list[np.ndarray] = []
        prev_lang = None
        prev_text = ""
        for chunk_lang, chunk in chunks:
            wave = self.load(chunk_lang).speak(chunk, speed)
            if wave is None or wave.size == 0:
                continue
            if pieces:
                pause = _boundary_pause(prev_text, chunk_lang != prev_lang) / speed
                pieces.append(np.zeros(int(pause * SAMPLE_RATE), dtype=np.float32))
            pieces.append(_fade_edges(wave, SAMPLE_RATE))
            prev_lang = chunk_lang
            prev_text = chunk

        if not pieces:
            raise NothingToSpeak("The text contains nothing that can be spoken in Khmer or English.")
        # Master once so relative phrase dynamics are not erased by independent
        # peak normalization. Bounded gain avoids making near-silence blast loudly.
        return _master_audio(np.concatenate(pieces)), SAMPLE_RATE

    def synthesize_result(self, text: str, lang: str = "auto", speed: float = 1.0) -> SpeechResult:
        """API result with per-request provenance; never change the configured voice.

        OmniVoice gets its usual bounded retry first. Only a failed, short,
        Khmer-only utterance may use MMS. Long/mixed text and engine/infra errors
        must not silently change speaker. The tuple-only synthesize method remains
        available for primary-engine evaluation and existing integrations.
        """
        try:
            wave, sr = self.synthesize(text, lang, speed)
            return SpeechResult(wave, sr, self.engine)
        except SpeechGenerationError:
            if self.engine != "omnivoice":
                raise
            primary, chunks = self.prepare(text, lang)
            spoken = [ch for _, chunk in chunks for ch in chunk
                      if unicodedata.category(ch)[0] in "LMN"]
            if (primary != "km" or len(chunks) != 1 or not spoken
                    or len(spoken) > SHORT_KHMER_FALLBACK_CHARS
                    or not all("\u1780" <= ch <= "\u17ff" for ch in spoken)):
                raise

        logger.warning("Using labelled MMS fallback after failed short Khmer OmniVoice TTS")
        try:
            voice = self.load("km")
        except OSError as exc:
            raise EngineUnavailable("The Khmer fallback voice could not be loaded. Please retry.") from exc
        wave = voice.speak(chunks[0][1], speed)
        from app.services.omni_tts import usable_audio
        if wave is None or not usable_audio(np.asarray(wave)):
            raise SpeechGenerationError("Neither voice produced usable speech. Please retry or use a longer phrase.")
        return SpeechResult(_master_audio(_fade_edges(wave, SAMPLE_RATE)), SAMPLE_RATE,
                            "mms", "short-khmer-omni-failed")

    def _synthesize_omni(self, chunks: list[tuple[str, str]], speed: float) -> tuple[np.ndarray, int]:
        chunks = [(lang, text) for lang, text in chunks if any(ch.isalnum() for ch in text)]
        if not chunks:
            raise NothingToSpeak("The text contains nothing that can be spoken in Khmer or English.")
        voice = self._omni()
        pieces = []
        for lang, text in chunks:
            languages = {run.lang for run in split_runs(text, default=lang)}
            if pieces:
                pieces.append(np.zeros(int(0.12 * voice.sample_rate / speed), dtype=np.float32))
            wave = np.asarray(voice.speak(text, lang if len(languages) == 1 else None, speed), dtype=np.float32)
            if (wave.ndim != 1 or not wave.size or not np.isfinite(wave).all()
                    or np.max(np.abs(wave)) <= 1e-5):
                raise SpeechGenerationError(
                    "The speech model returned no usable audio. Please retry or use a slightly longer phrase.")
            pieces.append(_fade_edges(wave, voice.sample_rate))
        return _master_audio(np.concatenate(pieces)), voice.sample_rate

    def _synthesize_voxcpm(self, chunks: list[tuple[str, str]], speed: float) -> tuple[np.ndarray, int]:
        chunks = [(lang, c) for lang, c in chunks if any(ch.isalnum() for ch in c)]
        if not chunks:
            raise NothingToSpeak("The text contains nothing that can be spoken in Khmer or English.")
        vox = self._vox()
        ref, ref_text = vox.house_voice()
        sr = vox.sample_rate
        pieces: list[np.ndarray] = []
        for _, chunk in chunks:
            if pieces:
                pieces.append(np.zeros(int(SENTENCE_PAUSE_S * sr), dtype=np.float32))
            pieces.append(_peak_normalize(vox.clone(chunk, ref, ref_text, speed)))
        return np.concatenate(pieces), sr


def _limit_length(sentence: str) -> list[str]:
    if len(sentence) <= MAX_CHUNK_CHARS:
        return [sentence]
    parts, current = [], ""
    for word in sentence.split(" "):
        if current and len(current) + len(word) + 1 > MAX_CHUNK_CHARS:
            parts.append(current)
            current = word
        else:
            current = f"{current} {word}" if current else word
    chunks = []
    for part in parts + [current]:
        while len(part) > MAX_CHUNK_CHARS:
            cut = MAX_CHUNK_CHARS
            # Never start with a combining vowel/mark, or separate Khmer coeng
            # from its following consonant. This is cluster safety, not word segmentation.
            while cut and (unicodedata.category(part[cut]).startswith("M") or part[cut - 1] == "្"):
                cut -= 1
            if not cut:
                raise NothingToSpeak("Text contains an excessively long combining-character sequence.")
            chunks.append(part[:cut])
            part = part[cut:]
        if part:
            chunks.append(part)
    return chunks


def _boundary_pause(previous: str, language_changed: bool) -> float:
    end = previous.rstrip()[-1:]
    if end == "៕":
        return 0.45
    if end in ("។", ".", "?", "!"):
        return 0.3
    if end in (",", ";", "៖"):
        return 0.12
    return 0.05 if language_changed else 0.035


def _fade_edges(wave: np.ndarray, sr: int) -> np.ndarray:
    wave = np.asarray(wave, dtype=np.float32).copy()
    n = min(int(0.005 * sr), len(wave) // 2)
    if n:
        fade = np.linspace(0, 1, n, dtype=np.float32)
        wave[:n] *= fade
        wave[-n:] *= fade[::-1]
    return wave


def _master_audio(wave: np.ndarray) -> np.ndarray:
    if not np.isfinite(wave).all():
        raise RuntimeError("The speech model produced invalid audio samples.")
    peak = float(np.max(np.abs(wave)))
    rms = float(np.sqrt(np.mean(wave.astype(np.float64) ** 2)))
    if not peak or not rms:
        return wave
    return (wave * min(3.0, 0.1 / rms, 0.9 / peak)).astype(np.float32)


def _peak_normalize(wave: np.ndarray, peak: float = 0.9) -> np.ndarray:
    # The Khmer and English voices have different loudness; even them out.
    m = float(np.abs(wave).max())
    return wave * (peak / m) if m > 0 else wave


def to_wav_bytes(wave: np.ndarray, sample_rate: int) -> bytes:
    pcm = (np.clip(wave, -1.0, 1.0) * 32767).astype(np.int16)
    buf = io.BytesIO()
    scipy.io.wavfile.write(buf, sample_rate, pcm)
    return buf.getvalue()
