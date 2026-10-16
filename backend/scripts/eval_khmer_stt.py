"""Measure Khmer STT accuracy on Google FLEURS (km_kh).

Streams selected clips of a FLEURS split (no full download), runs them
through the same SttService the API uses, and reports:
- CER (character error rate). Spaces, punctuation and digit script are
  ignored: Khmer word spacing and writing "៨" vs "8" are style choices,
  not recognition errors.
- auto-mode language detection accuracy
- real-time factor (processing time / audio duration)

Usage (from backend/):
    .venv/bin/python -m scripts.eval_khmer_stt --clips 30
    .venv/bin/python -m scripts.eval_khmer_stt --clips 30 --mode km   # skip detection
    .venv/bin/python -m scripts.eval_khmer_stt --manifest tmp/fleurs/meta.json --mode km \
        --offset 6 --clips 24 --report tmp/candidate.json --compare tmp/baseline.json
"""

import argparse
import hashlib
import io
import json
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


def load_clips(split: str, n: int, offset: int = 0) -> list[tuple[bytes, str]]:
    import pyarrow.parquet as pq
    from huggingface_hub import HfFileSystem

    if n < 1 or offset < 0:
        raise ValueError("clips must be positive and offset nonnegative")
    clips = []
    seen = 0
    with HfFileSystem().open(FLEURS.format(split=split), "rb", block_size=8 << 20) as f:
        for batch in pq.ParquetFile(f).iter_batches(batch_size=min(n, 100), columns=["audio", "transcription"]):
            for row in batch.to_pylist():
                if seen >= offset:
                    clips.append((row["audio"]["bytes"], row["transcription"]))
                seen += 1
                if len(clips) == n:
                    return clips
    return clips


def load_manifest(path: Path, n: int, offset: int = 0) -> list[tuple[bytes, str]]:
    """Local list of {file, transcription}; audio paths are relative to the manifest."""
    if n < 1 or offset < 0:
        raise ValueError("clips must be positive and offset nonnegative")
    rows = json.loads(path.read_text())
    return [((path.parent / r["file"]).read_bytes(), r["transcription"])
            for r in rows[offset:offset + n]]


def compare_reports(baseline: dict, candidate: dict) -> dict:
    """Never report an accuracy delta for different recordings or references."""
    def inputs(report):
        return [(r["audio_sha256"], r["reference"]) for r in report["results"]]
    if not baseline.get("complete") or not candidate.get("complete"):
        raise ValueError("Both reports must be complete")
    if not inputs(baseline) or inputs(baseline) != inputs(candidate):
        raise ValueError("Comparison requires the same audio and references in the same order")
    before, after = baseline["cer"], candidate["cer"]
    return {"baseline_cer": before, "candidate_cer": after,
            "absolute_reduction": before - after,
            "relative_reduction": (before - after) / before if before else None}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--clips", type=int, default=30)
    ap.add_argument("--split", default="validation", choices=["validation", "test", "train"])
    ap.add_argument("--mode", default="auto", choices=["auto", "km"])
    ap.add_argument("--offset", type=int, default=0, help="skip this many split/manifest rows")
    ap.add_argument("--manifest", type=Path, help="use cached/local audio and references instead of downloading")
    ap.add_argument("--report", type=Path, help="save reproducible JSON results, including per-clip errors")
    ap.add_argument("--compare", type=Path, help="compare with a complete report on identical inputs")
    ap.add_argument("-v", "--verbose", action="store_true", help="print every reference/hypothesis pair")
    args = ap.parse_args()
    if args.clips < 1 or args.offset < 0:
        ap.error("--clips must be positive and --offset nonnegative")

    settings = get_settings()
    stt = SttService(settings)
    print(f"Loading models and {args.clips} FLEURS {args.split} clips...")
    # Forced Khmer should not load an unrelated 1.6 GB English model.
    if args.mode == "km":
        stt._load_khmer()
    else:
        stt.load()
    clips = (load_manifest(args.manifest, args.clips, args.offset) if args.manifest
             else load_clips(args.split, args.clips, args.offset))
    if not clips:
        ap.error("No clips at the requested offset")
    report = {"complete": False, "dataset": "local manifest" if args.manifest else "google/fleurs",
              "manifest": str(args.manifest) if args.manifest else None,
              "split": args.split, "offset": args.offset, "mode": args.mode,
              "model": settings.stt_km_model, "revision": settings.stt_km_model_revision,
              "compute_type": settings.stt_km_compute_type, "beam_size": settings.stt_beam_size,
              "results": []}
    import ctranslate2
    from faster_whisper.audio import decode_audio
    report["ctranslate2"] = ctranslate2.__version__

    refs, hyps, detected_km, audio_s, proc_s = [], [], 0, 0.0, 0.0
    for i, (wav, ref) in enumerate(clips):
        audio = decode_audio(io.BytesIO(wav), sampling_rate=16_000)
        t = time.perf_counter()
        res = stt.transcribe_audio(audio, None if args.mode == "auto" else "km")
        elapsed = time.perf_counter() - t
        proc_s += elapsed
        audio_s += res.duration
        detected_km += res.language == "km"
        refs.append(normalize(ref))
        hyps.append(normalize(res.text))
        clip_cer = jiwer.cer(refs[-1], hyps[-1])
        errors = jiwer.process_characters(refs[-1], hyps[-1])
        report["results"].append({"index": args.offset + i, "audio_sha256": hashlib.sha256(wav).hexdigest(),
                                  "reference": ref, "hypothesis": res.text, "cer": clip_cer,
                                  "duration": res.duration, "processing_s": elapsed,
                                  "language": res.language, "substitutions": errors.substitutions,
                                  "deletions": errors.deletions, "insertions": errors.insertions})
        print(f"[{i + 1:>3}/{len(clips)}] {res.duration:5.1f}s  lang={res.language}  CER={clip_cer:.3f}")
        if args.verbose:
            print(f"      REF: {ref}\n      HYP: {res.text}")
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")

    print("\n=== Results ===")
    print(f"Clips:               {len(clips)} ({audio_s / 60:.1f} min of audio)")
    print(f"CER:                 {jiwer.cer(refs, hyps):.3f}")
    if args.mode == "auto":
        print(f"Detected as Khmer:   {detected_km}/{len(clips)}")
    print(f"Real-time factor:    {proc_s / audio_s:.2f}  (lower is faster; <1 = faster than real time)")
    report.update(complete=True, cer=jiwer.cer(refs, hyps), clips=len(clips), audio_s=audio_s,
                  processing_s=proc_s, rtf=proc_s / audio_s, detected_km=detected_km)
    if args.compare:
        report["comparison"] = compare_reports(json.loads(args.compare.read_text()), report)
        print(json.dumps(report["comparison"], indent=2))
    if args.report:
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
