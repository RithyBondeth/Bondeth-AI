import uuid
from datetime import datetime
import math
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.db import Transcription, User, get_db
from app.services.subtitles import subtitle_text

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


class TranscriptSegment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: float = Field(ge=0, le=3600000, allow_inf_nan=False)
    end: float = Field(gt=0, le=3600000, allow_inf_nan=False)
    text: str = Field(max_length=10000)

    @model_validator(mode="after")
    def valid_duration(self):
        if math.floor(self.end * 1000 + 0.5) <= math.floor(self.start * 1000 + 0.5):
            raise ValueError("A subtitle must end after it starts (at millisecond precision)")
        return self


class TranscriptionDetail(TranscriptionOut):
    segments: list[TranscriptSegment] | None
    segmented_text: str | None
    revision: int
    updated_at: datetime | None


class TranscriptionEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=1)
    text: str | None = Field(None, max_length=500000)
    segments: list[TranscriptSegment] | None = Field(None, min_length=1, max_length=20000)

    @model_validator(mode="after")
    def exactly_one_editor(self):
        if (self.text is None) == (self.segments is None):
            raise ValueError("Provide either text or timed segments")
        if self.segments and sum(len(segment.text) for segment in self.segments) > 500000:
            raise ValueError("Transcript exceeds 500000 characters")
        if self.segments and any(b.start < a.start for a, b in zip(self.segments, self.segments[1:])):
            raise ValueError("Subtitle segments must be ordered by start time")
        if (self.text and "\x00" in self.text) or (self.segments and any("\x00" in s.text for s in self.segments)):
            raise ValueError("Transcript cannot contain null characters")
        return self


async def _owned_transcription(transcription_id: uuid.UUID, user: User, session: AsyncSession,
                                lock: bool = False) -> Transcription:
    statement = select(Transcription).where(Transcription.id == transcription_id, Transcription.user_id == user.id)
    if lock:
        statement = statement.with_for_update()
    row = await session.scalar(statement)
    if row is None:
        raise HTTPException(404, "Transcription not found")
    return row


@router.get("", response_model=TranscriptionPage)
async def list_transcriptions(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    q: str = Query("", max_length=500),
    language: Literal["km", "en"] | None = Query(None),
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> TranscriptionPage:
    """Search all your saved transcriptions, newest first (literal, case-insensitive text)."""
    mine = Transcription.user_id == user.id
    if q.strip():
        mine &= Transcription.transcribed_text.icontains(q.strip(), autoescape=True)
    if language:
        mine &= Transcription.language_code == language
    total = await session.scalar(select(func.count()).select_from(Transcription).where(mine))
    rows = await session.scalars(
        select(Transcription).where(mine)
        .order_by(Transcription.created_at.desc(), Transcription.id).limit(limit).offset(offset))
    return TranscriptionPage(items=[TranscriptionOut.model_validate(r) for r in rows], total=total or 0)


@router.get("/{transcription_id}", response_model=TranscriptionDetail)
async def get_transcription(transcription_id: uuid.UUID, user: User = Depends(get_current_user),
                             session: AsyncSession = Depends(get_db)) -> TranscriptionDetail:
    return TranscriptionDetail.model_validate(await _owned_transcription(transcription_id, user, session))


@router.patch("/{transcription_id}", response_model=TranscriptionDetail)
async def edit_transcription(transcription_id: uuid.UUID, edit: TranscriptionEdit,
                              user: User = Depends(get_current_user), session: AsyncSession = Depends(get_db)) -> TranscriptionDetail:
    row = await _owned_transcription(transcription_id, user, session, lock=True)
    if edit.segments is not None:
        if row.audio_duration_seconds is not None and any(s.end > row.audio_duration_seconds + 0.02 for s in edit.segments):
            raise HTTPException(422, "Subtitle timing exceeds the audio duration")
        text = " ".join(s.text.strip() for s in edit.segments if s.text.strip())
        segments = [s.model_dump() for s in edit.segments]
    else:
        if row.segments:
            raise HTTPException(422, "Edit timed transcripts through their segments to preserve subtitle alignment")
        text, segments = edit.text, None
    if row.revision != edit.revision:
        # A retry after a lost response is safe if this exact draft is already saved.
        if row.transcribed_text == text and row.segments == segments:
            return TranscriptionDetail.model_validate(row)
        raise HTTPException(409, "This transcript changed elsewhere. Load the saved version or save your version explicitly.")
    if row.transcribed_text != text or row.segments != segments:
        if row.transcribed_text != text:
            row.segmented_text = None  # model-provided word boundaries no longer describe the edited words
        row.transcribed_text, row.segments = text, segments
        row.revision += 1
        row.updated_at = func.now()
        await session.commit()
        await session.refresh(row)
    return TranscriptionDetail.model_validate(row)


@router.get("/{transcription_id}/export")
async def export_transcription(transcription_id: uuid.UUID, format: Literal["txt", "srt", "vtt"] = Query("txt"),
                                user: User = Depends(get_current_user), session: AsyncSession = Depends(get_db)) -> Response:
    row = await _owned_transcription(transcription_id, user, session)
    if format == "txt":
        content, media_type = row.transcribed_text, "text/plain"
    else:
        try:
            content = subtitle_text(row.segments or [], format)
        except ValueError as exc:
            raise HTTPException(422, "No subtitle timestamps were saved for this transcript, or all cues are empty.") from exc
        media_type = "text/vtt" if format == "vtt" else "application/x-subrip"
    return Response(content, media_type=media_type, headers={"Cache-Control": "private, no-store",
                    "Content-Disposition": f'attachment; filename="transcript-{row.id}.{format}"'})


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
