"""Measure Khmer STT accuracy on Google FLEURS (km_kh).

Streams the first N clips of a FLEURS split (no full download), runs them
through the same SttService the API uses, and reports:
- CER (character error rate). Spaces, punctuation and digit script are
  ignored: Khmer word spacing and writing "៨" vs "8" are style choices,
  not recognition errors.
- auto-mode language detection accuracy
- real-time factor (processing time / audio duration)

Usage (from backend/):
    .venv/bin/python -m scripts.eval_khmer_stt --clips 30
    .venv/bin/python -m scripts.eval_khmer_stt --clips 30 --mode km   # skip detection
"""

import argparse
import io
import re
import time
from pathlib import Path

import jiwer

from app.config import get_settings
from app.services.stt import SttService

FLEURS = "datasets/google/fleurs/parquet-data/km_kh/{split}-00000-of-00001.parquet"
_IGNORED = re.compile(r"[\s។៕,.?!\"'()\-]")
_KHMER_DIGITS = str.maketrans("០១២៣៤៥៦៧៨៩", "0123456789")


def normalize(text: str) -> str:
    return _IGNORED.sub("", text.translate(_KHMER_DIGITS)).lower()


def load_clips(split: str, n: int) -> list[tuple[bytes, str]]:
    import pyarrow.parquet as pq
    from huggingface_hub import HfFileSystem

    with HfFileSystem().open(FLEURS.format(split=split), "rb", block_size=8 << 20) as f:
        batch = next(pq.ParquetFile(f).iter_batches(batch_size=n, columns=["audio", "transcription"]))
    return [(r["audio"]["bytes"], r["transcription"]) for r in batch.to_pylist()]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--clips", type=int, default=30)
    ap.add_argument("--split", default="validation", choices=["validation", "test", "train"])
    ap.add_argument("--mode", default="auto", choices=["auto", "km"])
    ap.add_argument("-v", "--verbose", action="store_true", help="print every reference/hypothesis pair")
    args = ap.parse_args()

    settings = get_settings()
    settings.tmp_dir.mkdir(parents=True, exist_ok=True)
    stt = SttService(settings)
    print(f"Loading models and {args.clips} FLEURS {args.split} clips...")
    stt.load()
    clips = load_clips(args.split, args.clips)

    refs, hyps, detected_km, audio_s, proc_s = [], [], 0, 0.0, 0.0
    for i, (wav, ref) in enumerate(clips):
        path = settings.tmp_dir / f"eval_{i}.wav"
        path.write_bytes(wav)
        try:
            t = time.perf_counter()
            res = stt.transcribe(path, None if args.mode == "auto" else "km")
            proc_s += time.perf_counter() - t
        finally:
            path.unlink(missing_ok=True)
        audio_s += res.duration
        detected_km += res.language == "km"
        refs.append(normalize(ref))
        hyps.append(normalize(res.text))
        clip_cer = jiwer.cer(refs[-1], hyps[-1]) if refs[-1] else 0.0
        print(f"[{i + 1:>3}/{len(clips)}] {res.duration:5.1f}s  lang={res.language}  CER={clip_cer:.3f}")
        if args.verbose:
            print(f"      REF: {ref}\n      HYP: {res.text}")

    print("\n=== Results ===")
    print(f"Clips:               {len(clips)} ({audio_s / 60:.1f} min of audio)")
    print(f"CER:                 {jiwer.cer(refs, hyps):.3f}")
    if args.mode == "auto":
        print(f"Detected as Khmer:   {detected_km}/{len(clips)}")
    print(f"Real-time factor:    {proc_s / audio_s:.2f}  (lower is faster; <1 = faster than real time)")


if __name__ == "__main__":
    main()
