-- Migration 014: Ensure ai_monthly_usage has real tracking columns.
-- This migration is idempotent — safe to run multiple times.
--
-- HISTORY: The original CREATE TABLE (002_dashboard_tables.sql) had:
--   id, org_id, month, total_tokens, total_cost_usd, request_count
-- Later the table was modified to add credits_used, cost_eur, tokens_used,
-- reset_at, updated_at. Some environments may also have credits_limit
-- and credits_extra — these are deprecated and will be removed in a
-- follow-up migration once all code is deployed.
--
-- RULE: The canonical source for credit LIMIT is PLAN_DEFINITIONS in
-- src/lib/plans.ts. No code should read/write credits_limit or
-- credits_extra from this table.

-- Add tracking columns (idempotent — no-op if they already exist)
ALTER TABLE ai_monthly_usage
  ADD COLUMN IF NOT EXISTS credits_used  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_eur        REAL    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_used     INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reset_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- NOTE: We do NOT drop credits_limit / credits_extra here.
-- They will be removed in migration 015 after the new code (which no
-- longer references them) is fully deployed to production.
