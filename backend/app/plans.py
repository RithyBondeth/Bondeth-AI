"""Entitlements come from verified, unexpired provider subscription state."""
from datetime import UTC, datetime

from app.config import Settings
from app.db import User


def effective_plan(user: User | None, settings: Settings) -> str:
    if user is None or not user.email_verified:
        return "free"
    if (settings.billing_enabled and user.subscription_status in ("active", "trialing")
            and user.subscription_price_id == settings.stripe_pro_price_id
            and user.subscription_valid_until is not None
            and user.subscription_valid_until > datetime.now(UTC)):
        return "pro"
    return "free"
