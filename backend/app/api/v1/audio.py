"""Private library of generated speech and voice-clone outputs."""
import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.config import Settings, get_settings
from app.db import GeneratedAudio, User, get_db
from app.services.audio_library import audio_path

router = APIRouter(prefix="/audio", tags=["audio-library"])


class AudioOut(BaseModel):
    id: uuid.UUID
    kind: Literal["tts", "clone"]
    text: str
    voice: str
    language: str
    speed: float
    duration: float
    engine: str
    notice: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class AudioPage(BaseModel):
    items: list[AudioOut]
    total: int


@router.get("", response_model=AudioPage)
async def list_audio(
    limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0),
    q: str = Query("", max_length=500), kind: Literal["tts", "clone"] | None = Query(None),
    user: User = Depends(get_current_user), session: AsyncSession = Depends(get_db),
) -> AudioPage:
    mine = GeneratedAudio.user_id == user.id
    if q.strip():
        mine &= GeneratedAudio.text.icontains(q.strip(), autoescape=True)
    if kind:
        mine &= GeneratedAudio.kind == kind
    total = await session.scalar(select(func.count()).select_from(GeneratedAudio).where(mine))
    rows = await session.scalars(select(GeneratedAudio).where(mine)
                                 .order_by(GeneratedAudio.created_at.desc(), GeneratedAudio.id)
                                 .limit(limit).offset(offset))
    return AudioPage(items=[AudioOut.model_validate(row) for row in rows], total=total or 0)


async def _owned_audio(audio_id: uuid.UUID, user: User, session: AsyncSession) -> GeneratedAudio:
    row = await session.scalar(select(GeneratedAudio).where(
        GeneratedAudio.id == audio_id, GeneratedAudio.user_id == user.id))
    if row is None:
        raise HTTPException(404, "Audio not found")
    return row


@router.get("/{audio_id}/file", response_class=FileResponse)
async def get_audio(audio_id: uuid.UUID, user: User = Depends(get_current_user),
                    session: AsyncSession = Depends(get_db), settings: Settings = Depends(get_settings)) -> FileResponse:
    row = await _owned_audio(audio_id, user, session)
    path = audio_path(settings.data_dir, user.id, row.id)
    if not await run_in_threadpool(path.is_file):
        raise HTTPException(404, "Audio file is unavailable")
    return FileResponse(path, media_type="audio/wav", filename=f"bondeth-{row.kind}-{row.id}.wav",
                        headers={"Cache-Control": "private, no-store"})


@router.delete("/{audio_id}", status_code=204)
async def delete_audio(audio_id: uuid.UUID, user: User = Depends(get_current_user),
                       session: AsyncSession = Depends(get_db), settings: Settings = Depends(get_settings)) -> Response:
    row = await _owned_audio(audio_id, user, session)
    await run_in_threadpool(audio_path(settings.data_dir, user.id, row.id).unlink, missing_ok=True)
    await session.delete(row)
    await session.commit()
    return Response(status_code=204)
