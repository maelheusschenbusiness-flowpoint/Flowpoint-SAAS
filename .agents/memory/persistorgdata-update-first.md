---
name: persistOrgData UPDATE-first pattern
description: The INSERT ON CONFLICT pattern for organizations fails in production; UPDATE-first is the correct approach.
---

# persistOrgData — UPDATE first, INSERT ON CONFLICT as fallback

## The rule
`persistOrgData` must run `UPDATE organizations SET ... WHERE id=$1::uuid` first.
Only if `rowCount === 0` (org row truly absent) fall back to `INSERT INTO organizations (id) VALUES ($1::uuid) ON CONFLICT (id) DO UPDATE SET ...`.

## Why
The bare `INSERT INTO organizations (id) VALUES ($1)` (without `::uuid` cast and without the other NOT NULL columns) failed in production before reaching the ON CONFLICT clause. Root cause was not fully identified remotely (RLS, type-cast, or schema constraint), but the symptom was consistent: every call from billing routes returned a 500 with "Échec de la mise à jour du plan" even though the org row existed.

Using UPDATE first is also semantically correct: billing routes always call this for existing orgs. The INSERT fallback only exists for the rare new-account webhook race condition.

## How to apply
- Commit `9173de4e` on Test-Replit contains the fix in `artifacts/api-server/src/services/org-data.ts`
- Validated live: Pro→Standard downgrade without Stripe sub → HTTP 200 after fix (was 500 before)
- The fallback INSERT now includes `::uuid` cast on `$1` for safety

## Residual risk: Stripe/DB desync on account deletion
If Stripe cleanup succeeds but DB transaction fails (and user never retries):
- DB rows survive indefinitely (not bounded by session TTL)
- Stripe customer already deleted → user can login but cannot reactivate billing
- Retry is idempotent (resource_missing treated as clean)
- Accepted as-is; financial impact is zero (no active Stripe billing)
