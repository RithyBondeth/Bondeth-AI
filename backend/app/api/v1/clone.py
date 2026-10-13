import shutil
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import Settings, get_settings
from app.deps import get_clone_queue
from app.services.clone_jobs import CloneJob, CloneJobQueue, JobStatus, QueueFull
from app.services.voice_clone import InvalidReference, load_reference
from app.uploads import saved_upload

router = APIRouter(prefix="/clone", tags=["voice-cloning"])


class CloneJobOut(BaseModel):
    job_id: str
    status: JobStatus
    queue_position: int | None = None
    error: str | None = None
    reference_text: str | None = None
    reference_text_source: Literal["provided", "transcribed"]
    duration: float | None = None
    status_url: str
    audio_url: str | None = None


def _job_out(job: CloneJob, queue: CloneJobQueue, request: Request) -> CloneJobOut:
    return CloneJobOut(
        job_id=job.id,
        status=job.status,
        queue_position=queue.position(job),
        error=job.error,
        reference_text=job.ref_text,
        reference_text_source=job.ref_text_source,
        duration=job.duration,
        status_url=str(request.url_for("clone_job_status", job_id=job.id)),
        audio_url=str(request.url_for("clone_job_audio", job_id=job.id)) if job.status == "done" else None,
    )


@router.post("", status_code=202, response_model=CloneJobOut)
async def create_clone_job(
    request: Request,
    reference_audio: UploadFile = File(..., description="3-30 s of the voice to clone (.wav, .mp3, .m4a, ...)"),
    text: str = Form(..., min_length=1, description="What the cloned voice should say"),
    consent: bool = Form(..., description="Confirms the voice is yours or you have the speaker's permission"),
    lang: Literal["auto", "km", "en"] = Form("auto"),
    speed: float = Form(1.0, ge=0.5, le=2.0),
    reference_text: str | None = Form(None, description="Transcript of the reference audio; transcribed automatically if omitted"),
    settings: Settings = Depends(get_settings),
    queue: CloneJobQueue = Depends(get_clone_queue),
) -> CloneJobOut:
    """Queue a voice-cloning job. Poll `status_url` until `status` is `done`, then fetch `audio_url`."""
    if not consent:
        raise HTTPException(403, "Voice cloning requires consent: only clone your own voice "
                                 "or a voice you have explicit permission to use.")
    if len(text) > settings.clone_max_chars:
        raise HTTPException(413, f"Text exceeds {settings.clone_max_chars} characters")

    job_id = uuid.uuid4().hex
    job = CloneJob(id=job_id, text=text.strip(), lang=lang, speed=speed,
                   work_dir=settings.tmp_dir / "clone_jobs" / job_id,
                   ref_text=(reference_text or "").strip() or None)
    job.work_dir.mkdir(parents=True, exist_ok=True)
    try:
        async with saved_upload(reference_audio, settings.tmp_dir, settings.max_upload_mb) as path:
            await run_in_threadpool(load_reference, path, job.reference_path,
                                    settings.clone_ref_min_s, settings.clone_ref_max_s)
        queue.submit(job)
    except InvalidReference as exc:
        shutil.rmtree(job.work_dir, ignore_errors=True)
        raise HTTPException(422, str(exc)) from exc
    except QueueFull as exc:
        shutil.rmtree(job.work_dir, ignore_errors=True)
        raise HTTPException(503, str(exc), headers={"Retry-After": "30"}) from exc
    except BaseException:
        shutil.rmtree(job.work_dir, ignore_errors=True)
        raise
    return _job_out(job, queue, request)


@router.get("/jobs/{job_id}", response_model=CloneJobOut, name="clone_job_status")
def clone_job_status(job_id: str, request: Request, queue: CloneJobQueue = Depends(get_clone_queue)) -> CloneJobOut:
    job = queue.get(job_id)
    if job is None:
        raise HTTPException(404, "Job not found (it may have expired)")
    return _job_out(job, queue, request)


@router.get("/jobs/{job_id}/audio", response_class=FileResponse, name="clone_job_audio",
            responses={200: {"content": {"audio/wav": {}}}})
def clone_job_audio(job_id: str, queue: CloneJobQueue = Depends(get_clone_queue)) -> FileResponse:
    job = queue.get(job_id)
    if job is None:
        raise HTTPException(404, "Job not found (it may have expired)")
    if job.status != "done":
        raise HTTPException(409, f"Job is {job.status}; audio is not available")
    return FileResponse(job.output_path, media_type="audio/wav", filename="cloned.wav")
