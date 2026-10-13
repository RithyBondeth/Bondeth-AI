"""Saved voices: store a voice sample once, then clone with its id.

Audio lives under data_dir/voices/{user_id}/{voice_id}.wav; the database row
stores that path relative to data_dir so the data folder can be moved.
"""

import uuid
from datetime import UTC, datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.db import ClonedVoice, User, get_db
from app.deps import get_stt_service
from app.services.stt import SttService
from app.services.voice_clone import InvalidReference, load_reference
from app.uploads import saved_upload

router = APIRouter(prefix="/voices", tags=["saved voices"])

CONSENT_REQUIRED = ("Saving a voice requires consent: only save your own voice "
                    "or a voice you have explicit permission to use.")


class VoiceOut(BaseModel):
    id: uuid.UUID
    voice_alias: str
    reference_text: str
    reference_duration_seconds: float
    consent_confirmed_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


class VoiceUpdate(BaseModel):
    voice_alias: str | None = Field(None, min_length=1, max_length=100)
    reference_text: str | None = Field(None, min_length=1)


def voice_audio_path(voice: ClonedVoice, settings: Settings) -> Path:
    return settings.data_dir / voice.reference_audio_path


async def get_owned_voice(voice_id: uuid.UUID, user: User, session: AsyncSession) -> ClonedVoice:
    voice = await session.get(ClonedVoice, voice_id)
    # Someone else's voice looks exactly like a missing one.
    if voice is None or voice.user_id != user.id:
        raise HTTPException(404, "Voice not found")
    return voice


@router.post("", status_code=201, response_model=VoiceOut)
async def create_voice(
    voice_alias: str = Form(..., min_length=1, max_length=100),
    reference_audio: UploadFile = File(..., description="3-30 s of the voice (.wav, .mp3, .m4a, ...)"),
    consent: bool = Form(..., description="Confirms the voice is yours or you have the speaker's permission"),
    reference_text: str | None = Form(None, description="Transcript of the audio; transcribed automatically if omitted"),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
    stt: SttService = Depends(get_stt_service),
) -> VoiceOut:
    if not consent:
        raise HTTPException(403, CONSENT_REQUIRED)
    count = await session.scalar(select(func.count()).select_from(ClonedVoice).where(ClonedVoice.user_id == user.id))
    if count >= settings.max_voices_per_user:
        raise HTTPException(409, f"You can save up to {settings.max_voices_per_user} voices. Delete one first.")

    voice_id = uuid.uuid4()
    relative = Path("voices") / str(user.id) / f"{voice_id}.wav"
    dest = settings.data_dir / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        async with saved_upload(reference_audio, settings.tmp_dir, settings.max_upload_mb) as upload:
            duration = await run_in_threadpool(
                load_reference, upload, dest, settings.clone_ref_min_s, settings.clone_ref_max_s)
        text = (reference_text or "").strip()
        if not text:
            text = (await run_in_threadpool(stt.transcribe, dest)).text.strip()
            if not text:
                raise InvalidReference("No speech was detected in the reference audio.")
        voice = ClonedVoice(
            id=voice_id, user_id=user.id, voice_alias=voice_alias.strip(), reference_audio_path=str(relative),
            reference_text=text, reference_duration_seconds=round(duration, 2),
            consent_confirmed_at=datetime.now(UTC),
        )
        session.add(voice)
        await session.commit()
    except InvalidReference as exc:
        dest.unlink(missing_ok=True)
        raise HTTPException(422, str(exc)) from exc
    except BaseException:
        dest.unlink(missing_ok=True)
        raise
    await session.refresh(voice)
    return VoiceOut.model_validate(voice)


@router.get("", response_model=list[VoiceOut])
async def list_voices(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_db)) -> list[VoiceOut]:
    rows = await session.scalars(
        select(ClonedVoice).where(ClonedVoice.user_id == user.id).order_by(ClonedVoice.created_at.desc()))
    return [VoiceOut.model_validate(v) for v in rows]


@router.get("/{voice_id}", response_model=VoiceOut)
async def get_voice(voice_id: uuid.UUID, user: User = Depends(get_current_user),
                    session: AsyncSession = Depends(get_db)) -> VoiceOut:
    return VoiceOut.model_validate(await get_owned_voice(voice_id, user, session))


@router.patch("/{voice_id}", response_model=VoiceOut)
async def update_voice(voice_id: uuid.UUID, req: VoiceUpdate, user: User = Depends(get_current_user),
                       session: AsyncSession = Depends(get_db)) -> VoiceOut:
    """Rename a voice or correct its transcript (a wrong transcript lowers cloning quality)."""
    voice = await get_owned_voice(voice_id, user, session)
    if req.voice_alias is not None:
        voice.voice_alias = req.voice_alias.strip()
    if req.reference_text is not None:
        voice.reference_text = req.reference_text.strip()
    await session.commit()
    await session.refresh(voice)
    return VoiceOut.model_validate(voice)


@router.delete("/{voice_id}", status_code=204)
async def delete_voice(voice_id: uuid.UUID, user: User = Depends(get_current_user),
                       session: AsyncSession = Depends(get_db),
                       settings: Settings = Depends(get_settings)) -> Response:
    voice = await get_owned_voice(voice_id, user, session)
    path = voice_audio_path(voice, settings)
    await session.delete(voice)
    await session.commit()
    path.unlink(missing_ok=True)
    return Response(status_code=204)


@router.get("/{voice_id}/audio", response_class=FileResponse, responses={200: {"content": {"audio/wav": {}}}})
async def voice_audio(voice_id: uuid.UUID, user: User = Depends(get_current_user),
                      session: AsyncSession = Depends(get_db),
                      settings: Settings = Depends(get_settings)) -> FileResponse:
    """Play back the stored voice sample."""
    voice = await get_owned_voice(voice_id, user, session)
    path = voice_audio_path(voice, settings)
    if not path.exists():
        raise HTTPException(404, "Voice audio is missing")
    return FileResponse(path, media_type="audio/wav", filename=f"{voice.voice_alias}.wav")
