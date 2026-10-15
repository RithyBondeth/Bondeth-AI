"""Reproducible cloning listening comparison using a generic synthetic speaker.

No real person's voice is cloned by this script. Use before/after folders with
identical reference/target hashes. ASR agreement is not speaker similarity.
"""
import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

from app.config import get_settings
from app.services.clone_jobs import CloneJob
from app.services.omni_tts import HOUSE_TEXT, house_path
from app.services.stt import SttService
from app.services.voice_clone import VoiceCloneService, load_reference
from scripts.eval_khmer_tts import round_trip_cer

TARGETS = [
    ("khmer", "សួស្តី! នេះជាសំឡេងរបស់ខ្ញុំ។ ខ្ញុំចូលចិត្តអានសៀវភៅ និងស្តាប់តន្ត្រី។", "km"),
    ("mixed", "ខ្ញុំប្រើ Facebook និង YouTube រាល់ថ្ងៃ។", "auto"),
]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--compare", type=Path)
    ap.add_argument("--skip-asr", action="store_true")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    s = get_settings()
    src = house_path(s)
    if not src.exists():
        ap.error("Generate the synthetic OmniVoice TTS house voice first; no user recordings are used.")
    ref = args.out / "reference.wav"
    duration = load_reference(src, ref, s.clone_ref_min_s, s.clone_ref_max_s)
    stt = SttService(s)
    if not args.skip_asr:
        stt._load_khmer()
    clone = VoiceCloneService(s, stt)
    clone.load()
    report = {"reference_kind": "generic synthetic speaker", "reference_text": HOUSE_TEXT,
              "original_reference_sha256": hashlib.sha256(src.read_bytes()).hexdigest(),
              "reference_sample_rate": sf.info(ref).samplerate, "reference_s": duration,
              "model": s.clone_model, "revision": s.clone_model_revision,
              "seed": 777, "complete": False, "samples": [],
              "note": "Listening samples only; no validated speaker-identity similarity score."}
    for name, text, lang in TARGETS:
        job = CloneJob(user_id="synthetic-eval", text=text, lang=lang, speed=1,
                       work_dir=args.out, reference_path=ref, ref_text=HOUSE_TEXT, delete_reference=False)
        with torch.random.fork_rng(devices=[]):
            torch.manual_seed(report["seed"])
            start = time.perf_counter()
            clone.run(job)
            elapsed = time.perf_counter()-start
        target = args.out / f"clone_{name}.wav"
        job.output_path.replace(target)
        wave, sr = sf.read(target, dtype="float32")
        assert np.isfinite(wave).all() and wave.size
        row = {"name": name, "text": text, "lang": lang, "sample_rate": sr,
               "audio_s": len(wave)/sr, "generation_s": elapsed, "peak": float(np.max(np.abs(wave)))}
        if not args.skip_asr:
            row["heard"] = stt.transcribe(target, "km").text
            row["round_trip_cer"] = round_trip_cer(text, row["heard"], "km")
        report["samples"].append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
        (args.out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    report["complete"] = True
    if args.compare:
        old = json.loads(args.compare.read_text())
        if not old.get("complete") or old["original_reference_sha256"] != report["original_reference_sha256"] or [
                (r["name"], r["text"]) for r in old["samples"]] != [(r["name"], r["text"]) for r in report["samples"]]:
            raise ValueError("Compare only identical original references and targets")
        report["baseline"] = str(args.compare)
    (args.out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
