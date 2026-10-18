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

from app.services import queue_storage
from app.services.job_billing import JobBilling, JobCharge
from app.services.transcript_audio import TranscriptAudioLibrary
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
    charge: str | None = None  # JobCharge JSON: seconds reserved, settled when the job ends
    keep_source_audio: bool = False
    priority: bool = False
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
        for name in ("charge", "error", "result", "transcription_id", "finished_at"):
            if kwargs.get(name) == "":
                kwargs[name] = None
        kwargs["audio_path"] = Path(kwargs["audio_path"])
        kwargs["created_at"] = float(kwargs["created_at"])
        kwargs["keep_source_audio"] = kwargs.get("keep_source_audio") == "True"
        kwargs["priority"] = kwargs.get("priority") == "True"
        if kwargs.get("finished_at") is not None:
            kwargs["finished_at"] = float(kwargs["finished_at"])
        return cls(**kwargs)


class SttJobQueue:
    def __init__(self, redis: Redis, stt: SttService, jobs_root: Path, max_pending: int, ttl_s: int,
                 billing: JobBilling | None = None, library: TranscriptAudioLibrary | None = None):
        self._redis = redis
        self._billing = billing
        self._library = library
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
        if not queue_storage.submit(self._redis, QUEUE_KEY, PROCESSING_KEY, job_key(job.id),
                                    job.to_redis(), self._max_pending, PENDING_TTL_S, job.priority):
            raise QueueFull("The transcription queue is full. Please try again shortly.")
        return job

    def get(self, job_id: str) -> SttJob | None:
        data = self._redis.hgetall(job_key(job_id))
        return SttJob.from_redis(data) if data else None

    def pending_count(self) -> int:
        return queue_storage.pending(self._redis, QUEUE_KEY, PROCESSING_KEY)

    def position(self, job: SttJob) -> int | None:
        """1-based place in line for a queued job; None once it has started."""
        return queue_storage.position(self._redis, QUEUE_KEY, PROCESSING_KEY, job)

    # --- Worker side ---------------------------------------------------------------

    def start_worker(self) -> None:
        if self._thread and self._thread.is_alive():
            raise RuntimeError("Worker is already running")
        lock = queue_storage.WorkerLock(self._jobs_root)
        try:
            self._recover()
        except BaseException:
            lock.release()
            raise
        self._stop.clear()
        def run():
            try:
                self._loop()
            finally:
                lock.release()
        self._thread = threading.Thread(target=run, name="stt-worker", daemon=True)
        self._thread.start()

    def stop_worker(self, timeout: float = 2.0) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout)

    def _recover(self) -> None:
        while recovered := queue_storage.recover(self._redis, QUEUE_KEY, PROCESSING_KEY, job_key(""), reset_events=True):
            job_id, queued = recovered
            if queued:
                logger.info("Re-queued interrupted transcription job %s", job_id)

    def _loop(self) -> None:
        last_sweep = 0.0
        priority_run = 0
        while not self._stop.is_set():
            try:
                if time.time() - last_sweep > SWEEP_INTERVAL_S:
                    self.sweep()
                    last_sweep = time.time()
                selected = self._redis.eval(queue_storage.POP, 3, QUEUE_KEY + ":priority", QUEUE_KEY,
                                            PROCESSING_KEY, "normal" if priority_run >= 3 else "priority")
                if selected is None:
                    self._stop.wait(0.2)
                    continue
                job_id, source = selected
                priority_run = priority_run + 1 if source.endswith(":priority") else 0
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
            if self._billing and job.user_id:
                job.transcription_id = self._billing.save_history(job.id, job.user_id,
                    {**body, "source_audio_status": "pending" if job.keep_source_audio else "not_saved"})
                if self._library:
                    self._library.save(job)
            self._settle(job, math.ceil(result.duration))
            final = ("done", body)
        except Exception as exc:
            logger.warning("Transcription job %s failed: %s", job.id, exc)
            job.status, job.error = "failed", f"Could not transcribe audio: {exc or exc.__class__.__name__}"
            self._settle(job, 0)
            final = ("error", {"error": job.error})
        job.finished_at = time.time()
        with self._redis.pipeline(transaction=True) as pipe:
            pipe.hset(job_key(job.id), mapping=job.to_redis())
            pipe.expire(job_key(job.id), self._ttl_s)
            event, data = final
            pipe.xadd(events_key(job.id), {"event": event, "data": json.dumps(data, ensure_ascii=False)})
            pipe.expire(events_key(job.id), self._ttl_s)
            pipe.execute()
        # Keep retry input until the terminal record AND terminal event are durable.
        shutil.rmtree(job.audio_path.parent, ignore_errors=True)

    def _settle(self, job: SttJob, actual: int) -> None:
        """Correct the reservation to what was actually transcribed (0 = refund)."""
        charge = JobCharge.loads(job.charge)
        if self._billing and charge:
            self._billing.settle(charge, actual)
            job.charge = charge.dumps()

    def sweep(self) -> None:
        """Delete upload folders whose Redis record has expired."""
        if not self._jobs_root.exists():
            return
        cutoff = time.time() - SWEEP_GRACE_S
        for path in self._jobs_root.iterdir():
            if path.is_dir() and path.stat().st_mtime < cutoff and not self._redis.exists(job_key(path.name)):
                shutil.rmtree(path, ignore_errors=True)
