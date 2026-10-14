"""Redis-backed queue for long transcriptions, with segments streamed as they're decoded.

A long recording can take minutes, so instead of one long request it becomes a
job. A worker thread transcribes it and appends each event to a Redis Stream,
which clients follow over Server-Sent Events (GET /stt/jobs/{id}/events) and
can replay from the start at any time.

Redis layout:
    stt:job:{id}          hash: the job (expires after the result TTL)
    stt:job:{id}:events   stream: info, segment..., then done or error (same TTL)
    stt:queue             waiting job ids (new on the left, taken from the right)
    stt:processing        the id being worked on; re-queued after a crash

Quota: the API reserves the upload's duration when the job is submitted. The
worker settles that to the decoded duration, or refunds it if the job fails.
"""

import json
import logging
import math
import shutil
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Literal

from redis import Redis

from app.services.stt import Segment, SttService

logger = logging.getLogger(__name__)

JobStatus = Literal["queued", "running", "done", "failed"]

QUEUE_KEY = "stt:queue"
PROCESSING_KEY = "stt:processing"
PENDING_TTL_S = 24 * 3600
SWEEP_INTERVAL_S = 60
SWEEP_GRACE_S = 60


def job_key(job_id: str) -> str:
    return f"stt:job:{job_id}"


def events_key(job_id: str) -> str:
    return f"stt:job:{job_id}:events"


class QueueFull(RuntimeError):
    pass


@dataclass
class SttJob:
    audio_path: Path
    language: str  # "auto" | "km" | "en"
    user_id: str = ""  # "" for anonymous jobs, whose unguessable id is the only way in
    quota_key: str = ""  # Redis counter the reservation was added to
    charged: int = 0  # seconds reserved against the quota
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    status: JobStatus = "queued"
    error: str | None = None
    result: str | None = None  # JSON of the finished transcription
    transcription_id: str | None = None  # history row, once saved for a signed-in owner
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None

    def to_redis(self) -> dict[str, str]:
        return {k: "" if v is None else str(v) for k, v in asdict(self).items()}

    @classmethod
    def from_redis(cls, data: dict[str, str]) -> "SttJob":
        known = {f.name for f in fields(cls)}
        kwargs: dict = {k: v for k, v in data.items() if k in known}
        for name in ("error", "result", "transcription_id", "finished_at"):
            if kwargs.get(name) == "":
                kwargs[name] = None
        kwargs["audio_path"] = Path(kwargs["audio_path"])
        kwargs["charged"] = int(kwargs.get("charged") or 0)
        kwargs["created_at"] = float(kwargs["created_at"])
        if kwargs.get("finished_at") is not None:
            kwargs["finished_at"] = float(kwargs["finished_at"])
        return cls(**kwargs)


class SttJobQueue:
    def __init__(self, redis: Redis, stt: SttService, jobs_root: Path, max_pending: int, ttl_s: int):
        self._redis = redis
        self._stt = stt
        self._jobs_root = jobs_root
        self._max_pending = max_pending
        self._ttl_s = ttl_s
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # --- API side ------------------------------------------------------------------

    def new_work_dir(self, job_id: str) -> Path:
        path = self._jobs_root / job_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def submit(self, job: SttJob) -> SttJob:
        if self.pending_count() >= self._max_pending:
            raise QueueFull("The transcription queue is full. Please try again shortly.")
        with self._redis.pipeline(transaction=True) as pipe:
            pipe.hset(job_key(job.id), mapping=job.to_redis())
            pipe.expire(job_key(job.id), PENDING_TTL_S)
            pipe.lpush(QUEUE_KEY, job.id)
            pipe.execute()
        return job

    def get(self, job_id: str) -> SttJob | None:
        data = self._redis.hgetall(job_key(job_id))
        return SttJob.from_redis(data) if data else None

    def pending_count(self) -> int:
        return self._redis.llen(QUEUE_KEY) + self._redis.llen(PROCESSING_KEY)

    def position(self, job: SttJob) -> int | None:
        """1-based place in line for a queued job; None once it has started."""
        if job.status != "queued":
            return None
        index = self._redis.lpos(QUEUE_KEY, job.id)
        if index is None:
            return None
        return self._redis.llen(QUEUE_KEY) - index + self._redis.llen(PROCESSING_KEY)

    # --- Worker side ---------------------------------------------------------------

    def start_worker(self) -> None:
        self._recover()
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="stt-worker", daemon=True)
        self._thread.start()

    def stop_worker(self, timeout: float = 2.0) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout)

    def _recover(self) -> None:
        while (job_id := self._redis.lmove(PROCESSING_KEY, QUEUE_KEY, "LEFT", "RIGHT")) is not None:
            if self._redis.exists(job_key(job_id)):
                # Start the event stream over: the job runs again from the beginning.
                self._redis.delete(events_key(job_id))
                self._redis.hset(job_key(job_id), "status", "queued")
                logger.info("Re-queued interrupted transcription job %s", job_id)

    def _loop(self) -> None:
        last_sweep = 0.0
        while not self._stop.is_set():
            try:
                if time.time() - last_sweep > SWEEP_INTERVAL_S:
                    self.sweep()
                    last_sweep = time.time()
                job_id = self._redis.blmove(QUEUE_KEY, PROCESSING_KEY, 1, "RIGHT", "LEFT")
                if job_id is None:
                    continue
                self._process(job_id)
                self._redis.lrem(PROCESSING_KEY, 1, job_id)
            except Exception:
                logger.exception("Transcription worker error; retrying")
                self._stop.wait(1)

    def _emit(self, job_id: str, event: str, data: dict) -> None:
        self._redis.xadd(events_key(job_id), {"event": event, "data": json.dumps(data, ensure_ascii=False)})

    def _process(self, job_id: str) -> None:
        job = self.get(job_id)
        if job is None:
            return
        job.status = "running"
        self._redis.hset(job_key(job.id), "status", "running")
        self._redis.expire(events_key(job.id), PENDING_TTL_S)

        def on_start(language: str, probability: float, duration: float) -> None:
            self._emit(job.id, "info", {"detected_language": language, "language_probability": probability,
                                        "duration": duration})

        def on_segment(segment: Segment, segmented: str) -> None:
            self._emit(job.id, "segment", {**vars(segment), "segmented_text": segmented})

        try:
            language = None if job.language == "auto" else job.language
            result = self._stt.transcribe(job.audio_path, language, on_start=on_start, on_segment=on_segment)
            body = {
                "detected_language": result.language,
                "language_probability": result.language_probability,
                "duration": result.duration,
                "text": result.text,
                "segmented_text": result.segmented_text,
                "segments": [vars(s) for s in result.segments],
            }
            job.status, job.result = "done", json.dumps(body, ensure_ascii=False)
            self._settle(job, math.ceil(result.duration))
            final = ("done", body)
        except Exception as exc:
            logger.warning("Transcription job %s failed: %s", job.id, exc)
            job.status, job.error = "failed", f"Could not transcribe audio: {exc or exc.__class__.__name__}"
            self._settle(job, 0)
            final = ("error", {"error": job.error})
        finally:
            job.finished_at = time.time()
            shutil.rmtree(job.audio_path.parent, ignore_errors=True)
            with self._redis.pipeline(transaction=True) as pipe:
                pipe.hset(job_key(job.id), mapping=job.to_redis())
                pipe.expire(job_key(job.id), self._ttl_s)
                pipe.expire(events_key(job.id), self._ttl_s)
                pipe.execute()
        # Only after the job record is final: readers of the last event look it up.
        self._emit(job.id, *final)

    def _settle(self, job: SttJob, actual: int) -> None:
        """Correct the quota reservation to what was actually transcribed (0 = refund)."""
        if job.quota_key and actual != job.charged and self._redis.exists(job.quota_key):
            self._redis.incrby(job.quota_key, actual - job.charged)
            job.charged = actual

    def sweep(self) -> None:
        """Delete upload folders whose Redis record has expired."""
        if not self._jobs_root.exists():
            return
        cutoff = time.time() - SWEEP_GRACE_S
        for path in self._jobs_root.iterdir():
            if path.is_dir() and path.stat().st_mtime < cutoff and not self._redis.exists(job_key(path.name)):
                shutil.rmtree(path, ignore_errors=True)
