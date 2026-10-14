"""Zero-shot voice cloning.

The engine sits behind a small interface: OmniVoice (default; non-commercial
weights, runs on Apple Silicon) or VoxCPM2 (BONDETH_CLONE_ENGINE=voxcpm;
Apache-2.0, best on a CUDA GPU), see services/voxcpm.py.

The reference transcript matters: OmniVoice uses it to align the voice
sample. Without one, OmniVoice falls back to stock Whisper, which cannot
read Khmer, so we always supply it, transcribing with our own STT if needed.
"""

import logging
import threading
from pathlib import Path
from typing import Protocol

import numpy as np
import soundfile as sf

from app.config import Settings
from app.services import voxcpm
from app.services.clone_jobs import CloneJob
from app.services.stt import SttService
from app.text.english_normalizer import normalize_english
from app.text.khmer_normalizer import normalize_khmer
from app.text.script_split import dominant_lang

logger = logging.getLogger(__name__)

REF_SAMPLE_RATE = 16_000


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

    def clone(self, text, language, ref_audio, ref_text, speed):
        return self._model.generate(
            text=text, language=language, ref_audio=str(ref_audio), ref_text=ref_text, speed=speed,
        )[0]


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


def load_reference(src: Path, dest: Path, min_s: float, max_s: float) -> float:
    """Decode any audio format to 16 kHz mono WAV, enforcing the length limits."""
    from faster_whisper.audio import decode_audio

    try:
        audio = decode_audio(str(src), sampling_rate=REF_SAMPLE_RATE)
    except Exception as exc:
        raise InvalidReference(f"Could not read the reference audio: {exc}") from exc
    duration = len(audio) / REF_SAMPLE_RATE
    if duration < min_s:
        raise InvalidReference(f"Reference audio is {duration:.1f}s; it must be at least {min_s:g}s.")
    if duration > max_s:
        raise InvalidReference(f"Reference audio is {duration:.1f}s; it must be at most {max_s:g}s.")
    sf.write(dest, audio, REF_SAMPLE_RATE)
    return duration


class VoiceCloneService:
    def __init__(self, settings: Settings, stt: SttService):
        self._settings = settings
        self._stt = stt
        self._engine: CloneEngine | None = None
        self._load_lock = threading.Lock()

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
                        self._engine = OmniVoiceEngine(
                            s.clone_model, s.clone_model_revision, s.model_dir / "hf" / "hub", s.clone_device)
        return self._engine

    def run(self, job: CloneJob) -> None:
        """Worker entry point: transcribe the reference if needed, then synthesize."""
        if not job.reference_path.exists():
            # e.g. the saved voice was deleted while this job was waiting
            raise InvalidReference("The reference audio is no longer available.")
        if not job.ref_text:
            transcript = self._stt.transcribe(job.reference_path)
            if not transcript.text.strip():
                raise InvalidReference("No speech was detected in the reference audio.")
            job.ref_text, job.ref_text_source = transcript.text, "transcribed"

        language, text = prepare_text(job.text, job.lang)
        engine = self.load()
        wave = engine.clone(text, language, job.reference_path, job.ref_text, job.speed)
        wave = np.asarray(wave, dtype=np.float32)
        if wave.size == 0:
            raise RuntimeError("The model produced no audio.")
        sf.write(job.output_path, wave, engine.sample_rate)
        job.duration = round(len(wave) / engine.sample_rate, 2)
