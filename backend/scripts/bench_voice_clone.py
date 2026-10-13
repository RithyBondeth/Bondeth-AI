"""Benchmark voice cloning: speed and intelligibility.

Clones a real Khmer speaker from FLEURS with the configured clone engine,
generates a few test sentences, and checks intelligibility by transcribing
each result with our Khmer STT (CER vs. the intended text). Speaker
similarity is not measured; listen to the files in the output folder.

Usage (from backend/):
    .venv/bin/python -m scripts.bench_voice_clone
    .venv/bin/python -m scripts.bench_voice_clone --clip 24 --out tmp/clone_bench
"""

import argparse
import time
from pathlib import Path

import jiwer
import soundfile as sf

from app.config import get_settings
from app.services.stt import SttService
from app.services.voice_clone import VoiceCloneService, load_reference, prepare_text
from scripts.eval_khmer_stt import load_clips, normalize

SENTENCES = {
    "khmer": "សួស្តី! ខ្ញុំឈ្មោះបណ្ឌិត។ ថ្ងៃនេះយើងនឹងរៀនពីរបៀបប្រើប្រាស់បច្ចេកវិទ្យាសំឡេង។",
    "mixed": "ខ្ញុំប្រើ Facebook និង YouTube រាល់ថ្ងៃ។",
    "english": "Hello, this is a cloned voice speaking English for the Bondeth AI demo.",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--clip", type=int, default=24, help="FLEURS validation clip to use as the voice")
    ap.add_argument("--out", type=Path, default=Path("tmp/clone_bench"))
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    settings = get_settings()
    stt = SttService(settings)
    clone = VoiceCloneService(settings, stt)

    wav, ref_text = load_clips("validation", args.clip + 1)[args.clip]
    raw_ref = args.out / "reference_raw.wav"
    raw_ref.write_bytes(wav)
    ref = args.out / "reference.wav"
    ref_s = load_reference(raw_ref, ref, settings.clone_ref_min_s, settings.clone_ref_max_s)
    raw_ref.unlink()
    print(f"Reference: FLEURS clip {args.clip}, {ref_s:.1f}s\n  {ref_text}")

    t = time.perf_counter()
    engine = clone.load()
    print(f"Clone model loaded in {time.perf_counter() - t:.1f}s\n")

    for name, text in SENTENCES.items():
        language, prepared = prepare_text(text, "auto")
        t = time.perf_counter()
        wave = engine.clone(prepared, language, ref, ref_text, 1.0)
        gen_s = time.perf_counter() - t
        audio_s = len(wave) / engine.sample_rate
        out = args.out / f"clone_{name}.wav"
        sf.write(out, wave, engine.sample_rate)

        heard = stt.transcribe(out)
        cer = jiwer.cer(normalize(text), normalize(heard.text))
        print(f"{name:8} gen={gen_s:5.1f}s audio={audio_s:4.1f}s RTF={gen_s / audio_s:4.2f} "
              f"CER={cer:.2f} [{heard.language}]  heard: {heard.text}")

    print(f"\nAudio written to {args.out}/")


if __name__ == "__main__":
    main()
