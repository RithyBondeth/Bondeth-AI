"""Speech-to-text service.

Two engines:
- English: stock faster-whisper (large-v3-turbo).
- Khmer: a Khmer fine-tuned Whisper decoded via CTranslate2 (see khmer_stt.py).
  Stock Whisper cannot transcribe Khmer; it mistakes it for Thai or Vietnamese.

Auto mode uses stock Whisper's language detection, which is reliable for
English but scatters low-confidence guesses across many languages for Khmer.
So audio counts as English only when that detection is confident; everything
else goes to the Khmer engine (which also handles English words inside Khmer).

Models load lazily (or at startup with preloading enabled). Inference is
blocking, so callers must run `transcribe` in a worker thread.
"""

import logging
import threading
from dataclasses import dataclass, field
from pathlib import Path

from app.config import Settings

logger = logging.getLogger(__name__)

SAMPLE_RATE = 16_000


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
        self._whisper = None
        self._khmer = None
        self._load_lock = threading.Lock()
        self._slots = threading.Semaphore(settings.stt_max_concurrency)

    def loaded_engines(self) -> list[str]:
        return [name for name, eng in (("en", self._whisper), ("km", self._khmer)) if eng is not None]

    def load(self) -> None:
        self._load_whisper()
        self._load_khmer()

    def _load_whisper(self):
        if self._whisper is None:
            with self._load_lock:
                if self._whisper is None:
                    from faster_whisper import WhisperModel

                    s = self._settings
                    logger.info("Loading STT model %s on %s (%s)", s.stt_model, s.stt_device, s.stt_compute_type)
                    self._whisper = WhisperModel(
                        s.stt_model,
                        device=s.stt_device,
                        compute_type=s.stt_compute_type,
                        download_root=str(s.model_dir / "whisper"),
                    )
        return self._whisper

    def _load_khmer(self):
        if self._khmer is None:
            with self._load_lock:
                if self._khmer is None:
                    from huggingface_hub import snapshot_download

                    from app.services.khmer_stt import KhmerWhisperEngine

                    s = self._settings
                    logger.info("Loading Khmer STT model %s@%s", s.stt_km_model, s.stt_km_model_revision[:7])
                    path = snapshot_download(
                        s.stt_km_model,
                        revision=s.stt_km_model_revision,
                        cache_dir=str(s.model_dir / "hf" / "hub"),
                    )
                    self._khmer = KhmerWhisperEngine(
                        Path(path),
                        device=s.stt_device,
                        compute_type=s.stt_km_compute_type,
                        beam_size=s.stt_beam_size,
                        batch_size=s.stt_km_batch_size,
                    )
        return self._khmer

    def transcribe(self, audio_path: Path, language: str | None = None) -> Transcription:
        """Transcribe an audio file. `language=None` auto-detects between Khmer and English."""
        from faster_whisper.audio import decode_audio

        audio = decode_audio(str(audio_path), sampling_rate=SAMPLE_RATE)
        duration = round(len(audio) / SAMPLE_RATE, 2)

        with self._slots:
            if language is None:
                language, probability = self._detect(audio)
            else:
                probability = 1.0

            if language == "en":
                segments = self._transcribe_english(audio)
                text = " ".join(s.text for s in segments)
                segmented = text
            else:
                chunks = self._load_khmer().transcribe(audio)
                segments = [Segment(c.start, c.end, c.text) for c in chunks]
                text = " ".join(c.text for c in chunks)
                segmented = " ".join(c.segmented for c in chunks)

        return Transcription(
            language=language,
            language_probability=round(probability, 3),
            duration=duration,
            text=text,
            segmented_text=segmented,
            segments=segments,
        )

    def _detect(self, audio) -> tuple[str, float]:
        _, _, all_probs = self._load_whisper().detect_language(audio)
        p_en = dict(all_probs).get("en", 0.0)
        if p_en >= self._settings.stt_en_threshold:
            return "en", p_en
        return "km", 1.0 - p_en

    def _transcribe_english(self, audio) -> list[Segment]:
        segments_iter, _ = self._load_whisper().transcribe(
            audio,
            language="en",
            beam_size=self._settings.stt_beam_size,
            vad_filter=True,  # skip silence: faster and fewer hallucinations
        )
        # `segments_iter` is lazy; decoding actually happens while iterating.
        return [Segment(round(s.start, 2), round(s.end, 2), s.text.strip()) for s in segments_iter]
