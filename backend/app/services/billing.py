"""Stripe transport and signed events. Never grant access from a browser redirect."""
import hashlib
import hmac
import json
import time
from datetime import UTC, datetime
from urllib.parse import quote

import httpx
from fastapi import HTTPException

from app.config import Settings, get_settings
from app.db import User


class StripeBilling:
    def __init__(self, settings: Settings):
        self.settings = settings

    async def request(self, method: str, path: str, data: dict | None = None,
                      idempotency_key: str | None = None) -> dict:
        headers = {"Authorization": f"Bearer {self.settings.stripe_secret_key}",
                   "Stripe-Version": self.settings.stripe_api_version}
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                res = await client.request(method, "https://api.stripe.com/v1/" + path,
                                           headers=headers, data=data)
            if not res.is_success:
                raise HTTPException(502, "The billing provider could not complete this request. Please try again.")
            return res.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise HTTPException(502, "The billing provider is unavailable. Please try again.") from exc

    async def subscription(self, subscription_id: str) -> dict:
        return await self.request("GET", "subscriptions/" + quote(subscription_id, safe=""))

    def verify_event(self, payload: bytes, signature: str) -> dict:
        try:
            parts = [part.split("=", 1) for part in signature.split(",")]
            timestamp = next(v for k, v in parts if k == "t")
            if abs(time.time() - int(timestamp)) > 300:
                raise ValueError("Expired signature")
            expected = hmac.new(self.settings.stripe_webhook_secret.encode(),
                                timestamp.encode() + b"." + payload, hashlib.sha256).hexdigest()
            if not any(hmac.compare_digest(expected, v) for k, v in parts if k == "v1"):
                raise ValueError("Invalid signature")
            event = json.loads(payload)
            if not isinstance(event, dict) or not isinstance(event.get("id"), str) or not isinstance(event.get("type"), str):
                raise ValueError("Invalid event")
            return event
        except (ValueError, StopIteration, TypeError) as exc:
            raise HTTPException(400, "Invalid Stripe event or signature") from exc


def apply_subscription(user: User, subscription: dict, settings: Settings) -> None:
    """Only the expected customer and price may confer Pro entitlements."""
    if subscription.get("customer") != user.stripe_customer_id:
        raise HTTPException(400, "Subscription customer does not match")
    items = subscription.get("items", {}).get("data", [])
    valid_items = [i for i in items if i.get("price", {}).get("id") == settings.stripe_pro_price_id
                   and i.get("quantity", 1) == 1]
    item = valid_items[0] if len(items) == len(valid_items) == 1 else {}
    end = item.get("current_period_end")
    user.stripe_subscription_id = subscription["id"]
    user.subscription_status = subscription.get("status", "unknown")
    user.subscription_price_id = item.get("price", {}).get("id")
    user.subscription_valid_until = datetime.fromtimestamp(end, UTC) if end else None


def get_billing() -> StripeBilling:
    settings = get_settings()
    if not settings.billing_enabled:
        raise HTTPException(503, "Billing is not enabled on this installation.")
    return StripeBilling(settings)
