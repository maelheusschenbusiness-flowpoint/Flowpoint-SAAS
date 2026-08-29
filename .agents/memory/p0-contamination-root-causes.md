---
name: P0 contamination root causes
description: Root causes + fixes for the 6 P0 bugs found in live browser testing (state contamination, billing cross-tenant, upsell CTAs mutating plan, delete account failure, address not saved)
---

# P0 Root Causes & Fixes (confirmed 2026-08-29)

## P0-1/P0-4 — Frontend tenant state contamination

**Root cause (confirmed):**
1. `fp-state-cache` (sessionStorage) stores full tenant data without an `_org` field — read at startup BEFORE /api/me returns. On re-registration or org-switch, the previous tenant's audits/monitors/team/billing are rendered.
2. `fp:wl-branding`, `fp:settings`, `fp:pinned`, `fp:search-hist`, `fp:cl-extra`, `fp-psi-last` in localStorage stored WITHOUT orgId namespace.
3. Normal logout (`disconnectAllSessions`) only cleared auth tokens + last-route, NOT these tenant-specific keys.

**Fix applied (2df7ede):**
- `fp-state-cache` writes now include `_org: STATE.me.orgId`
- Phase 0 cache load validates `_cp._org` against `fp:last-org-id`; mismatch → discard cache + remove `fp:wl-branding`
- `disconnectAllSessions` now purges all tenant-specific localStorage keys on logout

**Still needed:**
- Full namespace migration: `fp:wl-branding` → `fp:${orgId}:wl-branding` etc. (complex, 6+ sites)
- `STATE` singleton not fully reset on org change — only route/subRoute reset; loaded arrays persist until loadData()

## P0-2 — Delete account shows "Expiré" instead of deleting

**Root cause (confirmed):**
- `cleanupStripe()` runs FIRST (cancels subs + deletes customer) — Stripe fires webhooks
- DB transaction runs after; `survivor check` (line 757) throws if ANY table has rows after DELETE
- TX rolls back → account data preserved, but Stripe already gone
- `billing.ts` catch block returned `{error: "..."}` with NO `stripeCleared` field — frontend showed toast, didn't redirect
- User re-logs in → sees canceled subscription screen (subscriptionStatus still old value in DB)

**Fix applied (2df7ede):**
- `billing.ts` catch block now returns `{error: "...", stripeCleared: true}` for DB failures (non-Stripe errors)
- Also calls `persistOrgData(orgId, {subscriptionStatus: "canceled"})` and clears session cookie
- Frontend `fpConfirmDeleteAccount` already handles `stripeCleared: true` (previous session fix)

**Still needed:**
- Find which specific tables survive deletion and cause the rollback (need Render logs: "[AccountDeletion] Rolled back — rows survived in: TABLE(N)")
- Add those tables to explicit deletion list in account-deletion.ts

## P0-3 — Cross-tenant billing: Ultra account → Standard without action

**Root cause (confirmed):**
- `customer.subscription.deleted` webhook fires when A's subscriptions are cancelled during deletion
- Webhook resolver → `findOrgByStripeCustomer(A.stripeCustomerId)` → if Stripe customer deleted/missing → Stripe API fallback → email → `SELECT id FROM organizations WHERE owner_email ORDER BY created_at DESC LIMIT 1` → can resolve to WRONG org (newest by email = could be new re-registered org or B if email collision)
- OR: previous `findOrgByStripeCustomer` would self-heal `stripe_customer_id` onto another org via email lookup → all future webhooks for A write to B's orgId
- Canonicalization step (email → UUID): used `ORDER BY created_at DESC LIMIT 1` → ambiguous when multiple orgs share email

**Fix applied (2df7ede):**
- `findOrgByStripeCustomer` email fallback REMOVED — no longer returns or self-heals based on email alone when metadata.orgId is missing
- Webhook canonicalization: changed from `LIMIT 1 ORDER BY created_at DESC` to counting matches — only canonicalizes when EXACTLY ONE org has that email; refuses and nullifies orgId when multiple orgs match (safe refusal vs corrupt write)

## P0-5 — Registration address not saved

**Root cause (confirmed, line 1785 auth.ts):**
- `pre-register` endpoint stores address in `pending_signups` table
- At `login-verify` (activation), the address backfill was EXPLICITLY REMOVED with a TODO comment:
  > "A safe implementation requires a durable org_id column on the consumed pending_signups row... Until that column is added, an email-only lookup risks writing one org's signup address into a different org's settings"
- So address from signup is never restored to the new org

**Fix needed:**
- `ALTER TABLE pending_signups ADD COLUMN org_id UUID REFERENCES organizations(id) ON DELETE SET NULL`
- Populate `pending_signups.org_id` in stripe-webhook.ts at activation (when org is created)
- Restore address backfill in `handleLoginVerify` keyed by `org_id`, not email

## P0-6 — Upsell CTAs mutating plan directly

**Root cause (confirmed, line 15464 dashboard.js):**
```javascript
window.fpUpgradeCta = function(plan) {
  var st = ... subscriptionStatus ...;
  if ((st === 'active' || st === 'trialing') && typeof window.fpUpgradeOrCheckout === 'function') {
    window.fpUpgradeOrCheckout(plan);  // ← makes POST /api/billing/upgrade directly!
    return;
  }
  window.fpGoToBillingPlans();
};
```
- `fpUpgradeCta` called `fpUpgradeOrCheckout` for active/trialing subscribers → direct POST to `/api/billing/upgrade` → real Stripe mutation
- All upsell banners ("Passer Pro/Ultra" in Local SEO, AI, Reports, Monitors, etc.) used `fpUpgradeCta`

**Fix applied (2df7ede):**
- `fpUpgradeCta` now always calls `fpGoToBillingPlans()` — navigation ONLY
- Never calls `fpUpgradeOrCheckout` regardless of subscription status

## Commit

SHA (local): `2df7ede`
GitHub push: BLOCKED (auth failure on git push; connectors SDK not loading in CodeExecution)
Files changed: billing.ts, stripe-webhook.ts, org-data.ts, dashboard.js (both copies)
