-- FlowPoint Migration 005 — All missing tables + schema fixes
-- AUTONOMOUS & IDEMPOTENT: does not rely on previous migrations having run.
-- Safe to re-run: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS throughout.
--
-- Run in Supabase SQL Editor (after or without 001–004; order-independent).
--
-- PART 1 — Fix existing tables created with wrong schema in migration 002
-- PART 2 — Create all tables missing from the codebase
-- PART 3 — Ensure org_settings + seed initial rows
-- ─────────────────────────────────────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 1 — FIX EXISTING TABLES (wrong schema from migration 002)
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── connectors ────────────────────────────────────────────────────────────────
-- Migration 002 created connectors with wrong columns (type, name, enabled).
-- Drizzle schema needs: provider, status, connected, access_token, ...
-- Drop and recreate ONLY if the correct column (provider) is missing.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'connectors' AND column_name = 'provider'
  ) THEN
    DROP TABLE IF EXISTS connectors CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS connectors (
  id             TEXT        PRIMARY KEY,
  provider       TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'disconnected',
  connected      BOOLEAN     NOT NULL DEFAULT false,
  access_token   TEXT,
  refresh_token  TEXT,
  webhook_secret TEXT,
  config         TEXT                 DEFAULT '{}',
  last_sync      TEXT,
  sync_status    TEXT                 DEFAULT 'idle',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS connectors_provider_idx ON connectors (provider);

-- ── alert_rules ───────────────────────────────────────────────────────────────
-- Migration 002 missing: operator, duration_min, site_urls
ALTER TABLE IF EXISTS alert_rules
  ADD COLUMN IF NOT EXISTS operator     TEXT    NOT NULL DEFAULT 'lt',
  ADD COLUMN IF NOT EXISTS duration_min INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS site_urls    TEXT    NOT NULL DEFAULT '[]';

-- ── team_messages ─────────────────────────────────────────────────────────────
-- Migration 002 missing: sender_name, type (Drizzle schema requires them)
ALTER TABLE IF EXISTS team_messages
  ADD COLUMN IF NOT EXISTS sender_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS type        TEXT NOT NULL DEFAULT 'text';

-- ── automation_integrations ───────────────────────────────────────────────────
-- Routes use endpoint_url, secret_key, headers, timeout_ms, max_retries, retry_enabled
ALTER TABLE IF EXISTS automation_integrations
  ADD COLUMN IF NOT EXISTS endpoint_url  TEXT,
  ADD COLUMN IF NOT EXISTS secret_key    TEXT,
  ADD COLUMN IF NOT EXISTS headers       JSONB   DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS timeout_ms    INTEGER DEFAULT 30000,
  ADD COLUMN IF NOT EXISTS max_retries   INTEGER DEFAULT 3,
  ADD COLUMN IF NOT EXISTS retry_enabled BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ DEFAULT NOW();

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 2 — NEW TABLES
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── tracked_keywords ──────────────────────────────────────────────────────────
-- Primary keywords table: /api/keywords and keyword-engine.ts
CREATE TABLE IF NOT EXISTS tracked_keywords (
  id               TEXT        PRIMARY KEY,
  org_id           TEXT        NOT NULL DEFAULT 'default',
  keyword          TEXT        NOT NULL,
  target_url       TEXT,
  location         TEXT        NOT NULL DEFAULT 'France',
  device           TEXT        NOT NULL DEFAULT 'desktop',
  intent           TEXT,
  tag              TEXT,
  cluster_id       TEXT,
  active           BOOLEAN     NOT NULL DEFAULT true,
  current_position INTEGER,
  prev_position    INTEGER,
  position_change  INTEGER              DEFAULT 0,
  search_volume    INTEGER              DEFAULT 0,
  difficulty       INTEGER              DEFAULT 0,
  trend            TEXT                 DEFAULT 'stable',
  volatility       REAL                 DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, keyword)
);
CREATE INDEX IF NOT EXISTS tracked_keywords_org_active_idx ON tracked_keywords (org_id, active);
CREATE INDEX IF NOT EXISTS tracked_keywords_position_idx   ON tracked_keywords (org_id, current_position ASC NULLS LAST);
CREATE INDEX IF NOT EXISTS tracked_keywords_cluster_idx    ON tracked_keywords (cluster_id);
CREATE INDEX IF NOT EXISTS tracked_keywords_trend_idx      ON tracked_keywords (org_id, trend);

-- ── keyword_clusters ──────────────────────────────────────────────────────────
-- Thematic groups of keywords: /api/keywords/clusters
CREATE TABLE IF NOT EXISTS keyword_clusters (
  id          TEXT        PRIMARY KEY,
  org_id      TEXT        NOT NULL DEFAULT 'default',
  name        TEXT        NOT NULL,
  description TEXT,
  intent      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS keyword_clusters_org_idx ON keyword_clusters (org_id);

-- ── keyword_opportunities ─────────────────────────────────────────────────────
-- Detected ranking gaps: /api/keywords/opportunities
CREATE TABLE IF NOT EXISTS keyword_opportunities (
  id                TEXT        PRIMARY KEY,
  org_id            TEXT        NOT NULL DEFAULT 'default',
  type              TEXT                 DEFAULT 'ranking_gap',
  keyword           TEXT,
  title             TEXT,
  description       TEXT,
  opportunity_score INTEGER              DEFAULT 0,
  search_volume     INTEGER              DEFAULT 0,
  difficulty        INTEGER              DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS keyword_opportunities_org_idx ON keyword_opportunities (org_id, opportunity_score DESC);

-- ── ranking_alerts ────────────────────────────────────────────────────────────
-- Position change alerts: /api/keywords/alerts
CREATE TABLE IF NOT EXISTS ranking_alerts (
  id           TEXT        PRIMARY KEY,
  org_id       TEXT        NOT NULL DEFAULT 'default',
  keyword      TEXT,
  keyword_id   TEXT,
  type         TEXT        NOT NULL DEFAULT 'position_drop',
  message      TEXT,
  read         BOOLEAN     NOT NULL DEFAULT false,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ranking_alerts_org_idx  ON ranking_alerts (org_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS ranking_alerts_read_idx ON ranking_alerts (org_id, read, triggered_at DESC);

-- ── competitor_rankings ───────────────────────────────────────────────────────
-- Competitor SERP positions: /api/keywords/competitor-rankings
CREATE TABLE IF NOT EXISTS competitor_rankings (
  id                TEXT        PRIMARY KEY,
  org_id            TEXT        NOT NULL DEFAULT 'default',
  competitor_domain TEXT        NOT NULL,
  keyword           TEXT,
  position          INTEGER,
  url               TEXT,
  checked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS competitor_rankings_org_idx    ON competitor_rankings (org_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS competitor_rankings_domain_idx ON competitor_rankings (org_id, competitor_domain);

-- ── keyword_history ───────────────────────────────────────────────────────────
-- Historical position tracking: getRankingHistory()
CREATE TABLE IF NOT EXISTS keyword_history (
  id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  org_id        TEXT        NOT NULL DEFAULT 'default',
  keyword_id    TEXT        NOT NULL,
  position      INTEGER,
  search_volume INTEGER              DEFAULT 0,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS keyword_history_kw_idx ON keyword_history (org_id, keyword_id, recorded_at DESC);

-- ── user_prefs ────────────────────────────────────────────────────────────────
-- Per-org preferences: /api/me/prefs
CREATE TABLE IF NOT EXISTS user_prefs (
  org_id     TEXT        PRIMARY KEY DEFAULT 'default',
  streak     INTEGER     NOT NULL DEFAULT 0,
  pinned     JSONB       NOT NULL DEFAULT '{}',
  checklist  JSONB,
  settings   JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── automation_runs ───────────────────────────────────────────────────────────
-- Integration dispatch logs: /api/integrations/runs
CREATE TABLE IF NOT EXISTS automation_runs (
  id             TEXT        PRIMARY KEY,
  org_id         TEXT        NOT NULL DEFAULT 'default',
  integration_id TEXT,
  status         TEXT        NOT NULL DEFAULT 'pending',
  event_type     TEXT,
  payload        JSONB,
  triggered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at    TIMESTAMPTZ,
  error          TEXT,
  output         JSONB,
  attempt        INTEGER     NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS automation_runs_org_idx    ON automation_runs (org_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS automation_runs_status_idx ON automation_runs (org_id, status);
CREATE INDEX IF NOT EXISTS automation_runs_intg_idx   ON automation_runs (integration_id);

-- ── incoming_webhooks ─────────────────────────────────────────────────────────
-- User-configured webhook receivers: /api/integrations/incoming-webhooks
CREATE TABLE IF NOT EXISTS incoming_webhooks (
  id            TEXT        PRIMARY KEY,
  org_id        TEXT        NOT NULL DEFAULT 'default',
  name          TEXT        NOT NULL,
  token         TEXT        NOT NULL UNIQUE,
  source        TEXT        NOT NULL DEFAULT 'custom',
  action        TEXT        NOT NULL DEFAULT 'create_mission',
  action_config JSONB       NOT NULL DEFAULT '{}',
  active        BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS incoming_webhooks_org_idx   ON incoming_webhooks (org_id, active);
CREATE INDEX IF NOT EXISTS incoming_webhooks_token_idx ON incoming_webhooks (token);

-- ── market_trends ─────────────────────────────────────────────────────────────
-- Market intelligence trends: /api/market-intelligence
CREATE TABLE IF NOT EXISTS market_trends (
  id                TEXT        PRIMARY KEY,
  org_id            TEXT        NOT NULL DEFAULT 'default',
  keyword           TEXT        NOT NULL,
  category          TEXT,
  volume            INTEGER              DEFAULT 0,
  growth            INTEGER              DEFAULT 0,
  opportunity_score INTEGER              DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS market_trends_org_idx ON market_trends (org_id, opportunity_score DESC);

-- ── market_opportunities ──────────────────────────────────────────────────────
-- Detected market gaps: /api/market-intelligence
CREATE TABLE IF NOT EXISTS market_opportunities (
  id               TEXT        PRIMARY KEY,
  org_id           TEXT        NOT NULL DEFAULT 'default',
  type             TEXT                 DEFAULT 'content_gap',
  title            TEXT        NOT NULL,
  description      TEXT,
  score            INTEGER              DEFAULT 0,
  estimated_impact TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS market_opportunities_org_idx ON market_opportunities (org_id, score DESC);

-- ── industry_signals ──────────────────────────────────────────────────────────
-- Expirable trend signals: getMarketDashboard()
CREATE TABLE IF NOT EXISTS industry_signals (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  org_id      TEXT        NOT NULL DEFAULT 'default',
  type        TEXT        NOT NULL DEFAULT 'trend',
  title       TEXT        NOT NULL,
  description TEXT,
  severity    TEXT        NOT NULL DEFAULT 'info',
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS industry_signals_org_idx ON industry_signals (org_id, created_at DESC);

-- ── competitor_movements ──────────────────────────────────────────────────────
-- Detected SERP movements: getMarketDashboard()
CREATE TABLE IF NOT EXISTS competitor_movements (
  id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  org_id      TEXT        NOT NULL DEFAULT 'default',
  competitor  TEXT        NOT NULL,
  type        TEXT        NOT NULL DEFAULT 'ranking_gain',
  description TEXT,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS competitor_movements_org_idx ON competitor_movements (org_id, detected_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PART 3 — ENSURE org_settings EXISTS + SEED INITIAL ROWS
-- (self-contained: does not require migration 004 to have run first)
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS org_settings (
  org_id         TEXT        PRIMARY KEY DEFAULT 'default',
  plan           TEXT        NOT NULL    DEFAULT 'standard',
  email          TEXT,
  name           TEXT,
  logo_url       TEXT,
  timezone       TEXT        NOT NULL    DEFAULT 'Europe/Paris',
  language       TEXT        NOT NULL    DEFAULT 'fr',
  currency       TEXT        NOT NULL    DEFAULT 'EUR',
  monthly_budget NUMERIC,
  primary_site   TEXT,
  industry       TEXT,
  company_size   TEXT,
  billing_email  TEXT,
  trial_ends_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL    DEFAULT NOW()
);

-- Seed default org row
INSERT INTO org_settings (org_id, plan)
VALUES ('default', 'standard')
ON CONFLICT (org_id) DO NOTHING;

-- Seed default user_prefs row
INSERT INTO user_prefs (org_id)
VALUES ('default')
ON CONFLICT (org_id) DO NOTHING;

-- Seed 7 standard connectors (disconnected) if fresh
INSERT INTO connectors (id, provider, status, connected, config) VALUES
  ('conn-slack',   'slack',                 'disconnected', false, '{"webhookUrl":""}'),
  ('conn-github',  'github',                'disconnected', false, '{"org":""}'),
  ('conn-google',  'google',                'disconnected', false, '{}'),
  ('conn-gsc',     'google-search-console', 'disconnected', false, '{}'),
  ('conn-ga',      'google-analytics',      'disconnected', false, '{}'),
  ('conn-notion',  'notion',                'disconnected', false, '{}'),
  ('conn-discord', 'discord',               'disconnected', false, '{"webhookUrl":""}')
ON CONFLICT (id) DO NOTHING;
