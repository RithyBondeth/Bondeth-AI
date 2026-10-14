"""Developer API keys: create (the key is shown once), list, revoke, and see metered usage.

Managing keys needs a signed-in session; a request made with an API key gets 403.
"""

import uuid
from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_session_user, new_api_key
from app.config import Settings, get_settings
from app.db import ApiKey, ApiKeyUsage, User, get_db
from app.limits import QUOTAS, Limits, get_limits

router = APIRouter(prefix="/api-keys", tags=["api keys"])


class ApiKeyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100, description="What the key is for, e.g. 'Telegram bot'")


class ApiKeyOut(BaseModel):
    id: uuid.UUID
    name: str
    prefix: str
    created_at: datetime
    last_used_at: datetime | None

    model_config = {"from_attributes": True}


class ApiKeyCreated(ApiKeyOut):
    key: str = Field(..., description="The full key. It is shown only once: store it somewhere safe.")


class UsageDay(BaseModel):
    day: date
    requests: int
    stt_seconds: int = 0
    tts_chars: int = 0
    clone_jobs: int = 0


async def _owned_key(key_id: uuid.UUID, user: User, session: AsyncSession) -> ApiKey:
    key = await session.get(ApiKey, key_id)
    if key is None or key.user_id != user.id or key.revoked_at is not None:
        raise HTTPException(404, "API key not found")
    return key


@router.post("", status_code=201, response_model=ApiKeyCreated)
async def create_api_key(req: ApiKeyCreate, user: User = Depends(get_session_user),
                         session: AsyncSession = Depends(get_db),
                         settings: Settings = Depends(get_settings)) -> ApiKeyCreated:
    active = await session.scalar(select(func.count()).select_from(ApiKey)
                                  .where(ApiKey.user_id == user.id, ApiKey.revoked_at.is_(None)))
    if active >= settings.max_api_keys_per_user:
        raise HTTPException(409, f"You can have up to {settings.max_api_keys_per_user} API keys. Revoke one first.")
    key, key_hash = new_api_key()
    row = ApiKey(user_id=user.id, name=req.name.strip(), prefix=key[:12], key_hash=key_hash)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return ApiKeyCreated(**ApiKeyOut.model_validate(row).model_dump(), key=key)


@router.get("", response_model=list[ApiKeyOut])
async def list_api_keys(user: User = Depends(get_session_user),
                        session: AsyncSession = Depends(get_db)) -> list[ApiKeyOut]:
    rows = await session.scalars(select(ApiKey).where(ApiKey.user_id == user.id, ApiKey.revoked_at.is_(None))
                                 .order_by(ApiKey.created_at.desc()))
    return [ApiKeyOut.model_validate(r) for r in rows]


@router.delete("/{key_id}", status_code=204)
async def revoke_api_key(key_id: uuid.UUID, user: User = Depends(get_session_user),
                         session: AsyncSession = Depends(get_db)) -> Response:
    """Revoke a key. It stops working immediately; its usage history is kept."""
    key = await _owned_key(key_id, user, session)
    key.revoked_at = datetime.now(UTC)
    await session.commit()
    return Response(status_code=204)


@router.get("/{key_id}/usage", response_model=list[UsageDay])
async def api_key_usage(key_id: uuid.UUID, days: int = Query(30, ge=1, le=366),
                        user: User = Depends(get_session_user), session: AsyncSession = Depends(get_db),
                        limits: Limits = Depends(get_limits)) -> list[UsageDay]:
    """Metered work done with this key per day (newest first), in the quota timezone."""
    await _owned_key(key_id, user, session)
    since = limits.resets_at().date() - timedelta(days=days)
    rows = await session.scalars(select(ApiKeyUsage).where(ApiKeyUsage.api_key_id == key_id, ApiKeyUsage.day > since))
    by_day: dict[date, UsageDay] = {}
    for r in rows:
        day = by_day.setdefault(r.day, UsageDay(day=r.day, requests=0))
        day.requests += r.requests
        if r.quota in QUOTAS:
            setattr(day, r.quota, getattr(day, r.quota) + r.amount)
    return sorted(by_day.values(), key=lambda d: d.day, reverse=True)
