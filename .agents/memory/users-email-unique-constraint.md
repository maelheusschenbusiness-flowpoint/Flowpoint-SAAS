---
name: users_email_unique missing constraint
description: ON CONFLICT (email) on users table always fails 42P10 when the table predates the CONSTRAINT clause — self-heal fix pattern.
---

## Rule
`CREATE TABLE IF NOT EXISTS users (... CONSTRAINT users_email_unique UNIQUE (email) ...)` is a **no-op** when the table already exists in production. The inline constraint is never retroactively added. Any code using `ON CONFLICT (email)` will always fail with **SQLSTATE 42P10** ("there is no unique or exclusion constraint matching the ON CONFLICT specification") on pre-existing tables.

## Why
PostgreSQL's `CREATE TABLE IF NOT EXISTS` skips the entire statement (including all inline constraints) when the table already exists. The table was originally created without the UNIQUE constraint, so later DDL that added it inside `CREATE TABLE IF NOT EXISTS` had no effect in production.

## How to apply
Whenever a table uses `ON CONFLICT (col)` targeting a non-PK column, a **self-heal** must explicitly create the unique index:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email);
```

This must run:
1. In `init-phase1-users.ts` — server startup self-heal (added after line 68)
2. In `finalize-checkout` self-heal block — runs on a separate auto-commit connection **before** the activation transaction opens (added alongside the ALTER TABLE self-heals)

`CREATE UNIQUE INDEX IF NOT EXISTS` is idempotent: safe to run on every boot even when the index already exists.

## What triggered this
finalize-checkout activation transaction (INSERT INTO users ... ON CONFLICT (email) DO UPDATE) always failed with 42P10, causing "Erreur de finalisation" on every new PaymentElement signup. `persistOrgData` succeeded (org_settings row created), but users/organizations/organization_members were never written because the transaction always rolled back. Confirmed via debug response on 2026-08-16.
