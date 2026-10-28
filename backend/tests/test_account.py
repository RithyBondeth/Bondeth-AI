import asyncio
import time

import pytest

from app.config import get_settings
from app.deps import get_stt_service, get_tts_service
from app.main import app
from tests.conftest import count_rows, sync_redis
from tests.fakes import FakeStt, wav_bytes
from tests.test_limits import FakeTts

PASSWORD = "correct-horse-battery"


@pytest.fixture
def fake_tts(client):
    app.dependency_overrides[get_tts_service] = lambda: FakeTts()


def signup(client, email="new@example.com", password=PASSWORD):
    return client.post("/api/v1/auth/register", json={"email": email, "password": password})


def bearer(body) -> dict:
    return {"Authorization": f"Bearer {body['access_token']}"}


def login(client, email="new@example.com", password=PASSWORD):
    return client.post("/api/v1/auth/login", data={"username": email, "password": password})


# --- Registration throttle -----------------------------------------------------------

def test_signups_are_limited_per_ip(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "register_max_per_ip", 2)
    assert signup(client, "a@example.com").status_code == 201
    assert signup(client, "b@example.com").status_code == 201
    res = signup(client, "c@example.com")
    assert res.status_code == 429
    assert "Too many new accounts" in res.json()["detail"]
    # Windows are clock-aligned, so Retry-After can be a few seconds near the top of the hour;
    # the counter's TTL shows the hourly window (not the 60 s default) is the one in use.
    assert 1 <= int(res.headers["retry-after"]) <= 3600
    (key,) = sync_redis().keys("rate:register:*")
    assert sync_redis().ttl(key) > 60


# --- Email verification --------------------------------------------------------------

def test_new_accounts_start_unverified_and_get_a_link(client):
    res = signup(client)
    assert res.json()["user"]["email_verified"] is False
    email = client.outbox.sent[-1]
    assert email.to == "new@example.com" and "Confirm your email" in email.subject
    assert f"{get_settings().public_app_url}/verify-email?token=" in email.body


def test_unverified_accounts_share_the_signed_out_allowance(client, fake_tts, monkeypatch):
    monkeypatch.setattr(get_settings(), "quota_tts_chars_anon", 10)
    assert client.post("/api/v1/tts", json={"text": "x" * 6}).status_code == 200  # signed out, same IP
    # Fresh accounts don't reset the allowance: they draw from the same per-IP pool.
    for email in ("a@example.com", "b@example.com"):
        headers = bearer(signup(client, email).json())
        res = client.post("/api/v1/tts", headers=headers, json={"text": "x" * 6})
        assert res.status_code == 429 and "Verify your email" in res.json()["detail"]
    usage = client.get("/api/v1/usage", headers=headers).json()
    assert usage["account"] == "unverified" and usage["signed_in"] is False
    assert usage["quotas"]["tts_chars"]["used"] == 6 and "clone_jobs" not in usage["quotas"]


def test_unverified_accounts_cannot_clone_or_make_api_keys(client):
    headers = bearer(signup(client).json())
    res = client.post("/api/v1/clone", headers=headers, data={"text": "hi", "voice_id": "00000000-0000-0000-0000-000000000000"})
    assert res.status_code == 429 and "Verify your email to use voice cloning" in res.json()["detail"]
    assert client.post("/api/v1/api-keys", headers=headers, json={"name": "bot"}).status_code == 403


def test_verifying_unlocks_the_account_allowance(client):
    headers = bearer(signup(client).json())
    token = client.outbox.link_token("new@example.com", "/verify-email")
    res = client.post("/api/v1/auth/verify-email", json={"token": token})
    assert res.status_code == 200 and res.json()["email_verified"] is True
    assert client.get("/api/v1/auth/me", headers=headers).json()["email_verified"] is True
    usage = client.get("/api/v1/usage", headers=headers).json()
    assert usage["account"] == "verified" and "clone_jobs" in usage["quotas"]
    # Links work once.
    assert client.post("/api/v1/auth/verify-email", json={"token": token}).status_code == 400
    assert client.post("/api/v1/auth/verify-email", json={"token": "made-up"}).status_code == 400


def test_resend_verification(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "auth_email_max_per_hour", 2)
    headers = bearer(signup(client).json())
    assert [client.post("/api/v1/auth/verify-email/resend", headers=headers).status_code
            for _ in range(3)] == [202, 202, 429]
    assert len(client.outbox.sent) == 3  # sign-up + 2 resends
    token = client.outbox.link_token("new@example.com", "/verify-email")
    client.post("/api/v1/auth/verify-email", json={"token": token})
    assert client.post("/api/v1/auth/verify-email/resend", headers=headers).status_code == 409


# --- Password reset ------------------------------------------------------------------

def test_password_reset_signs_out_everywhere(client, register):
    register()
    old = bearer(login(client, "user@example.com").json())
    old_refresh = login(client, "user@example.com").json()["refresh_token"]
    time.sleep(1.1)  # token timestamps are whole seconds

    res = client.post("/api/v1/auth/password-reset", json={"email": "USER@example.com"})
    assert res.status_code == 202
    token = client.outbox.link_token("user@example.com", "/reset-password")
    res = client.post("/api/v1/auth/password-reset/confirm", json={"token": token, "new_password": "a-brand-new-one"})
    assert res.status_code == 200

    assert client.get("/api/v1/auth/me", headers=old).status_code == 401
    assert "session ended" in client.get("/api/v1/auth/me", headers=old).json()["detail"].lower()
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": old_refresh}).status_code == 401
    assert login(client, "user@example.com").status_code == 401
    fresh = login(client, "user@example.com", "a-brand-new-one")
    assert fresh.status_code == 200
    assert client.get("/api/v1/auth/me", headers=bearer(fresh.json())).status_code == 200
    # Single use.
    assert client.post("/api/v1/auth/password-reset/confirm",
                       json={"token": token, "new_password": "another-one-here"}).status_code == 400


def test_older_reset_links_die_with_a_reset(client, register):
    register()
    client.post("/api/v1/auth/password-reset", json={"email": "user@example.com"})
    first = client.outbox.link_token("user@example.com", "/reset-password")
    time.sleep(1.1)
    client.post("/api/v1/auth/password-reset", json={"email": "user@example.com"})
    second = client.outbox.link_token("user@example.com", "/reset-password")
    time.sleep(1.1)
    assert client.post("/api/v1/auth/password-reset/confirm",
                       json={"token": second, "new_password": "new-password-1"}).status_code == 200
    assert client.post("/api/v1/auth/password-reset/confirm",
                       json={"token": first, "new_password": "new-password-2"}).status_code == 400


def test_reset_request_does_not_reveal_accounts(client, register):
    register()
    known = client.post("/api/v1/auth/password-reset", json={"email": "user@example.com"})
    unknown = client.post("/api/v1/auth/password-reset", json={"email": "nobody@example.com"})
    assert known.status_code == unknown.status_code == 202 and known.json() == unknown.json()
    assert [e.to for e in client.outbox.sent if "Reset" in e.subject] == ["user@example.com"]


def test_reset_requests_are_throttled_per_mailbox(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "auth_email_max_per_hour", 2)
    codes = [client.post("/api/v1/auth/password-reset", json={"email": "x@example.com"}).status_code
             for _ in range(3)]
    assert codes == [202, 202, 429]


def test_reset_verifies_the_email(client):
    signup(client)
    client.post("/api/v1/auth/password-reset", json={"email": "new@example.com"})
    token = client.outbox.link_token("new@example.com", "/reset-password")
    res = client.post("/api/v1/auth/password-reset/confirm", json={"token": token, "new_password": "fresh-password"})
    assert res.json()["email_verified"] is True


# --- Account deletion ----------------------------------------------------------------

def test_delete_account_removes_everything(client, register, fake_tts):
    app.dependency_overrides[get_stt_service] = lambda: FakeStt()
    headers = register()
    voice = client.post("/api/v1/voices", headers=headers, data={"voice_alias": "Me", "consent": "true"},
                        files={"reference_audio": ("me.wav", wav_bytes(5.0), "audio/wav")})
    assert voice.status_code == 201
    key = client.post("/api/v1/api-keys", headers=headers, json={"name": "bot"}).json()["key"]
    client.post("/api/v1/tts", headers={"X-API-Key": key}, json={"text": "metered"})
    client.post("/api/v1/stt", headers=headers, files={"file": ("a.wav", wav_bytes(1.0), "audio/wav")})
    user_id = client.get("/api/v1/auth/me", headers=headers).json()["id"]
    voices_dir = get_settings().data_dir / "voices" / user_id
    assert any(voices_dir.iterdir())

    assert client.request("DELETE", "/api/v1/auth/me", headers=headers, json={"password": "wrong"}).status_code == 403
    assert client.request("DELETE", "/api/v1/auth/me", headers={"X-API-Key": key},
                          json={"password": PASSWORD}).status_code == 403  # keys can't delete accounts
    assert client.request("DELETE", "/api/v1/auth/me", headers=headers, json={"password": PASSWORD}).status_code == 204

    assert not voices_dir.exists()
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401
    assert client.get("/api/v1/auth/me", headers={"X-API-Key": key}).status_code == 401
    assert login(client, "user@example.com").status_code == 401
    # The email is free again.
    assert signup(client, "user@example.com").status_code == 201

    for table in ("transcriptions", "cloned_voices", "api_keys", "api_key_usage"):
        assert asyncio.run(count_rows(table)) == 0, table
