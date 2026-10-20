-- Migration 016 — ai_recommendations table
-- Fixes: GET /api/ai/recommendations was querying ai_usage_logs with non-existent columns.
-- This table is the source of truth for actionable AI recommendations per org.

CREATE TABLE IF NOT EXISTS ai_recommendations (
  id           TEXT PRIMARY KEY DEFAULT ('rec_' || gen_random_uuid()::TEXT),
  org_id       TEXT NOT NULL,
  type         TEXT NOT NULL DEFAULT 'general',
  title        TEXT NOT NULL,
  description  TEXT,
  priority     INTEGER NOT NULL DEFAULT 5,
  status       TEXT NOT NULL DEFAULT 'active',
  source       TEXT DEFAULT 'ai',
  metadata     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ai_recommendations_org_idx
  ON ai_recommendations (org_id, priority ASC, created_at DESC);

CREATE INDEX IF NOT EXISTS ai_recommendations_status_idx
  ON ai_recommendations (org_id, status, expires_at);

ALTER TABLE ai_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS ai_recommendations_org_isolation
  ON ai_recommendations
  USING (org_id = current_setting('app.org_id', true));

-- Idempotency column for ai_usage_logs — prevents double-billing on retry.
-- If the column already exists (from a future re-run) we skip silently.
ALTER TABLE ai_usage_logs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_logs_idempotency_key_idx
  ON ai_usage_logs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
