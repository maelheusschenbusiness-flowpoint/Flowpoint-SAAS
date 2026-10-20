-- FlowPoint Dashboard Tables Migration
-- Run in Supabase SQL Editor AFTER 001_auth_tables.sql
-- Safe to re-run (all statements use IF NOT EXISTS).

-- ── Core audit & monitoring ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audits (
  id            TEXT PRIMARY KEY,
  url           TEXT NOT NULL,
  score         INTEGER NOT NULL DEFAULT 0,
  status        TEXT NOT NULL DEFAULT 'pending',
  speed         INTEGER NOT NULL DEFAULT 0,
  date          TEXT NOT NULL,
  issues        INTEGER NOT NULL DEFAULT 0,
  origin        TEXT NOT NULL DEFAULT 'manual',
  mobile_score  INTEGER,
  desktop_score INTEGER,
  lcp           REAL,
  fid           REAL,
  cls           REAL,
  ttfb          REAL,
  fcp           REAL,
  tbt           REAL,
  raw_mobile    JSONB,
  raw_desktop   JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audits_date_idx ON audits (date DESC);

CREATE TABLE IF NOT EXISTS audit_schedules (
  id          TEXT PRIMARY KEY,
  url         TEXT NOT NULL,
  frequency   TEXT NOT NULL DEFAULT 'weekly',
  next_run    TIMESTAMPTZ,
  last_run    TIMESTAMPTZ,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monitors (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  url             TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'up',
  uptime          REAL NOT NULL DEFAULT 100,
  latency         INTEGER NOT NULL DEFAULT 0,
  response_time   INTEGER,
  last_check      TEXT,
  last_checked    TEXT,
  alert_email     TEXT NOT NULL DEFAULT '',
  alert_phone     TEXT NOT NULL DEFAULT '',
  is_critical     BOOLEAN NOT NULL DEFAULT false,
  frequency       TEXT NOT NULL DEFAULT '5min',
  last_alert_sent BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS monitor_checks (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  monitor_id  TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  ok          BOOLEAN NOT NULL,
  latency     INTEGER,
  status_code INTEGER,
  checked_at  BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW()) * 1000,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS monitor_checks_monitor_id_idx ON monitor_checks (monitor_id, checked_at DESC);

-- ── Reports ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  audit_id        TEXT,
  format          TEXT NOT NULL DEFAULT 'pdf',
  white_label     BOOLEAN NOT NULL DEFAULT false,
  meeting_notes   JSONB,
  date            TEXT NOT NULL,
  date_start      TEXT,
  date_end        TEXT,
  share_url       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS share_tokens (
  token       TEXT PRIMARY KEY,
  report_id   TEXT NOT NULL,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Keywords & competitors ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS keywords (
  id            TEXT PRIMARY KEY,
  keyword       TEXT NOT NULL,
  position      INTEGER,
  prev_position INTEGER,
  volume        INTEGER,
  difficulty    INTEGER,
  url           TEXT,
  country       TEXT NOT NULL DEFAULT 'fr',
  device        TEXT NOT NULL DEFAULT 'desktop',
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS keywords_keyword_idx ON keywords (keyword);

CREATE TABLE IF NOT EXISTS competitors (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  score       INTEGER,
  traffic     INTEGER,
  keywords    INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Alert rules ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alert_rules (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  threshold       INTEGER,
  channels        JSONB NOT NULL DEFAULT '[]',
  filters         JSONB NOT NULL DEFAULT '{}',
  last_triggered  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Team ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_members (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL DEFAULT 'viewer',
  joined      TEXT NOT NULL,
  avatar      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_messages (
  id          TEXT PRIMARY KEY,
  sender_id   TEXT NOT NULL,
  content     TEXT NOT NULL,
  channel     TEXT NOT NULL DEFAULT 'general',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Notifications ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  read        BOOLEAN NOT NULL DEFAULT false,
  target_id   TEXT,
  target_type TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS notifications_read_idx ON notifications (read, created_at DESC);

-- ── Connectors ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS connectors (
  id            TEXT PRIMARY KEY,
  type          TEXT NOT NULL,
  name          TEXT NOT NULL,
  config        JSONB NOT NULL DEFAULT '{}',
  enabled       BOOLEAN NOT NULL DEFAULT true,
  last_sync     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Automation / Integrations ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS automation_workflows (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  trigger     TEXT NOT NULL,
  actions     JSONB NOT NULL DEFAULT '[]',
  enabled     BOOLEAN NOT NULL DEFAULT true,
  last_run    TIMESTAMPTZ,
  run_count   INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id            TEXT PRIMARY KEY,
  workflow_id   TEXT NOT NULL REFERENCES automation_workflows(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending',
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at   TIMESTAMPTZ,
  error         TEXT,
  output        JSONB
);

CREATE TABLE IF NOT EXISTS automation_integrations (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL DEFAULT 'default',
  platform      TEXT NOT NULL,
  name          TEXT NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  config        JSONB NOT NULL DEFAULT '{}',
  webhook_url   TEXT,
  secret        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS automation_integrations_org_idx ON automation_integrations (org_id);

CREATE TABLE IF NOT EXISTS automation_templates (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  platform    TEXT NOT NULL,
  trigger     TEXT NOT NULL,
  actions     JSONB NOT NULL DEFAULT '[]',
  active      BOOLEAN NOT NULL DEFAULT true,
  popularity  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS automation_logs (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  org_id          TEXT NOT NULL DEFAULT 'default',
  integration_id  TEXT,
  level           TEXT NOT NULL DEFAULT 'info',
  message         TEXT NOT NULL,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS automation_logs_org_idx ON automation_logs (org_id, created_at DESC);

-- ── Org addons ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_addons (
  org_id          TEXT PRIMARY KEY DEFAULT 'default',
  white_label     BOOLEAN NOT NULL DEFAULT false,
  ai_assistant    BOOLEAN NOT NULL DEFAULT false,
  advanced_reports BOOLEAN NOT NULL DEFAULT false,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Behavioral tracking ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS behavior_events (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  session_id  TEXT NOT NULL,
  site_id     TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  url         TEXT,
  data        JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS behavior_events_session_idx ON behavior_events (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS behavior_events_site_idx ON behavior_events (site_id, created_at DESC);

CREATE TABLE IF NOT EXISTS behavior_sessions (
  id          TEXT PRIMARY KEY,
  site_id     TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at    TIMESTAMPTZ,
  page_views  INTEGER NOT NULL DEFAULT 0,
  duration    INTEGER,
  device      TEXT,
  country     TEXT,
  referrer    TEXT
);
CREATE INDEX IF NOT EXISTS behavior_sessions_site_idx ON behavior_sessions (site_id, started_at DESC);

CREATE TABLE IF NOT EXISTS behavior_insights (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  site_id     TEXT NOT NULL,
  type        TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS behavior_site_tokens (
  site_id     TEXT PRIMARY KEY,
  token       TEXT NOT NULL UNIQUE,
  domain      TEXT NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── CRO ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cro_recommendations (
  id          TEXT PRIMARY KEY,
  site_url    TEXT NOT NULL,
  type        TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  impact      TEXT,
  effort      TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cro_scores (
  id          TEXT PRIMARY KEY,
  site_url    TEXT NOT NULL,
  score       INTEGER NOT NULL,
  breakdown   JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cro_experiments (
  id            TEXT PRIMARY KEY,
  site_url      TEXT NOT NULL,
  name          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'draft',
  variant_a     JSONB,
  variant_b     JSONB,
  winner        TEXT,
  started_at    TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Revenue leaks ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS revenue_leaks (
  id            TEXT PRIMARY KEY,
  site_url      TEXT,
  type          TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  impact        REAL,
  currency      TEXT NOT NULL DEFAULT 'EUR',
  status        TEXT NOT NULL DEFAULT 'open',
  resolved_at   TIMESTAMPTZ,
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── White-label / Report templates ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_templates (
  id                      TEXT PRIMARY KEY,
  org_id                  TEXT NOT NULL DEFAULT 'default',
  name                    TEXT NOT NULL,
  logo_url                TEXT,
  primary_color           TEXT NOT NULL DEFAULT '#2563EB',
  secondary_color         TEXT NOT NULL DEFAULT '#22c55e',
  font                    TEXT NOT NULL DEFAULT 'Inter',
  footer_text             TEXT,
  header_text             TEXT,
  hide_flowpoint_branding BOOLEAN NOT NULL DEFAULT false,
  is_default              BOOLEAN NOT NULL DEFAULT false,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custom_domains (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL DEFAULT 'default',
  domain      TEXT NOT NULL UNIQUE,
  verified    BOOLEAN NOT NULL DEFAULT false,
  ssl_active  BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_exports (
  id          TEXT PRIMARY KEY,
  report_id   TEXT NOT NULL,
  format      TEXT NOT NULL DEFAULT 'pdf',
  url         TEXT,
  status      TEXT NOT NULL DEFAULT 'pending',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── AI usage tracking ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  org_id          TEXT NOT NULL DEFAULT 'default',
  model           TEXT NOT NULL,
  prompt_tokens   INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens    INTEGER NOT NULL DEFAULT 0,
  cost_usd        REAL,
  feature         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_usage_logs_org_idx ON ai_usage_logs (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_monthly_usage (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  org_id          TEXT NOT NULL DEFAULT 'default',
  month           TEXT NOT NULL,
  total_tokens    INTEGER NOT NULL DEFAULT 0,
  total_cost_usd  REAL NOT NULL DEFAULT 0,
  request_count   INTEGER NOT NULL DEFAULT 0,
  UNIQUE(org_id, month)
);

CREATE TABLE IF NOT EXISTS ai_alerts (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  org_id      TEXT NOT NULL DEFAULT 'default',
  type        TEXT NOT NULL,
  threshold   REAL,
  triggered   BOOLEAN NOT NULL DEFAULT false,
  triggered_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Missions ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS missions (
  id                          TEXT PRIMARY KEY,
  org_id                      TEXT NOT NULL DEFAULT 'default',
  title                       TEXT NOT NULL,
  description                 TEXT,
  category                    TEXT,
  type                        TEXT,
  priority                    TEXT NOT NULL DEFAULT 'medium',
  priority_score              INTEGER NOT NULL DEFAULT 0,
  status                      TEXT NOT NULL DEFAULT 'todo',
  impact                      TEXT,
  effort                      TEXT,
  estimated_traffic_impact    INTEGER,
  estimated_revenue_impact    REAL,
  estimated_seo_impact        INTEGER,
  estimated_conversion_impact REAL,
  difficulty_score            INTEGER,
  business_impact_score       INTEGER,
  ai_explanation              TEXT,
  ai_action_steps             JSONB,
  ai_quick_win                BOOLEAN NOT NULL DEFAULT false,
  ai_reasoning                TEXT,
  ai_summary                  TEXT,
  source_type                 TEXT,
  source_data                 JSONB,
  steps                       JSONB NOT NULL DEFAULT '[]',
  due_date                    TEXT,
  completed_at                TIMESTAMPTZ,
  dismissed_at                TIMESTAMPTZ,
  last_refreshed_at           TIMESTAMPTZ,
  history                     JSONB NOT NULL DEFAULT '[]',
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS missions_org_status_idx ON missions (org_id, status, priority_score DESC);

CREATE TABLE IF NOT EXISTS mission_history (
  id          TEXT PRIMARY KEY,
  mission_id  TEXT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  org_id      TEXT NOT NULL DEFAULT 'default',
  action      TEXT NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mission_ai_logs (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  org_id      TEXT NOT NULL DEFAULT 'default',
  model       TEXT,
  prompt      TEXT,
  response    JSONB,
  tokens_used INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── CRM ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crm_integrations (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL DEFAULT 'default',
  provider      TEXT NOT NULL,
  access_token  TEXT,
  refresh_token TEXT,
  expires_at    TIMESTAMPTZ,
  portal_id     TEXT,
  scope         TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS crm_integrations_org_idx ON crm_integrations (org_id);

CREATE TABLE IF NOT EXISTS crm_sync_logs (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  org_id          TEXT NOT NULL DEFAULT 'default',
  provider        TEXT NOT NULL,
  entity_type     TEXT NOT NULL DEFAULT 'contacts',
  status          TEXT NOT NULL DEFAULT 'pending',
  records_synced  INTEGER NOT NULL DEFAULT 0,
  error           TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS crm_sync_logs_org_idx ON crm_sync_logs (org_id, started_at DESC);

-- ── SSO ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sso_providers (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL DEFAULT 'default',
  provider      TEXT NOT NULL,
  client_id     TEXT,
  client_secret TEXT,
  metadata_url  TEXT,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sso_providers_org_idx ON sso_providers (org_id);

CREATE TABLE IF NOT EXISTS org_auth_config (
  org_id                TEXT PRIMARY KEY DEFAULT 'default',
  require_sso           BOOLEAN NOT NULL DEFAULT false,
  allowed_domains       TEXT[],
  session_duration_mins INTEGER NOT NULL DEFAULT 1440,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS login_audits (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  org_id      TEXT NOT NULL DEFAULT 'default',
  email       TEXT,
  provider    TEXT,
  success     BOOLEAN NOT NULL,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS login_audits_org_idx ON login_audits (org_id, created_at DESC);

-- ── Review intelligence ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS review_analysis (
  id            TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL DEFAULT 'default',
  location_id   TEXT,
  author_name   TEXT,
  rating        INTEGER,
  review_text   TEXT,
  sentiment     TEXT,
  language      TEXT NOT NULL DEFAULT 'fr',
  reply_status  TEXT NOT NULL DEFAULT 'pending',
  replied_at    TIMESTAMPTZ,
  reviewed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  analysis      JSONB
);
CREATE INDEX IF NOT EXISTS review_analysis_org_idx ON review_analysis (org_id, reviewed_at DESC);

CREATE TABLE IF NOT EXISTS review_alerts (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  org_id      TEXT NOT NULL DEFAULT 'default',
  review_id   TEXT,
  type        TEXT NOT NULL,
  message     TEXT,
  resolved    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
