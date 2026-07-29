---
name: Billing reactivation checkout idempotency
description: Pattern for idempotent Stripe Checkout Sessions on canceled-account reactivation in POST /billing/upgrade
---

## Rule
A canceled account with a `stripeCustomerId` must go through a new Stripe Checkout Session (not a direct subscription create). The session reuses the existing customer. Two layers of idempotency protect against duplicate sessions:

1. **Pre-flight list check** — `stripe.checkout.sessions.list({ customer, status: "open", limit: 5 })`, filtered on `metadata.reactivation === "true"` && `metadata.targetPlan === targetPlan` && `s.url`. Returns existing session if found.
2. **Stripe-side idempotencyKey** — passed as the second argument to `stripe.checkout.sessions.create(params, { idempotencyKey })`. Key format: `fp-reactivation-${orgId}-${targetPlan}-${Math.floor(Date.now() / (30 * 60 * 1000))}`. The 30-minute bucket allows retry after expiry while closing the concurrent-request race window.

**Why:**
The list check alone is not atomic — two concurrent requests can both see an empty list and both call create(). The idempotencyKey closes the remaining race at the Stripe API level.

**How to apply:**
- Location: `artifacts/api-server/src/routes/billing.ts`, `POST /billing/upgrade`, before the existing `if (billingCtx.stripeCustomerId)` active-sub block.
- The idempotencyKey is the SECOND argument to `stripe.checkout.sessions.create()`, not a field inside the params object.
- No `persistOrgData()` is called here. The webhook (`checkout.session.completed`) is the sole source of truth for activating the plan.
- metadata must include both `plan: targetPlan` (consumed by webhook) and `targetPlan` (consumed by idempotency lookup).

**Test coverage:** T15-T22 in `tests/certification/lot_c_billing.test.ts`.
