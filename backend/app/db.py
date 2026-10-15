"""Database models and session handling (PostgreSQL via async SQLAlchemy).

The schema follows the blueprint (users, transcriptions, cloned_voices) with
two additions to cloned_voices: the reference transcript, so a saved voice is
never re-transcribed, and when the owner confirmed consent to clone it.
Developer API keys (api_keys) and their daily metered usage (api_key_usage)
come from the blueprint's business model.
"""

import uuid
from collections.abc import AsyncIterator
from datetime import date, datetime

from fastapi import Request
from sqlalchemy import BigInteger, Date, DateTime, Float, ForeignKey, Integer, String, Text, func
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
    # Until the email is confirmed the account only gets the signed-out allowance,
    # so creating accounts in bulk doesn't buy extra quota.
    email_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Tokens issued before this (e.g. before a password reset) are rejected.
    sessions_valid_after: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    stripe_checkout_id: Mapped[str | None] = mapped_column(String(255))
    subscription_status: Mapped[str | None] = mapped_column(String(40))
    subscription_price_id: Mapped[str | None] = mapped_column(String(255))
    subscription_valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None


class Transcription(Base):
    __tablename__ = "transcriptions"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _owner()
    language_code: Mapped[str] = mapped_column(String(10), nullable=False)
    transcribed_text: Mapped[str] = mapped_column(Text, nullable=False)
    audio_duration_seconds: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = _created_at()
    # A job saves history independently of whether a browser follows its result.
    source_job_id: Mapped[str | None] = mapped_column(String(32), unique=True)


class BillingEvent(Base):
    __tablename__ = "billing_events"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    event_type: Mapped[str] = mapped_column(String(100), nullable=False)
    processed_at: Mapped[datetime] = _created_at()


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


class ApiKey(Base):
    """A developer API key. Only a SHA-256 of the key is stored; the key itself is shown once."""
    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = _uuid_pk()
    user_id: Mapped[uuid.UUID] = _owner()
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    prefix: Mapped[str] = mapped_column(String(16), nullable=False)  # first characters, to recognise it
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    created_at: Mapped[datetime] = _created_at()
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ApiKeyUsage(Base):
    """Metered work per key, quota and day (in the quota timezone): the basis for API billing."""
    __tablename__ = "api_key_usage"

    api_key_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("api_keys.id", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    quota: Mapped[str] = mapped_column(String(20), primary_key=True)  # stt_seconds | tts_chars | clone_jobs
    amount: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    requests: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


def create_engine(database_url: str) -> AsyncEngine:
    return create_async_engine(database_url, pool_pre_ping=True)


def create_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


async def get_db(request: Request) -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request, from the app's engine."""
    async with request.app.state.sessionmaker() as session:
        yield session
