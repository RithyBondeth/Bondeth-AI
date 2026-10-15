"""Verify real local cloning with a generic synthetic reference and disposable account.

Never reads or clones a user's saved voices. Run from backend/; log-email,
development environment and loopback API only. Deletes its own account/voice.
"""
import asyncio
import io
import json
import secrets
import time
from pathlib import Path

import httpx
import numpy as np
import soundfile as sf

from app.config import get_settings
from app.services.omni_tts import HOUSE_TEXT, house_path
from scripts.smoke_local import local_verification


def main():
    s = get_settings()
    if s.env != "development" or s.email_backend != "log":
        raise RuntimeError("Use only local development with the log email backend.")
    reference = house_path(s)
    if not reference.exists():
        raise RuntimeError("Generate the generic OmniVoice TTS house voice first.")
    out = Path("tmp/clone-speed-api")
    out.mkdir(parents=True, exist_ok=True)
    report = {"reference": "generic synthetic speaker", "checks": {}}
    headers = None
    password = secrets.token_urlsafe(24)
    with httpx.Client(base_url="http://127.0.0.1:8000", timeout=60) as c:
        def request(method, path, **kwargs):
            r = c.request(method, path, **kwargs)
            r.raise_for_status()
            return r

        health = request("GET", "/api/v1/health").json()
        if health["env"] != "development":
            raise RuntimeError("Refusing a non-development backend.")
        try:
            signup = request("POST", "/api/v1/auth/register", json={
                "email": f"clone-quality-{secrets.token_hex(8)}@example.com", "password": password,
                "full_name": "Disposable synthetic cloning test"}).json()
            headers = {"Authorization": "Bearer " + signup["access_token"]}
            token = asyncio.run(local_verification(signup["user"]["id"]))
            request("POST", "/api/v1/auth/verify-email", json={"token": token})
            buf = io.BytesIO()
            sf.write(buf, np.zeros(4 * 24000, dtype=np.float32), 24000, format="WAV")
            bad = c.post("/api/v1/clone", headers=headers, data={"text": "សួស្តី", "consent": "true",
                "reference_text": HOUSE_TEXT}, files={"reference_audio": ("silence.wav", buf.getvalue(), "audio/wav")})
            assert bad.status_code == 422
            assert request("GET", "/api/v1/usage", headers=headers).json()["quotas"]["clone_jobs"]["used"] == 0
            report["checks"]["silent_reference_rejected_and_refunded"] = True
            wav = reference.read_bytes()
            voice = request("POST", "/api/v1/voices", headers=headers,
                data={"voice_alias": "Synthetic quality test", "consent": "true", "reference_text": HOUSE_TEXT},
                files={"reference_audio": ("synthetic.wav", wav, "audio/wav")}).json()
            saved_url = f"/api/v1/voices/{voice['id']}/audio"
            saved_before = request("GET", saved_url, headers=headers).content
            assert sf.info(io.BytesIO(saved_before)).samplerate == 24000
            report["checks"]["saved_reference_24khz"] = True
            for name in ("upload", "saved_voice"):
                form = {"text": "សួស្តី! ខ្ញុំចូលចិត្តអានសៀវភៅ និងស្តាប់តន្ត្រី។", "lang": "km", "speed": "1"}
                files = None
                if name == "upload":
                    form.update(consent="true", reference_text=HOUSE_TEXT)
                    files = {"reference_audio": ("synthetic.wav", wav, "audio/wav")}
                else:
                    form["voice_id"] = voice["id"]
                start = time.perf_counter()
                job = request("POST", "/api/v1/clone", headers=headers, data=form, files=files).json()
                deadline = time.monotonic() + 600
                while job["status"] not in ("done", "failed") and time.monotonic() < deadline:
                    time.sleep(1)
                    job = request("GET", f"/api/v1/clone/jobs/{job['job_id']}", headers=headers).json()
                assert job["status"] == "done", job
                assert not job["cache_hit"]
                assert job["reference_text"] == HOUSE_TEXT
                assert job["reference_text_source"] == ("provided" if name == "upload" else "saved_voice")
                data = request("GET", job["audio_url"], headers=headers).content
                wave, sr = sf.read(io.BytesIO(data))
                assert sr == 24000 and wave.size and np.isfinite(wave).all() and np.max(np.abs(wave)) > 0.001
                (out / f"clone_{name}.wav").write_bytes(data)
                report["checks"][name] = {"audio_s": len(wave) / sr, "sample_rate": sr,
                    "generation_s": time.perf_counter()-start, "transcript_source": job["reference_text_source"]}
                assert not (s.data_dir / "clone_jobs" / job["job_id"] / "prepared_reference.wav").exists()
                print(name, report["checks"][name], flush=True)
                # A repeat is a new private job and still consumes one allowance,
                # but should reuse the exact successful WAV rather than synthesize.
                start = time.perf_counter()
                repeated = request("POST", "/api/v1/clone", headers=headers, data=form, files=files).json()
                deadline = time.monotonic() + 30
                while repeated["status"] not in ("done", "failed") and time.monotonic() < deadline:
                    time.sleep(0.1)
                    repeated = request("GET", f"/api/v1/clone/jobs/{repeated['job_id']}", headers=headers).json()
                assert repeated["status"] == "done" and repeated["cache_hit"], repeated
                assert request("GET", repeated["audio_url"], headers=headers).content == data
                report["checks"][name + "_repeat"] = {"wall_s": time.perf_counter()-start,
                    "cache_hit": True, "byte_identical": True}
                print(name + "_repeat", report["checks"][name + "_repeat"], flush=True)
            assert request("GET", saved_url, headers=headers).content == saved_before
            report["checks"]["saved_original_unchanged"] = True
            request("DELETE", f"/api/v1/voices/{voice['id']}", headers=headers)
        finally:
            if headers:
                request("DELETE", "/api/v1/auth/me", headers=headers, json={"password": password})
                report["test_account_removed"] = True
            (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("Real local clone checks passed; disposable account removed.", flush=True)


if __name__ == "__main__":
    main()
