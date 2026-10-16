"""Exercise the real local TTS API, including short Khmer phrases and cache reuse.

Run from backend/: .venv/bin/python -m scripts.check_short_khmer_tts
Uses only synthetic text; never captures a microphone or creates an account.
"""
import argparse
import io
import json
import time
from pathlib import Path
from urllib.parse import urlsplit

import httpx
import numpy as np
import soundfile as sf

CASES = [
    ("hello", "សួស្តី", "km", 1.0),
    ("thanks", "អរគុណ។", "km", 1.0),
    ("welcome", "សួស្តី! សូមស្វាគមន៍។", "km", 1.0),
    ("hello_fast", "សួស្តី", "km", 2.0),
    ("thanks_fast", "អរគុណ។", "km", 2.0),
    ("welcome_fast", "សួស្តី! សូមស្វាគមន៍។", "km", 2.0),
    ("hello_slow", "សួស្តី", "km", 0.5),
    ("sentence", "សួស្តី! ថ្ងៃនេះអាកាសធាតុល្អណាស់។ តើអ្នកសុខសប្បាយទេ?", "km", 1.0),
    ("english", "Welcome to Bondeth AI. Thank you for listening.", "en", 1.0),
    ("mixed", "ខ្ញុំប្រើ Facebook និង YouTube រាល់ថ្ងៃ។", "km", 1.0),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--out", type=Path, default=Path("tmp/short-khmer-tts"))
    parser.add_argument("--cases", nargs="+", choices=[case[0] for case in CASES],
                        help="Optional subset for repeating a specific regression.")
    args = parser.parse_args()
    url = urlsplit(args.base_url)
    if (url.scheme not in ("http", "https") or url.hostname not in ("localhost", "127.0.0.1", "::1")
            or url.username or url.password or url.query or url.fragment or url.path not in ("", "/")):
        parser.error("Use a local loopback API URL without credentials, a path, or query parameters.")

    args.out.mkdir(parents=True, exist_ok=True)
    report = {"note": "Audio validity and API regression check, not a naturalness or pronunciation score.",
              "cases": [], "complete": False}
    cases = [case for case in CASES if not args.cases or case[0] in args.cases]
    with httpx.Client(base_url=args.base_url, timeout=180, trust_env=False,
                      limits=httpx.Limits(max_keepalive_connections=0)) as client:
        health = client.get("/api/v1/health")
        health.raise_for_status()
        if health.json().get("env") != "development":
            parser.error("This smoke check is restricted to a local development backend.")
        cached_case = None
        for name, text, lang, speed in cases:
            start = time.monotonic()
            response = client.post("/api/v1/tts", json={"text": text, "lang": lang, "speed": speed})
            if not response.is_success:
                report["failure"] = {"name": name, "speed": speed, "status": response.status_code}
                (args.out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
            response.raise_for_status()
            wave, rate = sf.read(io.BytesIO(response.content))
            engine = response.headers.get("x-tts-engine")
            fallback = response.headers.get("x-tts-fallback")
            assert engine in ("omnivoice", "mms"), "Select the OmniVoice TTS engine."
            if engine == "mms":
                assert name not in ("sentence", "english", "mixed"), "Do not switch control voices."
                assert fallback == "short-khmer-omni-failed" and response.headers.get("x-cache") == "BYPASS"
            else:
                assert fallback == "none"
                if cached_case is None:
                    cached_case = (text, lang, speed, response.content)
            assert rate == (16000 if engine == "mms" else 24000)
            assert wave.ndim == 1 and wave.size and np.isfinite(wave).all()
            assert np.max(np.abs(wave)) > 1e-5 and np.sqrt(np.mean(wave ** 2)) > 1e-4
            assert np.max(np.abs(wave)) < 1, "Audio must not clip."
            (args.out / f"{name}.wav").write_bytes(response.content)
            row = {"name": name, "text": text, "speed": speed, "status": response.status_code,
                   "engine": engine, "fallback": fallback,
                   "cache": response.headers.get("x-cache"), "sample_rate": rate,
                   "audio_seconds": round(len(wave) / rate, 3), "elapsed_seconds": round(time.monotonic() - start, 2)}
            report["cases"].append(row)
            print(json.dumps(row, ensure_ascii=False), flush=True)
            (args.out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")

        if cached_case:
            text, lang, speed, original = cached_case
            repeated = client.post("/api/v1/tts", json={"text": text, "lang": lang, "speed": speed})
            repeated.raise_for_status()
            assert repeated.headers.get("x-cache") == "HIT" and repeated.content == original
            assert repeated.headers.get("x-tts-engine") == "omnivoice"
            assert repeated.headers.get("x-tts-fallback") == "none"
            report["cache_reuse"] = "byte-identical OmniVoice HIT"
        else:
            report["cache_reuse"] = "not applicable: all clips used uncached MMS fallback"
    report["complete"] = True
    (args.out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(f"Passed {len(cases)} real API cases. Cache: {report['cache_reuse']}. Report: {args.out / 'report.json'}")


if __name__ == "__main__":
    main()
