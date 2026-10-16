"""Zero-shot voice cloning.

The engine sits behind a small interface: OmniVoice (default; non-commercial
weights, runs on Apple Silicon) or VoxCPM2 (BONDETH_CLONE_ENGINE=voxcpm;
Apache-2.0, best on a CUDA GPU), see services/voxcpm.py.

The reference transcript matters: OmniVoice uses it to align the voice
sample. Without one, OmniVoice falls back to stock Whisper, which cannot
read Khmer, so we always supply it, transcribing with our own STT if needed.
"""

import hashlib
import json
import logging
import threading
from pathlib import Path
from typing import Protocol

import numpy as np
import soundfile as sf

from app.config import Settings
from app.services import voxcpm
from app.services.clone_jobs import CloneJob
from app.services.clone_cache import CloneMemoryCache
from app.services.stt import SttService
from app.text.english_normalizer import normalize_english
from app.text.khmer_normalizer import normalize_khmer
from app.text.script_split import dominant_lang
from app.text.speech_duration import khmer_speech_duration

logger = logging.getLogger(__name__)

REF_SAMPLE_RATE = 24_000  # retain OmniVoice's native reference bandwidth
_omni_engines: dict[tuple, "OmniVoiceEngine"] = {}
_omni_engine_lock = threading.Lock()


class InvalidReference(ValueError):
    pass


class CloneEngine(Protocol):
    sample_rate: int

    def clone(self, text: str, language: str | None, ref_audio: Path, ref_text: str,
              speed: float) -> np.ndarray: ...


class OmniVoiceEngine:
    sample_rate = 24_000

    def __init__(self, repo: str, revision: str, cache_dir: Path, device: str):
        import torch
        from huggingface_hub import snapshot_download
        from omnivoice import OmniVoice

        device = _resolve_device(device)
        # float16 crashes while loading on Apple MPS; use it only on CUDA.
        dtype = torch.float16 if device.startswith("cuda") else torch.float32
        path = snapshot_download(repo, revision=revision, cache_dir=str(cache_dir))
        logger.info("Loading voice-clone model %s on %s (%s)", repo, device, dtype)
        self._model = OmniVoice.from_pretrained(path, device_map=device, dtype=dtype)
        self._generation_lock = threading.Lock()
        # Small derived-token cache, not raw recordings; scoped to the caller.
        self._prompts = CloneMemoryCache(max_entries=16, max_bytes=1024 * 1024, ttl_s=300)

    def clone(self, text, language, ref_audio, ref_text, speed, *, duration=None,
              num_step=32, preprocess_prompt=True, cache_scope=None):
        with self._generation_lock:
            reference = {"ref_audio": str(ref_audio), "ref_text": ref_text}
            if cache_scope is not None:
                import torch

                key = _cache_key([cache_scope, hashlib.sha256(Path(ref_audio).read_bytes()).hexdigest(),
                                  ref_text, preprocess_prompt])
                prompt = self._prompts.get(key)
                if prompt is None:
                    # Prompt creation outside generate() must not retain autograd graphs.
                    with torch.inference_mode():
                        prompt = self._model.create_voice_clone_prompt(
                            str(ref_audio), ref_text, preprocess_prompt=preprocess_prompt)
                    tokens = prompt.ref_audio_tokens
                    self._prompts.put(key, prompt, tokens.numel() * tokens.element_size() + len(ref_text.encode()))
                reference = {"voice_clone_prompt": prompt}
            return self._model.generate(
                text=text, language=language, speed=speed, **reference,
                num_step=num_step, preprocess_prompt=preprocess_prompt,
                **({"duration": duration} if duration is not None else {}),
            )[0]

    def design(self, text: str, instruction: str) -> np.ndarray:
        """Create a generic synthetic speaker without using a person's reference."""
        with self._generation_lock:
            return self._model.generate(text=text, language="km", instruct=instruction,
                                        duration=khmer_speech_duration(text))[0]


def get_omni_engine(settings: Settings) -> OmniVoiceEngine:
    """TTS and cloning share one model and generation lock per model/device."""
    s = settings
    key = (s.clone_model, s.clone_model_revision, str((s.model_dir / "hf" / "hub").resolve()), s.clone_device)
    with _omni_engine_lock:
        if key not in _omni_engines:
            _omni_engines[key] = OmniVoiceEngine(s.clone_model, s.clone_model_revision,
                                                 s.model_dir / "hf" / "hub", s.clone_device)
        return _omni_engines[key]


class VoxCpmCloneEngine:
    """VoxCPM2 needs no language tag: Khmer, English and mixed text go in as-is."""

    def __init__(self, settings: Settings):
        self._vox = voxcpm.VoxCpm(settings)
        self.sample_rate = self._vox.sample_rate  # loads the model

    def clone(self, text, language, ref_audio, ref_text, speed):
        return self._vox.clone(text, ref_audio, ref_text, speed)


def _resolve_device(device: str) -> str:
    if device != "auto":
        return device
    import torch

    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def prepare_text(text: str, lang: str) -> tuple[str | None, str]:
    """Return (engine language or None for auto, normalized text)."""
    primary = dominant_lang(text) if lang == "auto" else lang
    normalized = normalize_khmer(text) if primary == "km" else normalize_english(text, lowercase=False)
    # Auto mode lets the engine handle code-switching instead of forcing one language.
    return (None if lang == "auto" else lang), normalized


def _cache_key(identity) -> str:
    return hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest()


def load_reference(src: Path, dest: Path, min_s: float, max_s: float) -> float:
    """Prepare native-bandwidth mono audio without changing pitch or internal pauses.

    Float decoding avoids an intermediate 16-bit/16-kHz STT conversion. Only edge
    silence/DC is removed; no denoiser or speech content cropping is applied.
    """
    import av

    try:
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=REF_SAMPLE_RATE)
        pieces, samples = [], 0
        with av.open(str(src), metadata_errors="ignore") as container:
            for frame in container.decode(audio=0):
                for converted in resampler.resample(frame):
                    piece = converted.to_ndarray().reshape(-1)
                    samples += len(piece)
                    if samples > max_s * REF_SAMPLE_RATE:
                        raise InvalidReference(f"Reference audio must be at most {max_s:g}s.")
                    pieces.append(piece)
            for converted in resampler.resample(None):
                pieces.append(converted.to_ndarray().reshape(-1))
        audio = np.concatenate(pieces).astype(np.float32) if pieces else np.zeros(0, dtype=np.float32)
    except InvalidReference:
        raise
    except Exception as exc:
        raise InvalidReference(f"Could not read the reference audio: {exc}") from exc
    duration = len(audio) / REF_SAMPLE_RATE
    if duration < min_s:
        raise InvalidReference(f"Reference audio is {duration:.1f}s; it must be at least {min_s:g}s.")
    if duration > max_s:
        raise InvalidReference(f"Reference audio is {duration:.1f}s; it must be at most {max_s:g}s.")
    if not np.isfinite(audio).all():
        raise InvalidReference("Reference contains invalid audio samples. Please re-record it.")
    if np.mean(np.abs(audio) >= 0.999) >= 0.02:
        raise InvalidReference("Reference is heavily clipped/distorted. Lower the microphone gain and re-record it.")
    audio = audio - float(np.mean(audio, dtype=np.float64))
    centered_peak = float(np.max(np.abs(audio)))
    if centered_peak > 0.99:
        audio *= 0.99 / centered_peak  # removing a large DC offset must not introduce clipping
    if float(np.sqrt(np.mean(audio.astype(np.float64) ** 2))) < 1e-4:
        raise InvalidReference("Reference is silent or too quiet. Record one clear speaker closer to the microphone.")
    # Locate quiet edges using 10ms frame energy; keep 150ms guards for soft
    # consonants. Internal pauses are untouched, preserving the speaker's cadence.
    frame_size = REF_SAMPLE_RATE // 100
    framed = np.pad(audio, (0, (-len(audio)) % frame_size)).reshape(-1, frame_size)
    energy = np.sqrt(np.mean(framed.astype(np.float64) ** 2, axis=1))
    active = np.flatnonzero(energy > max(1e-5, float(energy.max()) * 0.003))
    guard = int(0.15 * REF_SAMPLE_RATE)
    start = max(0, int(active[0]) * frame_size - guard)
    end = min(len(audio), (int(active[-1]) + 1) * frame_size + guard)
    audio = audio[start:end]
    duration = len(audio) / REF_SAMPLE_RATE
    if duration < min_s:
        raise InvalidReference(f"Reference has only {duration:.1f}s of usable audio; record at least {min_s:g}s.")
    sf.write(dest, audio, REF_SAMPLE_RATE, subtype="PCM_24")
    return duration


class VoiceCloneService:
    def __init__(self, settings: Settings, stt: SttService):
        self._settings = settings
        self._stt = stt
        self._engine: CloneEngine | None = None
        self._load_lock = threading.Lock()
        self._reuse_lock = threading.Lock()
        self._results = CloneMemoryCache[tuple[bytes, float]](
            settings.clone_cache_max_entries, settings.clone_cache_max_bytes, settings.clone_cache_ttl_s)

    @property
    def is_loaded(self) -> bool:
        return self._engine is not None

    def load(self) -> CloneEngine:
        if self._engine is None:
            with self._load_lock:
                if self._engine is None:
                    s = self._settings
                    if s.clone_engine == "voxcpm":
                        self._engine = VoxCpmCloneEngine(s)
                    else:
                        self._engine = get_omni_engine(s)
        return self._engine

    def run(self, job: CloneJob) -> None:
        """Worker entry point: transcribe the reference if needed, then synthesize."""
        if not job.reference_path.exists():
            # e.g. the saved voice was deleted while this job was waiting
            raise InvalidReference("The reference audio is no longer available.")
        # Revalidate old saved references too, without modifying the stored voice.
        prepared = job.work_dir / "prepared_reference.wav"
        try:
            s = self._settings
            load_reference(job.reference_path, prepared, s.clone_ref_min_s, s.clone_ref_max_s)
            if not job.ref_text:
                transcript = self._stt.transcribe(prepared)
                if not transcript.text.strip():
                    raise InvalidReference("No speech was detected in the reference audio.")
                job.ref_text, job.ref_text_source = transcript.text, "transcribed"

            language, text = prepare_text(job.text, job.lang)
            reuse = s.clone_cache_enabled and s.clone_engine == "omnivoice"
            key = _cache_key([1, job.user_id, job.voice_id, hashlib.sha256(prepared.read_bytes()).hexdigest(),
                              job.ref_text, language, text, job.speed, s.clone_model, s.clone_model_revision,
                              s.clone_device, s.clone_omni_steps])
            # Coalesce misses without skipping reference validation/transcription.
            with self._reuse_lock:
                job.cache_hit = False
                cached = self._results.get(key) if reuse and job.reuse_cached else None
                if cached is not None:
                    wav, job.duration = cached
                    job.output_path.write_bytes(wav)
                    job.cache_hit = True
                    return
                engine = self.load()
                options = {"num_step": s.clone_omni_steps, "preprocess_prompt": False} if s.clone_engine == "omnivoice" else {}
                if reuse and isinstance(engine, OmniVoiceEngine):
                    options["cache_scope"] = job.user_id
                wave = np.asarray(engine.clone(text, language, prepared, job.ref_text, job.speed, **options), dtype=np.float32)
                if wave.size == 0 or not np.isfinite(wave).all() or np.max(np.abs(wave)) < 1e-5:
                    raise RuntimeError("The model produced empty, silent or invalid audio.")
                sf.write(job.output_path, wave, engine.sample_rate)
                job.duration = round(len(wave) / engine.sample_rate, 2)
                if reuse:
                    self._results.put(key, (job.output_path.read_bytes(), job.duration), job.output_path.stat().st_size)
        finally:
            prepared.unlink(missing_ok=True)
