import io
import os
import time

import numpy as np
import pytest
import soundfile as sf

import app.services.clone_jobs as clone_jobs
from app.config import get_settings
from app.deps import get_clone_queue, get_stt_service
from app.main import app
from app.services.clone_jobs import PROCESSING_KEY, QUEUE_KEY, CloneJobQueue
from app.services.voice_clone import VoiceCloneService, prepare_text
from tests.conftest import sync_redis
from tests.fakes import FakeEngine, FakeStt, wav_bytes


def make_queue(service: VoiceCloneService, max_pending: int = 10, ttl_s: int = 3600) -> CloneJobQueue:
    return CloneJobQueue(sync_redis(), service.run, get_settings().data_dir / "clone_jobs",
                         max_pending=max_pending, ttl_s=ttl_s)


@pytest.fixture
def env(client):
    """Clone setup with a fake engine/STT and a real Redis queue + worker thread."""
    engine, stt = FakeEngine(), FakeStt()
    service = VoiceCloneService(get_settings(), stt)
    service._engine = engine
    queue = make_queue(service)
    app.dependency_overrides[get_clone_queue] = lambda: queue
    app.dependency_overrides[get_stt_service] = lambda: stt  # used when saving voices
    queue.start_worker()
    yield {"engine": engine, "stt": stt, "service": service, "queue": queue}
    queue.stop_worker()


def post_clone(client, headers, seconds=5.0, upload=True, **data):
    form = {"text": "សួស្តី", **({"consent": "true"} if upload else {}), **data}
    files = {"reference_audio": ("voice.wav", wav_bytes(seconds), "audio/wav")} if upload else None
    return client.post("/api/v1/clone", headers=headers, data=form, files=files)


def wait_for(client, headers, job_id, timeout=10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/api/v1/clone/jobs/{job_id}", headers=headers).json()
        if body["status"] in ("done", "failed"):
            return body
        time.sleep(0.02)
    raise AssertionError(f"job did not finish: {body}")


def job_dirs():
    root = get_settings().data_dir / "clone_jobs"
    return sorted(p.name for p in root.iterdir()) if root.exists() else []


# --- Text preparation ----------------------------------------------------------------

def test_prepare_text_auto_lets_engine_handle_code_switching():
    assert prepare_text("តម្លៃ $25 សម្រាប់ iPhone", "auto") == (None, "តម្លៃ ម្ភៃប្រាំដុល្លារ សម្រាប់ iPhone")


def test_prepare_text_english_keeps_casing():
    assert prepare_text("Bondeth AI costs $7", "en") == ("en", "Bondeth AI costs seven dollars")


# --- Validation ----------------------------------------------------------------------

def test_requires_login(client, env):
    assert post_clone(client, {}).status_code == 401


def test_consent_required_for_uploads(client, env, register):
    headers = register()
    assert post_clone(client, headers, consent="false").status_code == 403
    assert not env["engine"].calls and job_dirs() == []


def test_exactly_one_voice_source(client, env, register):
    headers = register()
    assert post_clone(client, headers, upload=False).status_code == 422
    both = post_clone(client, headers, voice_id="00000000-0000-0000-0000-000000000000")
    assert both.status_code == 422


@pytest.mark.parametrize("seconds", [1.0, 31.0])
def test_reference_length_limits(client, env, register, seconds):
    res = post_clone(client, register(), seconds=seconds)
    assert res.status_code == 422 and "Reference audio" in res.json()["detail"]
    assert job_dirs() == []


def test_undecodable_reference(client, env, register):
    res = client.post("/api/v1/clone", headers=register(), data={"text": "hi", "consent": "true"},
                      files={"reference_audio": ("v.wav", b"not audio at all", "audio/wav")})
    assert res.status_code == 422 and job_dirs() == []


def test_text_too_long(client, env, register, monkeypatch):
    monkeypatch.setattr(get_settings(), "clone_max_chars", 5)
    assert post_clone(client, register(), text="x" * 6).status_code == 413


# --- Job lifecycle (uploaded reference) ----------------------------------------------

def test_job_lifecycle_with_provided_transcript(client, env, register):
    headers = register()
    res = post_clone(client, headers, text="Price $25", lang="en", speed="1.2", reference_text="hello there")
    assert res.status_code == 202
    job_id = res.json()["job_id"]

    body = wait_for(client, headers, job_id)
    assert body["status"] == "done" and body["duration"] == 1.0
    assert body["reference_text_source"] == "provided"
    assert env["stt"].calls == []
    assert env["engine"].calls == [("Price twenty-five dollars", "en", "hello there", 1.2)]

    audio = client.get(body["audio_url"], headers=headers)
    assert audio.status_code == 200 and audio.content[:4] == b"RIFF"
    # An uploaded voice sample is deleted once generation finishes.
    assert not (get_settings().data_dir / "clone_jobs" / job_id / "reference.wav").exists()


def test_missing_transcript_is_filled_by_khmer_stt(client, env, register):
    headers = register()
    body = wait_for(client, headers, post_clone(client, headers).json()["job_id"])
    assert body["status"] == "done"
    assert (body["reference_text"], body["reference_text_source"]) == ("ខ្ញុំស្រលាញ់ភាសាខ្មែរ", "transcribed")


def test_silent_reference_fails_cleanly(client, env, register):
    env["stt"].text = ""
    headers = register()
    body = wait_for(client, headers, post_clone(client, headers).json()["job_id"])
    assert body["status"] == "failed" and "No speech" in body["error"]


def test_engine_failure_is_reported(client, env, register):
    env["engine"].fail = True
    headers = register()
    body = wait_for(client, headers, post_clone(client, headers, reference_text="x").json()["job_id"])
    assert (body["status"], body["error"]) == ("failed", "engine exploded")
    assert client.get(f"/api/v1/clone/jobs/{body['job_id']}/audio", headers=headers).status_code == 409


def test_jobs_are_private(client, env, register):
    alice, bob = register("alice@example.com"), register("bob@example.com")
    job_id = post_clone(client, alice, reference_text="x").json()["job_id"]
    wait_for(client, alice, job_id)
    assert client.get(f"/api/v1/clone/jobs/{job_id}", headers=bob).status_code == 404
    assert client.get(f"/api/v1/clone/jobs/{job_id}/audio", headers=bob).status_code == 404
    assert client.get("/api/v1/clone/jobs/nope", headers=alice).status_code == 404


# --- Saved voices --------------------------------------------------------------------

def save_voice(client, headers, **data):
    res = client.post("/api/v1/voices", headers=headers, data={"voice_alias": "Me", "consent": "true", **data},
                      files={"reference_audio": ("me.wav", wav_bytes(5.0), "audio/wav")})
    assert res.status_code == 201, res.text
    return res.json()


def test_clone_with_saved_voice(client, env, register):
    headers = register()
    voice = save_voice(client, headers, reference_text="my saved transcript")
    res = post_clone(client, headers, upload=False, voice_id=voice["id"], text="Hello")
    assert res.status_code == 202  # no consent field needed: it was given when saving

    body = wait_for(client, headers, res.json()["job_id"])
    assert body["status"] == "done"
    assert (body["voice_id"], body["reference_text_source"]) == (voice["id"], "saved_voice")
    assert env["engine"].calls[-1][2] == "my saved transcript"
    assert env["stt"].calls == []  # never re-transcribed
    # The saved voice's audio must survive the job.
    assert client.get(f"/api/v1/voices/{voice['id']}/audio", headers=headers).status_code == 200


def test_cannot_clone_someone_elses_saved_voice(client, env, register):
    alice, bob = register("alice@example.com"), register("bob@example.com")
    voice = save_voice(client, alice)
    assert post_clone(client, bob, upload=False, voice_id=voice["id"]).status_code == 404


def test_voice_deleted_while_queued_fails_cleanly(client, env, register):
    env["queue"].stop_worker()
    headers = register()
    voice = save_voice(client, headers, reference_text="x")
    job_id = post_clone(client, headers, upload=False, voice_id=voice["id"]).json()["job_id"]
    client.delete(f"/api/v1/voices/{voice['id']}", headers=headers)
    env["queue"].start_worker()
    body = wait_for(client, headers, job_id)
    assert body["status"] == "failed" and "no longer available" in body["error"]


# --- Queue behaviour -----------------------------------------------------------------

def test_queue_full_and_positions(client, env, register):
    env["queue"].stop_worker()
    queue = make_queue(env["service"], max_pending=2)
    app.dependency_overrides[get_clone_queue] = lambda: queue
    headers = register()
    first = post_clone(client, headers, reference_text="x").json()
    second = post_clone(client, headers, reference_text="x").json()
    assert (first["queue_position"], second["queue_position"]) == (1, 2)
    third = post_clone(client, headers, reference_text="x")
    assert third.status_code == 503 and third.headers["retry-after"] == "30"
    assert len(job_dirs()) == 2  # the rejected job left nothing behind


def test_queued_jobs_survive_a_restart(client, env, register):
    """Jobs submitted while no worker runs are picked up by the next process's worker."""
    env["queue"].stop_worker()
    headers = register()
    job_id = post_clone(client, headers, reference_text="x").json()["job_id"]
    assert client.get(f"/api/v1/clone/jobs/{job_id}", headers=headers).json()["status"] == "queued"

    restarted = make_queue(env["service"])  # a fresh queue object, as after a restart
    app.dependency_overrides[get_clone_queue] = lambda: restarted
    restarted.start_worker()
    try:
        assert wait_for(client, headers, job_id)["status"] == "done"
    finally:
        restarted.stop_worker()


def test_job_interrupted_mid_run_is_resumed(client, env, register):
    """A crash leaves the job in `processing`; the next worker start puts it back and runs it."""
    env["queue"].stop_worker()
    headers = register()
    job_id = post_clone(client, headers, reference_text="x").json()["job_id"]
    r = sync_redis()
    # Simulate a worker that took the job and then died.
    assert r.lmove(QUEUE_KEY, PROCESSING_KEY, "RIGHT", "LEFT") == job_id
    r.hset(f"clone:job:{job_id}", "status", "running")

    restarted = make_queue(env["service"])
    app.dependency_overrides[get_clone_queue] = lambda: restarted
    restarted.start_worker()
    try:
        assert wait_for(client, headers, job_id)["status"] == "done"
        assert r.llen(PROCESSING_KEY) == 0
    finally:
        restarted.stop_worker()


def test_finished_jobs_expire_and_files_are_swept(client, env, register, monkeypatch):
    env["queue"].stop_worker()
    queue = make_queue(env["service"], ttl_s=1)
    app.dependency_overrides[get_clone_queue] = lambda: queue
    queue.start_worker()
    headers = register()
    try:
        job_id = post_clone(client, headers, reference_text="x").json()["job_id"]
        assert wait_for(client, headers, job_id)["status"] == "done"
        time.sleep(1.2)
        assert client.get(f"/api/v1/clone/jobs/{job_id}", headers=headers).status_code == 404
        monkeypatch.setattr(clone_jobs, "SWEEP_GRACE_S", 0)
        queue.sweep()
        assert job_id not in job_dirs()
    finally:
        queue.stop_worker()


# --- Real model (downloads ~2.5 GB on first run; slow on CPU/MPS) --------------------

@pytest.mark.skipif(not os.getenv("BONDETH_RUN_MODEL_TESTS"), reason="set BONDETH_RUN_MODEL_TESTS=1")
def test_real_omnivoice_clone(client, register):
    from app.deps import get_clone_service

    queue = make_queue(get_clone_service())
    app.dependency_overrides[get_clone_queue] = lambda: queue
    queue.start_worker()
    headers = register()
    try:
        # Build a >3 s Khmer reference with the MMS voice, then clone it speaking English.
        ref = client.post("/api/v1/tts", json={
            "text": "ខ្ញុំស្រលាញ់ភាសាខ្មែរ។ ថ្ងៃនេះអាកាសធាតុល្អណាស់។ យើងនឹងរៀនជាមួយគ្នា។", "lang": "km"})
        assert ref.status_code == 200
        res = client.post("/api/v1/clone", headers=headers,
                          data={"text": "Hello from Bondeth AI.", "consent": "true"},
                          files={"reference_audio": ("ref.wav", ref.content, "audio/wav")})
        assert res.status_code == 202, res.text
        body = wait_for(client, headers, res.json()["job_id"], timeout=600)
        assert body["status"] == "done", body
        assert body["reference_text_source"] == "transcribed"
        data, sr = sf.read(io.BytesIO(client.get(body["audio_url"], headers=headers).content))
        assert sr == 24_000 and len(data) / sr > 0.5 and np.abs(data).max() > 0.01
    finally:
        queue.stop_worker()
