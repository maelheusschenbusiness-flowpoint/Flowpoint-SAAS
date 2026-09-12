---
name: Stripe billing cert — 3 production fixes
description: Three bugs found during full Stripe Test billing certification (107/107 PASS 2026-08-15)
---

## Fix 1: Reconcile uses wrong Stripe key in test mode

**Rule:** In `persistAddonsFromSubscription`, the reconcile call to `stripe.subscriptions.list()` must use the same mode as the incoming webhook. Use `subscription.livemode` to select the key — not `getStripeKey()` unconditionally.

**Why:** `getStripeKey()` returns the live key when `STRIPE_LIVE_API_KEY` is set. Test-mode webhooks (`livemode:false`) carry test-mode customer IDs. Calling `subscriptions.list({ customer: 'cus_test...' })` with the live key returns "No such customer in test mode" → error → fail-open → deactivation silently skipped. This is a latent hole in any staging/dev environment that processes test webhooks.

**How to apply:**
```typescript
const subLivemode = Boolean((subscription as Record<string, unknown>)?.livemode ?? true);
const stripeKey = subLivemode
  ? getStripeKey()
  : (process.env["STRIPE_TEST_KEY"] ?? getStripeKey());
```
Location: `src/routes/stripe-webhook.ts`, inside `persistAddonsFromSubscription`, reconcile block.

---

## Fix 2: AI credit PaymentIntent webhook requires `type: "ai_credits"` in metadata

**Rule:** Any PaymentIntent for AI credits MUST include `metadata.type = "ai_credits"` (plus `pack`, `credits`, `amountEurCents`, `orgId`). The webhook handler branches on `piMeta["type"] === "ai_credits"` — without it the PI falls through to the pre_register_token path and does nothing.

**Why:** The `payment_intent.succeeded` handler handles both new-signup checkout and in-app AI credit purchases. The branch discriminator is `metadata.type === "ai_credits"`.

**How to apply:** When creating a PI for AI credits (in billing.ts `ai-credits-intent` route or in tests), always set:
```
metadata: { type: "ai_credits", pack: packKey, credits: String(n), amountEurCents: String(cents), orgId: "..." }
```

---

## Fix 3: `hasPremiumAccess` must include `past_due`

**Rule:** In `me.ts`, `hasPremiumAccess = normStatus === "active" || normStatus === "trialing" || normStatus === "past_due"`. Same logic applies to `mustCompleteBilling` (must be false for past_due).

**Why:** `past_due` = latest invoice payment failed but subscription is still active (Stripe grace period). Revoking access on past_due would lock out customers who just had a transient card failure — incorrect product behavior.

**Location:** `src/routes/me.ts` line ~133.
