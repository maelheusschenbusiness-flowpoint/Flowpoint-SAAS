---
name: Render boot errors — org_settings schema gaps
description: Three Supabase production boot errors and their root causes
---

**Rule:** org_settings must have trial_ends_at, email, first_name columns explicitly migrated; RLS patches on google_oauth_states must be conditional on table existence.

**Why:**
1. init-rls-setup.ts ran DROP/CREATE POLICY on google_oauth_states before the table was created by migrations → `relation does not exist`. Fix: check `to_regclass('public.google_oauth_states') IS NOT NULL` before any DDL.
2. init-data-tables.ts tried to CREATE INDEX ON org_settings(trial_ends_at) without first adding the column → `column does not exist`. Fix: ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ first. Same for email and first_name which the trial-cron SELECT query reads.
3. monitor-cron.ts catch used logger.error (level 50) → appeared as Render error. Downgraded to logger.warn. Real fix: columns now exist.

**How to apply:** Any new column read by application code must be explicitly added in init-data-tables.ts via ALTER TABLE ... ADD COLUMN IF NOT EXISTS before being referenced. Never assume Supabase schema matches local dev schema.
