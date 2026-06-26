---
name: Supabase RLS migration 012
description: RLS tenant isolation migration for the Supabase project (separate from Replit DB)
---

# Supabase RLS — Migration 012

## Key facts
- Supabase project ref: `sejbsuuaeokyuxuoaxzd` (URL: https://sejbsuuaeokyuxuoaxzd.supabase.co)
- 51 tables in Supabase — completely separate DB from the Replit heliumdb (DATABASE_URL)
- App currently uses Replit DB only; Supabase env vars exist but only referenced in diagnostics.ts
- Service role key bypasses RLS automatically in Supabase — zero risk from enabling RLS

## Migration file
`artifacts/api-server/migrations/012_supabase_rls_tenant_isolation.sql` (427 lines)

## What it does
1. ENABLE ROW LEVEL SECURITY on all 51 tables
2. ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default' on 35 tables that were missing it
3. DROP all existing policies (idempotent)
4. CREATE 4-op policies (SELECT/INSERT/UPDATE/DELETE) using GUC: `current_setting('app.current_org_id', true)`
5. Special cases: organizations (restrict by id), industry_signals (global read), users (service role only)
6. CREATE INDEX CONCURRENTLY on org_id for 18 high-traffic tables

## Tables that already had org_id (Group A)
ai_monthly_usage, ai_usage_logs, automation_workflows, market_opportunities, market_trends,
missions, org_addons, org_settings, user_prefs, user_sessions

## Tables that needed org_id added (Group B - 35 tables)
All other business data tables including: audits, monitors, competitors, tracked_keywords,
alert_events, audit_schedules, calendar_events, connectors, notifications, subscriptions, team_members,
seo_forecasts, workflow_runs, etc.

## How to apply
Cannot apply via REST API (no DDL via PostgREST). Must use one of:
1. Supabase Dashboard → SQL Editor → paste and run 012_supabase_rls_tenant_isolation.sql
2. `supabase db push` (requires supabase CLI and project linked)
3. Direct psql connection (requires DB password, not the service role JWT)

**Why:** Same GUC pattern used on Replit DB (migrations 010/011) — consistent tenant isolation strategy.
**How to apply:** Supabase SQL Editor. Service role queries unaffected (they bypass RLS).
