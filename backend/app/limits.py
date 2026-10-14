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

Usage is counted even with BONDETH_LIMITS_ENABLED=false; only enforcement stops.
"""

import math
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import Depends, Request
from fastapi.responses import JSONResponse
from redis.asyncio import Redis

from app.auth import get_current_user, get_optional_user, get_redis
from app.config import Settings, get_settings
from app.db import User

Quota = Literal["stt_seconds", "tts_chars", "clone_jobs"]
QUOTAS: tuple[Quota, ...] = ("stt_seconds", "tts_chars", "clone_jobs")
SIGNED_IN_ONLY: frozenset[Quota] = frozenset({"clone_jobs"})

_LABELS = {"stt_seconds": "speech-to-text", "tts_chars": "text-to-speech", "clone_jobs": "voice cloning"}


@dataclass(frozen=True)
class Caller:
    key: str  # "user:<id>" or "ip:<address>"
    signed_in: bool

    @classmethod
    def of(cls, request: Request, user: User | None) -> "Caller":
        if user is not None:
            return cls(f"user:{user.id}", True)
        # Behind a reverse proxy, set uvicorn's FORWARDED_ALLOW_IPS so this is the real client.
        return cls(f"ip:{request.client.host if request.client else 'unknown'}", False)


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
    def __init__(self, redis: Redis, settings: Settings, clock: Callable[[], float] = time.time):
        self._redis = redis
        self._s = settings
        self._clock = clock

    @property
    def enforced(self) -> bool:
        return self._s.limits_enabled

    # --- Rate limits ---------------------------------------------------------------

    async def hit(self, group: str, caller: Caller, cheap: bool = False) -> None:
        """Count one request to `group`; raise RateLimited past the per-window limit."""
        if not self.enforced:
            return
        if cheap:
            limit = self._s.rate_limit_cheap
        else:
            limit = self._s.rate_limit_user if caller.signed_in else self._s.rate_limit_anon
        window = self._s.rate_limit_window_s
        now = self._clock()
        key = f"rate:{group}:{caller.key}:{int(now // window)}"
        async with self._redis.pipeline(transaction=True) as pipe:
            pipe.incr(key)
            pipe.expire(key, window, nx=True)
            count, _ = await pipe.execute()
        if count > limit:
            raise RateLimited(f"Too many requests. Try again in {math.ceil(window - now % window)} s.",
                              retry_after=math.ceil(window - now % window))

    # --- Daily quotas --------------------------------------------------------------

    def _today(self) -> datetime:
        tz = timezone(timedelta(hours=self._s.quota_utc_offset_hours))
        return datetime.fromtimestamp(self._clock(), tz).replace(hour=0, minute=0, second=0, microsecond=0)

    def resets_at(self) -> datetime:
        return self._today() + timedelta(days=1)

    def _key(self, quota: Quota, caller: Caller) -> str:
        return f"quota:{quota}:{caller.key}:{self._today():%Y-%m-%d}"

    def limit(self, quota: Quota, caller: Caller) -> int:
        if quota in SIGNED_IN_ONLY and not caller.signed_in:
            return 0
        return getattr(self._s, f"quota_{quota}_{'user' if caller.signed_in else 'anon'}")

    async def used(self, quota: Quota, caller: Caller) -> int:
        return int(await self._redis.get(self._key(quota, caller)) or 0)

    async def _add(self, quota: Quota, caller: Caller, amount: int) -> int:
        key = self._key(quota, caller)
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
            message = f"Sign in to use {label}."
        else:
            message = f"You've used today's {label} allowance ({describe(quota, limit)})."
        if limit > 0 and not caller.signed_in:
            message += " Sign in for a larger allowance."
        raise QuotaExceeded(f"{message} It resets at midnight (UTC{self._s.quota_utc_offset_hours:+d}).",
                            retry_after=math.ceil(self.resets_at().timestamp() - self._clock()))

    @asynccontextmanager
    async def spend(self, quota: Quota, caller: Caller, amount: float) -> AsyncIterator[Charge]:
        """Reserve `amount` of a quota for the block; refunded if the block raises."""
        charge = Charge(math.ceil(amount))
        reserved = charge.amount
        await self._reserve(quota, caller, reserved)
        try:
            yield charge
        except BaseException:
            await self._add(quota, caller, -reserved)
            raise
        if charge.amount != reserved:
            await self._add(quota, caller, charge.amount - reserved)


def get_limits(redis: Redis = Depends(get_redis), settings: Settings = Depends(get_settings)) -> Limits:
    return Limits(redis, settings)


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
