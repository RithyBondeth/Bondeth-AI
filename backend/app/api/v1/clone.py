import shutil
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.voices import get_owned_voice, voice_audio_path
from app.auth import get_current_user
from app.config import Settings, get_settings
from app.db import User, get_db
from app.deps import get_clone_queue
from app.services.clone_jobs import CloneJob, CloneJobQueue, JobStatus, QueueFull, RefTextSource
from app.services.voice_clone import InvalidReference, load_reference
from app.uploads import saved_upload

router = APIRouter(prefix="/clone", tags=["voice-cloning"])

CONSENT_REQUIRED = ("Voice cloning requires consent: only clone your own voice "
                    "or a voice you have explicit permission to use.")


class CloneJobOut(BaseModel):
    job_id: str
    status: JobStatus
    queue_position: int | None = None
    error: str | None = None
    voice_id: str | None = None
    reference_text: str | None = None
    reference_text_source: RefTextSource
    duration: float | None = None
    status_url: str
    audio_url: str | None = None


def _job_out(job: CloneJob, queue: CloneJobQueue, request: Request) -> CloneJobOut:
    return CloneJobOut(
        job_id=job.id,
        status=job.status,
        queue_position=queue.position(job),
        error=job.error,
        voice_id=job.voice_id,
        reference_text=job.ref_text,
        reference_text_source=job.ref_text_source,
        duration=job.duration,
        status_url=str(request.url_for("clone_job_status", job_id=job.id)),
        audio_url=str(request.url_for("clone_job_audio", job_id=job.id)) if job.status == "done" else None,
    )


def _owned_job(job_id: str, user: User, queue: CloneJobQueue) -> CloneJob:
    job = queue.get(job_id)
    if job is None or job.user_id != str(user.id):
        raise HTTPException(404, "Job not found (it may have expired)")
    return job


@router.post("", status_code=202, response_model=CloneJobOut)
async def create_clone_job(
    request: Request,
    text: str = Form(..., min_length=1, description="What the cloned voice should say"),
    voice_id: uuid.UUID | None = Form(None, description="A saved voice to use instead of uploading audio"),
    reference_audio: UploadFile | None = File(None, description="3-30 s of the voice to clone, if not using voice_id"),
    consent: bool = Form(False, description="Required with reference_audio: the voice is yours or you have permission"),
    reference_text: str | None = Form(None, description="Transcript of reference_audio; transcribed automatically if omitted"),
    lang: Literal["auto", "km", "en"] = Form("auto"),
    speed: float = Form(1.0, ge=0.5, le=2.0),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    queue: CloneJobQueue = Depends(get_clone_queue),
) -> CloneJobOut:
    """Queue a cloning job using either a saved `voice_id` or an uploaded `reference_audio`.

    Poll `status_url` until `status` is `done`, then download `audio_url`.
    """
    if (voice_id is None) == (reference_audio is None):
        raise HTTPException(422, "Provide exactly one of voice_id or reference_audio")
    if len(text) > settings.clone_max_chars:
        raise HTTPException(413, f"Text exceeds {settings.clone_max_chars} characters")

    job_id = uuid.uuid4().hex
    common = dict(id=job_id, user_id=str(user.id), text=text.strip(), lang=lang, speed=speed)

    if voice_id is not None:
        voice = await get_owned_voice(voice_id, user, session)  # consent was given when it was saved
        job = CloneJob(**common, work_dir=queue.new_work_dir(job_id), voice_id=str(voice.id),
                       reference_path=voice_audio_path(voice, settings), delete_reference=False,
                       ref_text=voice.reference_text, ref_text_source="saved_voice")
    else:
        if not consent:
            raise HTTPException(403, CONSENT_REQUIRED)
        work_dir = queue.new_work_dir(job_id)
        job = CloneJob(**common, work_dir=work_dir, reference_path=work_dir / "reference.wav",
                       ref_text=(reference_text or "").strip() or None)
        try:
            async with saved_upload(reference_audio, settings.tmp_dir, settings.max_upload_mb) as path:
                await run_in_threadpool(load_reference, path, job.reference_path,
                                        settings.clone_ref_min_s, settings.clone_ref_max_s)
        except InvalidReference as exc:
            shutil.rmtree(work_dir, ignore_errors=True)
            raise HTTPException(422, str(exc)) from exc
        except BaseException:
            shutil.rmtree(work_dir, ignore_errors=True)
            raise

    try:
        await run_in_threadpool(queue.submit, job)
    except QueueFull as exc:
        shutil.rmtree(job.work_dir, ignore_errors=True)
        raise HTTPException(503, str(exc), headers={"Retry-After": "30"}) from exc
    return _job_out(job, queue, request)


@router.get("/jobs/{job_id}", response_model=CloneJobOut, name="clone_job_status")
def clone_job_status(job_id: str, request: Request, user: User = Depends(get_current_user),
                     queue: CloneJobQueue = Depends(get_clone_queue)) -> CloneJobOut:
    return _job_out(_owned_job(job_id, user, queue), queue, request)


@router.get("/jobs/{job_id}/audio", response_class=FileResponse, name="clone_job_audio",
            responses={200: {"content": {"audio/wav": {}}}})
def clone_job_audio(job_id: str, user: User = Depends(get_current_user),
                    queue: CloneJobQueue = Depends(get_clone_queue)) -> FileResponse:
    job = _owned_job(job_id, user, queue)
    if job.status != "done":
        raise HTTPException(409, f"Job is {job.status}; audio is not available")
    return FileResponse(job.output_path, media_type="audio/wav", filename="cloned.wav")
