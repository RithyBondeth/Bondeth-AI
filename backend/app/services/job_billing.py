"""Settling what a queued job was charged, once the worker knows its real cost.

The API reserves a job's cost when it's submitted (see Limits.spend): the daily
allowance counter in Redis and, for API-key requests, the key's metered usage in
PostgreSQL. The worker then settles: a failed job is refunded in full, and an STT
job is corrected to the length actually decoded.

Workers are plain threads with no async database session, so the rare metering
correction runs on its own short-lived connection.
"""

import asyncio
import json
import logging
import uuid
from dataclasses import asdict, dataclass
from datetime import date

from redis import Redis
from sqlalchemy import func, update, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from app.db import ApiKeyUsage, Transcription, User

logger = logging.getLogger(__name__)


@dataclass
class JobCharge:
    quota: str  # stt_seconds | clone_jobs
    quota_key: str  # the Redis daily counter it was added to
    amount: int
    api_key_id: str = ""  # set when submitted with an API key: also metered per key
    day: str = ""  # the metering day (ISO date) the amount was recorded under

    def dumps(self) -> str:
        return json.dumps(asdict(self))

    @classmethod
    def loads(cls, raw: str | None) -> "JobCharge | None":
        return cls(**json.loads(raw)) if raw else None


class JobBilling:
    def __init__(self, redis: Redis, database_url: str | None):
        self._redis = redis
        self._database_url = database_url

    def save_history(self, job_id: str, user_id: str, body: dict) -> str | None:
        if not self._database_url:
            return None
        return asyncio.run(self._save_history(job_id, user_id, body))

    async def _save_history(self, job_id: str, user_id: str, body: dict) -> str | None:
        engine = create_async_engine(self._database_url, poolclass=NullPool)
        try:
            async with engine.begin() as conn:
                # Key-share lock makes concurrent account deletion wait for the insert.
                owner = await conn.scalar(select(User.id).where(User.id == uuid.UUID(user_id)).with_for_update(key_share=True))
                if owner is None:
                    return None
                await conn.execute(insert(Transcription).values(
                    user_id=owner, source_job_id=job_id, language_code=body["detected_language"],
                    transcribed_text=body["text"], audio_duration_seconds=body["duration"]
                ).on_conflict_do_nothing(index_elements=[Transcription.source_job_id]))
                return str(await conn.scalar(select(Transcription.id).where(Transcription.source_job_id == job_id)))
        finally:
            await engine.dispose()

    def settle(self, charge: JobCharge | None, actual: int) -> None:
        """Correct a job's charge to `actual` (0 refunds it entirely)."""
        if charge is None or actual == charge.amount:
            return
        delta = actual - charge.amount
        # The counter expires after two days; don't resurrect it with a stray negative.
        if charge.quota_key and self._redis.exists(charge.quota_key):
            self._redis.incrby(charge.quota_key, delta)
        if charge.api_key_id and charge.day and self._database_url:
            try:
                asyncio.run(self._correct_metering(charge, delta))
            except Exception:
                logger.exception("Couldn't correct metered usage for API key %s", charge.api_key_id)
        charge.amount = actual

    async def _correct_metering(self, charge: JobCharge, delta: int) -> None:
        engine = create_async_engine(self._database_url, poolclass=NullPool)
        try:
            async with engine.begin() as conn:
                await conn.execute(
                    update(ApiKeyUsage)
                    .where(ApiKeyUsage.api_key_id == uuid.UUID(charge.api_key_id),
                           ApiKeyUsage.day == date.fromisoformat(charge.day),
                           ApiKeyUsage.quota == charge.quota)
                    .values(amount=func.greatest(ApiKeyUsage.amount + delta, 0)))
        finally:
            await engine.dispose()
