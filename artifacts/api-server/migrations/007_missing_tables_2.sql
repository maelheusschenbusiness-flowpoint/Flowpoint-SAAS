-- Migration 007: Fix missing tables that cause 500 errors
-- Totalement idempotent — safe to run multiple times on any state.
-- Requires migrations 001-006 to have run first (standard order).
-- No hardcoded INSERTs. FK constraints added via DO blocks (safe if parent missing).

-- ── crm_field_mappings ────────────────────────────────────────────────────────
-- Used by crm-service.ts (SELECT/INSERT crm_field_mappings) but absent from
-- all previous migrations → causes HTTP 500 on every CRM route.

CREATE TABLE IF NOT EXISTS crm_field_mappings (
  id                  TEXT        NOT NULL,
  crm_integration_id  TEXT        NOT NULL,
  entity_type         TEXT        NOT NULL,
  flowpoint_field     TEXT        NOT NULL,
  crm_field           TEXT        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT crm_field_mappings_pkey PRIMARY KEY (id),
  CONSTRAINT crm_field_mappings_unique UNIQUE (crm_integration_id, entity_type, flowpoint_field)
);
CREATE INDEX IF NOT EXISTS idx_crm_field_mappings_integration
  ON crm_field_mappings (crm_integration_id);

-- Add FK separately so this file doesn't fail if crm_integrations doesn't exist
-- (e.g. running this migration standalone for testing).
DO $$ BEGIN
  ALTER TABLE crm_field_mappings
    ADD CONSTRAINT crm_field_mappings_integration_fkey
    FOREIGN KEY (crm_integration_id)
    REFERENCES crm_integrations(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object  THEN NULL;
  WHEN undefined_table   THEN NULL;
END $$;

-- ── audit_trail ───────────────────────────────────────────────────────────────
-- Historically created by ensureAuditTable() at runtime. Formalised here so it
-- exists from first boot even if that code path is never reached.

CREATE TABLE IF NOT EXISTS audit_trail (
  id           TEXT        NOT NULL,
  org_id       TEXT        NOT NULL,
  user_id      TEXT,
  action       TEXT        NOT NULL,
  target_id    TEXT,
  target_type  TEXT,
  ip_address   TEXT,
  user_agent   TEXT,
  metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  severity     TEXT        NOT NULL DEFAULT 'info',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_trail_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_audit_trail_org     ON audit_trail (org_id);
CREATE INDEX IF NOT EXISTS idx_audit_trail_action  ON audit_trail (action);
CREATE INDEX IF NOT EXISTS idx_audit_trail_created ON audit_trail (created_at DESC);

-- ── google_tokens ─────────────────────────────────────────────────────────────
-- Stores GBP/Google OAuth tokens per org (used by location sync-gbp route).
-- Separate from google_accounts (which stores connector-level OAuth).

CREATE TABLE IF NOT EXISTS google_tokens (
  id            BIGSERIAL   NOT NULL,
  org_id        TEXT        NOT NULL,
  account_id    TEXT        NOT NULL,
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT google_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT google_tokens_org_account_unique UNIQUE (org_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_google_tokens_org ON google_tokens (org_id);

-- ── seo_forecasts ─────────────────────────────────────────────────────────────
-- Persists computed forecast data from forecasting-service.ts.

CREATE TABLE IF NOT EXISTS seo_forecasts (
  id          BIGSERIAL   NOT NULL,
  org_id      TEXT        NOT NULL,
  site_url    TEXT        NOT NULL,
  data        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT seo_forecasts_pkey PRIMARY KEY (id),
  CONSTRAINT seo_forecasts_org_site_unique UNIQUE (org_id, site_url)
);
CREATE INDEX IF NOT EXISTS idx_seo_forecasts_org ON seo_forecasts (org_id);

-- ── gbp_locations ─────────────────────────────────────────────────────────────
-- Cache for Google Business Profile location data pulled via sync-gbp.

CREATE TABLE IF NOT EXISTS gbp_locations (
  id           TEXT        NOT NULL,
  org_id       TEXT        NOT NULL,
  account_id   TEXT        NOT NULL,
  name         TEXT,
  address      TEXT,
  city         TEXT,
  postal_code  TEXT,
  country      TEXT,
  latitude     NUMERIC(10,7),
  longitude    NUMERIC(10,7),
  raw_data     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gbp_locations_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_gbp_locations_org ON gbp_locations (org_id);
