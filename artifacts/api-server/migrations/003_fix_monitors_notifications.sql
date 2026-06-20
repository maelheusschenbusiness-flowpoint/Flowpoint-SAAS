-- FlowPoint Migration 003 — Fix monitors table + add notifications
-- Run in Supabase SQL Editor after 001 and 002.
-- Safe to re-run (IF NOT EXISTS / OR REPLACE guards everywhere).

-- ── monitors : exact match with Drizzle schema in lib/db/src/index.ts ─────────
-- Drop incorrect table if it was created by migration 002 with wrong columns,
-- then recreate with the exact schema Drizzle expects.
-- WARNING: this drops existing monitor rows if the table exists.
DO $$ BEGIN
  -- Only drop+recreate if the columns don't match (detect by presence of wrong column)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'monitors' AND column_name IN ('response_time', 'last_checked')
  ) THEN
    DROP TABLE IF EXISTS monitor_checks CASCADE;
    DROP TABLE IF EXISTS monitors CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS monitors (
  id              TEXT        PRIMARY KEY,
  name            TEXT        NOT NULL,
  url             TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'up',
  uptime          REAL        NOT NULL DEFAULT 100,
  latency         INTEGER     NOT NULL DEFAULT 0,
  last_check      TEXT,
  alert_email     TEXT                 DEFAULT '',
  alert_phone     TEXT                 DEFAULT '',
  is_critical     BOOLEAN     NOT NULL DEFAULT false,
  frequency       TEXT        NOT NULL DEFAULT '5min',
  last_alert_sent TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monitor_checks (
  id          TEXT    PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  monitor_id  TEXT    NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  checked_at  BIGINT  NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
  ok          BOOLEAN NOT NULL,
  latency     INTEGER          DEFAULT 0,
  status_code INTEGER,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS monitor_checks_monitor_idx
  ON monitor_checks (monitor_id, checked_at DESC);

-- ── notifications : exact match with Drizzle schema ───────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT        PRIMARY KEY,
  type       TEXT        NOT NULL DEFAULT 'info',
  title      TEXT        NOT NULL,
  message    TEXT        NOT NULL,
  read       BOOLEAN     NOT NULL DEFAULT false,
  link       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_read_idx
  ON notifications (read, created_at DESC);
