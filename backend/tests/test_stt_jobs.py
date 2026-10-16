import json
import threading
import time

import pytest

from app.config import get_settings
from app.deps import get_stt_queue
from app.main import app
from app.services.stt import Segment, Transcription
from app.services.job_billing import JobBilling
from app.services.stt_jobs import PROCESSING_KEY, QUEUE_KEY, SttJobQueue, events_key, job_key
from tests.conftest import sync_redis
from tests.fakes import wav_bytes


class StreamingFakeStt:
    """Emits two segments; `gate` lets a test hold the job mid-transcription."""

    def __init__(self, fail: bool = False):
        self.fail, self.calls = fail, []
        self.gate = threading.Event()
        self.gate.set()

    def transcribe(self, path, language=None, on_start=None, on_segment=None):
        assert path.exists(), "the upload must exist while transcribing"
        self.calls.append((path, language))
        on_start and on_start("km", 0.97, 4.2)
        on_segment and on_segment(Segment(0.0, 2.0, "សួស្តី"), "សួស្តី")
        self.gate.wait(5)
        if self.fail:
            raise RuntimeError("decoder exploded")
        on_segment and on_segment(Segment(2.0, 4.2, "ពិភពលោក"), "ពិភព លោក")
        return Transcription("km", 0.97, 4.2, "សួស្តី ពិភពលោក", "សួស្តី ពិភព លោក",
                             [Segment(0.0, 2.0, "សួស្តី"), Segment(2.0, 4.2, "ពិភពលោក")])


@pytest.fixture
def env(client):
    stt = StreamingFakeStt()
    queue = SttJobQueue(sync_redis(), stt, get_settings().data_dir / "stt_jobs", max_pending=10, ttl_s=3600,
                        billing=JobBilling(sync_redis(), get_settings().database_url))
    app.dependency_overrides[get_stt_queue] = lambda: queue
    queue.start_worker()
    yield {"stt": stt, "queue": queue}
    queue.stop_worker()


def submit(client, headers=None, seconds=4.0, **data):
    return client.post("/api/v1/stt/jobs", headers=headers, data=data,
                       files={"file": ("long.wav", wav_bytes(seconds), "audio/wav")})


def wait_done(client, job_id, headers=None, timeout=10.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/api/v1/stt/jobs/{job_id}", headers=headers).json()
        if body["status"] in ("done", "failed"):
            return body
        time.sleep(0.02)
    raise AssertionError(f"job did not finish: {body}")


def read_events(client, url, headers=None):
    events = []
    with client.stream("GET", url, headers=headers) as res:
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("text/event-stream")
        event = {}
        for line in res.iter_lines():
            if line.startswith("event: "):
                event["event"] = line[7:]
            elif line.startswith("data: "):
                event["data"] = json.loads(line[6:])
            elif line == "" and event:
                events.append(event)
                event = {}
    return events


def test_job_streams_segments_then_the_result(client, env):
    res = submit(client, language="km")
    assert res.status_code == 202
    job = res.json()
    assert job["status"] in ("queued", "running", "done") and job["events_url"].endswith("/events")

    events = read_events(client, job["events_url"])
    assert [e["event"] for e in events] == ["info", "segment", "segment", "done"]
    assert events[0]["data"] == {"detected_language": "km", "language_probability": 0.97, "duration": 4.2}
    assert events[1]["data"]["text"] == "សួស្តី" and events[2]["data"]["segmented_text"] == "ពិភព លោក"
    assert events[3]["data"]["text"] == "សួស្តី ពិភពលោក"
    assert events[3]["data"]["transcription_id"] is None  # anonymous: no history

    done = wait_done(client, job["job_id"])
    assert done["result"]["segments"][1] == {"start": 2.0, "end": 4.2, "text": "ពិភពលោក"}
    assert env["stt"].calls[0][1] == "km"
    # The upload is deleted once transcribed.
    assert not (get_settings().data_dir / "stt_jobs" / job["job_id"]).exists()


def test_events_can_be_followed_while_the_job_runs(client, env):
    env["stt"].gate.clear()  # hold the job after its first segment
    job = submit(client).json()
    seen = []

    def release_after_first_segment():
        deadline = time.time() + 5
        while time.time() < deadline and not sync_redis().xlen(events_key(job["job_id"])) >= 2:
            time.sleep(0.01)
        seen.append(sync_redis().xlen(events_key(job["job_id"])))
        env["stt"].gate.set()

    threading.Thread(target=release_after_first_segment).start()
    events = read_events(client, job["events_url"])
    assert seen == [2]  # info + first segment were out before the job finished
    assert [e["event"] for e in events][-1] == "done"


def test_stream_survives_a_long_pause_between_segments(client, env, monkeypatch):
    import app.api.v1.stt as stt_api
    monkeypatch.setattr(stt_api, "KEEPALIVE_S", 1)
    env["stt"].gate.clear()
    job = submit(client).json()
    # Silent for longer than redis-py's default 5 s read timeout, which a long XREAD block tripped.
    threading.Timer(5.5, env["stt"].gate.set).start()
    with client.stream("GET", job["events_url"]) as res:
        body = "".join(res.iter_text())
    env["stt"].gate.wait(10)
    assert ": keep-alive" in body
    assert body.rstrip().endswith("}") and "event: done" in body


def test_quota_reserved_up_front_and_settled(client, env, monkeypatch):
    monkeypatch.setattr(get_settings(), "quota_stt_seconds_anon", 10)
    assert submit(client, seconds=11.0).status_code == 429  # longer than the allowance: rejected before queueing
    job = submit(client, seconds=6.0).json()
    wait_done(client, job["job_id"])
    # Reserved 6 s, then settled to the 4.2 s the engine decoded.
    assert client.get("/api/v1/usage").json()["quotas"]["stt_seconds"]["used"] == 5


def test_failed_job_refunds_quota_and_reports_the_error(client, env):
    env["stt"].fail = True
    job = submit(client).json()
    events = read_events(client, job["events_url"])
    assert [e["event"] for e in events] == ["info", "segment", "error"]
    assert "decoder exploded" in events[-1]["data"]["error"]
    assert wait_done(client, job["job_id"])["status"] == "failed"
    assert client.get("/api/v1/usage").json()["quotas"]["stt_seconds"]["used"] == 0


def test_signed_in_jobs_are_private_and_saved_to_history_once(client, env, register):
    owner, other = register("a@example.com"), register("b@example.com")
    env["stt"].gate.clear()
    job = submit(client, headers=owner).json()
    threading.Timer(0.3, env["stt"].gate.set).start()
    # Following live: the done event must already carry the saved history id.
    tid = read_events(client, job["events_url"], owner)[-1]["data"]["transcription_id"]
    assert tid
    assert wait_done(client, job["job_id"], owner)["result"]["transcription_id"] == tid
    assert read_events(client, job["events_url"], owner)[-1]["data"]["transcription_id"] == tid
    history = client.get("/api/v1/transcriptions", headers=owner).json()
    assert [t["id"] for t in history["items"]] == [tid]

    for headers in (other, None):
        assert client.get(f"/api/v1/stt/jobs/{job['job_id']}", headers=headers).status_code == 404
        assert client.get(job["events_url"], headers=headers).status_code == 404


def test_unreadable_audio_and_bad_extension(client, env):
    res = client.post("/api/v1/stt/jobs", files={"file": ("x.wav", b"not audio", "audio/wav")})
    assert res.status_code == 422
    assert client.post("/api/v1/stt/jobs", files={"file": ("x.txt", b"hi")}).status_code == 415
    assert client.get("/api/v1/usage").json()["quotas"]["stt_seconds"]["used"] == 0
    root = get_settings().data_dir / "stt_jobs"
    assert not root.exists() or list(root.iterdir()) == []


def test_job_saves_history_without_result_reader(client, env, register):
    owner = register()
    job = submit(client, headers=owner).json()
    deadline = time.time() + 5
    while time.time() < deadline:
        stored = env["queue"].get(job["job_id"])
        if stored.status == "done":
            break
        time.sleep(0.02)
    assert stored.status == "done" and stored.transcription_id
    # No status/SSE reader performed the insert.
    history = client.get("/api/v1/transcriptions", headers=owner).json()
    assert [t["id"] for t in history["items"]] == [stored.transcription_id]


def test_queue_full(client, env):
    env["queue"].stop_worker()
    full = SttJobQueue(sync_redis(), env["stt"], get_settings().data_dir / "stt_jobs", max_pending=1, ttl_s=60)
    app.dependency_overrides[get_stt_queue] = lambda: full
    assert submit(client).status_code == 202
    res = submit(client)
    assert res.status_code == 503 and res.headers["retry-after"] == "30"
    assert client.get("/api/v1/usage").json()["quotas"]["stt_seconds"]["used"] == 4  # second one refunded


def test_interrupted_job_is_requeued_with_a_fresh_event_stream(client, env):
    env["queue"].stop_worker()
    r = sync_redis()
    r.hset(job_key("crashed"), mapping={"audio_path": "/nope/a.wav", "language": "auto", "created_at": "0",
                                        "status": "running"})
    r.xadd(events_key("crashed"), {"event": "info", "data": "{}"})
    r.lpush(PROCESSING_KEY, "crashed")
    env["queue"]._recover()
    assert r.lrange(QUEUE_KEY, 0, -1) == ["crashed"]
    assert r.hget(job_key("crashed"), "status") == "queued"
    assert not r.exists(events_key("crashed"))
