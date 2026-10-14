import time

import jwt
import pytest
from pydantic import ValidationError

from app.config import DEV_JWT_SECRET, Settings, get_settings

PASSWORD = "correct-horse-battery"


def login(client, email="user@example.com", password=PASSWORD):
    return client.post("/api/v1/auth/login", data={"username": email, "password": password})


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# --- Register / login ----------------------------------------------------------------

def test_register_returns_tokens_and_normalized_user(client):
    res = client.post("/api/v1/auth/register",
                      json={"email": "Dara@Example.COM", "password": PASSWORD, "full_name": " Dara "})
    assert res.status_code == 201
    body = res.json()
    assert body["user"]["email"] == "dara@example.com"
    assert body["user"]["full_name"] == "Dara"
    assert body["token_type"] == "bearer" and body["expires_in"] == 15 * 60
    assert "password" not in str(body["user"]).lower()

    me = client.get("/api/v1/auth/me", headers=bearer(body["access_token"]))
    assert me.json()["email"] == "dara@example.com"


def test_register_rejects_duplicates_case_insensitively(client, register):
    register("dara@example.com")
    res = client.post("/api/v1/auth/register", json={"email": "DARA@example.com", "password": PASSWORD})
    assert res.status_code == 409


@pytest.mark.parametrize("payload", [
    {"email": "not-an-email", "password": PASSWORD},
    {"email": "a@example.com", "password": "short"},
    {"email": "a@example.com"},
])
def test_register_validation(client, payload):
    assert client.post("/api/v1/auth/register", json=payload).status_code == 422


def test_login(client, register):
    register()
    res = login(client, email="USER@example.com")  # email is case-insensitive
    assert res.status_code == 200
    assert res.json()["user"]["email"] == "user@example.com"


def test_login_failures_look_identical(client, register):
    register()
    wrong_password = login(client, password="wrong-password")
    unknown_user = login(client, email="nobody@example.com")
    assert wrong_password.status_code == unknown_user.status_code == 401
    assert wrong_password.json() == unknown_user.json()  # no hint whether the account exists


# --- Access tokens -------------------------------------------------------------------

def test_me_requires_valid_access_token(client, register):
    register()
    tokens = login(client).json()
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/auth/me", headers=bearer("garbage")).status_code == 401
    # A refresh token must not work as an access token.
    assert client.get("/api/v1/auth/me", headers=bearer(tokens["refresh_token"])).status_code == 401


def test_expired_and_forged_tokens_rejected(client, register):
    register()
    user_id = login(client).json()["user"]["id"]
    s = get_settings()
    expired = jwt.encode({"sub": user_id, "type": "access", "exp": int(time.time()) - 5},
                         s.jwt_secret, algorithm=s.jwt_algorithm)
    forged = jwt.encode({"sub": user_id, "type": "access", "exp": int(time.time()) + 600},
                        "someone-elses-secret", algorithm=s.jwt_algorithm)
    assert client.get("/api/v1/auth/me", headers=bearer(expired)).status_code == 401
    assert client.get("/api/v1/auth/me", headers=bearer(forged)).status_code == 401


# --- Refresh / logout ----------------------------------------------------------------

def test_refresh_rotates_and_is_single_use(client, register):
    register()
    old = login(client).json()
    res = client.post("/api/v1/auth/refresh", json={"refresh_token": old["refresh_token"]})
    assert res.status_code == 200
    new = res.json()
    assert new["refresh_token"] != old["refresh_token"]
    assert client.get("/api/v1/auth/me", headers=bearer(new["access_token"])).status_code == 200
    # Reusing the old refresh token fails...
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": old["refresh_token"]}).status_code == 401
    # ...but the new one works.
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": new["refresh_token"]}).status_code == 200


def test_access_token_cannot_be_used_to_refresh(client, register):
    register()
    tokens = login(client).json()
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["access_token"]}).status_code == 401


def test_logout_revokes_refresh_token(client, register):
    register()
    tokens = login(client).json()
    assert client.post("/api/v1/auth/logout", json={"refresh_token": tokens["refresh_token"]}).status_code == 204
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code == 401
    assert client.post("/api/v1/auth/logout", json={"refresh_token": "garbage"}).status_code == 401


# --- Brute-force protection ----------------------------------------------------------

def test_login_throttled_after_repeated_failures(client, register, monkeypatch):
    monkeypatch.setattr(get_settings(), "login_max_attempts", 3)
    register()
    for _ in range(3):
        assert login(client, password="wrong-password").status_code == 401
    blocked = login(client)  # even the right password is refused while blocked
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) > 0


def test_successful_login_resets_failure_count(client, register, monkeypatch):
    monkeypatch.setattr(get_settings(), "login_max_attempts", 3)
    register()
    for _ in range(2):
        login(client, password="wrong-password")
    assert login(client).status_code == 200
    for _ in range(2):
        login(client, password="wrong-password")
    assert login(client).status_code == 200


def test_throttle_is_per_account(client, register, monkeypatch):
    monkeypatch.setattr(get_settings(), "login_max_attempts", 2)
    register("a@example.com")
    register("b@example.com")
    for _ in range(2):
        login(client, email="a@example.com", password="wrong-password")
    assert login(client, email="a@example.com").status_code == 429
    assert login(client, email="b@example.com").status_code == 200


# --- Config safety -------------------------------------------------------------------

def test_production_requires_real_jwt_secret():
    with pytest.raises(ValidationError, match="BONDETH_JWT_SECRET"):
        Settings(env="production", jwt_secret=DEV_JWT_SECRET)
    for weak in ("", "short-secret"):
        with pytest.raises(ValidationError, match="BONDETH_JWT_SECRET"):
            Settings(env="production", jwt_secret=weak)
    assert Settings(env="production", jwt_secret="x" * 48).env == "production"
