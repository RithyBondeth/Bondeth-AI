"""Standalone queue owner: python -m app.worker [--check].

API replicas use *_WORKER_ENABLED=false and share /app/data with this process.
One owner per queue is enforced by file locks; a second worker fails before recovery.
"""
import logging
import signal
import sys
import threading

from redis import Redis

from app.config import get_settings
from app.deps import get_clone_service, get_stt_service
from app.services.clone_jobs import CloneJobQueue
from app.services.job_billing import JobBilling
from app.services.stt_jobs import SttJobQueue
from app.services.audio_library import CloneAudioLibrary

HEARTBEAT_KEY = "workers:standalone:heartbeat"


def main():
    settings = get_settings()
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    if "--check" in sys.argv:
        try:
            return 0 if redis.get(HEARTBEAT_KEY) else 1
        finally:
            redis.close()
    logging.basicConfig(level=logging.INFO)
    settings.tmp_dir.mkdir(parents=True, exist_ok=True)
    billing = JobBilling(redis, settings.database_url)
    queues = [
        CloneJobQueue(redis, get_clone_service().run, settings.data_dir / "clone_jobs",
                      settings.clone_max_queue, settings.clone_result_ttl_s, billing,
                      CloneAudioLibrary(settings.database_url, settings.data_dir, settings.clone_engine)),
        SttJobQueue(redis, get_stt_service(), settings.data_dir / "stt_jobs",
                    settings.stt_job_max_queue, settings.stt_job_result_ttl_s, billing),
    ]
    stop = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())
    started = []
    try:
        redis.ping()
        for queue in queues:
            queue.start_worker()
            started.append(queue)
        while not stop.is_set():
            if not all(q._thread and q._thread.is_alive() for q in started):
                raise RuntimeError("A queue worker exited")
            redis.set(HEARTBEAT_KEY, "ready", ex=15)
            stop.wait(5)
    finally:
        if started:
            redis.delete(HEARTBEAT_KEY)
        for queue in started:
            queue.stop_worker(timeout=0)
        # Keep ownership until in-flight work really exits; Docker may kill us after its grace period.
        for queue in started:
            if queue._thread:
                queue._thread.join()
        redis.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
