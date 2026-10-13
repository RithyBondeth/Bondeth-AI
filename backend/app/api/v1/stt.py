import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel

from app.auth import get_optional_user
from app.config import Settings, get_settings
from app.db import Transcription, User
from app.deps import get_stt_service
from app.services.stt import SttService
from app.uploads import saved_upload

router = APIRouter(prefix="/stt", tags=["speech-to-text"])


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
) -> SttResponse:
    """Public. When called with a bearer token, the result is also saved to your history."""
    async with saved_upload(file, settings.tmp_dir, settings.max_upload_mb) as path:
        try:
            # Whisper is CPU/GPU-bound; keep it off the event loop.
            result = await run_in_threadpool(stt.transcribe, path, None if language == "auto" else language)
        except Exception as exc:  # corrupt/undecodable audio surfaces here
            raise HTTPException(422, f"Could not transcribe audio: {exc}") from exc

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
