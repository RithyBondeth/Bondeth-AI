"""Quality-first TTS using the installed OmniVoice model (non-commercial weights).

Designs a generic synthetic Khmer speaker once; reuses that generated reference
for a stable voice across languages and requests. No real person's sample is used.
"""
import hashlib
import json
import logging
import threading
import uuid
from pathlib import Path

import numpy as np
import soundfile as sf
from filelock import FileLock

from app.config import Settings
from app.services.errors import SpeechGenerationError
from app.services.voice_clone import get_omni_engine
from app.text.speech_duration import khmer_speech_duration

HOUSE_TEXT = "សួស្តី! សូមស្វាគមន៍មកកាន់កម្មវិធីរបស់យើង។ ខ្ញុំនឹងអានអត្ថបទជាភាសាខ្មែរយ៉ាងច្បាស់ និងធម្មជាតិ។"
TTS_GENERATION_VERSION = 5  # invalidate speech cached before the short-phrase timing policy
MIN_KHMER_DURATION = 3.0
SHORT_KHMER_RETRY_DURATION = 4.0
_house_lock = threading.Lock()
logger = logging.getLogger(__name__)


def usable_audio(wave: np.ndarray) -> bool:
    return (wave.ndim == 1 and wave.size > 0 and np.isfinite(wave).all()
            and np.max(np.abs(wave)) > 1e-5)


def house_path(s: Settings) -> Path:
    identity = [2, s.clone_model, s.clone_model_revision, s.tts_omni_voice, HOUSE_TEXT]
    key = hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest()[:24]
    return s.data_dir / "tts_omnivoice" / f"{key}.wav"


class OmniTts:
    sample_rate = 24_000

    def __init__(self, settings: Settings):
        self._s = settings
        self._engine = None

    @property
    def loaded(self) -> bool:
        return self._engine is not None

    @property
    def engine(self):
        if self._engine is None:
            self._engine = get_omni_engine(self._s)
        return self._engine

    def house_voice(self) -> Path:
        path = house_path(self._s)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Thread and cross-process locks protect shared volumes; atomic publication
        # prevents another API replica from reading a partially written reference.
        with _house_lock, FileLock(str(path.with_suffix(".lock"))):
            if not path.exists():
                wave = np.asarray(self.engine.design(HOUSE_TEXT, self._s.tts_omni_voice), dtype=np.float32)
                if wave.size < 3 * self.sample_rate or not np.isfinite(wave).all() or np.max(np.abs(wave)) < 1e-5:
                    raise RuntimeError("The synthetic house voice was too short, silent or invalid; retry generation.")
                tmp = path.with_name(f"{path.stem}.{uuid.uuid4().hex}.tmp.wav")
                try:
                    sf.write(tmp, wave, self.sample_rate)
                    tmp.replace(path)
                finally:
                    tmp.unlink(missing_ok=True)
        return path

    def speak(self, text: str, language: str | None, speed: float) -> np.ndarray:
        duration = khmer_speech_duration(text, speed, self._s.tts_omni_khmer_chars_per_second)
        # Tiny fixed windows can produce only near-silence, which the model's
        # postprocessor removes entirely. Keep this floor absolute at fast speeds;
        # trimming still removes unused silence. Do not retime English or cloning.
        if duration is not None:
            duration = max(MIN_KHMER_DURATION, duration)
        reference = self.house_voice()
        wave = np.asarray(self.engine.clone(text, language, reference, HOUSE_TEXT, speed,
                                           duration=duration), dtype=np.float32)
        if not usable_audio(wave) and duration is not None and duration < SHORT_KHMER_RETRY_DURATION:
            # One bounded recovery for stochastic short-phrase failures, retaining
            # the same text, speaker, engine, decoding steps and sampling defaults.
            logger.warning("Retrying short Khmer TTS with a %.1fs window", SHORT_KHMER_RETRY_DURATION)
            wave = np.asarray(self.engine.clone(text, language, reference, HOUSE_TEXT, speed,
                                               duration=SHORT_KHMER_RETRY_DURATION), dtype=np.float32)
        if not usable_audio(wave):
            raise SpeechGenerationError(
                "The speech model returned no usable audio. Please retry or use a slightly longer phrase.")
        return wave
