# Stripe subscriptions

Billing is optional and disabled by default. The free installation works without
Stripe. This release implements recurring Pro subscriptions, not metered overage
invoices, credits, enterprise contracts, taxes, or unlimited inference.

## Configure in test mode first

1. Create a Stripe product with one recurring price. Choose the currency, amount,
   and billing interval in Stripe. The application does not hardcode a dollar price.
2. Enable/configure the Stripe customer portal for payment-method updates and
   subscription cancellation. Restrict price changes to the configured Pro price.
3. Set these variables in the root `.env` for Docker (or backend `.env` locally):

   ```dotenv
   BONDETH_TTS_ENGINE=voxcpm
   BONDETH_CLONE_ENGINE=voxcpm
   BONDETH_BILLING_ENABLED=true
   BONDETH_STRIPE_SECRET_KEY=sk_test_...
   BONDETH_STRIPE_WEBHOOK_SECRET=whsec_...
   BONDETH_STRIPE_PRO_PRICE_ID=price_...
   ```

   Use the GPU image/optional VoxCPM dependencies and apply migrations before startup.
   Billing validation rejects missing keys or the default noncommercial engines.
4. Register a **snapshot** webhook at `https://YOUR_API/api/v1/billing/webhook` for:

   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`

   The REST client pins Stripe API version `2025-06-30.basil`; period ends are read
   from subscription items. Prefer the same version for the snapshot destination.
   For local testing, `stripe listen --forward-to localhost:8000/api/v1/billing/webhook`
   provides its own signing secret; configure that value locally.
5. Open `/account` with a verified account, use **View Pro checkout**, complete a
   Stripe test payment, and confirm `/billing` and `/usage` report Pro after delivery.
6. Use **Manage subscription** to test cancellation and payment-method changes.
   Verify duplicate deliveries, delayed events and failed renewals in Stripe test mode
   before switching to live credentials and a live price ID.

Secrets never belong in `NEXT_PUBLIC_*` variables. Configure `PUBLIC_APP_URL` (Docker)
or `BONDETH_PUBLIC_APP_URL` (local backend) for return links. Prices/amounts supplied
by a browser are never accepted. Repeated Checkout requests reuse an open session;
an existing subscription directs the user to the portal.

## Entitlements

| Daily allowance | Verified free | Pro default |
| --- | ---: | ---: |
| STT | 60 minutes | 300 minutes |
| TTS | 50,000 characters | 250,000 characters |
| Cloning | 20 jobs | 100 jobs |
| Queued-job scheduling | Regular | Priority, with regular-job turns |

Override Pro caps with `BONDETH_QUOTA_STT_SECONDS_PRO`,
`BONDETH_QUOTA_TTS_CHARS_PRO`, and `BONDETH_QUOTA_CLONE_JOBS_PRO`.
These are bounded daily allowances, reset at midnight Cambodia time.

Cancellation scheduled for period end preserves access while Stripe reports active
and the local period has not expired. `past_due`, unpaid, incomplete, canceled,
paused, unverified and expired accounts receive free allowances. There is no grace
period. Provider delivery failures should be retried by Stripe; a failed database
or provider request does not commit a webhook receipt. Events from older subscriptions
cannot replace a nonterminal newer subscription.

The portal can remain available for a customer whose Pro access expired. Account
deletion expires pending Checkout and cancels the subscription before removing the
user. If Stripe is unavailable, deletion fails so a recurring payment is not orphaned.
Provider-side customer/invoice records are retained by Stripe; local account deletion
does not promise deletion of those external financial records.

## Operations

Alert on Stripe delivery failures and retry pending events after outages. An active
subscription stops granting access when its recorded period expires if renewals do
not arrive, so a stale local record cannot grant access indefinitely. Keep the price
ID stable; replacing it intentionally removes entitlement to the old price until
subscriptions are migrated. Keep server clocks synchronized for signature verification.

Backend tests use a fake provider and verify signatures, duplicate events, retry,
expired/unpaid entitlements, Checkout reuse, and account cancellation. They do not
prove a merchant account, tax configuration, or live payment has been provisioned.

Provider references: [Checkout](https://docs.stripe.com/api/checkout/sessions/create),
[customer portal](https://docs.stripe.com/api/customer_portal/sessions/create),
[webhooks](https://docs.stripe.com/webhooks).
