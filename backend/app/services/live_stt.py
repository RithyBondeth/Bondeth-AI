"""Live dictation: turn a growing stream of microphone audio into partial and final text.

Whisper isn't a streaming model, so this uses the usual "rolling window" approach:
audio not yet finalized sits in a window that is re-transcribed as often as the
model allows, and each result is sent as a *partial*. When the speaker pauses (or
the window nears Whisper's 30 s limit) the audio up to the pause is transcribed
one last time and sent as *final*, then dropped from the window. Long silences are
dropped without transcribing.

This class does no I/O, so its policy can be tested without models or sockets.
`add` may be called from the event loop while `step` runs in a worker thread.
"""

import re
import threading
from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

SAMPLE_RATE = 16_000
DETECT_AFTER_S = 1.5  # speech needed before auto mode picks Khmer or English
KEEP_TAIL_S = 0.5  # when dropping silence, keep a little in case a word is starting


@dataclass
class LiveConfig:
    pause_s: float = 0.6  # silence that ends a phrase
    max_window_s: float = 25.0  # finalize before Whisper's 30 s window is full
    silence_drop_s: float = 3.0  # a window with no speech at all is dropped after this
    partials: bool = True  # preview the phrase in progress (costly on CPU)


_LOOP = re.compile(r"(.{1,20}?)(?:\s*\1){4,}")


def looks_degenerate(text: str) -> bool:
    """Whisper can loop on a fragment ("និង និង និង…", "ស្រាប់ស្រាប់ស្រាប់…"); such previews are dropped.

    Khmer has no spaces between words, so this looks for any short fragment repeated 5+ times.
    """
    return bool(_LOOP.search(text))


class LiveTranscriber:
    def __init__(self, transcribe: Callable[[np.ndarray, str, bool], tuple[str, str]],
                 speech_spans: Callable[[np.ndarray], list[tuple[float, float]]],
                 detect_language: Callable[[np.ndarray], str],
                 language: str | None = None, config: LiveConfig | None = None):
        """`transcribe(audio, lang, preview) -> (text, segmented_text)`; `language=None` detects it once.

        `preview=True` marks a partial, which may use faster, less accurate decoding.
        """
        self._transcribe = transcribe
        self._spans = speech_spans
        self._detect = detect_language
        self.language = language
        self._cfg = config or LiveConfig()
        self._window = np.zeros(0, dtype=np.float32)
        self._incoming: list[np.ndarray] = []
        self._lock = threading.Lock()
        self.offset_s = 0.0  # stream time at the start of the window
        self.finals: list[dict] = []
        self._last_partial = ""

    # --- Event-loop side -----------------------------------------------------------

    def add_pcm16(self, data: bytes) -> float:
        """Queue little-endian 16-bit mono 16 kHz samples; returns their length in seconds."""
        samples = np.frombuffer(data[: len(data) - len(data) % 2], dtype="<i2").astype(np.float32) / 32768.0
        with self._lock:
            self._incoming.append(samples)
        return len(samples) / SAMPLE_RATE

    @property
    def has_new_audio(self) -> bool:
        with self._lock:
            return bool(self._incoming)

    # --- Worker side ---------------------------------------------------------------

    @property
    def text(self) -> str:
        return " ".join(f["text"] for f in self.finals if f["text"])

    @property
    def segmented_text(self) -> str:
        return " ".join(f["segmented_text"] for f in self.finals if f["segmented_text"])

    def step(self, finish: bool = False) -> list[dict]:
        """Process what has arrived; returns events to send. `finish=True` finalizes everything."""
        with self._lock:
            if self._incoming:
                self._window = np.concatenate([self._window, *self._incoming])
                self._incoming.clear()
        window_s = len(self._window) / SAMPLE_RATE
        if window_s == 0:
            return []

        spans = self._spans(self._window)
        if not spans:
            if finish:
                return self._cut(len(self._window), transcribe=False)
            if window_s >= self._cfg.silence_drop_s:  # nothing said: let it go
                self._cut(len(self._window) - int(KEEP_TAIL_S * SAMPLE_RATE), transcribe=False)
            return []

        if self.language is None:
            speech_s = sum(end - start for start, end in spans)
            if speech_s < DETECT_AFTER_S and not finish:
                return []
            self.language = self._detect(self._window)

        # Every pause inside the window ends a phrase. (Several can pile up when audio
        # arrives faster than the model keeps up, e.g. on a CPU.)
        events: list[dict] = []
        while len(spans) > 1:
            gap = next((i for i in range(len(spans) - 1) if spans[i + 1][0] - spans[i][1] >= self._cfg.pause_s), None)
            if gap is None:
                break
            events += self._cut(int((spans[gap][1] + 0.2) * SAMPLE_RATE))
            spans = self._spans(self._window)
        window_s = len(self._window) / SAMPLE_RATE
        if not spans:
            return events

        last_end = spans[-1][1]
        if finish:
            return events + self._cut(len(self._window))
        if window_s - last_end >= self._cfg.pause_s:  # the speaker paused: finalize that phrase
            return events + self._cut(int(min(last_end + 0.2, window_s) * SAMPLE_RATE))
        if window_s >= self._cfg.max_window_s:  # no pause for too long: cut at the last gap
            gaps = [spans[i][1] for i in range(len(spans) - 1) if spans[i][1] >= 2.0]
            return events + self._cut(int((gaps[-1] if gaps else window_s) * SAMPLE_RATE))

        if not self._cfg.partials:
            return events
        text, _ = self._transcribe(self._window, self.language, True)
        if text == self._last_partial or looks_degenerate(text):
            return events
        self._last_partial = text
        return events + [{"type": "partial", "text": text}]

    def _cut(self, n_samples: int, transcribe: bool = True) -> list[dict]:
        """Finalize the first n samples of the window and drop them."""
        n_samples = max(0, min(n_samples, len(self._window)))
        head, self._window = self._window[:n_samples], self._window[n_samples:]
        start, end = self.offset_s, self.offset_s + n_samples / SAMPLE_RATE
        self.offset_s = end
        events = []
        if transcribe and n_samples:
            text, segmented = self._transcribe(head, self.language or "km", False)
            if text:
                final = {"type": "final", "text": text, "segmented_text": segmented,
                         "start": round(start, 2), "end": round(end, 2)}
                self.finals.append(final)
                events.append(final)
        if self._last_partial:
            self._last_partial = ""
            events.append({"type": "partial", "text": ""})
        return events
