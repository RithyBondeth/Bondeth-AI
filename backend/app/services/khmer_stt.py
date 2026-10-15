"""Khmer speech recognition with a Khmer fine-tuned Whisper, decoded via CTranslate2.

The fine-tune (whisper-turbo-khmer-v9) adds ~6k Khmer word pieces to the
vocabulary *after* Whisper's special tokens. faster-whisper treats every id
past <|endoftext|> as a control token and drops it, so this engine runs the
model through CTranslate2 directly and strips control tokens by name instead.

The model emits khmercut-style output: words separated by spaces and phrase
groups separated by ";". We turn that into normal Khmer text (no spaces
inside a phrase) plus a word-segmented version.
"""

import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16_000
N_FRAMES = 3_000  # Whisper's fixed 30 s input window
N_SAMPLES = 30 * SAMPLE_RATE
MAX_DECODER_POSITIONS = 448
MAX_CHUNK_S = 29.0
# Khmer speech runs ~8 tokens/s (14 at most on FLEURS). Capping output at about twice that per
# second of audio stops a decoding loop early instead of letting it run to Whisper's 448 tokens.
MAX_TOKENS_PER_S = 25

_SPECIAL_RE = re.compile(r"<\|.*\|>")
_KHMER_GAP_RE = re.compile(r"(?<=[ក-៿])\s+(?=[ក-៿])")


@dataclass
class KhmerChunk:
    start: float
    end: float
    text: str  # normal Khmer: spaces only between phrases and around Latin words
    segmented: str  # every word separated by a space


def clean_khmer_output(raw: str) -> tuple[str, str]:
    """'ការ ដើម ឡើយ ; នៅ ភាគ' -> ('ការដើមឡើយ នៅភាគ', 'ការ ដើម ឡើយ នៅ ភាគ')"""
    groups = [" ".join(g.split()) for g in raw.split(";")]
    groups = [g for g in groups if g]
    text = " ".join(_KHMER_GAP_RE.sub("", g) for g in groups)
    return text, " ".join(groups)


class KhmerWhisperEngine:
    def __init__(self, model_dir: Path, device: str, compute_type: str, beam_size: int, batch_size: int):
        import ctranslate2
        from faster_whisper.feature_extractor import FeatureExtractor
        from tokenizers import Tokenizer

        self._ct2 = ctranslate2
        self._model = ctranslate2.models.Whisper(str(model_dir), device=device, compute_type=compute_type)
        self._features = FeatureExtractor(feature_size=self._model.n_mels)
        self._tokenizer = Tokenizer.from_file(str(model_dir / "tokenizer.json"))
        self._beam_size = beam_size
        self._batch_size = batch_size

        vocab = json.loads((model_dir / "vocabulary.json").read_text())
        self._special_ids = {i for i, tok in enumerate(vocab) if _SPECIAL_RE.fullmatch(tok)}
        self._prompt = [vocab.index(t) for t in
                        ("<|startoftranscript|>", "<|km|>", "<|transcribe|>", "<|notimestamps|>")]

    def transcribe(self, audio: np.ndarray, on_chunk: Callable[[KhmerChunk], None] | None = None,
                   beam_size: int | None = None) -> list[KhmerChunk]:
        from faster_whisper.vad import VadOptions, get_speech_timestamps

        # Split on silence into <30 s pieces so long recordings fit Whisper's window.
        spans = get_speech_timestamps(
            audio, VadOptions(max_speech_duration_s=MAX_CHUNK_S, min_silence_duration_ms=500))
        chunks: list[KhmerChunk] = []
        # The first piece is decoded alone so streaming clients see text as soon as possible.
        starts = [0, *range(1, len(spans), self._batch_size)] if spans else []
        for i, start in enumerate(starts):
            batch = spans[start:starts[i + 1] if i + 1 < len(starts) else len(spans)]
            feats = np.stack([self._mel(audio[s["start"]:s["end"]]) for s in batch])
            duration = max(s["end"] - s["start"] for s in batch) / SAMPLE_RATE
            # CTranslate2 4.8.3 internally caps generated tokens at max_length // 2.
            # Compensate for that API behavior, NOT by exceeding Whisper's context:
            # prompt + generated tokens must still fit in 448 decoder positions.
            # The runtime is pinned in requirements.txt; recheck on upgrades.
            token_budget = min(MAX_DECODER_POSITIONS - len(self._prompt),
                               16 + int(MAX_TOKENS_PER_S * duration))
            results = self._model.generate(
                self._ct2.StorageView.from_array(feats),
                [self._prompt] * len(batch),
                beam_size=beam_size or self._beam_size,
                max_length=2 * token_budget,
            )
            for span, res in zip(batch, results):
                ids = [t for t in res.sequences_ids[0] if t not in self._special_ids]
                text, segmented = clean_khmer_output(self._tokenizer.decode(ids))
                if text:
                    chunks.append(KhmerChunk(
                        round(span["start"] / SAMPLE_RATE, 2), round(span["end"] / SAMPLE_RATE, 2), text, segmented))
                    if on_chunk:
                        on_chunk(chunks[-1])
        return chunks

    def _mel(self, audio: np.ndarray) -> np.ndarray:
        # Pad in waveform space, as in the model's training preprocessor. Zero in
        # log-Mel space is not silence and also changes the end-of-speech features.
        if len(audio) > N_SAMPLES:
            raise ValueError("Khmer STT chunks must not exceed 30 seconds")
        padded = np.pad(audio, (0, N_SAMPLES - len(audio)))
        return self._features(padded, padding=0)[:, :N_FRAMES].astype(np.float32)
