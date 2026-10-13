"""FastAPI auth dependencies."""

import uuid

from fastapi import Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordBearer
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings, get_settings
from app.db import User, get_db
from app.security import InvalidToken, decode_token

# auto_error=False so public endpoints can accept an optional token.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login", auto_error=False)

_UNAUTHORIZED = {"WWW-Authenticate": "Bearer"}


def get_redis(request: Request) -> Redis:
    return request.app.state.redis


async def _user_from_token(token: str, session: AsyncSession, settings: Settings) -> User:
    try:
        claims = decode_token(token, "access", settings)
        user_id = uuid.UUID(claims["sub"])
    except (InvalidToken, ValueError) as exc:
        raise HTTPException(401, "Invalid or expired token", headers=_UNAUTHORIZED) from exc
    user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(401, "Account no longer exists", headers=_UNAUTHORIZED)
    return user


async def get_current_user(
    token: str | None = Depends(oauth2_scheme),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> User:
    if not token:
        raise HTTPException(401, "Not authenticated", headers=_UNAUTHORIZED)
    return await _user_from_token(token, session, settings)


async def get_optional_user(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    settings: Settings = Depends(get_settings),
) -> User | None:
    """The user when a token is sent, else None. A bad token is still rejected, not ignored.

    Opens a session only when a token is present, so anonymous requests to public
    endpoints never touch the database.
    """
    if not token:
        return None
    async with request.app.state.sessionmaker() as session:
        return await _user_from_token(token, session, settings)
