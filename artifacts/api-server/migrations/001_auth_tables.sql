-- FlowPoint Auth Tables Migration
-- Run once against your Supabase/PostgreSQL database.
-- Safe to re-run (uses IF NOT EXISTS).

-- ── Magic link tokens (one-time login links) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS magic_link_tokens (
  token       TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-purge expired tokens
CREATE INDEX IF NOT EXISTS magic_link_tokens_expires_at_idx ON magic_link_tokens (expires_at);

-- ── User sessions (auth cookies) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  org_id      TEXT NOT NULL DEFAULT 'default',
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'member',
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx ON user_sessions (expires_at);
