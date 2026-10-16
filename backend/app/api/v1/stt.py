"""Speech-to-text.

POST /stt answers in one request: fine for short clips. Long recordings go to
POST /stt/jobs, which queues them and streams segments as they're decoded
(GET /stt/jobs/{id}/events, Server-Sent Events), so the first words show up
within seconds instead of after the whole file.
"""

import json
import shutil
import uuid
from collections.abc import AsyncIterator
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.auth import get_optional_user
from app.config import Settings, get_settings
from app.db import Transcription, User
from app.deps import get_stt_queue, get_stt_service
from app.limits import Caller, Limits, get_limits, rate_limit
from app.services.stt import SttService
from app.services.stt_jobs import JobStatus, QueueFull, SttJob, SttJobQueue, events_key, job_key
from app.uploads import audio_duration, saved_upload, store_upload

router = APIRouter(prefix="/stt", tags=["speech-to-text"])

# Each XREAD blocks briefly: well under the Redis client's socket timeout, so a long
# silence between segments never looks like a dead connection.
EVENTS_BLOCK_MS = 1_000
KEEPALIVE_S = 15


class SegmentOut(BaseModel):
    start: float
    end: float
    text: str


class SttResponse(BaseModel):
    status: Literal["success"] = "success"
    detected_language: str
    language_probability: float
    duration: float
    text: str
    segmented_text: str
    segments: list[SegmentOut]
    transcription_id: uuid.UUID | None = None  # set when saved to a signed-in user's history


@router.post("", response_model=SttResponse)
async def speech_to_text(
    request: Request,
    file: UploadFile = File(..., description="Audio file (.wav, .mp3, .m4a, .webm, ...)"),
    language: Literal["auto", "km", "en"] = Form("auto"),
    settings: Settings = Depends(get_settings),
    stt: SttService = Depends(get_stt_service),
    user: User | None = Depends(get_optional_user),
    caller: Caller = Depends(rate_limit("stt")),
    limits: Limits = Depends(get_limits),
) -> SttResponse:
    """Public. When called with a bearer token, the result is also saved to your history.

    Counts against the daily speech-to-text allowance (see GET /usage).
    """
    async with saved_upload(file, settings.tmp_dir, settings.max_upload_mb) as path:
        # Reserve the header's duration up front when it has one; settle to the real one below.
        probed = await run_in_threadpool(audio_duration, path)
        async with limits.spend("stt_seconds", caller, probed or 0) as charge:
            try:
                # Whisper is CPU/GPU-bound; keep it off the event loop.
                result = await run_in_threadpool(stt.transcribe, path, None if language == "auto" else language)
            except Exception as exc:  # corrupt/undecodable audio surfaces here
                raise HTTPException(422, f"Could not transcribe audio: {exc}") from exc
            charge.settle(result.duration)

    transcription_id = None
    if user is not None and result.text:
        async with request.app.state.sessionmaker() as session:
            row = Transcription(user_id=user.id, language_code=result.language,
                                transcribed_text=result.text, audio_duration_seconds=result.duration)
            session.add(row)
            await session.commit()
            transcription_id = row.id

    return SttResponse(
        transcription_id=transcription_id,
        detected_language=result.language,
        language_probability=result.language_probability,
        duration=result.duration,
        text=result.text,
        segmented_text=result.segmented_text,
        segments=[SegmentOut(**vars(s)) for s in result.segments],
    )


# --- Jobs: long recordings, streamed results -----------------------------------------

class SttJobOut(BaseModel):
    job_id: str
    status: JobStatus
    queue_position: int | None = None
    error: str | None = None
    result: SttResponse | None = None  # once status is "done"
    status_url: str
    events_url: str


async def _save_history(job: SttJob, request: Request) -> str | None:
    """Save a finished job to its owner's history once, whichever reader gets there first."""
    if job.transcription_id or not job.user_id or job.status != "done":
        return job.transcription_id
    redis = request.app.state.redis
    body = json.loads(job.result)
    async with request.app.state.sessionmaker() as session:
        owner = await session.scalar(select(User.id).where(User.id == uuid.UUID(job.user_id)).with_for_update(key_share=True))
        if owner is None:
            return None
        await session.execute(insert(Transcription).values(
            user_id=owner, source_job_id=job.id, language_code=body["detected_language"],
            transcribed_text=body["text"], audio_duration_seconds=body["duration"]
        ).on_conflict_do_nothing(index_elements=[Transcription.source_job_id]))
        row_id = await session.scalar(select(Transcription.id).where(Transcription.source_job_id == job.id))
        await session.commit()
    job.transcription_id = str(row_id)
    await redis.hset(job_key(job.id), "transcription_id", job.transcription_id)
    return job.transcription_id


async def _job_out(job: SttJob, queue: SttJobQueue, request: Request) -> SttJobOut:
    result = None
    if job.status == "done":
        transcription_id = await _save_history(job, request)
        result = SttResponse(**json.loads(job.result), transcription_id=transcription_id)
    return SttJobOut(
        job_id=job.id, status=job.status, error=job.error, result=result,
        queue_position=await run_in_threadpool(queue.position, job),
        status_url=str(request.url_for("stt_job_status", job_id=job.id)),
        events_url=str(request.url_for("stt_job_events", job_id=job.id)),
    )


async def _visible_job(job_id: str, user: User | None, queue: SttJobQueue) -> SttJob:
    job = await run_in_threadpool(queue.get, job_id)
    # A signed-in user's job is theirs alone; anonymous jobs are reachable by their unguessable id.
    if job is None or (job.user_id and (user is None or str(user.id) != job.user_id)):
        raise HTTPException(404, "Job not found (it may have expired)")
    return job


@router.post("/jobs", status_code=202, response_model=SttJobOut)
async def create_stt_job(
    request: Request,
    file: UploadFile = File(..., description="Audio file, up to the job upload limit"),
    language: Literal["auto", "km", "en"] = Form("auto"),
    settings: Settings = Depends(get_settings),
    user: User | None = Depends(get_optional_user),
    caller: Caller = Depends(rate_limit("stt")),
    limits: Limits = Depends(get_limits),
    queue: SttJobQueue = Depends(get_stt_queue),
) -> SttJobOut:
    """Queue a transcription. Follow `events_url` for live segments, or poll `status_url`.

    The recording's full length is reserved from the daily speech-to-text allowance
    up front and refunded if the job fails.
    """
    job_id = uuid.uuid4().hex
    work_dir = queue.new_work_dir(job_id)
    try:
        path = await store_upload(file, work_dir, settings.stt_job_max_upload_mb)
        duration = await run_in_threadpool(audio_duration, path)
        if duration is None:
            raise HTTPException(422, "Could not read the audio file.")
        async with limits.spend("stt_seconds", caller, duration) as charge:
            job = SttJob(id=job_id, audio_path=path, language=language, user_id=str(user.id) if user else "",
                         priority=caller.plan == "pro",
                         charge=limits.job_charge("stt_seconds", caller, charge).dumps())
            try:
                await run_in_threadpool(queue.submit, job)
            except QueueFull as exc:
                raise HTTPException(503, str(exc), headers={"Retry-After": "30"}) from exc
    except BaseException:
        shutil.rmtree(work_dir, ignore_errors=True)
        raise
    return await _job_out(job, queue, request)


@router.get("/jobs/{job_id}", response_model=SttJobOut, name="stt_job_status")
async def stt_job_status(job_id: str, request: Request, user: User | None = Depends(get_optional_user),
                         queue: SttJobQueue = Depends(get_stt_queue)) -> SttJobOut:
    return await _job_out(await _visible_job(job_id, user, queue), queue, request)


@router.get("/jobs/{job_id}/events", name="stt_job_events", response_class=StreamingResponse,
            responses={200: {"content": {"text/event-stream": {}}}})
async def stt_job_events(job_id: str, request: Request, user: User | None = Depends(get_optional_user),
                         queue: SttJobQueue = Depends(get_stt_queue)) -> StreamingResponse:
    """Server-Sent Events, replayed from the start (or after `Last-Event-ID`):

    - `info`: `{detected_language, language_probability, duration}` once decoding starts
    - `segment`: `{start, end, text, segmented_text}` for each piece, as it's decoded
    - `done`: the full result (same shape as POST /stt), or `error`: `{error}`
    """
    await _visible_job(job_id, user, queue)
    redis = request.app.state.redis
    last_id = request.headers.get("last-event-id", "0")

    async def stream() -> AsyncIterator[str]:
        nonlocal last_id
        idle = 0.0
        while True:
            batch = await redis.xread({events_key(job_id): last_id}, block=EVENTS_BLOCK_MS, count=100)
            if not batch:
                if not await redis.exists(job_key(job_id)):
                    return  # expired
                idle += EVENTS_BLOCK_MS / 1000
                if idle >= KEEPALIVE_S:  # stops proxies from closing a quiet connection
                    idle = 0.0
                    yield ": keep-alive\n\n"
                continue
            idle = 0.0
            for _, entries in batch:
                for entry_id, fields in entries:
                    last_id, event, data = entry_id, fields["event"], fields["data"]
                    if event == "done":
                        job = await run_in_threadpool(queue.get, job_id)
                        if job is not None:
                            data = json.dumps({**json.loads(data), "transcription_id": await _save_history(job, request)},
                                              ensure_ascii=False)
                    yield f"id: {entry_id}\nevent: {event}\ndata: {data}\n\n"
                    if event in ("done", "error"):
                        return

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
