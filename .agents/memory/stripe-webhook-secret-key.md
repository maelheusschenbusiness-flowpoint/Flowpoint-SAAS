---
name: Stripe webhook secret env var mismatch
description: STRIPE_WEBHOOK_SECRET_RENDER is the secret name; stripe-webhook.ts must read both names
---

# Stripe webhook secret env var mismatch

## The rule
`stripe-webhook.ts` must read:
```typescript
process.env["STRIPE_WEBHOOK_SECRET"] || process.env["STRIPE_WEBHOOK_SECRET_RENDER"]
```
Never just `process.env["STRIPE_WEBHOOK_SECRET"]` alone.

**Why:** The Replit secret is named `STRIPE_WEBHOOK_SECRET_RENDER`. Using only `STRIPE_WEBHOOK_SECRET` silently returns `undefined` in production, causing the webhook handler to return 503 on every event. All `setup_intent.succeeded`, `checkout.session.completed`, `invoice.payment_succeeded` events were being silently rejected, so `activateNewSignup` was never called and no magic link was ever sent after checkout.

**How to apply:** Any route file that processes Stripe webhooks must use both env var names. `billing.ts` already does this correctly. If adding a new webhook handler, always use the `||` pattern.
