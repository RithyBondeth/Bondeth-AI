import pytest

from app.config import get_settings
from app.deps import get_tts_service
from app.main import app
from tests.test_limits import FakeTts


@pytest.fixture
def fake_tts(client):
    app.dependency_overrides[get_tts_service] = lambda: FakeTts()


def create_key(client, headers, name="My bot"):
    res = client.post("/api/v1/api-keys", headers=headers, json={"name": name})
    assert res.status_code == 201, res.text
    return res.json()


def test_create_list_and_revoke(client, register):
    headers = register()
    created = create_key(client, headers)
    assert created["key"].startswith("bdk_") and len(created["key"]) > 40
    assert created["prefix"] == created["key"][:12]

    listed = client.get("/api/v1/api-keys", headers=headers).json()
    assert [k["id"] for k in listed] == [created["id"]]
    assert "key" not in listed[0]  # never shown again

    as_key = {"X-API-Key": created["key"]}
    assert client.get("/api/v1/auth/me", headers=as_key).status_code == 200

    assert client.delete(f"/api/v1/api-keys/{created['id']}", headers=headers).status_code == 204
    assert client.get("/api/v1/auth/me", headers=as_key).status_code == 401
    assert client.get("/api/v1/api-keys", headers=headers).json() == []


def test_key_works_as_bearer_token_and_records_last_use(client, register):
    headers = register()
    created = create_key(client, headers)
    assert created["last_used_at"] is None
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {created['key']}"})
    assert me.status_code == 200 and me.json()["email"] == "user@example.com"
    assert client.get("/api/v1/api-keys", headers=headers).json()[0]["last_used_at"] is not None


def test_bad_keys_are_rejected(client):
    for headers in ({"X-API-Key": "bdk_nope"}, {"Authorization": "Bearer bdk_nope"}):
        assert client.get("/api/v1/auth/me", headers=headers).status_code == 401
        # Public endpoints don't silently fall back to anonymous either.
        assert client.get("/api/v1/usage", headers=headers).status_code == 401


def test_keys_cannot_manage_keys(client, register):
    created = create_key(client, register())
    as_key = {"X-API-Key": created["key"]}
    assert client.get("/api/v1/api-keys", headers=as_key).status_code == 403
    assert client.post("/api/v1/api-keys", headers=as_key, json={"name": "x"}).status_code == 403


def test_keys_are_private_to_their_owner(client, register):
    mine = create_key(client, register("a@example.com"))
    other = register("b@example.com")
    assert client.delete(f"/api/v1/api-keys/{mine['id']}", headers=other).status_code == 404
    assert client.get(f"/api/v1/api-keys/{mine['id']}/usage", headers=other).status_code == 404


def test_key_limit(client, register, monkeypatch):
    monkeypatch.setattr(get_settings(), "max_api_keys_per_user", 1)
    headers = register()
    first = create_key(client, headers)
    assert client.post("/api/v1/api-keys", headers=headers, json={"name": "two"}).status_code == 409
    client.delete(f"/api/v1/api-keys/{first['id']}", headers=headers)
    create_key(client, headers, "two")  # revoked keys don't count


def test_usage_is_metered_per_key(client, register, fake_tts):
    headers = register()
    a, b = create_key(client, headers, "a"), create_key(client, headers, "b")
    for _ in range(2):
        assert client.post("/api/v1/tts", headers={"X-API-Key": a["key"]}, json={"text": "hello"}).status_code == 200
    client.post("/api/v1/tts", headers={"X-API-Key": b["key"]}, json={"text": "hi"})
    client.post("/api/v1/tts", headers=headers, json={"text": "studio"})  # signed in, no key: not metered

    usage_a = client.get(f"/api/v1/api-keys/{a['id']}/usage", headers=headers).json()
    assert len(usage_a) == 1
    assert usage_a[0] | {"day": None} == {"day": None, "requests": 2, "stt_seconds": 0, "tts_chars": 10, "clone_jobs": 0}
    assert client.get(f"/api/v1/api-keys/{b['id']}/usage", headers=headers).json()[0]["tts_chars"] == 2

    # Keys share the account's daily allowance.
    assert client.get("/api/v1/usage", headers=headers).json()["quotas"]["tts_chars"]["used"] == 18

    # Usage history survives revoking the key... but the owner can no longer look it up.
    client.delete(f"/api/v1/api-keys/{a['id']}", headers=headers)
    assert client.get(f"/api/v1/api-keys/{a['id']}/usage", headers=headers).status_code == 404


def test_each_key_has_its_own_rate_limit(client, register, fake_tts, monkeypatch):
    monkeypatch.setattr(get_settings(), "rate_limit_api_key", 2)
    headers = register()
    a, b = create_key(client, headers, "a"), create_key(client, headers, "b")
    codes = [client.post("/api/v1/tts", headers={"X-API-Key": a["key"]}, json={"text": "x"}).status_code
             for _ in range(3)]
    assert codes == [200, 200, 429]
    assert client.post("/api/v1/tts", headers={"X-API-Key": b["key"]}, json={"text": "x"}).status_code == 200
    assert client.post("/api/v1/tts", headers=headers, json={"text": "x"}).status_code == 200
