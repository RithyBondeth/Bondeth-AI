"""Text-to-speech service: Meta MMS-TTS (VITS, default) or VoxCPM2.

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

import numpy as np
import scipy.io.wavfile

from app.config import Settings
from app.services import voxcpm
from app.text.english_normalizer import normalize_english
from app.text.khmer_normalizer import normalize_khmer
from app.text.script_split import dominant_lang, split_runs, split_sentences

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16_000  # both MMS models output 16 kHz
SENTENCE_PAUSE_S = 0.25
RUN_PAUSE_S = 0.08
MAX_CHUNK_CHARS = 400  # VITS quality and memory degrade on very long inputs


class NothingToSpeak(ValueError):
    pass


class _Voice:
    def __init__(self, repo: str, cache_dir: str):
        from transformers import AutoTokenizer, VitsModel

        self.tokenizer = AutoTokenizer.from_pretrained(repo, cache_dir=cache_dir)
        self.model = VitsModel.from_pretrained(repo, cache_dir=cache_dir).eval()
        # speaking_rate is model state, so one request at a time per voice.
        self.lock = threading.Lock()

    def speak(self, text: str, speed: float) -> np.ndarray | None:
        import torch

        inputs = self.tokenizer(text, return_tensors="pt")
        if inputs.input_ids.shape[-1] == 0:
            return None  # nothing this voice can pronounce
        with self.lock, torch.no_grad():
            self.model.speaking_rate = speed
            wave = self.model(**inputs).waveform
        return wave.squeeze().cpu().numpy().astype(np.float32)


class TtsService:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._repos = {"km": settings.tts_model_km, "en": settings.tts_model_en}
        self._voices: dict[str, _Voice] = {}
        self._load_lock = threading.Lock()
        self._voxcpm: voxcpm.VoxCpm | None = None

    @property
    def engine(self) -> str:
        return self._settings.tts_engine

    def loaded_languages(self) -> list[str]:
        if self.engine == "voxcpm":
            return ["voxcpm"] if voxcpm.is_loaded() else []
        return sorted(self._voices)

    def preload(self) -> None:
        if self.engine == "voxcpm":
            self._vox().house_voice()
        else:
            for lang in ("km", "en"):
                self.load(lang)

    def _vox(self) -> voxcpm.VoxCpm:
        if self._voxcpm is None:
            self._voxcpm = voxcpm.VoxCpm(self._settings)
        return self._voxcpm

    def load(self, lang: str) -> _Voice:
        if lang not in self._voices:
            with self._load_lock:
                if lang not in self._voices:
                    logger.info("Loading TTS model %s", self._repos[lang])
                    cache = str(self._settings.model_dir / "hf" / "hub")
                    self._voices[lang] = _Voice(self._repos[lang], cache)
        return self._voices[lang]

    def prepare(self, text: str, lang: str) -> tuple[str, list[tuple[str, str]]]:
        """Return (primary_lang, [(lang, chunk_text), ...]) without running any model."""
        primary = dominant_lang(text) if lang == "auto" else lang
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
        if self.engine == "voxcpm":
            return self._synthesize_voxcpm(chunks, speed)
        pieces: list[np.ndarray] = []
        prev_lang = None
        for chunk_lang, chunk in chunks:
            wave = self.load(chunk_lang).speak(chunk, speed)
            if wave is None or wave.size == 0:
                continue
            if pieces:
                pause = RUN_PAUSE_S if chunk_lang != prev_lang else SENTENCE_PAUSE_S
                pieces.append(np.zeros(int(pause * SAMPLE_RATE), dtype=np.float32))
            pieces.append(_peak_normalize(wave))
            prev_lang = chunk_lang

        if not pieces:
            raise NothingToSpeak("The text contains nothing that can be spoken in Khmer or English.")
        return np.concatenate(pieces), SAMPLE_RATE

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
    # Khmer without spaces can still exceed the limit; hard-split as a last resort.
    return [p[i:i + MAX_CHUNK_CHARS] for p in parts + [current] for i in range(0, len(p), MAX_CHUNK_CHARS)]


def _peak_normalize(wave: np.ndarray, peak: float = 0.9) -> np.ndarray:
    # The Khmer and English voices have different loudness; even them out.
    m = float(np.abs(wave).max())
    return wave * (peak / m) if m > 0 else wave


def to_wav_bytes(wave: np.ndarray, sample_rate: int) -> bytes:
    pcm = (np.clip(wave, -1.0, 1.0) * 32767).astype(np.int16)
    buf = io.BytesIO()
    scipy.io.wavfile.write(buf, sample_rate, pcm)
    return buf.getvalue()
