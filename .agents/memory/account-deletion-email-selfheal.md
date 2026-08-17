---
name: Account deletion — email self-heal
description: Why deleteAccount must resolve email from DB when the caller passes null, and what breaks if it doesn't.
---

# Account deletion — email self-heal

## The bug

`DELETE /billing/account` calls `deleteAccount({ orgId, userId, email: email || null, ... })`.
`billingCtx.email` can be `null` (e.g. when `organizations.owner_email` is not set).
When `email` is null, three cleanup steps are skipped inside the transaction:
- `magic_link_tokens` (EMAIL_KEYED_TABLES) — not deleted → existing tokens still valid
- `pending_signups` (EMAIL_KEYED_TABLES) — not deleted
- Legacy `org_settings` (org_id = email, step 2e-ter) — not deleted

**Consequence:** a deleted user can request a fresh magic link (login-request finds the
surviving email-keyed org_settings and allows it), click it, and `login-verify`'s S3-legacy
path calls `resolveOrCreateLegacyOrg` which **recreates** the account from the surviving
org_settings row.

## The fix (2026-08-17)

Changed `const email` → `let email` in `deleteAccount`.

Added an email self-heal block right after the org lock, before step 2a:
1. `SELECT email FROM users WHERE id::text = $userId` (userId always provided for auth'd requests)
2. Fallback: `SELECT owner_email FROM organizations WHERE id::text = $orgId`
3. If resolved, log it and assign to `email` — all downstream email-keyed cleanup now runs.
4. If still null after both queries, log a warning and continue (skipping email cleanup is non-fatal but logged).

**Why:** The two DB queries run inside the open transaction, so they see the not-yet-deleted rows
and always succeed when data exists.

## How to apply

- Any future refactor of `deleteAccount` must keep `email` as `let`, not `const`.
- The self-heal block must stay BEFORE step 2a (user resolution) and AFTER the org lock.
- Do NOT rely on the caller to supply email — the self-heal is the safety net.
- `user_sessions` is NOT added to EMAIL_KEYED_TABLES: it is correctly handled by dynamic
  discovery via the `org_id` column. Adding it by email would wrongly delete sessions for
  multi-org users who are preserved.
