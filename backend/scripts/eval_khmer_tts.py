"""Generate reproducible listening samples; ASR round-trip is NOT a naturalness score.

From backend/: python -m scripts.eval_khmer_tts --out tmp/tts-before
Repeat with --compare tmp/tts-before/report.json after a pipeline change.
"""
import argparse
import hashlib
import json
import time
from pathlib import Path

import jiwer
import numpy as np
import torch

from app.config import get_settings
from app.services.stt import SttService
from app.services.tts import TtsService, to_wav_bytes
from app.text.english_normalizer import normalize_english
from app.text.khmer_normalizer import normalize_khmer
from scripts.eval_khmer_stt import normalize

SAMPLES = [
    ("greeting", "សួស្តី! ថ្ងៃនេះអាកាសធាតុល្អណាស់។ តើអ្នកសុខសប្បាយទេ?", "km"),
    ("narration", "យើងនឹងរៀនពីរបៀបប្រើប្រាស់បច្ចេកវិទ្យាសំឡេង ដើម្បីជួយសម្រួលដល់ការរស់នៅប្រចាំថ្ងៃ។", "km"),
    ("clauses", "សូមស្តាប់ដោយយកចិត្តទុកដាក់, បន្ទាប់មកអានអត្ថបទនេះម្ដងទៀត។", "km"),
    ("numbers", "តម្លៃ $25.50 នៅថ្ងៃទី 13/10/2026 បញ្ចុះតម្លៃ 20%។", "km"),
    ("mixed", "ខ្ញុំប្រើ Facebook និង YouTube រាល់ថ្ងៃ។", "km"),
    ("english", "Welcome to Bondeth AI. Thank you for listening.", "en"),
]


def round_trip_cer(expected: str, heard: str, lang: str) -> float:
    # ASR may write 25/២៥ for spoken ម្ភៃប្រាំ. Compare spoken forms rather
    # than scoring a transcription formatting choice as failed pronunciation.
    verbalize = normalize_khmer if lang == "km" else normalize_english
    return jiwer.cer(normalize(verbalize(expected)), normalize(verbalize(heard)))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--compare", type=Path)
    ap.add_argument("--noise", type=float, help="diagnostic override of Khmer acoustic variation")
    ap.add_argument("--duration-noise", type=float, help="diagnostic override of Khmer timing variation")
    ap.add_argument("--skip-asr", action="store_true")
    ap.add_argument("--engine", choices=["mms", "omnivoice"], default="mms")
    ap.add_argument("--samples", nargs="+", choices=[r[0] for r in SAMPLES], help="optional sample subset")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    s = get_settings().model_copy(update={"tts_engine": args.engine})
    tts = TtsService(s)
    tts.preload()
    voice = tts.load("km") if args.engine == "mms" else None
    if voice and args.noise is not None:
        voice.model.noise_scale = args.noise
    if voice and args.duration_noise is not None:
        voice.model.noise_scale_duration = args.duration_noise
    stt = None if args.skip_asr else SttService(s)
    if stt:
        stt.load()
    report = {"engine": tts.engine, "model": s.tts_model_km if voice else s.clone_model, "seed": 555,
              "noise": voice.model.noise_scale if voice else None,
              "duration_noise": voice.model.noise_scale_duration if voice else None,
              "tts_source_sha256": hashlib.sha256(Path("app/services/tts.py").read_bytes()).hexdigest(),
              "note": "ASR round-trip measures recognizer agreement, NOT human naturalness or MOS.",
              "metric": "spoken-form-round-trip-cer-v1",
              "samples": [], "complete": False}
    for name, text, lang in SAMPLES:
        if args.samples and name not in args.samples:
            continue
        # Reproducible offline evaluation only; do not seed the live server's global RNG.
        with torch.random.fork_rng(devices=[]):
            torch.manual_seed(report["seed"])
            start = time.perf_counter()
            wave, sr = tts.synthesize(text, lang)
            elapsed = time.perf_counter() - start
        assert np.isfinite(wave).all() and wave.size and np.max(np.abs(wave)) > 0
        (args.out / f"{name}.wav").write_bytes(to_wav_bytes(wave, sr))
        _, chunks = tts.prepare(text, lang)
        expected = " ".join(t for _, t in chunks)
        row = {"name": name, "text": text, "language": lang, "spoken_text": expected,
               "chunks": chunks, "sample_rate": sr, "audio_s": len(wave) / sr, "generation_s": elapsed,
               "peak": float(np.max(np.abs(wave))), "rms": float(np.sqrt(np.mean(wave ** 2))),
               "edge_jump": float(max(abs(wave[0]), abs(wave[-1]))),
               "clipped_samples": int(np.count_nonzero(np.abs(wave) >= 1))}
        if stt:
            row["heard"] = stt.transcribe_audio(wave, lang).text
            row["round_trip_cer"] = round_trip_cer(expected, row["heard"], lang)
        report["samples"].append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
        (args.out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    report["complete"] = True
    if args.compare:
        before = json.loads(args.compare.read_text())
        old_rows = [r for r in before["samples"] if not args.samples or r["name"] in args.samples]
        if not before.get("complete") or [(r["name"], r["text"]) for r in old_rows] != [
                (r["name"], r["text"]) for r in report["samples"]]:
            raise ValueError("Comparison requires complete reports with identical listening scripts")
        report["baseline"] = str(args.compare)
        if stt:
            report["comparison"] = [{"sample": old["name"],
                "baseline_round_trip_cer": round_trip_cer(old["spoken_text"], old["heard"], old["language"]),
                "candidate_round_trip_cer": new["round_trip_cer"]}
                for old, new in zip(old_rows, report["samples"])]
    (args.out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
