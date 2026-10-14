from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from app.auth import get_optional_user
from app.db import User
from app.limits import QUOTAS, SIGNED_IN_ONLY, Caller, Limits, get_limits

router = APIRouter(prefix="/usage", tags=["usage"])


class QuotaOut(BaseModel):
    used: int
    limit: int | None  # None when limits are switched off
    remaining: int | None


class UsageOut(BaseModel):
    signed_in: bool  # has the account allowance (signed in with a verified email)
    account: Literal["none", "unverified", "verified"]
    resets_at: datetime
    # stt_seconds, tts_chars, and clone_jobs (signed in only)
    quotas: dict[str, QuotaOut]


@router.get("", response_model=UsageOut)
async def usage(request: Request, user: User | None = Depends(get_optional_user),
                limits: Limits = Depends(get_limits)) -> UsageOut:
    """Today's usage and allowances for you (with a bearer token) or your IP address."""
    caller = Caller.of(request, user)
    quotas = {}
    for quota in QUOTAS:
        if quota in SIGNED_IN_ONLY and not caller.signed_in:
            continue
        used = await limits.used(quota, caller)
        limit = limits.limit(quota, caller) if limits.enforced else None
        quotas[quota] = QuotaOut(used=used, limit=limit, remaining=None if limit is None else max(limit - used, 0))
    account = "verified" if caller.signed_in else "unverified" if caller.unverified else "none"
    return UsageOut(signed_in=caller.signed_in, account=account, resets_at=limits.resets_at(), quotas=quotas)
