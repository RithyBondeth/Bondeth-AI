"""Redis-backed job queue for slow voice-cloning requests.

Cloning takes tens of seconds on CPU/MPS, longer than a client should hold an
HTTP request open, so requests become jobs that a worker thread runs one at a
time while clients poll for the result.

Redis layout:
    clone:job:{id}     hash with the job's fields (expires after the result TTL)
    clone:queue        list of waiting job ids (new on the left, taken from the right)
    clone:processing   list of the id currently being worked on

The worker moves an id atomically from queue to processing (BLMOVE), so if the
process dies mid-job the id is still in `processing` and is put back at the
front of the queue on the next start. Jobs therefore survive restarts.

Assumes a single worker process; API-only replicas set clone_worker_enabled=false.
"""

import logging
import shutil
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Literal

from redis import Redis

logger = logging.getLogger(__name__)

JobStatus = Literal["queued", "running", "done", "failed"]
RefTextSource = Literal["provided", "transcribed", "saved_voice"]

QUEUE_KEY = "clone:queue"
PROCESSING_KEY = "clone:processing"
PENDING_TTL_S = 24 * 3600  # safety net so abandoned job hashes can't live forever
SWEEP_INTERVAL_S = 60
SWEEP_GRACE_S = 60  # don't delete a folder whose job is still being submitted


def job_key(job_id: str) -> str:
    return f"clone:job:{job_id}"


class QueueFull(RuntimeError):
    pass


@dataclass
class CloneJob:
    user_id: str
    text: str
    lang: str  # "auto" | "km" | "en"
    speed: float
    work_dir: Path
    reference_path: Path
    delete_reference: bool = True  # False for saved voices, whose audio must be kept
    ref_text: str | None = None
    ref_text_source: RefTextSource = "provided"
    voice_id: str | None = None
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    status: JobStatus = "queued"
    error: str | None = None
    duration: float | None = None
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None

    @property
    def output_path(self) -> Path:
        return self.work_dir / "output.wav"

    def to_redis(self) -> dict[str, str]:
        # Redis hashes store strings; None is stored as "" and restored below.
        return {k: "" if v is None else str(v) for k, v in asdict(self).items()}

    @classmethod
    def from_redis(cls, data: dict[str, str]) -> "CloneJob":
        known = {f.name for f in fields(cls)}
        kwargs: dict = {k: v for k, v in data.items() if k in known}
        for name in _OPTIONAL_FIELDS:
            if kwargs.get(name) == "":
                kwargs[name] = None
        for name in _FLOAT_FIELDS:
            if kwargs.get(name) is not None:
                kwargs[name] = float(kwargs[name])
        kwargs["work_dir"] = Path(kwargs["work_dir"])
        kwargs["reference_path"] = Path(kwargs["reference_path"])
        kwargs["delete_reference"] = kwargs.get("delete_reference") == "True"
        return cls(**kwargs)


_OPTIONAL_FIELDS = ("ref_text", "voice_id", "error", "duration", "finished_at")
_FLOAT_FIELDS = ("speed", "duration", "created_at", "finished_at")


class CloneJobQueue:
    def __init__(self, redis: Redis, worker: Callable[[CloneJob], None], jobs_root: Path,
                 max_pending: int, ttl_s: int):
        self._redis = redis
        self._worker = worker
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

    def submit(self, job: CloneJob) -> CloneJob:
        if self.pending_count() >= self._max_pending:
            raise QueueFull("The voice-cloning queue is full. Please try again shortly.")
        with self._redis.pipeline(transaction=True) as pipe:
            pipe.hset(job_key(job.id), mapping=job.to_redis())
            pipe.expire(job_key(job.id), PENDING_TTL_S)
            pipe.lpush(QUEUE_KEY, job.id)
            pipe.execute()
        return job

    def get(self, job_id: str) -> CloneJob | None:
        data = self._redis.hgetall(job_key(job_id))
        return CloneJob.from_redis(data) if data else None

    def pending_count(self) -> int:
        return self._redis.llen(QUEUE_KEY) + self._redis.llen(PROCESSING_KEY)

    def position(self, job: CloneJob) -> int | None:
        """1-based place in line for a queued job; None once it has started."""
        if job.status != "queued":
            return None
        index = self._redis.lpos(QUEUE_KEY, job.id)
        if index is None:
            return None
        waiting_behind_it = index  # newer jobs sit to its left
        ahead = self._redis.llen(QUEUE_KEY) - waiting_behind_it - 1
        return ahead + self._redis.llen(PROCESSING_KEY) + 1

    # --- Worker side ---------------------------------------------------------------

    def start_worker(self) -> None:
        self._recover()
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="clone-worker", daemon=True)
        self._thread.start()

    def stop_worker(self, timeout: float = 2.0) -> None:
        # A job still running is left in `processing` and resumes on the next start.
        self._stop.set()
        if self._thread:
            self._thread.join(timeout)

    def _recover(self) -> None:
        """Put jobs interrupted by a crash or restart back at the front of the queue."""
        while (job_id := self._redis.lmove(PROCESSING_KEY, QUEUE_KEY, "LEFT", "RIGHT")) is not None:
            if self._redis.exists(job_key(job_id)):
                self._redis.hset(job_key(job_id), "status", "queued")
                logger.info("Re-queued interrupted clone job %s", job_id)

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
                logger.exception("Clone worker error; retrying")
                self._stop.wait(1)

    def _process(self, job_id: str) -> None:
        job = self.get(job_id)
        if job is None:
            return  # expired or deleted while waiting
        job.status = "running"
        self._redis.hset(job_key(job.id), "status", "running")
        try:
            self._worker(job)
            job.status = "done"
        except Exception as exc:
            logger.warning("Clone job %s failed: %s", job.id, exc)
            job.status, job.error = "failed", str(exc) or exc.__class__.__name__
        finally:
            job.finished_at = time.time()
            if job.delete_reference:
                job.reference_path.unlink(missing_ok=True)
            with self._redis.pipeline(transaction=True) as pipe:
                pipe.hset(job_key(job.id), mapping=job.to_redis())
                pipe.expire(job_key(job.id), self._ttl_s)
                pipe.execute()

    def sweep(self) -> None:
        """Delete job folders whose Redis record has expired."""
        if not self._jobs_root.exists():
            return
        cutoff = time.time() - SWEEP_GRACE_S
        for path in self._jobs_root.iterdir():
            if path.is_dir() and path.stat().st_mtime < cutoff and not self._redis.exists(job_key(path.name)):
                shutil.rmtree(path, ignore_errors=True)
