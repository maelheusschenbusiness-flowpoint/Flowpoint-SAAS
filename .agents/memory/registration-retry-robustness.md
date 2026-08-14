---
name: Registration retry robustness
description: Root causes and fixes for pre-register blocking re-registration after abandon/retry
---

## Rule
A pre-registration attempt (pre-register → Stripe → abandon) must never leave ghost rows that block a subsequent attempt with the same email.

## Root causes fixed (all in auth.ts + account-deletion.ts)
1. **org_settings guard** — only block when subscription_status IN ('active','trialing','past_due'); delete any non-active shell immediately in the guard (not just in the stale-pending branch).
2. **users ON CONFLICT DO NOTHING** → changed to ON CONFLICT DO UPDATE WHERE status='pending' so retries update the name.
3. **stale Stripe customer** — read stripe_customer_id from stale pending_signups before marking consumed; fire-and-forget delete from Stripe.
4. **account-deletion misses pending users** — add DELETE FROM users WHERE email=$1 AND status='pending' (never in organization_members, so missed by UUID-based deletion).
5. **account-deletion misses email-keyed org_settings** — add DELETE FROM org_settings WHERE lower(org_id::text)=lower($email) after UUID-based deletion.

## Why
Old Render code created org_settings with subscription_status='pending_billing' on every pre-register. Each new attempt found it and returned 409. New guard + cleanup makes this non-blocking and self-healing regardless of server version in production.

## Test matrix (9/9 PASS on dev server)
S1 first reg, S2 retry-name-update, S3 third attempt, S4 pending_billing non-blocking+cleaned, S5 active blocks, S6 users.active blocks, S7 canceled allows re-reg, S8 trialing blocks, S9 none non-blocking+cleaned.

## How to apply
- auth.ts pre-register guard: check ['active','trialing','past_due'] AND delete non-active rows immediately
- account-deletion.ts: two extra steps after terminal-tables loop
- finalize-checkout activation: ON CONFLICT DO UPDATE already idempotent (users/orgs/org_members)
