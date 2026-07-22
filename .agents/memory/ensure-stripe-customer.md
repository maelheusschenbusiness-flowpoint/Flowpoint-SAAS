---
name: ensureStripeCustomer pattern
description: P0 service guaranteeing every org has a valid Stripe Customer — concurrency lock, DB-first, deleted-customer recovery
---

## The rule
All billing code that needs a Stripe Customer ID must call `ensureStripeCustomer(orgId, hint?, stripeKey?)` from `services/ensure-stripe-customer.ts`. Never create customers inline or fall back to `store.me.stripeCustomerId` for billing decisions.

**Why:** Before this fix, 5 ad-hoc inline `stripe.customers.create` blocks existed in billing.ts, none handled `deleted` or `resource_missing`. Portal returned 422 permanently. login-verify created no customer at all (only signup did). Scenario test confirmed 422 → 200 fix after deletion.

## How to apply
- Import: `import { ensureStripeCustomer } from "../services/ensure-stripe-customer.js"`
- Call: `const customerId = await ensureStripeCustomer(orgId, billingCtx, stripeKey)`
  - `billingCtx` (or any `{ stripeCustomerId, email, firstName, orgName }`) is a perf hint — the function always reads DB anyway
  - `stripeKey` defaults to env STRIPE_LIVE_API_KEY / STRIPE_SECRET_KEY
- For portal: wrap in try/catch → 503 on Stripe error (key missing = 503 is correct)
- login-verify: fire-and-forget after res.json(); skip if no stripeKey (non-fatal)

## Key internals
1. Per-orgId `_inflight` Map lock — concurrent requests for same org share one Promise
2. DB via `loadOrgSettings` is source of truth (survives process restarts)
3. Validates existing ID via `stripe.customers.retrieve` → checks `deleted: true` → handles `resource_missing`
4. Before creating: searches by `metadata['orgId']:'...'` to recover orphaned customers
5. Creates with `{ email (if valid regex), name, metadata: { orgId, flowpointUserId, environment } }`
6. `_persist` retries DB write once (250ms delay); warns on failure but never throws
7. `_syncStore` updates `store.me.stripeCustomerId` best-effort (secondary — never source of truth)

## Stripe search indexing latency
Stripe's `/v1/customers/search` has ~10-30s indexing latency. Direct `retrieve(id)` is authoritative. Tests using email search right after create will see false negatives — verify via direct retrieve or check DB + portal response instead.
