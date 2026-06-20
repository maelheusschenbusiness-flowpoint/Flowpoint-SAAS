-- Migration 007: Fix missing tables that cause 500 errors
-- Idempotent — safe to run multiple times

-- ── crm_field_mappings ────────────────────────────────────────────────────────
-- Used by crm-service.ts but absent from all previous migrations.
CREATE TABLE IF NOT EXISTS crm_field_mappings (
  id                  TEXT        PRIMARY KEY,
  crm_integration_id  TEXT        NOT NULL REFERENCES crm_integrations(id) ON DELETE CASCADE,
  entity_type         TEXT        NOT NULL,
  flowpoint_field     TEXT        NOT NULL,
  crm_field           TEXT        NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (crm_integration_id, entity_type, flowpoint_field)
);
CREATE INDEX IF NOT EXISTS idx_crm_field_mappings_integration ON crm_field_mappings (crm_integration_id);

-- ── audit_trail ───────────────────────────────────────────────────────────────
-- Historically created programmatically by ensureAuditTable(); formalized here
-- so it exists from first boot without a code path triggering ensureAuditTable.
CREATE TABLE IF NOT EXISTS audit_trail (
  id           TEXT        PRIMARY KEY,
  org_id       TEXT        NOT NULL,
  user_id      TEXT,
  action       TEXT        NOT NULL,
  target_id    TEXT,
  target_type  TEXT,
  ip_address   TEXT,
  user_agent   TEXT,
  metadata     JSONB       DEFAULT '{}'::jsonb,
  severity     TEXT        DEFAULT 'info',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_trail_org    ON audit_trail (org_id);
CREATE INDEX IF NOT EXISTS idx_audit_trail_action ON audit_trail (action);
CREATE INDEX IF NOT EXISTS idx_audit_trail_created ON audit_trail (created_at DESC);

-- ── google_tokens (alias for google_accounts used in location sync-gbp) ───────
-- Some code references google_tokens; ensure it exists as a view or synonym.
CREATE TABLE IF NOT EXISTS google_tokens (
  id            SERIAL      PRIMARY KEY,
  org_id        TEXT        NOT NULL,
  account_id    TEXT        NOT NULL,
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_google_tokens_org ON google_tokens (org_id);

-- ── seo_forecasts (used by forecast route) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS seo_forecasts (
  id         SERIAL      PRIMARY KEY,
  org_id     TEXT        NOT NULL,
  site_url   TEXT        NOT NULL,
  data       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, site_url)
);
CREATE INDEX IF NOT EXISTS idx_seo_forecasts_org ON seo_forecasts (org_id);

-- ── gbp_locations (for GBP data caching) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS gbp_locations (
  id           TEXT        PRIMARY KEY,
  org_id       TEXT        NOT NULL,
  account_id   TEXT        NOT NULL,
  name         TEXT,
  address      TEXT,
  city         TEXT,
  postal_code  TEXT,
  country      TEXT,
  latitude     NUMERIC(10,7),
  longitude    NUMERIC(10,7),
  raw_data     JSONB       DEFAULT '{}'::jsonb,
  synced_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gbp_locations_org ON gbp_locations (org_id);
