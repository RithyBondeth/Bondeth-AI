import io
import os
import threading
import time

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from app.config import get_settings
from app.deps import get_clone_queue
from app.main import app
from app.services.clone_jobs import CloneJobQueue
from app.services.stt import Transcription
from app.services.voice_clone import VoiceCloneService, prepare_text

client = TestClient(app)


def wav_bytes(seconds: float, sr: int = 16_000) -> bytes:
    t = np.arange(int(seconds * sr)) / sr
    buf = io.BytesIO()
    sf.write(buf, (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32), sr, format="WAV")
    return buf.getvalue()


class FakeStt:
    def __init__(self, text="ខ្ញុំស្រលាញ់ភាសាខ្មែរ"):
        self.text, self.calls = text, 0

    def transcribe(self, path, language=None):
        self.calls += 1
        return Transcription("km", 0.99, 5.0, self.text, self.text)


class FakeEngine:
    sample_rate = 24_000

    def __init__(self, fail=False):
        self.fail, self.calls = fail, []

    def clone(self, text, language, ref_audio, ref_text, speed):
        assert ref_audio.exists(), "reference must exist while generating"
        self.calls.append((text, language, ref_text, speed))
        if self.fail:
            raise RuntimeError("engine exploded")
        return np.zeros(self.sample_rate, dtype=np.float32)  # 1 s


def make_service(engine=None, stt=None) -> VoiceCloneService:
    svc = VoiceCloneService(get_settings(), stt or FakeStt())
    svc._engine = engine or FakeEngine()
    return svc


@pytest.fixture
def clone_env():
    """Fresh queue per test, backed by a VoiceCloneService with fake engine and STT."""
    env = {"engine": FakeEngine(), "stt": FakeStt()}
    service = make_service(env["engine"], env["stt"])
    env["queue"] = CloneJobQueue(service.run, max_pending=10, ttl_s=3600)
    app.dependency_overrides[get_clone_queue] = lambda: env["queue"]
    yield env
    app.dependency_overrides.clear()
    env["queue"].shutdown()


def post_clone(seconds=5.0, **data):
    form = {"text": "សួស្តី", "consent": "true", **data}
    return client.post("/api/v1/clone", data=form,
                       files={"reference_audio": ("voice.wav", wav_bytes(seconds), "audio/wav")})


def wait_for(job_id, timeout=10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/api/v1/clone/jobs/{job_id}").json()
        if body["status"] in ("done", "failed"):
            return body
        time.sleep(0.02)
    raise AssertionError("job did not finish")


# --- Text preparation ----------------------------------------------------------------

def test_prepare_text_auto_lets_engine_handle_code_switching():
    assert prepare_text("តម្លៃ $25 សម្រាប់ iPhone", "auto") == (None, "តម្លៃ ម្ភៃប្រាំដុល្លារ សម្រាប់ iPhone")


def test_prepare_text_english_keeps_casing():
    assert prepare_text("Bondeth AI costs $7", "en") == ("en", "Bondeth AI costs seven dollars")


# --- Validation ----------------------------------------------------------------------

def test_consent_required(clone_env):
    assert post_clone(consent="false").status_code == 403
    res = client.post("/api/v1/clone", data={"text": "hi"},
                      files={"reference_audio": ("v.wav", wav_bytes(5), "audio/wav")})
    assert res.status_code == 422  # consent field missing entirely
    assert not clone_env["engine"].calls


@pytest.mark.parametrize("seconds", [1.0, 31.0])
def test_reference_length_limits(clone_env, seconds):
    res = post_clone(seconds=seconds)
    assert res.status_code == 422
    assert "Reference audio" in res.json()["detail"]


def test_undecodable_reference(clone_env):
    res = client.post("/api/v1/clone", data={"text": "hi", "consent": "true"},
                      files={"reference_audio": ("v.wav", b"not audio at all", "audio/wav")})
    assert res.status_code == 422


def test_text_too_long(clone_env, monkeypatch):
    monkeypatch.setattr(get_settings(), "clone_max_chars", 5)
    assert post_clone(text="x" * 6).status_code == 413


def test_rejected_requests_leave_no_files(clone_env):
    jobs_dir = get_settings().tmp_dir / "clone_jobs"
    before = set(jobs_dir.iterdir()) if jobs_dir.exists() else set()
    post_clone(seconds=1.0)
    post_clone(consent="false")
    assert (set(jobs_dir.iterdir()) if jobs_dir.exists() else set()) == before


# --- Job lifecycle -------------------------------------------------------------------

def test_job_lifecycle_with_provided_transcript(clone_env):
    res = post_clone(text="Price $25", lang="en", speed="1.2", reference_text="hello there")
    assert res.status_code == 202
    job_id = res.json()["job_id"]

    body = wait_for(job_id)
    assert body["status"] == "done"
    assert body["duration"] == 1.0
    assert body["reference_text_source"] == "provided"
    assert clone_env["stt"].calls == 0
    assert clone_env["engine"].calls == [("Price twenty-five dollars", "en", "hello there", 1.2)]

    audio = client.get(body["audio_url"])
    assert audio.status_code == 200 and audio.content[:4] == b"RIFF"
    # The voice sample is deleted once generation finishes.
    assert not (get_settings().tmp_dir / "clone_jobs" / job_id / "reference.wav").exists()


def test_missing_transcript_is_filled_by_khmer_stt(clone_env):
    body = wait_for(post_clone().json()["job_id"])
    assert body["status"] == "done"
    assert body["reference_text"] == "ខ្ញុំស្រលាញ់ភាសាខ្មែរ"
    assert body["reference_text_source"] == "transcribed"
    assert clone_env["engine"].calls[0][2] == "ខ្ញុំស្រលាញ់ភាសាខ្មែរ"


def test_silent_reference_fails_cleanly(clone_env):
    clone_env["stt"].text = ""
    body = wait_for(post_clone().json()["job_id"])
    assert body["status"] == "failed"
    assert "No speech" in body["error"]


def test_engine_failure_is_reported(clone_env):
    clone_env["engine"].fail = True
    body = wait_for(post_clone(reference_text="x").json()["job_id"])
    assert body["status"] == "failed"
    assert body["error"] == "engine exploded"
    assert client.get(f"/api/v1/clone/jobs/{body['job_id']}/audio").status_code == 409


def test_unknown_job():
    assert client.get("/api/v1/clone/jobs/nope").status_code == 404
    assert client.get("/api/v1/clone/jobs/nope/audio").status_code == 404


# --- Queue behaviour -----------------------------------------------------------------

def test_queue_full_and_positions(clone_env):
    release = threading.Event()
    queue = CloneJobQueue(lambda job: release.wait(5), max_pending=2, ttl_s=3600)
    app.dependency_overrides[get_clone_queue] = lambda: queue
    try:
        first = post_clone(reference_text="x").json()
        second = post_clone(reference_text="x").json()
        assert second["status"] == "queued" and second["queue_position"] == 2
        third = post_clone(reference_text="x")
        assert third.status_code == 503
        assert third.headers["retry-after"] == "30"
    finally:
        release.set()
        queue.shutdown()
    assert first["job_id"] != second["job_id"]


def test_finished_jobs_expire(clone_env):
    queue = CloneJobQueue(make_service().run, max_pending=10, ttl_s=0)
    app.dependency_overrides[get_clone_queue] = lambda: queue
    job_id = post_clone(reference_text="x").json()["job_id"]
    job = queue._jobs[job_id]
    deadline = time.time() + 5
    while job.finished_at is None and time.time() < deadline:
        time.sleep(0.02)
    time.sleep(0.01)
    assert client.get(f"/api/v1/clone/jobs/{job_id}").status_code == 404
    assert not job.work_dir.exists()
    queue.shutdown()


def test_startup_removes_orphaned_job_files():
    orphan = get_settings().tmp_dir / "clone_jobs" / "left-over-from-last-run"
    orphan.mkdir(parents=True, exist_ok=True)
    (orphan / "output.wav").write_bytes(b"x")
    with TestClient(app):  # runs the lifespan startup
        assert not orphan.exists()


def test_queue_works_after_app_restart():
    with TestClient(app):
        pass  # startup + shutdown
    # Would raise "cannot schedule new futures after shutdown" with the stopped queue.
    get_clone_queue()._executor.submit(lambda: None).result(timeout=5)


# --- Real model (downloads ~2.5 GB on first run; slow on CPU/MPS) --------------------

@pytest.mark.skipif(not os.getenv("BONDETH_RUN_MODEL_TESTS"), reason="set BONDETH_RUN_MODEL_TESTS=1")
def test_real_omnivoice_clone():
    app.dependency_overrides.clear()
    # Build a >3 s Khmer reference with the MMS voice, then clone it speaking English.
    ref = client.post("/api/v1/tts", json={
        "text": "ខ្ញុំស្រលាញ់ភាសាខ្មែរ។ ថ្ងៃនេះអាកាសធាតុល្អណាស់។ យើងនឹងរៀនជាមួយគ្នា។", "lang": "km"})
    assert ref.status_code == 200
    res = client.post("/api/v1/clone", data={"text": "Hello from Bondeth AI.", "consent": "true"},
                      files={"reference_audio": ("ref.wav", ref.content, "audio/wav")})
    assert res.status_code == 202, res.text
    body = wait_for(res.json()["job_id"], timeout=600)
    assert body["status"] == "done", body
    assert body["reference_text_source"] == "transcribed"
    data, sr = sf.read(io.BytesIO(client.get(body["audio_url"]).content))
    assert sr == 24_000 and len(data) / sr > 0.5 and np.abs(data).max() > 0.01
