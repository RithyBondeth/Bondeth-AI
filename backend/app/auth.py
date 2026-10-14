"""FastAPI auth dependencies.

Two kinds of credentials are accepted wherever a user is needed:
- a JWT access token from signing in: `Authorization: Bearer <jwt>`
- a developer API key: `Authorization: Bearer bdk_...` or `X-API-Key: bdk_...`

A request authenticated with an API key records the key on `request.state.api_key`
so limits and metering can attribute the work to it. Managing API keys themselves
requires a signed-in session (get_session_user), so a leaked key can't mint more.
"""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import Depends, HTTPException, Request
from fastapi.security import APIKeyHeader, OAuth2PasswordBearer
from redis.asyncio import Redis
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import ApiKey, User, get_db
from app.security import InvalidToken, decode_token, issued_before_cutoff

# auto_error=False so public endpoints can accept an optional credential.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)
api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False, description="A developer API key (bdk_...)")

API_KEY_PREFIX = "bdk_"
LAST_USED_RESOLUTION = timedelta(minutes=1)  # don't write last_used_at on every single request

_UNAUTHORIZED = {"WWW-Authenticate": "Bearer"}


def get_redis(request: Request) -> Redis:
    return request.app.state.redis


def new_api_key() -> tuple[str, str]:
    """Return (key, sha256 hex). The key has 256 bits of randomness, so a fast hash is enough."""
    key = API_KEY_PREFIX + secrets.token_urlsafe(32)
    return key, hash_api_key(key)


def hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


async def _user_from_api_key(key: str, request: Request, session: AsyncSession) -> User:
    row = (await session.execute(
        select(ApiKey, User).join(User, ApiKey.user_id == User.id)
        .where(ApiKey.key_hash == hash_api_key(key), ApiKey.revoked_at.is_(None))
    )).first()
    if row is None:
        raise HTTPException(401, "Invalid or revoked API key", headers=_UNAUTHORIZED)
    api_key, user = row
    now = datetime.now(UTC)
    if api_key.last_used_at is None or now - api_key.last_used_at > LAST_USED_RESOLUTION:
        await session.execute(update(ApiKey).where(ApiKey.id == api_key.id).values(last_used_at=now))
        await session.commit()
    request.state.api_key = api_key
    return user


async def _user_from_token(token: str, session: AsyncSession, settings: Settings) -> User:
    try:
        claims = decode_token(token, "access", settings)
        user_id = uuid.UUID(claims["sub"])
    except (InvalidToken, ValueError) as exc:
        raise HTTPException(401, "Invalid or expired token", headers=_UNAUTHORIZED) from exc
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(401, "Account no longer exists", headers=_UNAUTHORIZED)
    if issued_before_cutoff(claims["iat"], user.sessions_valid_after):
        raise HTTPException(401, "Your session ended (the password was changed). Please sign in again.",
                            headers=_UNAUTHORIZED)
    return user


async def _authenticate(credential: str, request: Request, session: AsyncSession, settings: Settings) -> User:
    if credential.startswith(API_KEY_PREFIX):
        return await _user_from_api_key(credential, request, session)
    return await _user_from_token(credential, session, settings)


async def get_current_user(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    api_key: str | None = Depends(api_key_header),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    credential = token or api_key
    if not credential:
        raise HTTPException(401, "Not authenticated", headers=_UNAUTHORIZED)
    return await _authenticate(credential, request, session, settings)


async def get_optional_user(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    api_key: str | None = Depends(api_key_header),
    settings: Settings = Depends(get_settings),
) -> User | None:
    """The user when a credential is sent, else None. A bad one is still rejected, not ignored.

    Opens a session only when a credential is present, so anonymous requests to
    public endpoints never touch the database.
    """
    credential = token or api_key
    if not credential:
        return None
    async with request.app.state.sessionmaker() as session:
        return await _authenticate(credential, request, session, settings)


async def get_session_user(request: Request, user: User = Depends(get_current_user)) -> User:
    """A user who signed in (JWT), not one calling with an API key."""
    if getattr(request.state, "api_key", None) is not None:
        raise HTTPException(403, "API keys can't manage API keys. Sign in to the studio instead.")
    return user
