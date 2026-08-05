---
name: Stripe E2E certification tooling
description: How to run the billing E2E certification suite against Stripe Test Mode
---

## Rule
The E2E billing certification lives at `artifacts/api-server/tools/e2e-billing-cert.mjs`.
Run it from that directory: `node tools/e2e-billing-cert.mjs`.

## Requirements
- `STRIPE_TEST_KEY` (sk_test_...) — stored as a Replit secret
- `STRIPE_WEBHOOK_SECRET` or `STRIPE_WEBHOOK_SECRET_RENDER` — the live webhook secret, used to sign simulated events (server validates with the same key regardless of test/live event origin)
- Server must be running on port 8081 (localhost)

## What it tests
- Flow 1: Standard → Pro plan change via `checkout.session.completed` webhook
- Flow 2: AI Token Pack 50K via `payment_intent.succeeded` — verifies 50 000 credits in `ai_credit_purchases`, proves ON CONFLICT DO NOTHING idempotency (replay = 0 extra credits)
- Flow 3: Add-on activation via `checkout.session.completed` with addon metadata
- Flow 4: AI credits checkout session creation (produces a real cs_test_ URL)

**Why:** Test key signing order must match the server (`STRIPE_WEBHOOK_SECRET` first, then `STRIPE_WEBHOOK_SECRET_RENDER`). Wrong order → 400 signature mismatch.

**How to apply:** Any future webhook simulation must send `Content-Type: application/json` (not `text/plain`) so `express.raw({ type: "application/json" })` populates `req.rawBody` as a Buffer.
