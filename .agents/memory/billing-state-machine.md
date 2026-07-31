---
name: Billing state-machine corrections
description: 9 structural billing fixes applied — patterns for subscription status, trial, addons, checkout auth, and cart versioning.
---

## Correction 1 — Status key mismatch
`/api/billing/subscription` must return BOTH `status` AND `subscriptionStatus` (same value).
`dashboard.js` reads `STATE.billing.subscriptionStatus` — if only `status` is returned, `_has=false`
and ALL cancel/reactivate buttons are hidden.
**Fix**: billing.ts returns both keys; `window.getBillingStatus()` reads `.subscriptionStatus || .status`.
**How to apply**: any new billing endpoint must return both keys.

## Correction 2 — Public finalize-checkout auth gate
`POST /public/finalize-checkout` must require an authenticated session even though it's on the public router.
Validate `fp_token` cookie via `user_sessions` SHA-256 hash query; return 401 if no valid session.
**Why**: anonymous callers could complete a Stripe checkout and attach it to no org (or the wrong org).

## Correction 3 — No trial at signup
Email/Google/GitHub signup → `subscriptionStatus: "pending_billing"` (no `trialEndsAt`).
Real trial starts only when Stripe webhook `customer.subscription.created` fires with `status=trialing`.
OAuth handlers must check if org already exists before upsert to avoid overwriting existing billing data.
`sendTrialStarted` email fires from the webhook, NOT from signup.

## Correction 4 — canStartTrial is always backend-derived
`canStartTrial = !trialConsumedAt && !stripeSubscriptionId` — computed in `loadBillingContext()`.
Never trust client-supplied trial eligibility. The field is now in `/api/me` and `/api/billing/subscription`.

## Correction 5 — resource_missing reconciliation
On `stripe.subscriptions.retrieve()` throwing `resource_missing`: clear `stripe_subscription_id` from DB
(raw `UPDATE org_settings SET stripe_subscription_id = NULL, subscription_status = ...`).
upsertOrgSettings cannot set text cols to NULL so use direct pool query.

## Correction 6 — Cart versioning
`fp_cart` in localStorage must carry `_v:1, _orgId, _updatedAt`. Invalidate if >1h old or orgId mismatch.
Set _orgId from `/api/me` email field (async after page load).

## Correction 8 — org_addons source of truth
`me.ts` must query `org_addons` table first; merge `org_settings.addons` JSONB as legacy supplemental.
`org_addons` row wins on key collision. Pattern: build map from org_addons, then for loop legacy fallback.

## trialConsumedAt flow
- Set by webhook on `customer.subscription.created` + `status=trialing` (idempotent: skipped if already set).
- NULL = account has never had a real Stripe trial → `canStartTrial=true`.
- Non-null = trial already used → `canStartTrial=false`, "14j offerts" badge hidden in checkout.html.

## Direct plan changes
- Active/trialing plan buttons call the authenticated upgrade endpoint directly; they must never send an existing subscriber through Checkout.
- Stripe upgrades change the subscription immediately while preserving `trial_end`; downgrades use a schedule and keep the current plan until trial/period end.
- A `customer.subscription.updated` webhook must not clear `pendingPlan` while the subscription metadata still identifies the higher current phase.

## Migration script
`artifacts/api-server/scripts/billing-migration-dryrun.ts` — audits all org_settings rows.
Run `pnpm --filter api-server exec tsx scripts/billing-migration-dryrun.ts` for dry-run.
Add `--apply` to commit changes.
