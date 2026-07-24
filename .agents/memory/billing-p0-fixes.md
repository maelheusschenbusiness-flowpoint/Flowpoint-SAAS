---
name: FlowPoint Billing P0 fixes
description: 6 P0 billing security fixes implemented 2026-07-24; patterns and constraints for future billing work
---

## P0-1: persistSubscriptionMeta — orgId must be explicit
`stripe-webhook.ts` `persistSubscriptionMeta` requires `orgId: string` (no default).
If orgId is "default" or unresolved → log error + return early. Never write billing state to "default".
orgId resolution: 3-pass — stripe_customer_id lookup → metadata.orgId → subscription_metadata.orgId.
Unresolved events use "_system_" sentinel in billing_events (never "default").

**Why:** Webhooks were writing all orgs' billing state to `org_id='default'`, shadowing real tenant rows.

## P0-2: planGate — DB-first, fail-closed in prod
`planGate.ts` `requirePlan`/`requireFeature` call `loadOrgSettings(req.orgId)` — never `store.me.plan`.
Fail-closed: DB error in prod → 503 (not fail-open). Dev: fail-open with "standard".
`requireQuota` callback now receives `orgId: string` param.

**Why:** store.me.plan is a global singleton — all orgs share one plan, allowing privilege escalation.

## P0-3: No store.me mutations in stripe-webhook.ts
All `store.me.*` billing assignments removed from stripe-webhook.ts.
Only `store.broadcast()` and `store.broadcastPlanUpdate()` remain (SSE-only, acceptable).
`syncAddonsFromSubscription` → `parseAddonsFromSubscription` (returns map, doesn't mutate).
Addon activation: `activateAddon(key, orgId)` with resolved orgId.

**Why:** store.me is shared singleton; webhook for org A was overwriting plan/status for all orgs.

## P0-4: subscription.deleted must reset plan+status
`customer.subscription.deleted` handler must call:
`persistSubscriptionMeta({ orgId, subscriptionStatus: 'canceled', plan: 'standard' })`
Preserves stripe_customer_id and trial_ends_at (needed for history/re-checkout).

**Why:** Before fix, subscription deletion left plan unchanged in DB; org retained paid-plan quotas forever.

## P0-5: Email recipient — always from org_settings
`loadOrgEmail(orgId)` helper in stripe-webhook.ts — reads `email`/`first_name`/`plan` from DB.
If email is null/empty → skip mailer call, log structured warning.
Never use `store.me.email` for transactional emails.

**Why:** store.me.email is the last-logged-in user globally, not the billing org for this webhook event.

## P0-6: checkQuota is async + DB-driven
`checkQuota(resource, orgId)` is now `async`.
Loads plan from `loadOrgSettings`, addons from `org_addons WHERE active=true` (no quantity column).
Live usage: SQL COUNT per resource. Graceful degradation on DB error → allow + warn.

**Why:** sync `checkQuota` used `store.me.plan` and `store.me.usage` — wrong org's data.

## org_addons schema note
`org_addons` table has NO `quantity` column. Each active row = 1 unit of the addon.
`monitorsPack50` active → +50 monitors. `extraSeats` active → +5 seats.

## Test runner
`src/tests/billing-isolation.test.cjs` — 36 tests, CJS, requires pg.
Run: `NODE_PATH="/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules:..." node billing-isolation.test.cjs`
From workspace root. All 36 pass.
