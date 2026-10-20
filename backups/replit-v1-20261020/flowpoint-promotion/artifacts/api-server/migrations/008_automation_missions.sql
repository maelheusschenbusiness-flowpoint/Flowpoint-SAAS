-- Migration 008: automation_workflows, workflow_runs, missions, mission_history,
--               mission_ai_logs, automation_integrations, automation_logs,
--               automation_runs, incoming_webhooks
-- Totally idempotent — safe to run multiple times on any state.
-- No hardcoded INSERTs. CREATE TABLE IF NOT EXISTS throughout.

-- ── automation_integrations ───────────────────────────────────────────────────
-- Referenced by automation_logs, automation_runs FK (added via DO block).
-- Create first so FK blocks below can reference it.

CREATE TABLE IF NOT EXISTS automation_integrations (
  id            TEXT        NOT NULL,
  org_id        TEXT        NOT NULL,
  name          TEXT        NOT NULL DEFAULT '',
  type          TEXT        NOT NULL DEFAULT 'outgoing',
  platform      TEXT        NOT NULL DEFAULT 'custom',
  endpoint_url  TEXT,
  secret_key    TEXT,
  headers       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  events        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  active        BOOLEAN     NOT NULL DEFAULT true,
  metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  timeout_ms    INTEGER              DEFAULT 10000,
  max_retries   INTEGER              DEFAULT 3,
  retry_enabled BOOLEAN              DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT automation_integrations_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_ai_org      ON automation_integrations (org_id);
CREATE INDEX IF NOT EXISTS idx_ai_platform ON automation_integrations (platform);

-- ── automation_workflows ──────────────────────────────────────────────────────
-- Core table for the automation engine (ensureDefaultWorkflows seeds it).

CREATE TABLE IF NOT EXISTS automation_workflows (
  id             TEXT        NOT NULL,
  org_id         TEXT        NOT NULL,
  name           TEXT        NOT NULL DEFAULT '',
  icon           TEXT                 DEFAULT '⚡',
  description    TEXT,
  trigger_type   TEXT        NOT NULL DEFAULT 'schedule',
  trigger_config JSONB       NOT NULL DEFAULT '{}'::jsonb,
  actions        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  enabled        BOOLEAN     NOT NULL DEFAULT true,
  runs_count     INTEGER     NOT NULL DEFAULT 0,
  last_run_at    TIMESTAMPTZ,
  category       TEXT                 DEFAULT 'Général',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT automation_workflows_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_aw_org     ON automation_workflows (org_id);
CREATE INDEX IF NOT EXISTS idx_aw_enabled ON automation_workflows (org_id, enabled);

-- ── workflow_runs ─────────────────────────────────────────────────────────────
-- One row per workflow execution (inserted by executeWorkflow).

CREATE TABLE IF NOT EXISTS workflow_runs (
  id              TEXT        NOT NULL,
  workflow_id     TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'running',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at        TIMESTAMPTZ,
  duration_ms     INTEGER,
  steps_completed INTEGER              DEFAULT 0,
  error           TEXT,
  CONSTRAINT workflow_runs_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_wr_workflow   ON workflow_runs (workflow_id);
CREATE INDEX IF NOT EXISTS idx_wr_started_at ON workflow_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_wr_status     ON workflow_runs (status);

DO $$ BEGIN
  ALTER TABLE workflow_runs
    ADD CONSTRAINT workflow_runs_workflow_fkey
    FOREIGN KEY (workflow_id)
    REFERENCES automation_workflows(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table  THEN NULL;
END $$;

-- ── automation_logs ───────────────────────────────────────────────────────────
-- Logs per integration (GET /api/integrations/automation-logs).

CREATE TABLE IF NOT EXISTS automation_logs (
  id             TEXT        NOT NULL,
  org_id         TEXT        NOT NULL,
  integration_id TEXT,
  level          TEXT        NOT NULL DEFAULT 'info',
  message        TEXT,
  metadata       JSONB                DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT automation_logs_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_al_org           ON automation_logs (org_id);
CREATE INDEX IF NOT EXISTS idx_al_integration   ON automation_logs (integration_id);
CREATE INDEX IF NOT EXISTS idx_al_created       ON automation_logs (created_at DESC);

DO $$ BEGIN
  ALTER TABLE automation_logs
    ADD CONSTRAINT automation_logs_integration_fkey
    FOREIGN KEY (integration_id)
    REFERENCES automation_integrations(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table  THEN NULL;
END $$;

-- ── automation_runs ───────────────────────────────────────────────────────────
-- Execution history per integration (GET /api/integrations/runs).

CREATE TABLE IF NOT EXISTS automation_runs (
  id             TEXT        NOT NULL,
  org_id         TEXT        NOT NULL,
  integration_id TEXT,
  status         TEXT        NOT NULL DEFAULT 'success',
  triggered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data           JSONB                DEFAULT '{}'::jsonb,
  CONSTRAINT automation_runs_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_ar_org         ON automation_runs (org_id);
CREATE INDEX IF NOT EXISTS idx_ar_integration ON automation_runs (integration_id);
CREATE INDEX IF NOT EXISTS idx_ar_triggered   ON automation_runs (triggered_at DESC);

DO $$ BEGIN
  ALTER TABLE automation_runs
    ADD CONSTRAINT automation_runs_integration_fkey
    FOREIGN KEY (integration_id)
    REFERENCES automation_integrations(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table  THEN NULL;
END $$;

-- ── incoming_webhooks ─────────────────────────────────────────────────────────
-- Configured inbound webhook listeners (GET /api/integrations/incoming-webhooks).

CREATE TABLE IF NOT EXISTS incoming_webhooks (
  id            TEXT        NOT NULL,
  org_id        TEXT        NOT NULL,
  name          TEXT        NOT NULL DEFAULT '',
  token         TEXT        NOT NULL,
  source        TEXT,
  action        TEXT,
  action_config JSONB                DEFAULT '{}'::jsonb,
  active        BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT incoming_webhooks_pkey PRIMARY KEY (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_iw_token ON incoming_webhooks (token);
CREATE INDEX        IF NOT EXISTS idx_iw_org   ON incoming_webhooks (org_id);

-- ── missions ──────────────────────────────────────────────────────────────────
-- Core mission management table (routes/missions.ts + services/mission-engine.ts).
-- Status values used in code: 'todo', 'open', 'in_progress', 'done', 'dismissed', 'stale'.

CREATE TABLE IF NOT EXISTS missions (
  id                          TEXT        NOT NULL,
  org_id                      TEXT        NOT NULL,
  title                       TEXT        NOT NULL,
  description                 TEXT,
  category                    TEXT        NOT NULL DEFAULT 'seo',
  type                        TEXT                 DEFAULT 'seo',
  priority                    TEXT                 DEFAULT 'medium',
  priority_score              INTEGER              DEFAULT 50,
  status                      TEXT        NOT NULL DEFAULT 'todo',
  impact                      TEXT,
  effort                      TEXT,
  steps                       JSONB                DEFAULT '[]'::jsonb,
  due_date                    TIMESTAMPTZ,
  source_type                 TEXT                 DEFAULT 'manual',
  source_data                 JSONB,
  estimated_traffic_impact    NUMERIC,
  estimated_revenue_impact    NUMERIC,
  estimated_seo_impact        NUMERIC,
  estimated_conversion_impact NUMERIC,
  difficulty_score            INTEGER,
  business_impact_score       INTEGER,
  ai_explanation              TEXT,
  ai_action_steps             JSONB                DEFAULT '[]'::jsonb,
  ai_quick_win                BOOLEAN              DEFAULT false,
  ai_reasoning                TEXT,
  ai_summary                  TEXT,
  completed_at                TIMESTAMPTZ,
  dismissed_at                TIMESTAMPTZ,
  last_refreshed_at           TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT missions_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_missions_org          ON missions (org_id);
CREATE INDEX IF NOT EXISTS idx_missions_status       ON missions (org_id, status);
CREATE INDEX IF NOT EXISTS idx_missions_priority     ON missions (org_id, priority_score DESC);
CREATE INDEX IF NOT EXISTS idx_missions_quick_win    ON missions (org_id, ai_quick_win) WHERE ai_quick_win = true;
CREATE INDEX IF NOT EXISTS idx_missions_due          ON missions (due_date ASC NULLS LAST);

-- ── mission_history ───────────────────────────────────────────────────────────
-- Audit trail for mission status transitions (DELETE cascade on mission delete).

CREATE TABLE IF NOT EXISTS mission_history (
  id          TEXT        NOT NULL,
  mission_id  TEXT        NOT NULL,
  org_id      TEXT        NOT NULL,
  action      TEXT        NOT NULL,
  from_status TEXT,
  to_status   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mission_history_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_mh_mission ON mission_history (mission_id);
CREATE INDEX IF NOT EXISTS idx_mh_org     ON mission_history (org_id);

DO $$ BEGIN
  ALTER TABLE mission_history
    ADD CONSTRAINT mission_history_mission_fkey
    FOREIGN KEY (mission_id)
    REFERENCES missions(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_table  THEN NULL;
END $$;

-- ── mission_ai_logs ───────────────────────────────────────────────────────────
-- Stores AI generation run logs (GET /api/missions/logs).

CREATE TABLE IF NOT EXISTS mission_ai_logs (
  id         TEXT        NOT NULL,
  org_id     TEXT        NOT NULL,
  trigger    TEXT                 DEFAULT 'manual',
  inserted   INTEGER              DEFAULT 0,
  skipped    INTEGER              DEFAULT 0,
  message    TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mission_ai_logs_pkey PRIMARY KEY (id)
);
CREATE INDEX IF NOT EXISTS idx_mal_org ON mission_ai_logs (org_id);
