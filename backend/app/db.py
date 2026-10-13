"""Database models and session handling (PostgreSQL via async SQLAlchemy).

The schema follows the blueprint (users, transcriptions, cloned_voices) with
two additions to cloned_voices: the reference transcript, so a saved voice is
never re-transcribed, and when the owner confirmed consent to clone it.
"""

import uuid
from collections.abc import AsyncIterator
from datetime import datetime

from fastapi import Request
from sqlalchemy import DateTime, Float, ForeignKey, String, Text, func
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(primary_key=True, server_default=func.gen_random_uuid())


def _created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def _owner() -> Mapped[uuid.UUID]:
    return mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = _created_at()


class Transcription(Base):
    __tablename__ = "transcriptions"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _owner()
    language_code: Mapped[str] = mapped_column(String(10), nullable=False)
    transcribed_text: Mapped[str] = mapped_column(Text, nullable=False)
    audio_duration_seconds: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = _created_at()


class ClonedVoice(Base):
    __tablename__ = "cloned_voices"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _owner()
    voice_alias: Mapped[str] = mapped_column(String(100), nullable=False)
    reference_audio_path: Mapped[str] = mapped_column(String(512), nullable=False)
    reference_text: Mapped[str] = mapped_column(Text, nullable=False)
    reference_duration_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    consent_confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = _created_at()


def create_engine(database_url: str) -> AsyncEngine:
    return create_async_engine(database_url, pool_pre_ping=True)


def create_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request, from the app's engine."""
    async with request.app.state.sessionmaker() as session:
        yield session
