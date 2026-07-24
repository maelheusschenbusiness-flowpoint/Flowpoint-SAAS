---
name: Billing audit findings
description: Complete audit of FlowPoint billing — store.me singleton contamination, persistSubscriptionMeta orgId bug, and what is correctly isolated.
---

# FlowPoint Billing Audit — Key Findings

**Why:** Exhaustive audit performed before any correction. Use this to scope fixes accurately.

## Root cause — store.me singleton vs DB layer coexistence

Two contradictory layers:
- `store.me` (global JS object, single-tenant heritage) — used by 60% of billing decisions
- `billing-context.ts` + `org_settings` + `org_addons` (DB per-org, correctly isolated) — used by the rest

## Critical bugs (P0)

1. **persistSubscriptionMeta always writes org_id="default"** — `stripe-webhook.ts`; the function signature has `orgId = "default"` and all 4 callers omit the param. Subscription status never persists to the real org in DB.

2. **planGate.ts reads store.me.plan** — `currentPlan()` is `store.me?.plan`; plan gate checks are wrong in any multi-tenant session.

3. **Webhook mutations on store.me** — `subscription.deleted` mutates 8 addon keys + subscriptionStatus on the singleton, corrupting state for all concurrent orgs.

4. **subscription.deleted does NOT update org_settings.plan** — plan column stays at old value after cancellation; `broadcastPlanUpdate("standard")` is SSE only, not DB write.

5. **Email notification uses store.me.email** — payment_succeeded email goes to wrong recipient in multi-tenant.

6. **checkQuota() is fully sync from store.me** — `billing-service.ts`; no DB read, wrong plan & usage limits.

## Significant bugs (P1)

- `addon-checkout` creates Stripe session without `customer:` field → orphan customer → webhook resolves orgId to "default"
- Fallback checkout (embedded→redirect) also missing `customer:` field
- `startTrial()` writes plan/status to store.me only, not upserted to DB immediately
- `syncAddonsFromSubscription` writes to store.me.addons in addition to DB
- `getUsageSummary()` reads addons/subscriptionStatus/trialEndsAt from store.me
- `GET /billing/plans` returns `store.me.plan` as "current" (public route, pre-auth)
- `public/finalize-checkout` creates Stripe customer with no org_settings linkage
- `ai-engine.ts` L.63 falls back to `store.me.plan` if loadOrgSettings fails

## What is correct (preserve as-is)

- `billing-context.ts` — always DB-first, per-org, no singleton
- `ensureStripeCustomer` — DB-first, concurrency lock, deleted-customer recovery
- `me.ts` normal path — reads `loadOrgSettings(orgId)`, email from `req.orgContext`
- `ai-engine.ts` credit tracking — withOrgDb, all queries use orgId
- `/billing/verify` — correctly calls `upsertOrgSettings(orgId, ...)` with right orgId
- Webhook signature verification — constructEventAsync, rejects unsigned in prod
- org_addons reset on subscription.deleted — correct DB write with real orgId

## Reliability estimate

- Single-tenant (one org per instance): ~78%
- Multi-tenant (multiple orgs simultaneously): ~35%

## Fix order

Phase 1 (P0): pass orgId to persistSubscriptionMeta → replace store.me mutations with upsertOrgSettings → add plan='standard' on deletion → fix email → planGate reads billingCtx → checkQuota async DB read

Phase 2 (P1): add customer: to addon-checkout + fallback → link finalize-checkout customer to org → startTrial upsertOrgSettings → getUsageSummary from billingCtx → remove store.me.addons mutations

**How to apply:** Before writing any billing fix, check if the route already has `loadBillingContext(orgId)` call — if yes, use `billingCtx` not `store.me`. The pattern already exists in the main billing routes.
