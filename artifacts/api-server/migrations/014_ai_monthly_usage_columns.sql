-- Migration 014: Add real tracking columns to ai_monthly_usage
-- Previously the table only had: id, org_id, month, total_tokens, total_cost_usd, request_count
-- The codebase tried to read/write credits_used, credits_limit, credits_extra, cost_eur,
-- tokens_used, reset_at, updated_at — which did not exist.
--
-- RULE: credits_limit and credits_extra are NEVER stored in this table.
-- They come exclusively from PLAN_DEFINITIONS in src/lib/plans.ts (single source of truth).

ALTER TABLE ai_monthly_usage
  ADD COLUMN IF NOT EXISTS credits_used  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_eur      REAL    NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tokens_used   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reset_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Drop legacy columns that are redundant with plans.ts (if they were ever added ad-hoc)
ALTER TABLE ai_monthly_usage
  DROP COLUMN IF EXISTS credits_limit,
  DROP COLUMN IF EXISTS credits_extra;

-- Ensure the original total_* columns are kept for backward compat
-- (they map to tokens_used / cost_eur respectively)
UPDATE ai_monthly_usage
  SET tokens_used = COALESCE(tokens_used, total_tokens, 0),
      cost_eur    = COALESCE(cost_eur, total_cost_usd, 0)
  WHERE tokens_used = 0 AND total_tokens > 0;
