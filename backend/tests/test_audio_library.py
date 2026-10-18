import asyncio
import shutil
import time
import uuid

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import get_settings
from app.services.audio_library import audio_path, save_audio
from app.services.tts import SpeechResult
from tests.conftest import count_rows, sync_redis
from tests.test_clone import env, post_clone, save_voice, wait_for  # noqa: F401
from tests.test_tts import fake_tts  # noqa: F401


def speech(client, headers=None, **data):
    return client.post("/api/v1/tts", headers=headers or {}, json={"text": "Saved speech", **data})


def test_anonymous_audio_is_session_only_and_library_needs_auth(client, register, fake_tts):
    response = speech(client)
    assert response.status_code == 200 and "x-audio-id" not in response.headers
    assert client.get("/api/v1/audio").status_code == 401
    assert client.get("/api/v1/audio", headers=register()).json() == {"items": [], "total": 0}


def test_speech_is_durable_private_and_deletable(client, register, fake_tts):
    owner, other = register(), register("other@example.com")
    response = speech(client, owner, text="Original $25", lang="en", speed=1.2)
    assert response.status_code == 200
    audio_id = response.headers["x-audio-id"]
    page = client.get("/api/v1/audio", headers=owner).json()
    assert page["total"] == 1
    row = page["items"][0]
    assert row.items() >= dict(id=audio_id, kind="tts", text="Original $25", language="en", speed=1.2,
                              duration=0.5, engine="mms", voice="MMS", notice=None).items()
    url = f"/api/v1/audio/{audio_id}/file"
    audio = client.get(url, headers=owner)
    assert audio.status_code == 200 and audio.content == response.content
    assert audio.headers["cache-control"] == "private, no-store"
    partial = client.get(url, headers={**owner, "Range": "bytes=0-3"})
    assert partial.status_code == 206 and partial.content == b"RIFF"
    sync_redis().flushdb()  # the account library is independent of job/cache expiry
    assert client.get(url, headers=owner).content == response.content
    assert client.get("/api/v1/audio", headers=other).json()["total"] == 0
    assert client.get(url).status_code == 401
    assert client.get(url, headers=other).status_code == 404
    assert client.delete(f"/api/v1/audio/{audio_id}", headers=other).status_code == 404
    user_id = client.get("/api/v1/auth/me", headers=owner).json()["id"]
    path = audio_path(get_settings().data_dir, uuid.UUID(user_id), uuid.UUID(audio_id))
    assert path.exists()
    assert client.delete(f"/api/v1/audio/{audio_id}", headers=owner).status_code == 204
    assert not path.exists() and client.get(url, headers=owner).status_code == 404
    assert client.get("/api/v1/audio", headers=owner).json()["total"] == 0


def test_cached_speech_still_saves_each_request_and_original_settings(client, register, fake_tts):
    owner = register()
    first = speech(client, owner, text="It costs $25", lang="en")
    second = speech(client, owner, text="it costs twenty-five dollars", lang="en")
    assert second.headers["x-cache"] == "HIT"
    assert first.headers["x-audio-id"] != second.headers["x-audio-id"]
    page = client.get("/api/v1/audio?kind=tts&q=COSTS&limit=1", headers=owner).json()
    assert page["total"] == 2 and page["items"][0]["text"] == "it costs twenty-five dollars"
    assert client.get("/api/v1/audio?kind=tts&q=costs&limit=1&offset=1", headers=owner).json()["items"][0]["text"] == "It costs $25"
    assert client.get("/api/v1/audio?kind=clone", headers=owner).json()["total"] == 0


def test_clone_is_saved_by_worker_without_browser_and_outlives_job(client, register, env, monkeypatch):
    owner = register()
    voice = save_voice(client, owner, reference_text="sample")
    job_id = post_clone(client, owner, upload=False, voice_id=voice["id"], text="សួស្តី", speed="1.2").json()["job_id"]
    deadline = time.monotonic() + 10
    while env["queue"].get(job_id).status not in ("done", "failed") and time.monotonic() < deadline:
        time.sleep(0.02)
    job = env["queue"].get(job_id)
    assert job.status == "done", job.error
    rows = client.get("/api/v1/audio?kind=clone", headers=owner).json()
    assert rows["total"] == 1
    saved = rows["items"][0]
    assert saved["id"] == str(uuid.UUID(job_id)) == job.audio_id
    assert saved["text"] == "សួស្តី" and saved["voice"] == "Me" and saved["speed"] == 1.2
    wav = client.get(f"/api/v1/audio/{saved['id']}/file", headers=owner).content
    env["queue"].stop_worker()
    sync_redis().delete(f"clone:job:{job_id}")
    monkeypatch.setattr("app.services.clone_jobs.SWEEP_GRACE_S", 0)
    env["queue"].sweep()
    client.delete(f"/api/v1/voices/{voice['id']}", headers=owner)
    assert not job.work_dir.exists()
    assert client.get(f"/api/v1/audio/{saved['id']}/file", headers=owner).content == wav


def test_crash_after_archiving_restores_output_without_inference_or_duplicate(client, register, env):
    owner = register()
    job_id = post_clone(client, owner, reference_text="sample").json()["job_id"]
    done = wait_for(client, owner, job_id)
    assert done["status"] == "done" and done["audio_id"]
    env["queue"].stop_worker()
    job = env["queue"].get(job_id)
    expected = job.output_path.read_bytes()
    job.output_path.unlink()
    env["engine"].fail = True
    # A recovered attempt must use the committed library entry, even after reference cleanup.
    env["queue"]._process(job_id)
    assert env["queue"].get(job_id).status == "done"
    assert job.output_path.read_bytes() == expected
    assert client.get("/api/v1/audio", headers=owner).json()["total"] == 1


def test_failed_generation_is_not_saved(client, register, env, fake_tts):
    owner = register()
    assert speech(client, owner, text="!!!").status_code == 422
    env["engine"].fail = True
    job_id = post_clone(client, owner, reference_text="sample").json()["job_id"]
    assert wait_for(client, owner, job_id)["status"] == "failed"
    assert client.get("/api/v1/audio", headers=owner).json()["total"] == 0


def test_save_failure_refunds_and_leaves_no_orphan(client, register, fake_tts, monkeypatch):
    owner = register()
    def fail(*args):
        raise OSError("disk full")
    monkeypatch.setattr("app.services.audio_library._write_audio", fail)
    assert speech(client, owner).status_code == 503
    assert client.get("/api/v1/audio", headers=owner).json()["total"] == 0
    assert client.get("/api/v1/usage", headers=owner).json()["quotas"]["tts_chars"]["used"] == 0
    assert not list((get_settings().data_dir / "audio_library").glob("**/*.wav"))


def test_fallback_provenance_is_saved_with_audio(client, register, fake_tts, monkeypatch):
    owner = register()
    monkeypatch.setattr(fake_tts, "synthesize_result", lambda text, lang, speed: SpeechResult(
        *fake_tts.synthesize(text, lang, speed), engine="mms", fallback="short-khmer-omni-failed"))
    response = speech(client, {**owner, "Origin": "http://localhost:3000"}, text="សួស្តី", lang="km")
    assert response.status_code == 200 and response.headers["x-cache"] == "BYPASS"
    assert "X-Audio-Id" in response.headers["access-control-expose-headers"]
    row = client.get("/api/v1/audio", headers=owner).json()["items"][0]
    assert row["engine"] == "mms" and row["voice"] == "MMS fallback — different voice"
    assert "different speaker" in row["notice"]


def test_clone_archive_failure_refunds_instead_of_claiming_success(client, register, env, monkeypatch):
    owner = register()
    def fail(*args):
        raise OSError("disk full")
    monkeypatch.setattr("app.services.audio_library._write_audio", fail)
    job_id = post_clone(client, owner, reference_text="sample").json()["job_id"]
    assert wait_for(client, owner, job_id)["status"] == "failed"
    assert client.get("/api/v1/audio", headers=owner).json()["total"] == 0
    assert client.get("/api/v1/usage", headers=owner).json()["quotas"]["clone_jobs"]["used"] == 0


def test_account_deletion_removes_audio_and_a_late_worker_cannot_recreate_it(client, register, fake_tts):
    owner = register()
    assert speech(client, owner).status_code == 200
    user_id = uuid.UUID(client.get("/api/v1/auth/me", headers=owner).json()["id"])
    directory = get_settings().data_dir / "audio_library" / str(user_id)
    assert directory.exists()
    assert client.request("DELETE", "/api/v1/auth/me", headers=owner, json={"password": "correct-horse-battery"}).status_code == 204
    assert not directory.exists() and asyncio.run(count_rows("generated_audio")) == 0
    async def late_save():
        engine = create_async_engine(get_settings().database_url, poolclass=NullPool)
        try:
            async with async_sessionmaker(engine)() as session:
                return await save_audio(session, get_settings().data_dir, user_id, uuid.uuid4(), b"audio",
                                        kind="clone", text="late", voice="Me", language="km", speed=1,
                                        duration=1, engine="omnivoice")
        finally:
            await engine.dispose()
    assert asyncio.run(late_save()) is None and not directory.exists()


def test_missing_file_is_reported_and_can_be_deleted(client, register, fake_tts):
    owner = register()
    audio_id = speech(client, owner).headers["x-audio-id"]
    shutil.rmtree(get_settings().data_dir / "audio_library")
    assert client.get(f"/api/v1/audio/{audio_id}/file", headers=owner).status_code == 404
    assert client.delete(f"/api/v1/audio/{audio_id}", headers=owner).status_code == 204
