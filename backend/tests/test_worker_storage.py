from concurrent.futures import ThreadPoolExecutor

import pytest

from app.services import queue_storage
from app.services.stt_jobs import SttJob, SttJobQueue, QueueFull, QUEUE_KEY, PROCESSING_KEY
from tests.conftest import sync_redis


def test_atomic_queue_admission(client, tmp_path):
    queue = SttJobQueue(sync_redis(), None, tmp_path, max_pending=2, ttl_s=60)
    def submit(i):
        try:
            queue.submit(SttJob(audio_path=tmp_path / str(i), language="km", priority=i % 2 == 0))
            return True
        except QueueFull:
            return False
    with ThreadPoolExecutor(max_workers=8) as pool:
        accepted = list(pool.map(submit, range(20)))
    assert sum(accepted) == queue.pending_count() == 2


def test_second_worker_cannot_recover_live_jobs(client, tmp_path):
    redis = sync_redis()
    first = SttJobQueue(redis, None, tmp_path, 10, 60)
    second = SttJobQueue(redis, None, tmp_path, 10, 60)
    first.start_worker()
    try:
        redis.lpush(PROCESSING_KEY, "still-running")
        with pytest.raises(RuntimeError, match="already owns"):
            second.start_worker()
        assert redis.lrange(PROCESSING_KEY, 0, -1) == ["still-running"]
    finally:
        first.stop_worker()
    # Ownership is released by the worker, not by deleting the lock file.
    second.start_worker()
    second.stop_worker()


def test_priority_scheduler_still_services_free_jobs(client, tmp_path):
    redis = sync_redis()
    redis.lpush(QUEUE_KEY, "free")
    redis.lpush(QUEUE_KEY + ":priority", "pro1", "pro2", "pro3", "pro4")
    picked = []
    streak = 0
    for _ in range(5):
        job_id, source = redis.eval(queue_storage.POP, 3, QUEUE_KEY + ":priority", QUEUE_KEY,
                                    PROCESSING_KEY, "normal" if streak >= 3 else "priority")
        picked.append(job_id)
        streak = streak + 1 if source.endswith(":priority") else 0
    assert picked == ["pro1", "pro2", "pro3", "free", "pro4"]


def test_terminal_job_left_processing_is_not_rerun(client, tmp_path):
    from app.services.stt_jobs import job_key
    redis = sync_redis()
    queue = SttJobQueue(redis, None, tmp_path, 10, 60)
    job = SttJob(audio_path=tmp_path / "gone.wav", language="km", status="done")
    redis.hset(job_key(job.id), mapping=job.to_redis())
    redis.lpush(PROCESSING_KEY, job.id)
    queue.start_worker()
    try:
        assert redis.llen(QUEUE_KEY) == redis.llen(PROCESSING_KEY) == 0
        assert queue.get(job.id).status == "done"
    finally:
        queue.stop_worker()


def test_standalone_worker_starts_healthchecks_and_stops(client):
    import os
    import subprocess
    import sys
    import time
    from app.worker import HEARTBEAT_KEY

    proc = subprocess.Popen([sys.executable, "-m", "app.worker"], env=os.environ.copy(),
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        deadline = time.time() + 10
        while time.time() < deadline and not sync_redis().get(HEARTBEAT_KEY):
            assert proc.poll() is None
            time.sleep(0.05)
        assert sync_redis().get(HEARTBEAT_KEY)
        checked = subprocess.run([sys.executable, "-m", "app.worker", "--check"], timeout=10)
        assert checked.returncode == 0
        proc.terminate()
        proc.wait(timeout=10)
        assert proc.returncode == 0
        assert not sync_redis().get(HEARTBEAT_KEY)
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait(timeout=5)
