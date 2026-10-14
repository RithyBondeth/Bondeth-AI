"""VoxCPM2 (Apache-2.0): a commercially usable engine for both voice cloning and TTS.

MMS-TTS and OmniVoice weights are CC BY-NC, so they can't back a paid offering.
VoxCPM2 is a 2B-parameter multilingual model (Khmer and English among its 30
languages, no language tag needed) with 48 kHz output. It wants ~8 GB of VRAM
on CUDA; Apple Silicon (MPS) and CPU work but are much slower.

One model instance serves both uses (loading it twice would double the memory):
- Cloning ("ultimate cloning"): the reference clip is passed as both prompt and
  reference, with its transcript, for the closest match.
- Standard TTS: without a reference VoxCPM2 picks a new voice on every call, so a
  house voice is designed once from a text description, saved under data_dir,
  and cloned from then on. Delete that file to design a new one.

VoxCPM2 has no speed control; speed is passed as a style hint, so it's approximate.

Install with `pip install -r requirements-voxcpm.txt`, then set
BONDETH_CLONE_ENGINE=voxcpm and/or BONDETH_TTS_ENGINE=voxcpm.
"""

import logging
import threading
from pathlib import Path

import numpy as np
import soundfile as sf

from app.config import Settings

logger = logging.getLogger(__name__)

# Spoken once to create the house voice; long enough (~8 s) to clone from.
HOUSE_VOICE_SCRIPT = ("Hello, and welcome to Bondeth AI. I read Khmer and English clearly, "
                      "at a calm and natural pace.")

_model = None
_model_lock = threading.Lock()


def load_model(settings: Settings):
    """The process-wide VoxCPM2 model, loaded on first use."""
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from huggingface_hub import snapshot_download
                from voxcpm import VoxCPM

                s = settings
                path = snapshot_download(s.voxcpm_model, revision=s.voxcpm_model_revision,
                                         cache_dir=str(s.model_dir / "hf" / "hub"))
                logger.info("Loading VoxCPM2 %s@%s on %s", s.voxcpm_model, s.voxcpm_model_revision[:7], s.voxcpm_device)
                # No denoiser (it pulls a separate ModelScope model); torch.compile only on CUDA.
                _model = VoxCPM(voxcpm_model_path=path, zipenhancer_model_path=None, enable_denoiser=False,
                                optimize=s.voxcpm_device.startswith("cuda"),
                                device=None if s.voxcpm_device == "auto" else s.voxcpm_device)
    return _model


def is_loaded() -> bool:
    return _model is not None


def style_for_speed(speed: float) -> str:
    """VoxCPM2 takes style hints in parentheses at the start of the text."""
    if speed >= 1.35:
        return "(fast pace)"
    if speed >= 1.1:
        return "(slightly faster pace)"
    if speed <= 0.7:
        return "(slow, unhurried pace)"
    if speed <= 0.9:
        return "(slightly slower pace)"
    return ""


class VoxCpm:
    """Thin wrapper: one generation at a time (the model isn't safe to share across threads)."""

    def __init__(self, settings: Settings, model=None):
        self._s = settings
        self._model = model
        self._lock = threading.Lock()
        self._design_lock = threading.Lock()

    @property
    def model(self):
        if self._model is None:
            self._model = load_model(self._s)
        return self._model

    @property
    def sample_rate(self) -> int:
        return self.model.tts_model.sample_rate

    def _generate(self, text: str, **kwargs) -> np.ndarray:
        with self._lock:
            wave = self.model.generate(text=text, cfg_value=self._s.voxcpm_cfg_value,
                                       inference_timesteps=self._s.voxcpm_inference_timesteps, **kwargs)
        return np.asarray(wave, dtype=np.float32)

    def clone(self, text: str, ref_audio: Path, ref_text: str | None, speed: float = 1.0) -> np.ndarray:
        prompt = {"prompt_wav_path": str(ref_audio), "prompt_text": ref_text} if ref_text else {}
        return self._generate(style_for_speed(speed) + text, reference_wav_path=str(ref_audio), **prompt)

    def house_voice(self) -> tuple[Path, str]:
        """(reference wav, its transcript) for standard TTS, designing the voice on first use."""
        path = self._s.data_dir / "voxcpm" / "house_voice.wav"
        with self._design_lock:
            if not path.exists():
                logger.info("Designing the VoxCPM2 house voice: %s", self._s.voxcpm_house_voice)
                wave = self._generate(f"({self._s.voxcpm_house_voice}){HOUSE_VOICE_SCRIPT}")
                path.parent.mkdir(parents=True, exist_ok=True)
                tmp = path.with_suffix(".tmp.wav")
                sf.write(tmp, wave, self.sample_rate)
                tmp.replace(path)
        return path, HOUSE_VOICE_SCRIPT
