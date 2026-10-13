"""Speech-to-text service backed by faster-whisper.

The model is loaded lazily on first use (or at startup when preloading is
enabled) and inference is blocking, so callers must run `transcribe` in a
worker thread rather than directly inside an async route.
"""

import logging
import threading
from dataclasses import dataclass, field
from pathlib import Path

from app.config import Settings
from app.text.khmer_segmenter import segment_khmer

logger = logging.getLogger(__name__)

SUPPORTED_LANGUAGES = {"km", "en"}


@dataclass
class Segment:
    start: float
    end: float
    text: str


@dataclass
class Transcription:
    language: str
    language_probability: float
    duration: float
    text: str
    segmented_text: str
    segments: list[Segment] = field(default_factory=list)


class SttService:
    def __init__(self, settings: Settings):
        self._settings = settings
        self._model = None
        self._load_lock = threading.Lock()
        self._slots = threading.Semaphore(settings.stt_max_concurrency)

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    def load(self):
        if self._model is None:
            with self._load_lock:
                if self._model is None:
                    from faster_whisper import WhisperModel

                    s = self._settings
                    logger.info("Loading STT model %s on %s (%s)", s.stt_model, s.stt_device, s.stt_compute_type)
                    self._model = WhisperModel(
                        s.stt_model,
                        device=s.stt_device,
                        compute_type=s.stt_compute_type,
                        download_root=str(s.model_dir / "whisper"),
                    )
        return self._model

    def transcribe(self, audio_path: Path, language: str | None = None) -> Transcription:
        """Transcribe an audio file. `language=None` auto-detects."""
        model = self.load()
        with self._slots:
            segments_iter, info = model.transcribe(
                str(audio_path),
                language=language,
                beam_size=self._settings.stt_beam_size,
                vad_filter=True,  # skip silence: faster and fewer hallucinations
            )
            # `segments_iter` is lazy; decoding actually happens while iterating.
            segments = [Segment(round(s.start, 2), round(s.end, 2), s.text.strip()) for s in segments_iter]

        if info.language == "km":
            # Whisper separates Khmer segments arbitrarily; rejoin before segmenting words.
            text = "".join(s.text for s in segments)
            segmented = segment_khmer(text)
        else:
            text = " ".join(s.text for s in segments)
            segmented = text

        return Transcription(
            language=info.language,
            language_probability=round(info.language_probability, 3),
            duration=round(info.duration, 2),
            text=text,
            segmented_text=segmented,
            segments=segments,
        )
