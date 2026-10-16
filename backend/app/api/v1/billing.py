"""Session-only billing management and authenticated Stripe snapshot webhooks."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_session_user
from app.config import Settings, get_settings
from app.db import BillingEvent, User, get_db
from app.limits import rate_limit
from app.plans import effective_plan
from app.services.billing import StripeBilling, apply_subscription, get_billing

router = APIRouter(prefix="/billing", tags=["billing"])


class BillingStatus(BaseModel):
    enabled: bool
    plan: str
    subscription_status: str | None
    valid_until: str | None
    can_manage: bool
    pro_quotas: dict[str, int]


@router.get("", response_model=BillingStatus)
async def status(user: User = Depends(get_session_user), settings: Settings = Depends(get_settings)):
    return BillingStatus(enabled=settings.billing_enabled, plan=effective_plan(user, settings),
                         subscription_status=user.subscription_status,
                         valid_until=user.subscription_valid_until.isoformat() if user.subscription_valid_until else None,
                         can_manage=bool(settings.billing_enabled and user.stripe_customer_id),
                         pro_quotas={q: getattr(settings, "quota_" + q + "_pro")
                                     for q in ("stt_seconds", "tts_chars", "clone_jobs")})


async def locked_user(user: User, session: AsyncSession) -> User:
    return (await session.scalars(select(User).where(User.id == user.id).with_for_update()
                                  .execution_options(populate_existing=True))).one()


@router.post("/checkout", dependencies=[Depends(rate_limit("billing", signed_in=True))])
async def checkout(user: User = Depends(get_session_user), session: AsyncSession = Depends(get_db),
                   provider: StripeBilling = Depends(get_billing)):
    if not user.email_verified:
        raise HTTPException(403, "Verify your email before subscribing.")
    user = await locked_user(user, session)
    s = provider.settings
    if user.stripe_subscription_id:
        subscription = await provider.subscription(user.stripe_subscription_id)
        apply_subscription(user, subscription, s)
        await session.flush()
        if subscription["status"] not in ("canceled", "incomplete_expired"):
            await session.commit()
            raise HTTPException(409, "You already have a subscription. Manage it in the billing portal.")
    if not user.stripe_customer_id:
        customer = await provider.request("POST", "customers", {
            "email": user.email, "metadata[bondeth_user_id]": str(user.id),
        }, idempotency_key=f"bondeth-customer-{user.id}")
        user.stripe_customer_id = customer["id"]
        # Keep the provider identity even if a subsequent Checkout call fails.
        await session.commit()
        user = await locked_user(user, session)
    if user.stripe_checkout_id:
        existing = await provider.request("GET", f"checkout/sessions/{user.stripe_checkout_id}")
        if existing["status"] == "open":
            return {"url": existing["url"]}
        if existing["status"] == "complete" and existing.get("subscription"):
            sub = await provider.subscription(existing["subscription"])
            apply_subscription(user, sub, s)
            if sub["status"] not in ("canceled", "incomplete_expired"):
                await session.commit()
                raise HTTPException(409, "Subscription received. Manage it in the billing portal.")
    result = await provider.request("POST", "checkout/sessions", {
        "mode": "subscription", "customer": user.stripe_customer_id,
        "client_reference_id": str(user.id), "subscription_data[metadata][bondeth_user_id]": str(user.id),
        "line_items[0][price]": s.stripe_pro_price_id, "line_items[0][quantity]": "1",
        "success_url": s.public_app_url.rstrip("/") + "/account?billing=success",
        "cancel_url": s.public_app_url.rstrip("/") + "/account?billing=cancelled",
    }, idempotency_key=f"bondeth-checkout-{user.id}-{user.stripe_checkout_id or 'first'}")
    user.stripe_checkout_id = result["id"]
    await session.commit()
    return {"url": result["url"]}


@router.post("/portal", dependencies=[Depends(rate_limit("billing", signed_in=True))])
async def portal(user: User = Depends(get_session_user), provider: StripeBilling = Depends(get_billing)):
    if not user.stripe_customer_id:
        raise HTTPException(409, "This account has no billing profile yet.")
    result = await provider.request("POST", "billing_portal/sessions", {
        "customer": user.stripe_customer_id, "return_url": provider.settings.public_app_url.rstrip("/") + "/account",
    })
    return {"url": result["url"]}


@router.post("/webhook")
async def webhook(request: Request, session: AsyncSession = Depends(get_db),
                  provider: StripeBilling = Depends(get_billing)):
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > 1_000_000:
            raise HTTPException(413, "Webhook too large")
    event = provider.verify_event(bytes(body), request.headers.get("stripe-signature", ""))
    supported = {"customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted",
                 "checkout.session.completed", "checkout.session.async_payment_succeeded"}
    if event["type"] not in supported:
        return {"received": True}
    obj = event.get("data", {}).get("object", {})
    if not isinstance(obj, dict) or not isinstance(obj.get("customer"), str):
        raise HTTPException(400, "Invalid subscription event")
    user = await session.scalar(select(User).where(User.stripe_customer_id == obj["customer"]).with_for_update())
    if user is None:  # Deleted account, or a customer outside this application.
        return {"received": True}
    claimed = await session.scalar(insert(BillingEvent).values(id=event["id"], event_type=event["type"])
                                    .on_conflict_do_nothing().returning(BillingEvent.id))
    if claimed is None:
        return {"received": True}
    sub_id = obj.get("subscription") if event["type"].startswith("checkout.") else obj.get("id")
    if isinstance(sub_id, str):
        # A delayed old event must never overwrite a newer subscription.
        if user.stripe_subscription_id and user.stripe_subscription_id != sub_id:
            current = await provider.subscription(user.stripe_subscription_id)
            if current["status"] not in ("canceled", "incomplete_expired"):
                await session.commit()
                return {"received": True}
        # Read current provider state under the account lock: delivery order is irrelevant.
        apply_subscription(user, await provider.subscription(sub_id), provider.settings)
    await session.commit()
    return {"received": True}
