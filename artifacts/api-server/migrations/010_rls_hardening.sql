-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration 010: Row Level Security (RLS) Hardening
-- All tenant-data tables get RLS enabled with org_id isolation policies.
-- Strategy:
--   1. Add org_id to tables that are missing it (idempotent via IF NOT EXISTS).
--   2. Enable RLS on every tenant table.
--   3. Policy: service_role bypasses RLS automatically (no explicit policy needed).
--   4. Policy: authenticated role may only see rows where
--              org_id = current_setting('app.current_org_id', true)
--   5. Truly global tables (tokens, behavior events) get RLS enabled but
--      restrict direct external access via anon role.
--
-- NOTE: The API server must execute
--       SET LOCAL app.current_org_id = '<orgId>';
--       inside each transaction (or connection) before any DML.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Helper: create a standard per-org RLS policy ─────────────────────────────
-- We use a DO block so this file is idempotent on repeated runs.

DO $$
BEGIN

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 1: Add org_id to tables that are missing it
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE IF EXISTS audits
  ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE IF EXISTS audit_schedules
  ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE IF EXISTS alert_rules
  ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE IF EXISTS monitors
  ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE IF EXISTS monitor_checks
  ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE IF EXISTS competitors
  ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE IF EXISTS keywords
  ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE IF EXISTS reports
  ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE IF EXISTS report_exports
  ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE IF EXISTS notifications
  ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE IF EXISTS team_members
  ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE IF EXISTS team_messages
  ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE IF EXISTS connectors
  ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE IF EXISTS cro_experiments
  ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE IF EXISTS cro_recommendations
  ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE IF EXISTS cro_scores
  ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE IF EXISTS revenue_leaks
  ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE IF EXISTS workflow_runs
  ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE IF EXISTS automation_templates
  ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';

ALTER TABLE IF EXISTS activity_logs
  ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 2: Create indexes on new org_id columns (perf for policy evaluation)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_audits_org_id           ON audits (org_id);
CREATE INDEX IF NOT EXISTS idx_audit_schedules_org_id  ON audit_schedules (org_id);
CREATE INDEX IF NOT EXISTS idx_alert_rules_org_id      ON alert_rules (org_id);
CREATE INDEX IF NOT EXISTS idx_monitors_org_id         ON monitors (org_id);
CREATE INDEX IF NOT EXISTS idx_monitor_checks_org_id   ON monitor_checks (org_id);
CREATE INDEX IF NOT EXISTS idx_competitors_org_id      ON competitors (org_id);
CREATE INDEX IF NOT EXISTS idx_keywords_org_id         ON keywords (org_id);
CREATE INDEX IF NOT EXISTS idx_reports_org_id          ON reports (org_id);
CREATE INDEX IF NOT EXISTS idx_report_exports_org_id   ON report_exports (org_id);
CREATE INDEX IF NOT EXISTS idx_notifications_org_id    ON notifications (org_id);
CREATE INDEX IF NOT EXISTS idx_team_members_org_id     ON team_members (org_id);
CREATE INDEX IF NOT EXISTS idx_team_messages_org_id    ON team_messages (org_id);
CREATE INDEX IF NOT EXISTS idx_connectors_org_id       ON connectors (org_id);
CREATE INDEX IF NOT EXISTS idx_cro_experiments_org_id  ON cro_experiments (org_id);
CREATE INDEX IF NOT EXISTS idx_cro_scores_org_id       ON cro_scores (org_id);
CREATE INDEX IF NOT EXISTS idx_revenue_leaks_org_id    ON revenue_leaks (org_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_org_id    ON workflow_runs (org_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_org_id    ON activity_logs (org_id);

END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 3: Enable RLS + per-org policies on all tenant tables
-- ─────────────────────────────────────────────────────────────────────────────

-- Macro pattern per table:
--   ALTER TABLE t ENABLE ROW LEVEL SECURITY;
--   ALTER TABLE t FORCE ROW LEVEL SECURITY;          -- also applies to table owner
--   DROP POLICY IF EXISTS rls_org_isolation ON t;
--   CREATE POLICY rls_org_isolation ON t
--     USING (org_id = current_setting('app.current_org_id', true));

-- ── Tables WITH org_id (original schema) ─────────────────────────────────────

ALTER TABLE ai_alerts               ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_alerts               FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON ai_alerts;
CREATE POLICY rls_org_isolation ON ai_alerts
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE ai_credit_purchases     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_credit_purchases     FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON ai_credit_purchases;
CREATE POLICY rls_org_isolation ON ai_credit_purchases
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE ai_monthly_usage        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_monthly_usage        FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON ai_monthly_usage;
CREATE POLICY rls_org_isolation ON ai_monthly_usage
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE ai_usage_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_logs           FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON ai_usage_logs;
CREATE POLICY rls_org_isolation ON ai_usage_logs
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE audit_trail             ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_trail             FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON audit_trail;
CREATE POLICY rls_org_isolation ON audit_trail
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE automation_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_integrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON automation_integrations;
CREATE POLICY rls_org_isolation ON automation_integrations
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE automation_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_logs         FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON automation_logs;
CREATE POLICY rls_org_isolation ON automation_logs
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE automation_runs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runs         FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON automation_runs;
CREATE POLICY rls_org_isolation ON automation_runs
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE automation_workflows    ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_workflows    FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON automation_workflows;
CREATE POLICY rls_org_isolation ON automation_workflows
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE competitor_movements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_movements    FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON competitor_movements;
CREATE POLICY rls_org_isolation ON competitor_movements
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE competitor_rankings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_rankings     FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON competitor_rankings;
CREATE POLICY rls_org_isolation ON competitor_rankings
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE crm_integrations        ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_integrations        FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON crm_integrations;
CREATE POLICY rls_org_isolation ON crm_integrations
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE crm_sync_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_sync_logs           FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON crm_sync_logs;
CREATE POLICY rls_org_isolation ON crm_sync_logs
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE custom_domains          ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_domains          FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON custom_domains;
CREATE POLICY rls_org_isolation ON custom_domains
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE gbp_locations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE gbp_locations           FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON gbp_locations;
CREATE POLICY rls_org_isolation ON gbp_locations
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE google_tokens           ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_tokens           FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON google_tokens;
CREATE POLICY rls_org_isolation ON google_tokens
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE incoming_webhooks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE incoming_webhooks       FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON incoming_webhooks;
CREATE POLICY rls_org_isolation ON incoming_webhooks
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE industry_signals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE industry_signals        FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON industry_signals;
CREATE POLICY rls_org_isolation ON industry_signals
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE keyword_clusters        ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_clusters        FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON keyword_clusters;
CREATE POLICY rls_org_isolation ON keyword_clusters
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE keyword_history         ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_history         FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON keyword_history;
CREATE POLICY rls_org_isolation ON keyword_history
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE keyword_opportunities   ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_opportunities   FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON keyword_opportunities;
CREATE POLICY rls_org_isolation ON keyword_opportunities
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE login_audits            ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_audits            FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON login_audits;
CREATE POLICY rls_org_isolation ON login_audits
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE market_opportunities    ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_opportunities    FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON market_opportunities;
CREATE POLICY rls_org_isolation ON market_opportunities
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE market_trends           ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_trends           FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON market_trends;
CREATE POLICY rls_org_isolation ON market_trends
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE mission_ai_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission_ai_logs         FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON mission_ai_logs;
CREATE POLICY rls_org_isolation ON mission_ai_logs
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE mission_history         ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission_history         FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON mission_history;
CREATE POLICY rls_org_isolation ON mission_history
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE missions                ENABLE ROW LEVEL SECURITY;
ALTER TABLE missions                FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON missions;
CREATE POLICY rls_org_isolation ON missions
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE org_addons              ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_addons              FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON org_addons;
CREATE POLICY rls_org_isolation ON org_addons
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE org_auth_config         ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_auth_config         FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON org_auth_config;
CREATE POLICY rls_org_isolation ON org_auth_config
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE org_settings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_settings            FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON org_settings;
CREATE POLICY rls_org_isolation ON org_settings
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE ranking_alerts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranking_alerts          FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON ranking_alerts;
CREATE POLICY rls_org_isolation ON ranking_alerts
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE report_templates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_templates        FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON report_templates;
CREATE POLICY rls_org_isolation ON report_templates
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE review_alerts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_alerts           FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON review_alerts;
CREATE POLICY rls_org_isolation ON review_alerts
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE review_analysis         ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_analysis         FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON review_analysis;
CREATE POLICY rls_org_isolation ON review_analysis
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE seo_forecasts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_forecasts           FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON seo_forecasts;
CREATE POLICY rls_org_isolation ON seo_forecasts
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE sso_providers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sso_providers           FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON sso_providers;
CREATE POLICY rls_org_isolation ON sso_providers
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE tracked_keywords        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracked_keywords        FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON tracked_keywords;
CREATE POLICY rls_org_isolation ON tracked_keywords
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE user_prefs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_prefs              FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON user_prefs;
CREATE POLICY rls_org_isolation ON user_prefs
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE user_sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions           FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON user_sessions;
CREATE POLICY rls_org_isolation ON user_sessions
  USING (org_id = current_setting('app.current_org_id', true));

-- ── Tables that received org_id via STEP 1 above ─────────────────────────────

ALTER TABLE audits                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audits                  FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON audits;
CREATE POLICY rls_org_isolation ON audits
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE audit_schedules         ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_schedules         FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON audit_schedules;
CREATE POLICY rls_org_isolation ON audit_schedules
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE alert_rules             ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_rules             FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON alert_rules;
CREATE POLICY rls_org_isolation ON alert_rules
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE monitors                ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitors                FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON monitors;
CREATE POLICY rls_org_isolation ON monitors
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE monitor_checks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_checks          FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON monitor_checks;
CREATE POLICY rls_org_isolation ON monitor_checks
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE competitors             ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors             FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON competitors;
CREATE POLICY rls_org_isolation ON competitors
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE keywords                ENABLE ROW LEVEL SECURITY;
ALTER TABLE keywords                FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON keywords;
CREATE POLICY rls_org_isolation ON keywords
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE reports                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports                 FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON reports;
CREATE POLICY rls_org_isolation ON reports
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE report_exports          ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_exports          FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON report_exports;
CREATE POLICY rls_org_isolation ON report_exports
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE notifications           ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications           FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON notifications;
CREATE POLICY rls_org_isolation ON notifications
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE team_members            ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members            FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON team_members;
CREATE POLICY rls_org_isolation ON team_members
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE team_messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_messages           FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON team_messages;
CREATE POLICY rls_org_isolation ON team_messages
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE connectors              ENABLE ROW LEVEL SECURITY;
ALTER TABLE connectors              FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON connectors;
CREATE POLICY rls_org_isolation ON connectors
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE cro_experiments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE cro_experiments         FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON cro_experiments;
CREATE POLICY rls_org_isolation ON cro_experiments
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE cro_recommendations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cro_recommendations     FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON cro_recommendations;
CREATE POLICY rls_org_isolation ON cro_recommendations
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE cro_scores              ENABLE ROW LEVEL SECURITY;
ALTER TABLE cro_scores              FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON cro_scores;
CREATE POLICY rls_org_isolation ON cro_scores
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE revenue_leaks           ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_leaks           FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON revenue_leaks;
CREATE POLICY rls_org_isolation ON revenue_leaks
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE workflow_runs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs           FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON workflow_runs;
CREATE POLICY rls_org_isolation ON workflow_runs
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE automation_templates    ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_templates    FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON automation_templates;
CREATE POLICY rls_org_isolation ON automation_templates
  USING (org_id = current_setting('app.current_org_id', true));

ALTER TABLE activity_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_logs           FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON activity_logs;
CREATE POLICY rls_org_isolation ON activity_logs
  USING (org_id = current_setting('app.current_org_id', true));

-- crm_field_mappings (org_id added via migration 007)
ALTER TABLE crm_field_mappings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_field_mappings      FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_org_isolation ON crm_field_mappings;
CREATE POLICY rls_org_isolation ON crm_field_mappings
  USING (org_id = current_setting('app.current_org_id', true));

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 4: Global tables — enable RLS, deny anon, allow service_role only
-- These tables (auth tokens, behavioral events) are global by design.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE magic_link_tokens       ENABLE ROW LEVEL SECURITY;
ALTER TABLE magic_link_tokens       FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_deny_anon ON magic_link_tokens;
CREATE POLICY rls_deny_anon ON magic_link_tokens AS RESTRICTIVE
  TO anon USING (false);

ALTER TABLE share_tokens            ENABLE ROW LEVEL SECURITY;
ALTER TABLE share_tokens            FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_deny_anon ON share_tokens;
CREATE POLICY rls_deny_anon ON share_tokens AS RESTRICTIVE
  TO anon USING (false);

ALTER TABLE behavior_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavior_events         FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_deny_anon ON behavior_events;
CREATE POLICY rls_deny_anon ON behavior_events AS RESTRICTIVE
  TO anon USING (false);

ALTER TABLE behavior_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavior_sessions       FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_deny_anon ON behavior_sessions;
CREATE POLICY rls_deny_anon ON behavior_sessions AS RESTRICTIVE
  TO anon USING (false);

ALTER TABLE behavior_insights       ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavior_insights       FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_deny_anon ON behavior_insights;
CREATE POLICY rls_deny_anon ON behavior_insights AS RESTRICTIVE
  TO anon USING (false);

ALTER TABLE behavior_site_tokens    ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavior_site_tokens    FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_deny_anon ON behavior_site_tokens;
CREATE POLICY rls_deny_anon ON behavior_site_tokens AS RESTRICTIVE
  TO anon USING (false);

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 5: Ensure API server sets org context per transaction
-- Add this function as a helper for connection pool setup.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_org_context(p_org_id TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  PERFORM set_config('app.current_org_id', p_org_id, true);
END;
$$;

-- Grant execution to authenticated role
GRANT EXECUTE ON FUNCTION set_org_context(TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- STEP 6: Verify — list all tables with RLS enabled (for audit log)
-- This SELECT does not modify data; it serves as a post-migration check.
-- ─────────────────────────────────────────────────────────────────────────────

-- Run after applying: SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
