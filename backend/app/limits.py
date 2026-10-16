"""Rate limits and daily quotas, both counted in Redis.

- Rate limits stop bursts: at most N requests per fixed window to each endpoint
  group, per caller (the signed-in user, otherwise the client IP).
- Quotas are daily allowances of the expensive work itself: seconds of audio
  transcribed, characters spoken and clone jobs. They reset at local midnight
  (UTC+7, Cambodia, by default) and are what GET /usage reports.

A quota is reserved before the work starts and refunded if the work fails, so
parallel requests can't all slip under the limit. Speech-to-text reserves the
upload's duration when the file header has one, then settles to the duration
actually transcribed.

Requests made with a developer API key get their own rate-limit bucket per key,
share the owner's daily quotas (so extra keys don't mean extra allowance) and
are metered per key and day in PostgreSQL (api_key_usage) for billing.

Usage is counted even with BONDETH_LIMITS_ENABLED=false; only enforcement stops.
"""

import math
import time
import uuid
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import Depends, Request
from fastapi.responses import JSONResponse
from redis.asyncio import Redis
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.auth import get_current_user, get_optional_user, get_redis
from app.config import Settings, get_settings
from app.db import ApiKeyUsage, User
from app.plans import effective_plan

Quota = Literal["stt_seconds", "tts_chars", "clone_jobs"]
QUOTAS: tuple[Quota, ...] = ("stt_seconds", "tts_chars", "clone_jobs")
SIGNED_IN_ONLY: frozenset[Quota] = frozenset({"clone_jobs"})

_LABELS = {"stt_seconds": "speech-to-text", "tts_chars": "text-to-speech", "clone_jobs": "voice cloning"}


@dataclass(frozen=True)
class Caller:
    key: str  # quota owner: "user:<id>" for verified accounts, else "ip:<address>"
    signed_in: bool  # gets the account allowance (a verified account)
    api_key_id: uuid.UUID | None = None  # set when the request used a developer API key
    unverified: bool = False  # signed in, but the email isn't confirmed yet
    plan: str = "free"

    @property
    def rate_key(self) -> str:
        return f"key:{self.api_key_id}" if self.api_key_id else self.key

    @classmethod
    def of(cls, request: Request, user: User | None) -> "Caller":
        if user is not None and user.email_verified:
            api_key = getattr(request.state, "api_key", None)
            return cls(f"user:{user.id}", True, api_key.id if api_key else None,
                       plan=effective_plan(user, get_settings()))
        # Signed out, or not verified yet: limited per IP, so new accounts don't add allowance.
        # Behind a reverse proxy, set uvicorn's FORWARDED_ALLOW_IPS so this is the real client.
        return cls(f"ip:{request.client.host if request.client else 'unknown'}", False, unverified=user is not None)


class LimitExceeded(Exception):
    reason: str

    def __init__(self, message: str, retry_after: int):
        super().__init__(message)
        self.retry_after = max(retry_after, 1)


class RateLimited(LimitExceeded):
    reason = "rate_limit"


class QuotaExceeded(LimitExceeded):
    reason = "quota"


async def limit_exceeded_handler(request: Request, exc: LimitExceeded) -> JSONResponse:
    return JSONResponse({"detail": str(exc), "reason": exc.reason}, status_code=429,
                        headers={"Retry-After": str(exc.retry_after)})


@dataclass
class Charge:
    """The amount a `spend` block will be billed; `settle` corrects it once the real cost is known."""
    amount: int

    def settle(self, actual: float) -> None:
        self.amount = math.ceil(actual)


def describe(quota: Quota, amount: int) -> str:
    if quota == "stt_seconds":
        return f"{amount // 60} min" if amount >= 60 else f"{amount} s"
    if quota == "tts_chars":
        return f"{amount:,} characters"
    return f"{amount} clone job{'s' if amount != 1 else ''}"


class Limits:
    def __init__(self, redis: Redis, settings: Settings, clock: Callable[[], float] = time.time,
                 sessionmaker: async_sessionmaker[AsyncSession] | None = None):
        self._redis = redis
        self._s = settings
        self._clock = clock
        self._sessionmaker = sessionmaker  # for per-API-key metering

    @property
    def enforced(self) -> bool:
        return self._s.limits_enabled

    # --- Rate limits ---------------------------------------------------------------

    async def hit(self, group: str, caller: Caller, cheap: bool = False,
                  limit: int | None = None, window: int | None = None, message: str | None = None) -> None:
        """Count one request to `group`; raise RateLimited past the per-window limit.

        `limit`/`window` override the defaults, e.g. for sign-ups per hour.
        """
        if not self.enforced:
            return
        if limit is None:
            if cheap:
                limit = self._s.rate_limit_cheap
            elif caller.api_key_id:
                limit = self._s.rate_limit_api_key
            elif caller.plan == "pro":
                limit = self._s.rate_limit_pro
            else:
                limit = self._s.rate_limit_user if caller.signed_in else self._s.rate_limit_anon
        window = window or self._s.rate_limit_window_s
        now = self._clock()
        key = f"rate:{group}:{caller.rate_key}:{int(now // window)}"
        async with self._redis.pipeline(transaction=True) as pipe:
            pipe.incr(key)
            pipe.expire(key, window, nx=True)
            count, _ = await pipe.execute()
        if count > limit:
            wait = math.ceil(window - now % window)
            when = f"{wait} s" if wait < 120 else f"{math.ceil(wait / 60)} min"
            raise RateLimited(f"{message or 'Too many requests.'} Try again in {when}.", retry_after=wait)

    # --- Daily quotas --------------------------------------------------------------

    def _today(self) -> datetime:
        tz = timezone(timedelta(hours=self._s.quota_utc_offset_hours))
        return datetime.fromtimestamp(self._clock(), tz).replace(hour=0, minute=0, second=0, microsecond=0)

    def resets_at(self) -> datetime:
        return self._today() + timedelta(days=1)

    def quota_key(self, quota: Quota, caller: Caller) -> str:
        """The Redis counter for today's usage (job workers settle against it later)."""
        return f"quota:{quota}:{caller.key}:{self._today():%Y-%m-%d}"

    def limit(self, quota: Quota, caller: Caller) -> int:
        if quota in SIGNED_IN_ONLY and not caller.signed_in:
            return 0
        if caller.signed_in and caller.plan == "pro":
            return getattr(self._s, f"quota_{quota}_pro")
        return getattr(self._s, f"quota_{quota}_{'user' if caller.signed_in else 'anon'}")

    async def used(self, quota: Quota, caller: Caller) -> int:
        return int(await self._redis.get(self.quota_key(quota, caller)) or 0)

    async def _add(self, quota: Quota, caller: Caller, amount: int) -> int:
        key = self.quota_key(quota, caller)
        async with self._redis.pipeline(transaction=True) as pipe:
            pipe.incrby(key, amount)
            pipe.expire(key, 2 * 86_400, nx=True)
            total, _ = await pipe.execute()
        return total

    async def _reserve(self, quota: Quota, caller: Caller, amount: int) -> None:
        total = await self._add(quota, caller, amount)
        limit = self.limit(quota, caller)
        # A zero-cost reservation (duration unknown until transcribed) still needs some allowance left.
        if not self.enforced or total < limit or (amount > 0 and total == limit):
            return
        await self._add(quota, caller, -amount)
        used = total - amount
        label = _LABELS[quota]
        if used < limit:
            message = (f"This needs {describe(quota, amount)} of {label} but only "
                       f"{describe(quota, limit - used)} of today's allowance is left.")
        elif limit == 0:
            message = f"Verify your email to use {label}." if caller.unverified else f"Sign in to use {label}."
        else:
            message = f"You've used today's {label} allowance ({describe(quota, limit)})."
        if limit > 0 and not caller.signed_in:
            message += (" Verify your email for a larger allowance." if caller.unverified
                        else " Sign in for a larger allowance.")
        raise QuotaExceeded(f"{message} It resets at midnight (UTC{self._s.quota_utc_offset_hours:+d}).",
                            retry_after=math.ceil(self.resets_at().timestamp() - self._clock()))

    @asynccontextmanager
    async def spend(self, quota: Quota, caller: Caller, amount: float) -> AsyncIterator[Charge]:
        """Reserve `amount` of a quota for the block; refunded if the block raises."""
        charge = Charge(math.ceil(amount))
        reserved = charge.amount
        await self._reserve(quota, caller, reserved)
        # Metered up front, before the block can queue a job whose worker may settle it.
        await self.meter(caller.api_key_id, quota, reserved)
        try:
            yield charge
        except BaseException:
            await self._add(quota, caller, -reserved)
            await self.meter(caller.api_key_id, quota, -reserved, requests=-1)
            raise
        if charge.amount != reserved:
            await self._add(quota, caller, charge.amount - reserved)
            await self.meter(caller.api_key_id, quota, charge.amount - reserved, requests=0)

    async def charge(self, quota: Quota, caller: Caller, amount: int, requests: int = 0) -> None:
        """Add `amount` to today's usage now, for work paid as it streams in (live dictation).

        With amount=0 it just checks that some allowance is left. Raises QuotaExceeded.
        """
        await self._reserve(quota, caller, amount)
        await self.meter(caller.api_key_id, quota, amount, requests=requests)

    def job_charge(self, quota: Quota, caller: Caller, charge: Charge) -> "JobCharge":
        """What a queued job was charged, for its worker to settle (see services/job_billing.py)."""
        from app.services.job_billing import JobCharge

        return JobCharge(quota=quota, quota_key=self.quota_key(quota, caller), amount=charge.amount,
                         api_key_id=str(caller.api_key_id or ""), day=self._today().date().isoformat())

    async def meter(self, api_key_id: uuid.UUID | None, quota: Quota, amount: int, requests: int = 1) -> None:
        """Add `amount` (and `requests`) to the key's durable usage for today; negatives undo."""
        if api_key_id is None or self._sessionmaker is None or (amount == 0 and requests == 0):
            return
        stmt = insert(ApiKeyUsage).values(api_key_id=api_key_id, day=self._today().date(), quota=quota,
                                          amount=max(amount, 0), requests=max(requests, 0))
        stmt = stmt.on_conflict_do_update(
            index_elements=[ApiKeyUsage.api_key_id, ApiKeyUsage.day, ApiKeyUsage.quota],
            set_={"amount": func.greatest(ApiKeyUsage.amount + amount, 0),
                  "requests": func.greatest(ApiKeyUsage.requests + requests, 0)})
        async with self._sessionmaker() as session:
            await session.execute(stmt)
            await session.commit()


def get_limits(request: Request, redis: Redis = Depends(get_redis),
               settings: Settings = Depends(get_settings)) -> Limits:
    return Limits(redis, settings, sessionmaker=request.app.state.sessionmaker)


def rate_limit(group: str, *, signed_in: bool = False, cheap: bool = False):
    """Dependency that counts a request against `group` and returns the Caller.

    `signed_in=True` requires a login (it reuses the endpoint's get_current_user);
    `cheap=True` is for endpoints that run no model and gets a much higher limit.
    """
    async def check(request: Request, user: User | None = Depends(get_current_user if signed_in else get_optional_user),
                    limits: Limits = Depends(get_limits)) -> Caller:
        caller = Caller.of(request, user)
        await limits.hit(group, caller, cheap=cheap)
        return caller
    return check
