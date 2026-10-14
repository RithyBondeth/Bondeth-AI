"""Fake engines so API tests run instantly without loading ML models."""

import io

import numpy as np
import soundfile as sf

from app.services.stt import Transcription


def wav_bytes(seconds: float, sr: int = 16_000) -> bytes:
    t = np.arange(int(seconds * sr)) / sr
    buf = io.BytesIO()
    sf.write(buf, (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), sr, format="WAV")
    return buf.getvalue()


class FakeStt:
    def __init__(self, text: str = "ខ្ញុំស្រលាញ់ភាសាខ្មែរ"):
        self.text, self.calls = text, []

    def transcribe(self, path, language=None):
        assert path.exists(), "audio should be on disk during transcription"
        self.calls.append((path, language))
        return Transcription("km", 0.98, 5.0, self.text, self.text)


class FakeEngine:
    sample_rate = 24_000

    def __init__(self, fail: bool = False):
        self.fail, self.calls = fail, []

    def clone(self, text, language, ref_audio, ref_text, speed):
        assert ref_audio.exists(), "reference must exist while generating"
        self.calls.append((text, language, ref_text, speed))
        if self.fail:
            raise RuntimeError("engine exploded")
        return np.zeros(self.sample_rate, dtype=np.float32)  # 1 s
