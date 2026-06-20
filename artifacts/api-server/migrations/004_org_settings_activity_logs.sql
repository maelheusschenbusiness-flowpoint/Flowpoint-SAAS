-- FlowPoint Migration 004 — org_settings + activity_logs
-- Run in Supabase SQL Editor after 001, 002, 003.
-- Safe to re-run (IF NOT EXISTS everywhere).

-- ── org_settings ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_settings (
  org_id          TEXT        PRIMARY KEY DEFAULT 'default',
  plan            TEXT        NOT NULL    DEFAULT 'standard',
  email           TEXT,
  name            TEXT,
  logo_url        TEXT,
  timezone        TEXT        NOT NULL    DEFAULT 'Europe/Paris',
  language        TEXT        NOT NULL    DEFAULT 'fr',
  currency        TEXT        NOT NULL    DEFAULT 'EUR',
  monthly_budget  NUMERIC,
  primary_site    TEXT,
  industry        TEXT,
  company_size    TEXT,
  billing_email   TEXT,
  trial_ends_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL    DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL    DEFAULT NOW()
);

-- Seed default row if table is empty
INSERT INTO org_settings (org_id, plan)
VALUES ('default', 'standard')
ON CONFLICT (org_id) DO NOTHING;

-- ── activity_logs ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_logs (
  id              TEXT        PRIMARY KEY,
  type            TEXT        NOT NULL    DEFAULT 'info',
  label           TEXT        NOT NULL,
  target_id       TEXT,
  target_type     TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL    DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_type       ON activity_logs (type);
