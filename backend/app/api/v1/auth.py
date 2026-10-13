import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, Field
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, get_redis
from app.config import Settings, get_settings
from app.db import User, get_db
from app.security import (
    InvalidToken,
    LoginThrottle,
    hash_password,
    issue_tokens,
    revoke_refresh_token,
    rotate_refresh_token,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    full_name: str | None = Field(None, max_length=100)


class RefreshRequest(BaseModel):
    refresh_token: str


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class AuthOut(TokenOut):
    user: UserOut


async def _tokens(user_id: uuid.UUID, redis: Redis, settings: Settings) -> TokenOut:
    pair = await issue_tokens(str(user_id), redis, settings)
    return TokenOut(access_token=pair.access_token, refresh_token=pair.refresh_token, expires_in=pair.expires_in)


@router.post("/register", status_code=201, response_model=AuthOut)
async def register(
    req: RegisterRequest,
    session: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    settings: Settings = Depends(get_settings),
) -> AuthOut:
    user = User(email=req.email.lower(), password_hash=hash_password(req.password),
                full_name=(req.full_name or "").strip() or None)
    session.add(user)
    try:
        await session.commit()
    except IntegrityError as exc:
        raise HTTPException(409, "An account with this email already exists") from exc
    await session.refresh(user)
    tokens = await _tokens(user.id, redis, settings)
    return AuthOut(**tokens.model_dump(), user=UserOut.model_validate(user))


@router.post("/login", response_model=AuthOut)
async def login(
    request: Request,
    form: OAuth2PasswordRequestForm = Depends(),
    session: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    settings: Settings = Depends(get_settings),
) -> AuthOut:
    """Form fields `username` (your email) and `password`; also works with the docs' Authorize button."""
    email = form.username.strip().lower()
    ip = request.client.host if request.client else "unknown"
    throttle = LoginThrottle(redis, settings)
    if (wait := await throttle.retry_after(email, ip)) is not None:
        raise HTTPException(429, "Too many failed login attempts. Try again later.",
                            headers={"Retry-After": str(wait)})

    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not verify_password(form.password, user.password_hash if user else None):
        await throttle.record_failure(email, ip)
        raise HTTPException(401, "Incorrect email or password", headers={"WWW-Authenticate": "Bearer"})

    await throttle.reset(email, ip)
    tokens = await _tokens(user.id, redis, settings)
    return AuthOut(**tokens.model_dump(), user=UserOut.model_validate(user))


@router.post("/refresh", response_model=TokenOut)
async def refresh(req: RefreshRequest, redis: Redis = Depends(get_redis),
                  settings: Settings = Depends(get_settings)) -> TokenOut:
    """Exchange a refresh token for a new pair. Each refresh token works once."""
    try:
        pair = await rotate_refresh_token(req.refresh_token, redis, settings)
    except InvalidToken as exc:
        raise HTTPException(401, "Invalid, expired or already-used refresh token") from exc
    return TokenOut(access_token=pair.access_token, refresh_token=pair.refresh_token, expires_in=pair.expires_in)


@router.post("/logout", status_code=204)
async def logout(req: RefreshRequest, redis: Redis = Depends(get_redis),
                 settings: Settings = Depends(get_settings)) -> Response:
    try:
        await revoke_refresh_token(req.refresh_token, redis, settings)
    except InvalidToken as exc:
        raise HTTPException(401, "Invalid refresh token") from exc
    return Response(status_code=204)


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut.model_validate(user)
