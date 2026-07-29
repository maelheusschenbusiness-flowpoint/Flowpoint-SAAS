---
name: finalize-checkout intentType mismatch
description: validation bug in finalize-checkout; correct values; createStripeClient requirement for public-billing
---

## Rule
`finalize-checkout` validation must accept `["payment", "setup", "checkout_session"]` — never `"payment_intent"` or `"setup_intent"`.

`checkout-return.html` Case A line 45: `intentType = paymentIntentId ? 'payment' : 'setup'` — always short form.

**Why:** The old whitelist `["payment_intent","setup_intent"]` was wrong: the frontend always sent the short form, but the logic at line 827 also used `"payment"` correctly. Only the validation was broken.

## checkout_session path (reactivation hosted checkout)
- `intentType: "checkout_session"` is an early-return path inside finalize-checkout
- Verifies `mode === "subscription"`, orgId ownership, `payment_status === "paid"`
- Returns `{ success: true, awaitingWebhook: true, plan }` — does NOT activate locally
- Webhook remains sole activation gate

## success_url for reactivation
`billing.ts` reactivation Checkout Session `success_url` must point to `checkout-return.html?session_id=...` (not `dashboard.html`) so the return goes through billing/verify.

## checkout-return.html routing
- `isAlreadyLoggedIn` = `!!localStorage.getItem('fp_token')` — computed at top of IIFE
- Logged-in users (reactivation/upgrade): Case B calls `billing/verify` directly, skips `checkout-complete`
- New signups: Case B calls `checkout-complete` first, falls back to `billing/verify` on error
- `runBillingVerify()` checks `data.ok` (billing/verify returns `{ ok: true, plan }`, no `status` field)
- Logged-in path redirects to `dashboard.html?plan_activated=1`; new signup to `success.html?session_id=...`

## createStripeClient requirement
`public-billing.ts` must import and use `createStripeClient(stripeKey)` instead of `new Stripe(stripeKey, ...)`.
`stripe-factory.ts` is the testability injection point — any route that bypasses it cannot be tested with `setStripeForTesting()`.

**How to apply:** Any new handler in `public-billing.ts` must use `const stripe = await createStripeClient(stripeKey)`.
