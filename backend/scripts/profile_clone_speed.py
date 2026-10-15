"""Measure reference reuse with unchanged 48-step settings and synthetic speech only.

Run with the local API stopped to avoid loading two models on a small Mac.
No recordings or saved voices belonging to a person are read.
"""
import argparse
import hashlib
import importlib.metadata
import json
import statistics
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

from app.config import get_settings
from app.services.omni_tts import HOUSE_TEXT, house_path
from app.services.voice_clone import VoiceCloneService, load_reference, prepare_text

TARGETS = [
    ("khmer", "សួស្តី! នេះជាសំឡេងរបស់ខ្ញុំ។ ខ្ញុំចូលចិត្តអានសៀវភៅ និងស្តាប់តន្ត្រី។", "km"),
    ("mixed", "ខ្ញុំប្រើ Facebook និង YouTube រាល់ថ្ងៃ។", "auto"),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--runs", type=int, default=3)
    args = parser.parse_args()
    if args.runs < 2:
        parser.error("Use at least two repetitions to expose timing variance.")
    s = get_settings()
    if s.clone_engine != "omnivoice":
        parser.error("This measurement is for the installed OmniVoice engine.")
    source = house_path(s)
    if not source.exists():
        parser.error("Generate the generic synthetic OmniVoice TTS reference first.")
    args.out.mkdir(parents=True, exist_ok=True)
    reference = args.out / "reference.wav"
    load_reference(source, reference, s.clone_ref_min_s, s.clone_ref_max_s)
    engine = VoiceCloneService(s, None).load()
    model = engine._model
    stages = {}

    def sync():
        if str(model.device).startswith("mps"):
            torch.mps.synchronize()
        elif str(model.device).startswith("cuda"):
            torch.cuda.synchronize()

    def timed(name):
        original = getattr(model, name)
        def wrapper(*a, **kw):
            sync()
            start = time.perf_counter()
            result = original(*a, **kw)
            sync()
            stages[name] = stages.get(name, 0) + time.perf_counter() - start
            return result
        setattr(model, name, wrapper)

    for name in ("create_voice_clone_prompt", "_generate_iterative", "_decode_and_post_process"):
        timed(name)
    options = {"num_step": s.clone_omni_steps, "preprocess_prompt": False}

    def generate(text, lang, prompt=None):
        torch.manual_seed(777)
        stages.clear()
        sync()
        start = time.perf_counter()
        with torch.inference_mode():
            result = model.generate(text=text, language=lang, speed=1, **options,
                **({"voice_clone_prompt": prompt} if prompt is not None else
                   {"ref_audio": str(reference), "ref_text": HOUSE_TEXT}))[0]
        sync()
        return result, time.perf_counter() - start, dict(stages)

    print(json.dumps({"device": str(model.device), "threads": torch.get_num_threads(),
                      "attention": model.llm.config._attn_implementation}), flush=True)
    # Warm all kernels before comparing reference reuse, not cold vs warm loading.
    warm_lang, warm_text = prepare_text(TARGETS[0][1], TARGETS[0][2])
    generate(warm_text, warm_lang)
    with torch.inference_mode():
        prompt = model.create_voice_clone_prompt(str(reference), HOUSE_TEXT, preprocess_prompt=False)
    report = {"reference_kind": "generic synthetic speaker", "steps": s.clone_omni_steps,
              "model": s.clone_model, "revision": s.clone_model_revision, "seed": 777,
              "reference_sha256": hashlib.sha256(reference.read_bytes()).hexdigest(),
              "device": str(model.device), "dtype": str(model.dtype),
              "runtime": {name: importlib.metadata.version(name) for name in ("omnivoice", "torch", "transformers")},
              "samples": [], "complete": False}
    for name, text, lang in TARGETS:
        language, text = prepare_text(text, lang)
        baseline = None
        for repeat in range(args.runs):
            for mode in ("raw", "reused_prompt") if repeat % 2 == 0 else ("reused_prompt", "raw"):
                wave, elapsed, timing = generate(text, language, prompt if mode == "reused_prompt" else None)
                assert wave.size and np.isfinite(wave).all()
                if baseline is None:
                    baseline = wave.copy()
                row = {"name": name, "mode": mode, "repeat": repeat, "total_s": elapsed,
                       "stages": timing, "audio_s": len(wave)/engine.sample_rate,
                       "identical_to_first": bool(np.array_equal(wave, baseline)),
                       "sha256": hashlib.sha256(wave.tobytes()).hexdigest()}
                report["samples"].append(row)
                sf.write(args.out / f"{name}-{mode}-{repeat}.wav", wave, engine.sample_rate, subtype="FLOAT")
                print(json.dumps(row), flush=True)
                (args.out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    report["summary"] = {name: {mode: statistics.median(r["total_s"] for r in report["samples"]
        if r["name"] == name and r["mode"] == mode) for mode in ("raw", "reused_prompt")}
        for name, _, _ in TARGETS}
    report["complete"] = True
    report["quality_preserved"] = all(row["identical_to_first"] for row in report["samples"])
    (args.out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report["summary"]), flush=True)
    if not report["quality_preserved"]:
        raise RuntimeError("Reference reuse changed the waveform: do not accept it as a lossless speed improvement.")


if __name__ == "__main__":
    main()
