"""In-memory job queue for slow voice-cloning requests.

Cloning takes tens of seconds on CPU/MPS, longer than a client should hold
an HTTP request open. Requests become jobs that a single worker thread runs
one at a time; clients poll for the result.

Jobs live in memory, so they are lost on restart. Step 5 (Redis) can replace
this store without changing the API.
"""

import shutil
import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

JobStatus = Literal["queued", "running", "done", "failed"]


class QueueFull(RuntimeError):
    pass


@dataclass
class CloneJob:
    text: str
    lang: str  # "auto" | "km" | "en"
    speed: float
    work_dir: Path
    ref_text: str | None = None  # filled in by transcription when not provided
    ref_text_source: Literal["provided", "transcribed"] = "provided"
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    status: JobStatus = "queued"
    error: str | None = None
    duration: float | None = None
    created_at: float = field(default_factory=time.time)
    finished_at: float | None = None

    @property
    def reference_path(self) -> Path:
        return self.work_dir / "reference.wav"

    @property
    def output_path(self) -> Path:
        return self.work_dir / "output.wav"


class CloneJobQueue:
    def __init__(self, worker: Callable[[CloneJob], None], max_pending: int, ttl_s: int):
        self._worker = worker
        self._max_pending = max_pending
        self._ttl_s = ttl_s
        self._jobs: dict[str, CloneJob] = {}
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="clone")

    def submit(self, job: CloneJob) -> CloneJob:
        self.cleanup()
        with self._lock:
            if self.pending_count() >= self._max_pending:
                raise QueueFull("The voice-cloning queue is full. Please try again shortly.")
            self._jobs[job.id] = job
        self._executor.submit(self._run, job)
        return job

    def get(self, job_id: str) -> CloneJob | None:
        self.cleanup()
        with self._lock:
            return self._jobs.get(job_id)

    def pending_count(self) -> int:
        return sum(j.status in ("queued", "running") for j in self._jobs.values())

    def position(self, job: CloneJob) -> int | None:
        """1-based place in line for a queued job; None once it has started."""
        if job.status != "queued":
            return None
        with self._lock:
            return 1 + sum(j.status in ("queued", "running") and j.created_at < job.created_at
                           for j in self._jobs.values())

    def cleanup(self) -> None:
        """Forget finished jobs older than the TTL and delete their files."""
        cutoff = time.time() - self._ttl_s
        with self._lock:
            expired = [j for j in self._jobs.values() if j.finished_at and j.finished_at < cutoff]
            for job in expired:
                del self._jobs[job.id]
        for job in expired:
            shutil.rmtree(job.work_dir, ignore_errors=True)

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)

    def _run(self, job: CloneJob) -> None:
        job.status = "running"
        try:
            self._worker(job)
            job.status = "done"
        except Exception as exc:
            job.status = "failed"
            job.error = str(exc) or exc.__class__.__name__
        finally:
            job.finished_at = time.time()
            # The voice sample is only needed while generating; don't keep it around.
            job.reference_path.unlink(missing_ok=True)
