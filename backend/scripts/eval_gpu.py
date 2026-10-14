"""GPU go/no-go evaluation: is VoxCPM2 good and fast enough to charge for, and is dictation real-time?

Runs everything on the current machine (meant for a CUDA GPU such as a T4) and writes
a report with audio samples to listen to:

1. Khmer STT on FLEURS: CER and real-time factor.
2. Live dictation: real FLEURS speech streamed in real time through the same
   LiveTranscriber as WS /stt/live; how long after each phrase ends its final text arrives.
3. Text-to-speech, VoxCPM2 vs MMS: speed, time to first audio (VoxCPM2 streaming),
   and intelligibility: each clip is transcribed back with our Khmer STT (CER vs the text).
4. Voice cloning, VoxCPM2 vs OmniVoice: speed and intelligibility, cloning a FLEURS speaker.
5. Peak GPU memory.

Engines that aren't installed are reported as skipped. Usage (from backend/):
    .venv/bin/python -m scripts.eval_gpu --out eval-results
On a GPU server, deploy/gpu/run-eval.sh runs this inside the GPU Docker image.
"""

import argparse
import io
import json
import platform
import statistics
import time
from dataclasses import dataclass, field
from pathlib import Path

import jiwer
import numpy as np
import soundfile as sf

from app.config import Settings, get_settings
from app.services.live_stt import SAMPLE_RATE, LiveConfig, LiveTranscriber
from app.services.stt import SttService
from scripts.eval_khmer_stt import load_clips, normalize

# Targets for a paid offering; the report marks each result against them.
TARGETS = {
    "dictation_lag_p90_s": 2.0,  # final text within 2 s of a pause (blueprint: under 2 s)
    "tts_rtf": 0.5,  # synthesis at least twice as fast as playback
    "tts_first_audio_s": 1.0,  # streaming TTS starts playing within a second
    "clone_rtf": 1.0,
}

MIXED_AND_ENGLISH = [
    ("mixed", "ខ្ញុំប្រើ Facebook និង YouTube រាល់ថ្ងៃ ហើយតម្លៃគឺ $25។"),
    ("english", "Hello, this is Bondeth AI reading English at a natural pace."),
]


@dataclass
class Report:
    environment: dict = field(default_factory=dict)
    sections: dict = field(default_factory=dict)

    def add(self, name: str, data: dict) -> None:
        self.sections[name] = data
        print(f"\n== {name} ==\n{json.dumps(data, indent=2, ensure_ascii=False)}")


def decode(audio_bytes: bytes) -> np.ndarray:
    audio, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32")
    audio = audio.mean(1) if audio.ndim > 1 else audio
    if sr != SAMPLE_RATE:
        audio = np.interp(np.arange(0, len(audio), sr / SAMPLE_RATE), np.arange(len(audio)), audio).astype(np.float32)
    return audio


def resample(wave: np.ndarray, sr: int) -> np.ndarray:
    if sr == SAMPLE_RATE:
        return wave
    return np.interp(np.arange(0, len(wave), sr / SAMPLE_RATE), np.arange(len(wave)), wave).astype(np.float32)


def cer(refs: list[str], hyps: list[str]) -> float:
    pairs = [(normalize(r), normalize(h)) for r, h in zip(refs, hyps) if normalize(r)]
    if not pairs:
        return float("nan")
    return round(jiwer.cer([r for r, _ in pairs], [h or "∅" for _, h in pairs]), 3)


def pct(values: list[float], q: float) -> float:
    return round(sorted(values)[min(len(values) - 1, int(q * len(values)))], 2) if values else float("nan")


def environment() -> dict:
    import torch

    env = {"python": platform.python_version(), "torch": torch.__version__, "cuda": torch.cuda.is_available()}
    if torch.cuda.is_available():
        props = torch.cuda.get_device_properties(0)
        env |= {"gpu": props.name, "vram_gb": round(props.total_memory / 2**30, 1)}
        torch.cuda.reset_peak_memory_stats()
    return env


# --- 1. STT ----------------------------------------------------------------------------

def eval_stt(stt: SttService, clips: list[tuple[np.ndarray, str]]) -> dict:
    refs, hyps, audio_s, proc_s = [], [], 0.0, 0.0
    for audio, ref in clips:
        t = time.perf_counter()
        hyps.append(stt.transcribe_audio(audio, "km").text)
        proc_s += time.perf_counter() - t
        refs.append(ref)
        audio_s += len(audio) / SAMPLE_RATE
    return {"clips": len(clips), "cer": cer(refs, hyps), "rtf": round(proc_s / audio_s, 3),
            "audio_s": round(audio_s, 1)}


# --- 2. Live dictation --------------------------------------------------------------------

def simulate_dictation(stt: SttService, audio: np.ndarray, partials: bool = True, frame_s: float = 0.1) -> dict:
    """Feed audio at real-time speed, stepping whenever the model is free (like the WebSocket loop)."""
    live = LiveTranscriber(lambda a, lang, preview: _text(stt, a, lang, preview), stt.speech_spans,
                           stt.detect_language, "km", LiveConfig(partials=partials))
    frame = int(frame_s * SAMPLE_RATE)
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes()
    start, sent, lags, first_partial = time.perf_counter(), 0, [], None

    def handle(events):
        nonlocal first_partial
        now = time.perf_counter() - start
        for e in events:
            if e["type"] == "final":
                lags.append(now - e["end"])
            elif e["type"] == "partial" and e["text"] and first_partial is None:
                first_partial = now

    while sent < len(pcm):
        due = int((time.perf_counter() - start) / frame_s) + 1  # frames that have "been spoken" by now
        while sent < min(len(pcm), due * frame * 2):
            live.add_pcm16(pcm[sent:sent + frame * 2])
            sent += frame * 2
        if live.has_new_audio:
            handle(live.step())
        else:
            time.sleep(0.02)
    handle(live.step(finish=True))
    return {"phrases": len(lags), "final_lag_median_s": pct(lags, 0.5), "final_lag_p90_s": pct(lags, 0.9),
            "first_partial_s": round(first_partial, 2) if first_partial else None}


def _text(stt, audio, lang, preview):
    r = stt.transcribe_audio(audio, lang, beam_size=2 if preview else None)
    return r.text, r.segmented_text


# --- 3. TTS -----------------------------------------------------------------------------

def eval_tts(settings: Settings, engine: str, sentences: list[tuple[str, str]], stt: SttService, out: Path) -> dict:
    from app.services.tts import TtsService, to_wav_bytes

    tts = TtsService(settings.model_copy(update={"tts_engine": engine}))
    tts.preload()  # load (and for VoxCPM2, design the house voice) outside the timings
    rows, refs, hyps = [], [], []
    for name, text in sentences:
        t = time.perf_counter()
        wave, sr = tts.synthesize(text, "auto")
        elapsed = time.perf_counter() - t
        duration = len(wave) / sr
        (out / f"tts_{engine}_{name}.wav").write_bytes(to_wav_bytes(wave, sr))
        heard = stt.transcribe_audio(resample(wave, sr), "km").text
        refs.append(text)
        hyps.append(heard)
        rows.append({"sample": name, "audio_s": round(duration, 2), "seconds": round(elapsed, 2),
                     "rtf": round(elapsed / duration, 3)})
    result = {"engine": engine, "sample_rate": sr, "rtf_median": round(statistics.median(r["rtf"] for r in rows), 3),
              "khmer_round_trip_cer": cer(refs[:-len(MIXED_AND_ENGLISH)], hyps[:-len(MIXED_AND_ENGLISH)]),
              "samples": rows}
    if engine == "voxcpm":
        result["first_audio_s"] = first_audio_voxcpm(tts, sentences[0][1])
    return result


def first_audio_voxcpm(tts, text: str) -> float:
    """Time until VoxCPM2's streaming generator yields its first chunk."""
    vox = tts._vox()
    ref, ref_text = vox.house_voice()
    t = time.perf_counter()
    stream = vox.model.generate_streaming(text=text, prompt_wav_path=str(ref), prompt_text=ref_text,
                                          reference_wav_path=str(ref))
    next(iter(stream))
    elapsed = time.perf_counter() - t
    stream.close()
    return round(elapsed, 2)


# --- 4. Cloning ---------------------------------------------------------------------------

def eval_clone(settings: Settings, engine: str, reference: tuple[np.ndarray, str], sentences: list[tuple[str, str]],
               stt: SttService, out: Path) -> dict:
    from app.services.clone_jobs import CloneJob
    from app.services.voice_clone import VoiceCloneService

    service = VoiceCloneService(settings.model_copy(update={"clone_engine": engine}), stt)
    service.load()
    ref_path = out / "clone_reference.wav"
    sf.write(ref_path, reference[0], SAMPLE_RATE)
    rows, refs, hyps = [], [], []
    for name, text in sentences:
        job = CloneJob(user_id="eval", text=text, lang="auto", speed=1.0, work_dir=out, reference_path=ref_path,
                       delete_reference=False, ref_text=reference[1])
        t = time.perf_counter()
        service.run(job)
        elapsed = time.perf_counter() - t
        target = out / f"clone_{engine}_{name}.wav"
        job.output_path.replace(target)
        wave, sr = sf.read(target, dtype="float32")
        heard = stt.transcribe_audio(resample(wave, sr), "km").text
        refs.append(text)
        hyps.append(heard)
        rows.append({"sample": name, "audio_s": job.duration, "seconds": round(elapsed, 2),
                     "rtf": round(elapsed / job.duration, 3) if job.duration else None})
    return {"engine": engine, "rtf_median": round(statistics.median(r["rtf"] for r in rows if r["rtf"]), 3),
            "khmer_round_trip_cer": cer(refs[:-len(MIXED_AND_ENGLISH)], hyps[:-len(MIXED_AND_ENGLISH)]),
            "samples": rows}


# --- Report ---------------------------------------------------------------------------------

def check(value, target, lower_is_better=True) -> str:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return "–"
    ok = value <= target if lower_is_better else value >= target
    return "✅" if ok else "❌"


def markdown(report: Report) -> str:
    env, s = report.environment, report.sections
    lines = ["# Bondeth AI GPU evaluation", "",
             f"Machine: **{env.get('gpu', 'no CUDA GPU')}** ({env.get('vram_gb', '–')} GB), torch {env['torch']}, "
             f"peak GPU memory {env.get('peak_vram_gb', '–')} GB.", ""]
    if stt := s.get("stt"):
        lines += ["## Khmer speech-to-text (FLEURS)", "", "| Clips | CER | Real-time factor |", "|---|---|---|",
                  f"| {stt['clips']} | {stt['cer']:.1%} | {stt['rtf']} |", ""]
    if d := s.get("dictation"):
        t = TARGETS["dictation_lag_p90_s"]
        lines += ["## Live dictation", "", "Delay from the end of a spoken phrase to its final text (real-time stream).", "",
                  "| Mode | Phrases | Median | p90 | First words | Target p90 ≤ 2 s |", "|---|---|---|---|---|---|"]
        for mode, r in d.items():
            first = f"{r['first_partial_s']} s" if r["first_partial_s"] else "–"
            lines.append(f"| {mode} | {r['phrases']} | {r['final_lag_median_s']} s | {r['final_lag_p90_s']} s | "
                         f"{first} | {check(r['final_lag_p90_s'], t)} |")
        lines.append("")
    for kind, label in (("tts", "Text-to-speech"), ("clone", "Voice cloning")):
        rows = [r for k, r in s.items() if k.startswith(kind + ":")]
        if not rows:
            continue
        target = TARGETS[f"{kind}_rtf"]
        lines += [f"## {label}", "", "Intelligibility: each Khmer clip is transcribed back with our STT; lower CER is clearer.",
                  "", f"| Engine | Real-time factor (target ≤ {target}) | Khmer round-trip CER | First audio |", "|---|---|---|---|"]
        for r in rows:
            if "skipped" in r:
                lines.append(f"| {r['engine']} | skipped: {r['skipped']} | | |")
                continue
            first = f"{r['first_audio_s']} s {check(r['first_audio_s'], TARGETS['tts_first_audio_s'])}" if "first_audio_s" in r else "–"
            lines.append(f"| {r['engine']} | {r['rtf_median']} {check(r['rtf_median'], target)} | "
                         f"{r['khmer_round_trip_cer']:.1%} | {first} |")
        lines.append("")
    lines += ["## Listen", "", "Numbers can't judge naturalness or speaker similarity. Listen to the `tts_*` and "
              "`clone_*` files next to this report (the cloned voice is `clone_reference.wav`).", ""]
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--out", type=Path, default=Path("eval-results"))
    ap.add_argument("--clips", type=int, default=20, help="FLEURS clips for STT accuracy and TTS sentences")
    ap.add_argument("--tts-sentences", type=int, default=6)
    ap.add_argument("--dictation-clips", type=int, default=5, help="FLEURS clips streamed for the dictation test")
    ap.add_argument("--skip", nargs="*", default=[], choices=["stt", "dictation", "tts", "clone", "omnivoice", "mms"])
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    settings = get_settings()
    report = Report(environment=environment())
    print(f"Environment: {report.environment}\nLoading STT and {args.clips} FLEURS clips...")
    stt = SttService(settings)
    stt.load()
    clips = [(decode(a), t) for a, t in load_clips("validation", args.clips)]
    stt.transcribe_audio(clips[0][0], "km")  # warm up

    if "stt" not in args.skip:
        report.add("stt", eval_stt(stt, clips))
    if "dictation" not in args.skip:
        gap = np.zeros(int(1.0 * SAMPLE_RATE), dtype=np.float32)
        speech = np.concatenate([x for a, _ in clips[:args.dictation_clips] for x in (a, gap)])
        report.add("dictation", {"with previews": simulate_dictation(stt, speech, partials=True),
                                 "finals only": simulate_dictation(stt, speech, partials=False)})

    sentences = [(f"fleurs{i:02d}", t) for i, (_, t) in enumerate(clips[1:1 + args.tts_sentences])] + MIXED_AND_ENGLISH
    engines = {"tts": [e for e in ("voxcpm", "mms") if e not in args.skip],
               "clone": [e for e in ("voxcpm", "omnivoice") if e not in args.skip]}
    reference = clips[0]
    for kind in ("tts", "clone"):
        if kind in args.skip:
            continue
        for engine in engines[kind]:
            try:
                if kind == "tts":
                    result = eval_tts(settings, engine, sentences, stt, args.out)
                else:
                    result = eval_clone(settings, engine, reference, sentences, stt, args.out)
            except ImportError as exc:
                result = {"engine": engine, "skipped": f"not installed ({exc.name})"}
            report.add(f"{kind}:{engine}", result)

    try:
        import torch
        if torch.cuda.is_available():
            report.environment["peak_vram_gb"] = round(torch.cuda.max_memory_allocated() / 2**30, 1)
    except ImportError:
        pass
    (args.out / "report.json").write_text(json.dumps({"environment": report.environment, **report.sections},
                                                     indent=2, ensure_ascii=False))
    (args.out / "report.md").write_text(markdown(report))
    print(f"\nWrote {args.out / 'report.md'} and the audio samples next to it.")


if __name__ == "__main__":
    main()
