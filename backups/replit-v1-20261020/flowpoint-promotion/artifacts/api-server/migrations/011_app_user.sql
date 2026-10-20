-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 011 — Create app_user role for RLS enforcement
--
-- Creates a non-superuser, non-BYPASSRLS role that the application uses
-- when executing tenant-scoped queries.  When running as app_user, PostgreSQL
-- evaluates every RLS policy defined in migration 010.
--
-- Safe to run multiple times (idempotent).
-- ─────────────────────────────────────────────────────────────────────────────

SET client_min_messages = WARNING;

-- ── STEP 1: Create the role ───────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user
      NOLOGIN
      NOINHERIT
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOREPLICATION;
  END IF;
END $$;

-- ── STEP 2: Database-level CONNECT ────────────────────────────────────────────
DO $$
DECLARE db_name text;
BEGIN
  SELECT current_database() INTO db_name;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_user', db_name);
END $$;

-- ── STEP 3: Schema usage ──────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO app_user;

-- ── STEP 4: Table privileges on all existing tables ──────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

-- ── STEP 5: Sequence privileges ───────────────────────────────────────────────
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- ── STEP 6: Default privileges for future tables / sequences ─────────────────
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_user;
