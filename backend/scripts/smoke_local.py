"""Exercise real local voice endpoints with synthetic audio, writing playable results.

From backend/: .venv/bin/python -m scripts.smoke_local [--skip-clone]
Creates and deletes its own development-only account. Email verification uses a
local one-time token (the log email backend has no external mailbox).
"""
import argparse
import asyncio
import io
import json
import secrets
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse

import httpx
import numpy as np
import redis.asyncio
import soundfile as sf

from app.config import get_settings
from app.security import create_one_time_token

SAMPLES = {
    "en": "Hello, welcome to Bondeth AI. We are testing speech recognition and voice generation on this computer.",
    "km": "សួស្តី! ខ្ញុំស្រលាញ់ភាសាខ្មែរ។ ថ្ងៃនេះអាកាសធាតុល្អណាស់។",
    "mixed": "សួស្តី! Welcome to Bondeth AI. តម្លៃ $25 នៅថ្ងៃទី 13/10/2026។",
}


def audio_info(data: bytes) -> dict:
    wave, rate = sf.read(io.BytesIO(data))
    if len(wave) == 0 or not np.isfinite(wave).all() or np.abs(wave).max() <= 0.001:
        raise AssertionError("Empty, invalid, or silent generated audio")
    return {"sample_rate": rate, "duration_s": round(len(wave) / rate, 2),
            "peak": round(float(np.abs(wave).max()), 4)}


async def local_verification(user_id: str) -> str:
    client = redis.asyncio.Redis.from_url(get_settings().redis_url, decode_responses=True)
    try:
        return await create_one_time_token(client, "verify-email", user_id, 600)
    finally:
        await client.aclose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--out", type=Path, default=Path("tmp/local-smoke"))
    parser.add_argument("--skip-clone", action="store_true")
    args = parser.parse_args()
    if (get_settings().env != "development" or urlparse(args.url).hostname not in ("localhost", "127.0.0.1", "::1")):
        parser.error("This tool is restricted to a local development backend.")
    args.out.mkdir(parents=True, exist_ok=True)
    report = {"started_at": datetime.now(UTC).isoformat(), "checks": {}}
    with httpx.Client(base_url=args.url, timeout=600) as client:
        def request(method, path, **kwargs):
            res = client.request(method, path, **kwargs)
            if not res.is_success:
                raise AssertionError(f"{method} {path}: HTTP {res.status_code}: {res.text[:500]}")
            return res

        for language, text in SAMPLES.items():
            start = time.perf_counter()
            response = request("POST", "/api/v1/tts", json={"text": text, "lang": "auto" if language == "mixed" else language})
            info = audio_info(response.content)
            info.update(elapsed_s=round(time.perf_counter() - start, 2), cache=response.headers.get("X-Cache"))
            (args.out / f"tts_{language}.wav").write_bytes(response.content)
            report["checks"][f"tts_{language}"] = info
            print(f"tts_{language}: {info}", flush=True)

        for language in ("en", "km"):
            start = time.perf_counter()
            wav = (args.out / f"tts_{language}.wav").read_bytes()
            result = request("POST", "/api/v1/stt", files={"file": ("speech.wav", wav, "audio/wav")},
                             data={"language": "auto"}).json()
            if not result["text"].strip() or result["detected_language"] != language:
                raise AssertionError(f"Unexpected {language} transcription: {result}")
            report["checks"][f"stt_{language}"] = {"text": result["text"],
                "language": result["detected_language"], "elapsed_s": round(time.perf_counter() - start, 2)}
            print(f"stt_{language}: {report['checks'][f'stt_{language}']}", flush=True)

        headers = None
        password = secrets.token_urlsafe(24)
        try:
            signup = request("POST", "/api/v1/auth/register", json={
                "email": f"voice-smoke-{secrets.token_hex(6)}@example.com", "password": password,
                "full_name": "Local voice smoke test"}).json()
            headers = {"Authorization": "Bearer " + signup["access_token"]}
            report["test_user_id"] = signup["user"]["id"]
            token = asyncio.run(local_verification(signup["user"]["id"]))
            request("POST", "/api/v1/auth/verify-email", json={"token": token})
            wav = (args.out / "tts_en.wav").read_bytes()
            job = request("POST", "/api/v1/stt/jobs", headers=headers,
                          files={"file": ("speech.wav", wav, "audio/wav")}, data={"language": "en"}).json()
            events = []
            with client.stream("GET", f"/api/v1/stt/jobs/{job['job_id']}/events", headers=headers) as stream:
                stream.raise_for_status()
                for line in stream.iter_lines():
                    if line.startswith("event: "):
                        events.append(line[7:])
            if not events or events[-1] != "done" or "segment" not in events:
                raise AssertionError(f"Job stream did not finish: {events}")
            history = request("GET", "/api/v1/transcriptions", headers=headers).json()
            assert history["total"] == 1
            report["checks"]["stt_job"] = {"events": events, "history_saved": True}
            print(f"stt_job: {report['checks']['stt_job']}", flush=True)

            if not args.skip_clone:
                start = time.perf_counter()
                job = request("POST", "/api/v1/clone", headers=headers,
                              files={"reference_audio": ("synthetic.wav", wav, "audio/wav")},
                              data={"text": "Hello from Bondeth AI.", "lang": "en", "consent": "true",
                                    "reference_text": SAMPLES["en"]}).json()
                deadline = time.monotonic() + 600
                while time.monotonic() < deadline:
                    job = request("GET", f"/api/v1/clone/jobs/{job['job_id']}", headers=headers).json()
                    if job["status"] in ("done", "failed"):
                        break
                    time.sleep(1)
                if job["status"] != "done":
                    raise AssertionError(f"Clone did not finish: {job}")
                generated = request("GET", f"/api/v1/clone/jobs/{job['job_id']}/audio", headers=headers).content
                info = audio_info(generated)
                info["elapsed_s"] = round(time.perf_counter() - start, 2)
                (args.out / "clone_en.wav").write_bytes(generated)
                report["checks"]["clone"] = info
                print(f"clone: {info}", flush=True)

                voice = request("POST", "/api/v1/voices", headers=headers,
                                files={"reference_audio": ("synthetic.wav", wav, "audio/wav")},
                                data={"voice_alias": "Synthetic smoke voice", "consent": "true",
                                      "reference_text": SAMPLES["en"]}).json()
                assert request("GET", "/api/v1/voices", headers=headers).json()[0]["id"] == voice["id"]
                start = time.perf_counter()
                job = request("POST", "/api/v1/clone", headers=headers,
                              data={"voice_id": voice["id"], "text": "សួស្តី ខ្ញុំស្រលាញ់ភាសាខ្មែរ។", "lang": "km"}).json()
                deadline = time.monotonic() + 600
                while time.monotonic() < deadline:
                    job = request("GET", f"/api/v1/clone/jobs/{job['job_id']}", headers=headers).json()
                    if job["status"] in ("done", "failed"):
                        break
                    time.sleep(1)
                if job["status"] != "done":
                    raise AssertionError(f"Saved-voice clone did not finish: {job}")
                generated = request("GET", f"/api/v1/clone/jobs/{job['job_id']}/audio", headers=headers).content
                info = audio_info(generated)
                info["elapsed_s"] = round(time.perf_counter() - start, 2)
                info["reference_source"] = job["reference_text_source"]
                assert info["reference_source"] == "saved_voice"
                (args.out / "clone_km.wav").write_bytes(generated)
                request("DELETE", f"/api/v1/voices/{voice['id']}", headers=headers)
                assert request("GET", "/api/v1/voices", headers=headers).json() == []
                report["checks"]["saved_voice_clone"] = info
                print(f"saved_voice_clone: {info}", flush=True)
        finally:
            if headers:
                try:
                    deleted = client.request("DELETE", "/api/v1/auth/me", headers=headers, json={"password": password})
                    report["temporary_account_removed"] = deleted.status_code == 204
                except httpx.HTTPError:
                    report["temporary_account_removed"] = False
                print("Temporary test account removed:", report["temporary_account_removed"], flush=True)
            (args.out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(f"Real voice smoke test passed. Audio/report: {args.out.resolve()}", flush=True)


if __name__ == "__main__":
    main()
