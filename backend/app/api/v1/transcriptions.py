import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import Transcription, User, get_db

router = APIRouter(prefix="/transcriptions", tags=["transcriptions"])


class TranscriptionOut(BaseModel):
    id: uuid.UUID
    language_code: str
    transcribed_text: str
    audio_duration_seconds: float | None
    created_at: datetime

    model_config = {"from_attributes": True}


class TranscriptionPage(BaseModel):
    items: list[TranscriptionOut]
    total: int


@router.get("", response_model=TranscriptionPage)
async def list_transcriptions(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> TranscriptionPage:
    """Your saved transcriptions, newest first."""
    mine = Transcription.user_id == user.id
    total = await session.scalar(select(func.count()).select_from(Transcription).where(mine))
    rows = await session.scalars(
        select(Transcription).where(mine)
        .order_by(Transcription.created_at.desc(), Transcription.id).limit(limit).offset(offset))
    return TranscriptionPage(items=[TranscriptionOut.model_validate(r) for r in rows], total=total or 0)


@router.delete("/{transcription_id}", status_code=204)
async def delete_transcription(
    transcription_id: uuid.UUID,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Response:
    result = await session.execute(
        delete(Transcription).where(Transcription.id == transcription_id, Transcription.user_id == user.id))
    await session.commit()
    if result.rowcount == 0:
        raise HTTPException(404, "Transcription not found")
    return Response(status_code=204)
