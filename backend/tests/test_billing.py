import hashlib
import hmac
import json
import time
from datetime import UTC, datetime, timedelta

import pytest

from app.config import Settings, get_settings
from app.db import User
from app.main import app
from app.plans import effective_plan
from app.services.billing import StripeBilling, get_billing


class FakeStripe(StripeBilling):
    def __init__(self, settings):
        super().__init__(settings)
        self.calls = []
        self.sub = {"id": "sub_test", "customer": "cus_test", "status": "active",
                    "items": {"data": [{"price": {"id": "price_pro"}, "quantity": 1,
                                         "current_period_end": int(time.time()) + 3600}]}}
        self.checkout_status = "open"
        self.fail = False

    async def request(self, method, path, data=None, idempotency_key=None):
        from fastapi import HTTPException
        self.calls.append((method, path, data, idempotency_key))
        if self.fail:
            raise HTTPException(502, "Provider unavailable")
        if path == "customers":
            return {"id": "cus_test"}
        if path.startswith("subscriptions/"):
            if method == "DELETE":
                self.sub["status"] = "canceled"
            return self.sub
        if path.endswith("/expire"):
            self.checkout_status = "expired"
            return {"id": "cs_test"}
        if path.startswith("checkout/sessions"):
            return {"id": "cs_test", "url": "https://checkout.stripe.com/c/pay/test",
                    "status": self.checkout_status, "subscription": "sub_test" if self.checkout_status == "complete" else None}
        return {"url": "https://billing.stripe.com/p/session/test"}


@pytest.fixture
def stripe(client, monkeypatch):
    settings = get_settings()
    for name, value in {"billing_enabled": True, "stripe_secret_key": "sk_test_fake",
                        "stripe_webhook_secret": "whsec_test", "stripe_pro_price_id": "price_pro"}.items():
        monkeypatch.setattr(settings, name, value)
    provider = FakeStripe(settings)
    app.dependency_overrides[get_billing] = lambda: provider
    return provider


def signed(event, secret="whsec_test", timestamp=None):
    raw = json.dumps(event).encode()
    timestamp = timestamp or int(time.time())
    signature = hmac.new(secret.encode(), str(timestamp).encode() + b"." + raw, hashlib.sha256).hexdigest()
    return raw, {"Stripe-Signature": f"t={timestamp},v1={signature}"}


def send_event(client, event_id="evt_test", event_type="customer.subscription.updated"):
    raw, headers = signed({"id": event_id, "type": event_type,
                           "data": {"object": {"id": "sub_test", "customer": "cus_test", "subscription": "sub_test"}}})
    return client.post("/api/v1/billing/webhook", content=raw, headers=headers)


def test_disabled_and_session_only(client, register):
    headers = register()
    assert client.get("/api/v1/billing", headers=headers).json()["enabled"] is False
    assert client.post("/api/v1/billing/checkout", headers=headers).status_code == 503
    key = client.post("/api/v1/api-keys", headers=headers, json={"name": "bot"}).json()["key"]
    assert client.get("/api/v1/billing", headers={"X-API-Key": key}).status_code == 403


def test_checkout_verification_idempotency_and_portal(client, register, stripe):
    unverified = register("unverified@example.com", verify=False)
    assert client.post("/api/v1/billing/checkout", headers=unverified).status_code == 403
    headers = register()
    first = client.post("/api/v1/billing/checkout", headers=headers)
    assert first.status_code == 200
    assert client.post("/api/v1/billing/checkout", headers=headers).json() == first.json()
    assert len([c for c in stripe.calls if c[:2] == ("POST", "checkout/sessions")]) == 1
    params = next(c[2] for c in stripe.calls if c[:2] == ("POST", "checkout/sessions"))
    assert params["line_items[0][price]"] == "price_pro" and params["mode"] == "subscription"
    assert client.get("/api/v1/billing", headers=headers).json()["plan"] == "free"
    assert client.post("/api/v1/billing/portal", headers=headers).status_code == 200


def test_webhook_current_state_duplicate_cancel_and_api_key_entitlements(client, register, stripe):
    headers = register()
    client.post("/api/v1/billing/checkout", headers=headers)
    assert send_event(client).status_code == 200
    assert client.get("/api/v1/billing", headers=headers).json()["plan"] == "pro"
    key = client.post("/api/v1/api-keys", headers=headers, json={"name": "bot"}).json()["key"]
    usage = client.get("/api/v1/usage", headers={"X-API-Key": key}).json()
    assert usage["plan"] == "pro" and usage["quotas"]["stt_seconds"]["limit"] == get_settings().quota_stt_seconds_pro
    requests = len(stripe.calls)
    assert send_event(client).status_code == 200
    assert len(stripe.calls) == requests
    stripe.sub["status"] = "canceled"
    # Even a late 'created' event reads the current canceled state.
    assert send_event(client, "evt_late", "customer.subscription.created").status_code == 200
    assert client.get("/api/v1/usage", headers=headers).json()["plan"] == "free"


def test_webhook_retry_after_provider_failure(client, register, stripe):
    headers = register()
    client.post("/api/v1/billing/checkout", headers=headers)
    stripe.fail = True
    assert send_event(client).status_code == 502
    stripe.fail = False
    assert send_event(client).status_code == 200
    assert client.get("/api/v1/billing", headers=headers).json()["plan"] == "pro"


@pytest.mark.parametrize("status", ["past_due", "unpaid", "incomplete", "canceled", "paused"])
def test_unpaid_subscription_has_no_pro_entitlements(status):
    user = User(email_verified_at=datetime.now(UTC), subscription_status=status,
                subscription_price_id="price_pro", subscription_valid_until=datetime.now(UTC) + timedelta(days=1))
    settings = Settings()
    settings.billing_enabled, settings.stripe_pro_price_id = True, "price_pro"
    assert effective_plan(user, settings) == "free"


def test_expired_and_unknown_price_have_no_pro_entitlements(client, register, stripe):
    headers = register()
    client.post("/api/v1/billing/checkout", headers=headers)
    stripe.sub["items"]["data"][0]["current_period_end"] = int(time.time()) - 1
    send_event(client)
    assert client.get("/api/v1/billing", headers=headers).json()["plan"] == "free"
    stripe.sub["items"]["data"][0]["price"]["id"] = "price_unknown"
    send_event(client, "evt_unknown")
    assert client.get("/api/v1/billing", headers=headers).json()["plan"] == "free"


def test_webhook_rejects_bad_expired_and_malformed_signatures(client, stripe):
    event = {"id": "evt_bad", "type": "customer.subscription.updated"}
    for raw, headers in (signed(event, "wrong"), signed(event, timestamp=int(time.time()) - 600),
                         (b"{}", {"Stripe-Signature": "not-a-signature"})):
        assert client.post("/api/v1/billing/webhook", content=raw, headers=headers).status_code == 400


def test_active_subscription_cannot_start_second_checkout(client, register, stripe):
    headers = register()
    client.post("/api/v1/billing/checkout", headers=headers)
    send_event(client)
    assert client.post("/api/v1/billing/checkout", headers=headers).status_code == 409


def test_delete_account_cancels_subscription_before_removing_owner(client, register, stripe, monkeypatch):
    headers = register()
    client.post("/api/v1/billing/checkout", headers=headers)
    send_event(client)
    monkeypatch.setattr("app.services.billing.StripeBilling.request", stripe.request)
    res = client.request("DELETE", "/api/v1/auth/me", headers=headers, json={"password": "correct-horse-battery"})
    assert res.status_code == 204
    assert stripe.sub["status"] == "canceled"
    assert client.get("/api/v1/auth/me", headers=headers).status_code == 401


def test_settings_require_complete_commercial_billing_config():
    with pytest.raises(ValueError):
        Settings(billing_enabled=True)
    with pytest.raises(ValueError):
        Settings(billing_enabled=True, stripe_secret_key="sk_test", stripe_webhook_secret="whsec_test",
                 stripe_pro_price_id="price_test")


def test_health_returns_503_when_dependencies_are_down(client, monkeypatch):
    async def unavailable(_):
        return "unavailable"
    monkeypatch.setattr("app.api.v1.health._check_database", unavailable)
    res = client.get("/api/v1/health")
    assert res.status_code == 503 and res.json()["status"] == "degraded"
