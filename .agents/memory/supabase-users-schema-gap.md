---
name: Supabase users table schema gap — first_name / last_name
description: Production Supabase users table was missing first_name and last_name columns; activation transaction fails silently when these are absent.
---

## Problem

The `users` table in Supabase production was created before `init-phase1-users.ts` was first deployed.
`CREATE TABLE IF NOT EXISTS` is a no-op when the table already exists, so the new columns in the
CREATE definition are never added to the old table.

The self-healing `ALTER TABLE users ADD COLUMN IF NOT EXISTS ...` block originally only covered:
- `status`
- `email_verified`
- `auth_provider`
- `last_login_at`

`first_name` and `last_name` were silently absent, causing `/api/public/finalize-checkout` to fail
its activation transaction with PGRST204 ("Could not find column in schema cache").

## Symptom

- User pays via Stripe → payment confirmed
- `checkout-return.html` shows "Erreur de finalisation" with "Réessayer" button
- `_fcActivationCommitted` stays `false` → 502 returned
- `pending_signups` row remains unconsumed (token still valid for retry)

## Fix applied (2026-08-14)

Added to `init-phase1-users.ts` self-healing block:
```ts
await run(client, `ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;`);
await run(client, `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name  TEXT;`);
```

Pushed to GitHub (`Test-Replit` branch, commit `f1b1b8c2`). Render will apply on next deploy.

**For immediate relief on an existing Supabase project**, run in SQL Editor:
```sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name  TEXT;
```

## How to apply

Any new column added to the `CREATE TABLE IF NOT EXISTS users (...)` definition MUST also be
added as a standalone `ALTER TABLE users ADD COLUMN IF NOT EXISTS ...` in the self-healing block
immediately below it. Without that, the column silently never appears in production databases
that predate the migration.
