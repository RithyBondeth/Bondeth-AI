"""Accounts: register, sign in, refresh, verify email, reset password, delete.

New accounts start unverified and only get the signed-out allowance until the
email is confirmed (see limits.py), and sign-ups are limited per IP, so scripting
fresh accounts doesn't reset anyone's daily allowance.
"""

import shutil
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr, Field
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, get_redis, get_session_user
from app.config import Settings, get_settings
from app.db import User, get_db
from app.limits import Caller, Limits, get_limits
from app.security import (
    InvalidToken,
    LoginThrottle,
    consume_one_time_token,
    create_one_time_token,
    decode_token,
    hash_password,
    issue_tokens,
    issued_before_cutoff,
    revoke_refresh_token,
    rotate_refresh_token,
    verify_password,
)
from app.services.email import EmailSender, get_email_sender, password_reset_email, verification_email

router = APIRouter(prefix="/auth", tags=["auth"])

VERIFY = "verify-email"
RESET = "password-reset"


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=128)
    full_name: str | None = Field(None, max_length=100)


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenRequest(BaseModel):
    token: str = Field(..., min_length=1, max_length=200)


class PasswordResetRequest(BaseModel):
    email: EmailStr


class PasswordResetConfirm(BaseModel):
    token: str = Field(..., min_length=1, max_length=200)
    new_password: str = Field(..., min_length=8, max_length=128)


class DeleteAccountRequest(BaseModel):
    password: str


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    full_name: str | None
    email_verified: bool
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


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


async def _send_verification(user: User, redis: Redis, settings: Settings,
                             background: BackgroundTasks, sender: EmailSender) -> None:
    token = await create_one_time_token(redis, VERIFY, str(user.id), settings.email_verify_token_hours * 3600)
    link = f"{settings.public_app_url.rstrip('/')}/verify-email?token={token}"
    # Sent after the response, so a slow mail server never holds up sign-up.
    background.add_task(sender.send, verification_email(user.email, link, settings.email_verify_token_hours))


@router.post("/register", status_code=201, response_model=AuthOut)
async def register(
    req: RegisterRequest,
    request: Request,
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    settings: Settings = Depends(get_settings),
    limits: Limits = Depends(get_limits),
    sender: EmailSender = Depends(get_email_sender),
) -> AuthOut:
    """Create an account and email a verification link. Limited per IP address."""
    await limits.hit("register", Caller.of(request, None), limit=settings.register_max_per_ip,
                     window=settings.register_window_s, message="Too many new accounts from this network.")
    user = User(email=req.email.lower(), password_hash=hash_password(req.password),
                full_name=(req.full_name or "").strip() or None)
    session.add(user)
    try:
        await session.commit()
    except IntegrityError as exc:
        raise HTTPException(409, "An account with this email already exists") from exc
    await session.refresh(user)
    await _send_verification(user, redis, settings, background, sender)
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
    ip = _client_ip(request)
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
async def refresh(req: RefreshRequest, session: AsyncSession = Depends(get_db), redis: Redis = Depends(get_redis),
                  settings: Settings = Depends(get_settings)) -> TokenOut:
    """Exchange a refresh token for a new pair. Each refresh token works once."""
    try:
        claims = decode_token(req.refresh_token, "refresh", settings)
        user = await session.get(User, uuid.UUID(claims["sub"]))
        if user is None or issued_before_cutoff(claims["iat"], user.sessions_valid_after):
            await revoke_refresh_token(req.refresh_token, redis, settings)
            raise InvalidToken("Session ended")
        pair = await rotate_refresh_token(req.refresh_token, redis, settings)
    except (InvalidToken, ValueError) as exc:
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


# --- Email verification --------------------------------------------------------------

@router.post("/verify-email", response_model=UserOut)
async def verify_email(req: TokenRequest, session: AsyncSession = Depends(get_db),
                       redis: Redis = Depends(get_redis)) -> UserOut:
    """Confirm the email address with the token from the verification link. Each link works once."""
    found = await consume_one_time_token(redis, VERIFY, req.token)
    user = await session.get(User, uuid.UUID(found[0])) if found else None
    if user is None:
        raise HTTPException(400, "This link is invalid or has expired. Request a new one from your account page.")
    if user.email_verified_at is None:
        user.email_verified_at = datetime.now(UTC)
        await session.commit()
    return UserOut.model_validate(user)


@router.post("/verify-email/resend", status_code=202)
async def resend_verification(
    background: BackgroundTasks,
    user: User = Depends(get_session_user),
    redis: Redis = Depends(get_redis),
    settings: Settings = Depends(get_settings),
    limits: Limits = Depends(get_limits),
    sender: EmailSender = Depends(get_email_sender),
) -> dict:
    if user.email_verified:
        raise HTTPException(409, "Your email is already verified.")
    await limits.hit("verify-resend", Caller(f"user:{user.id}", True), limit=settings.auth_email_max_per_hour,
                     window=3600, message="Too many verification emails.")
    await _send_verification(user, redis, settings, background, sender)
    return {"status": "sent"}


# --- Password reset ------------------------------------------------------------------

@router.post("/password-reset", status_code=202)
async def request_password_reset(
    req: PasswordResetRequest,
    request: Request,
    background: BackgroundTasks,
    session: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    settings: Settings = Depends(get_settings),
    limits: Limits = Depends(get_limits),
    sender: EmailSender = Depends(get_email_sender),
) -> dict:
    """Email a reset link. The answer is the same whether or not the account exists."""
    email = req.email.lower()
    for scope in (f"ip:{_client_ip(request)}", f"email:{email}"):  # per network and per mailbox
        await limits.hit("password-reset", Caller(scope, False), limit=settings.auth_email_max_per_hour,
                         window=3600, message="Too many password reset requests.")
    user = (await session.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is not None:
        token = await create_one_time_token(redis, RESET, str(user.id), settings.password_reset_token_minutes * 60)
        link = f"{settings.public_app_url.rstrip('/')}/reset-password?token={token}"
        background.add_task(sender.send, password_reset_email(user.email, link, settings.password_reset_token_minutes))
    return {"status": "sent", "detail": "If an account exists for that email, a reset link is on its way."}


@router.post("/password-reset/confirm", response_model=UserOut)
async def confirm_password_reset(req: PasswordResetConfirm, session: AsyncSession = Depends(get_db),
                                 redis: Redis = Depends(get_redis)) -> UserOut:
    """Set a new password with the token from the reset link. Signs the account out everywhere."""
    found = await consume_one_time_token(redis, RESET, req.token)
    user = await session.get(User, uuid.UUID(found[0])) if found else None
    # A link issued before the last reset is stale even if it hasn't expired yet.
    if user is None or issued_before_cutoff(found[1], user.sessions_valid_after):
        raise HTTPException(400, "This link is invalid or has expired. Request a new one.")
    now = datetime.now(UTC)
    user.password_hash = hash_password(req.new_password)
    user.sessions_valid_after = now  # every token issued before now stops working
    user.email_verified_at = user.email_verified_at or now  # the link proved they own the mailbox
    await session.commit()
    return UserOut.model_validate(user)


# --- Account deletion ----------------------------------------------------------------

@router.delete("/me", status_code=204)
async def delete_account(
    req: DeleteAccountRequest,
    user: User = Depends(get_session_user),
    session: AsyncSession = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> Response:
    """Permanently delete your account: history, saved voices and their audio, API keys and their usage.

    Needs your password (and a signed-in session, not an API key).
    """
    if not verify_password(req.password, user.password_hash):
        raise HTTPException(403, "Incorrect password")
    user_id = user.id
    await session.delete(user)  # rows in other tables go with it (ON DELETE CASCADE)
    await session.commit()
    shutil.rmtree(settings.data_dir / "voices" / str(user_id), ignore_errors=True)
    # Outstanding tokens now fail: access tokens find no account, refresh tokens are refused above.
    return Response(status_code=204)
