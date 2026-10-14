"""Passwords, JWTs and login throttling.

- Passwords: Argon2 (pwdlib).
- Access tokens: short-lived JWTs, verified statelessly on every request.
- Refresh tokens: JWTs whose id (jti) must also exist in Redis. Each one is
  single-use: refreshing deletes it and issues a new pair, and logout deletes
  it, so a stolen or old refresh token stops working.
"""

import time
import uuid
from dataclasses import dataclass
from typing import Literal

import jwt
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher
from redis.asyncio import Redis

from app.config import Settings

TokenType = Literal["access", "refresh"]

_hasher = PasswordHash((Argon2Hasher(),))
# Verified against when the email is unknown, so login takes the same time
# whether or not an account exists (no user enumeration via timing).
_DUMMY_HASH = _hasher.hash("not-a-real-password")


class InvalidToken(Exception):
    pass


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    if password_hash is None:
        _hasher.verify(password, _DUMMY_HASH)
        return False
    return _hasher.verify(password, password_hash)


@dataclass
class TokenPair:
    access_token: str
    refresh_token: str
    expires_in: int  # access token lifetime, seconds


def _refresh_key(jti: str) -> str:
    return f"auth:refresh:{jti}"


def _encode(user_id: str, token_type: TokenType, ttl_s: int, settings: Settings, jti: str | None = None) -> str:
    now = int(time.time())
    claims = {"sub": user_id, "type": token_type, "iat": now, "exp": now + ttl_s}
    if jti:
        claims["jti"] = jti
    return jwt.encode(claims, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str, expected: TokenType, settings: Settings, verify_exp: bool = True) -> dict:
    try:
        claims = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm],
                            options={"verify_exp": verify_exp, "require": ["sub", "type", "exp"]})
    except jwt.PyJWTError as exc:
        raise InvalidToken(str(exc)) from exc
    if claims["type"] != expected:
        raise InvalidToken(f"Expected a {expected} token")
    return claims


async def issue_tokens(user_id: str, redis: Redis, settings: Settings) -> TokenPair:
    access_ttl = settings.access_token_minutes * 60
    refresh_ttl = settings.refresh_token_days * 86_400
    jti = uuid.uuid4().hex
    await redis.set(_refresh_key(jti), user_id, ex=refresh_ttl)
    return TokenPair(
        access_token=_encode(user_id, "access", access_ttl, settings),
        refresh_token=_encode(user_id, "refresh", refresh_ttl, settings, jti=jti),
        expires_in=access_ttl,
    )


async def rotate_refresh_token(token: str, redis: Redis, settings: Settings) -> TokenPair:
    claims = decode_token(token, "refresh", settings)
    # GETDEL makes the token single-use, even under concurrent requests.
    owner = await redis.getdel(_refresh_key(claims.get("jti", "")))
    if owner is None or owner != claims["sub"]:
        raise InvalidToken("Refresh token has been used or revoked")
    return await issue_tokens(claims["sub"], redis, settings)


async def revoke_refresh_token(token: str, redis: Redis, settings: Settings) -> None:
    # Expired tokens can still be logged out; their Redis key is already gone anyway.
    claims = decode_token(token, "refresh", settings, verify_exp=False)
    await redis.delete(_refresh_key(claims.get("jti", "")))


class LoginThrottle:
    """Fixed-window limit on failed logins per (email, client IP)."""

    def __init__(self, redis: Redis, settings: Settings):
        self._redis = redis
        self._max = settings.login_max_attempts
        self._window = settings.login_window_s

    @staticmethod
    def _key(email: str, ip: str) -> str:
        return f"auth:login-fail:{email}:{ip}"

    async def retry_after(self, email: str, ip: str) -> int | None:
        """Seconds until another attempt is allowed, or None if not blocked."""
        key = self._key(email, ip)
        failures = await self._redis.get(key)
        if failures is not None and int(failures) >= self._max:
            return max(await self._redis.ttl(key), 1)
        return None

    async def record_failure(self, email: str, ip: str) -> None:
        key = self._key(email, ip)
        async with self._redis.pipeline(transaction=True) as pipe:
            pipe.incr(key)
            pipe.expire(key, self._window, nx=True)
            await pipe.execute()

    async def reset(self, email: str, ip: str) -> None:
        await self._redis.delete(self._key(email, ip))
