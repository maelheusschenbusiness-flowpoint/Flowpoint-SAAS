-- Migration 006: Add location fields to org_settings
-- Idempotent — safe to run multiple times

ALTER TABLE org_settings
  ADD COLUMN IF NOT EXISTS address              TEXT,
  ADD COLUMN IF NOT EXISTS city                 TEXT,
  ADD COLUMN IF NOT EXISTS postal_code          TEXT,
  ADD COLUMN IF NOT EXISTS country              TEXT,
  ADD COLUMN IF NOT EXISTS latitude             NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS longitude            NUMERIC(10,7),
  ADD COLUMN IF NOT EXISTS service_area         JSONB    DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS location_configured  BOOLEAN  DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS location_source      TEXT     DEFAULT 'manual';

-- Index for faster lookups when filtering by city/country
CREATE INDEX IF NOT EXISTS idx_org_settings_city    ON org_settings (city);
CREATE INDEX IF NOT EXISTS idx_org_settings_country ON org_settings (country);
