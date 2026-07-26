---
name: P0 auth isolation fixes
description: Root causes and fixes for cross-user data leakage, duplicate Stripe customer, and upgrade errors
---

## Root causes identified

### Wrong account after magic link
1. `store.me` global singleton — auth.ts signup wrote `firstName/plan/subscriptionStatus/trialEndsAt` to the shared singleton. When `/api/me` DB lookup fails (row not yet created), me.ts fallback spread `{...store.me}` → User B sees User A's data.
2. `login-verify.js` did NOT clear `localStorage`/`sessionStorage` before redirecting. Stale `fp-state-cache` from previous user was immediately re-read by the dashboard.
3. No `invalidateAllSessions` call before `createSession` in login-verify endpoint — old session tokens could bleed.

### Duplicate Stripe customer
`auth.ts` signup called `stripe.customers.create` directly (bypassed `ensureStripeCustomer`). Every re-signup created a new customer regardless of whether one existed.

### Upgrade error ("Erreur lors de la mise à niveau")
`fpUpgradeOrCheckout` in dashboard.js didn't handle `{noSubscription: true, redirectTo: ...}` or 409 `{error: "plan_already_active"}` responses — both fell to the catch-all error branch.

## Fixes applied

| File | Fix |
|------|-----|
| `me.ts` fallback (lines 101-102) | Replaced `{...store.me}` with safe defaults from `req.orgContext` only |
| `me.ts` happy path (line 49) | Removed `?? store.me.firstName` fallback |
| `auth.ts` login-verify | Added `invalidateAllSessions(entry.email)` before `createSession` |
| `auth.ts` signup upsertOrgSettings | Added existing-account detection; if existing → update contact info ONLY (no plan/trial overwrite) |
| `auth.ts` signup store.me writes | REMOVED all `store.me.firstName/org/plan/subscriptionStatus/trialEndsAt` writes |
| `auth.ts` signup Stripe | Replaced `stripe.customers.create` with `ensureStripeCustomer` (deduplication) |
| `auth.ts` signup response | Added `existingAccount: true` + friendly message when account pre-exists |
| `login-verify.js` | Added `purgeUserCache()` (clears all `fp-*` localStorage keys + sessionStorage) before API call; uses `location.replace` + `?_cb=Date.now()` cache-bust on redirect |
| `dashboard.js fpUpgradeOrCheckout` | Added `r.noSubscription` → redirect to checkout; `plan_already_active` → info toast |
| `ensure-stripe-customer.ts` Step 4 | Added `description` (company), `address` (country/city/line1), richer `metadata` (flowpoint_org_id, company, website, signup_source) |

**Why:** `store.me` is shared across ALL concurrent requests on the server; any user-specific write to it leaks to other users whose DB lookup fails. The safe pattern is: me.ts fallback must ONLY use `req.orgContext` (scoped to the authenticated session).

**How to apply:** Any new route that returns user-specific data must NEVER read from `store.me`. Always read from DB (`loadOrgSettings`) or `req.orgContext`. If DB fails, return safe defaults scoped to `req.orgContext.email/role` only.
