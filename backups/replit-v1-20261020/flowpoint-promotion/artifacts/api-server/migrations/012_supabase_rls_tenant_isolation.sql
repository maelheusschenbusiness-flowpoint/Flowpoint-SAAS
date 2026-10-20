-- =============================================================================
-- Migration 012 — Supabase RLS Tenant Isolation
-- Apply via: Supabase Dashboard → SQL Editor, or: supabase db push
-- Strategy:
--   • Enable RLS on ALL 51 tables (deny-all for anon by default)
--   • Tables already having org_id → direct tenant policy
--   • Tables missing org_id but needing isolation → ADD COLUMN + policy
--   • organizations → restrict by id (it IS the org record)
--   • users, magic_link_tokens → token/identity tables, service-role only
--   • Service role automatically bypasses RLS (Supabase default)
--   • GUC used: current_setting('app.current_org_id', true)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: set a GUC-based tenant context (call before any query with anon/app_user)
-- Usage: SELECT set_config('app.current_org_id', 'org_xxx', true);
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- SECTION 1 — Enable RLS on ALL tables (idempotent)
-- ===========================================================================

ALTER TABLE audits                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitors                ENABLE ROW LEVEL SECURITY;
ALTER TABLE missions                ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors             ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracked_keywords        ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_schedules         ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_trail             ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_workflows    ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_movements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_rankings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE connectors              ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_field_mappings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE gbp_locations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_tokens           ENABLE ROW LEVEL SECURITY;
ALTER TABLE incoming_webhooks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE industry_signals        ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_clusters        ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_history         ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_opportunities   ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_opportunities    ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_trends           ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission_ai_logs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission_history         ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_checks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_incidents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_logs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications           ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_connections       ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_addons              ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_settings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranking_alerts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_forecasts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_reports             ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members            ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_prefs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_credit_purchases     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_monthly_usage        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE magic_link_tokens       ENABLE ROW LEVEL SECURITY;
ALTER TABLE my_table                ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- SECTION 2 — Add org_id to tables that are missing it
-- (DEFAULT 'default' preserves existing rows; change per-tenant after migration)
-- ===========================================================================

ALTER TABLE audits                  ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE monitors                ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE competitors             ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE tracked_keywords        ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE alert_events            ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE audit_schedules         ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE audit_trail             ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE automation_integrations ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE automation_logs         ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE automation_runs         ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE calendar_events         ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE competitor_movements    ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE competitor_rankings     ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE connectors              ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE crm_field_mappings      ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE gbp_locations           ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE google_tokens           ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE incoming_webhooks       ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE keyword_clusters        ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE keyword_history         ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE keyword_opportunities   ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE mission_ai_logs         ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE mission_history         ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE monitor_checks          ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE monitor_incidents       ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE monitor_logs            ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE notifications           ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE oauth_connections       ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE ranking_alerts          ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE seo_forecasts           ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE sla_reports             ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE subscriptions           ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE team_members            ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE usage                   ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE workflow_runs           ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE ai_credit_purchases     ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';

-- industry_signals and market data: global/read-only, no org_id needed
-- users: identity table, no org_id (see policy below)
-- organizations: IS the org record, identified by its own id

-- ===========================================================================
-- SECTION 3 — Create tenant-isolation policies (org_id tables)
-- Using GUC: current_setting('app.current_org_id', true)
-- The `true` arg makes it non-fatal if GUC is unset (returns null → no access)
-- ===========================================================================

-- Drop existing policies first (idempotent re-run safety)
DO $$ DECLARE r RECORD;
BEGIN
  FOR r IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- ---- Macro: all tables with org_id column --------------------------------
-- (Group A: already had it + Group B: just added it)

CREATE POLICY "tenant_select"  ON audits                  FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON audits                  FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON audits                  FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON audits                  FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON monitors                FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON monitors                FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON monitors                FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON monitors                FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON missions                FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON missions                FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON missions                FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON missions                FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON competitors             FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON competitors             FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON competitors             FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON competitors             FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON tracked_keywords        FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON tracked_keywords        FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON tracked_keywords        FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON tracked_keywords        FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON alert_events            FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON alert_events            FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON alert_events            FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON alert_events            FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON audit_schedules         FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON audit_schedules         FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON audit_schedules         FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON audit_schedules         FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON audit_trail             FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON audit_trail             FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON audit_trail             FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON audit_trail             FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON automation_integrations FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON automation_integrations FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON automation_integrations FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON automation_integrations FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON automation_logs         FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON automation_logs         FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON automation_logs         FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON automation_logs         FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON automation_runs         FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON automation_runs         FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON automation_runs         FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON automation_runs         FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON automation_workflows    FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON automation_workflows    FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON automation_workflows    FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON automation_workflows    FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON calendar_events         FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON calendar_events         FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON calendar_events         FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON calendar_events         FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON competitor_movements    FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON competitor_movements    FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON competitor_movements    FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON competitor_movements    FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON competitor_rankings     FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON competitor_rankings     FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON competitor_rankings     FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON competitor_rankings     FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON connectors              FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON connectors              FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON connectors              FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON connectors              FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON crm_field_mappings      FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON crm_field_mappings      FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON crm_field_mappings      FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON crm_field_mappings      FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON gbp_locations           FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON gbp_locations           FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON gbp_locations           FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON gbp_locations           FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON google_tokens           FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON google_tokens           FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON google_tokens           FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON google_tokens           FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON incoming_webhooks       FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON incoming_webhooks       FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON incoming_webhooks       FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON incoming_webhooks       FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON keyword_clusters        FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON keyword_clusters        FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON keyword_clusters        FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON keyword_clusters        FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON keyword_history         FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON keyword_history         FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON keyword_history         FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON keyword_history         FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON keyword_opportunities   FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON keyword_opportunities   FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON keyword_opportunities   FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON keyword_opportunities   FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON market_opportunities    FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON market_opportunities    FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON market_opportunities    FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON market_opportunities    FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON market_trends           FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON market_trends           FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON market_trends           FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON market_trends           FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON mission_ai_logs         FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON mission_ai_logs         FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON mission_ai_logs         FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON mission_ai_logs         FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON mission_history         FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON mission_history         FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON mission_history         FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON mission_history         FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON monitor_checks          FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON monitor_checks          FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON monitor_checks          FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON monitor_checks          FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON monitor_incidents       FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON monitor_incidents       FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON monitor_incidents       FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON monitor_incidents       FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON monitor_logs            FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON monitor_logs            FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON monitor_logs            FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON monitor_logs            FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON notifications           FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON notifications           FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON notifications           FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON notifications           FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON oauth_connections       FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON oauth_connections       FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON oauth_connections       FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON oauth_connections       FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON org_addons              FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON org_addons              FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON org_addons              FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON org_addons              FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON org_settings            FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON org_settings            FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON org_settings            FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON org_settings            FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON ranking_alerts          FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON ranking_alerts          FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON ranking_alerts          FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON ranking_alerts          FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON seo_forecasts           FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON seo_forecasts           FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON seo_forecasts           FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON seo_forecasts           FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON sla_reports             FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON sla_reports             FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON sla_reports             FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON sla_reports             FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON subscriptions           FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON subscriptions           FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON subscriptions           FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON subscriptions           FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON team_members            FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON team_members            FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON team_members            FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON team_members            FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON usage                   FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON usage                   FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON usage                   FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON usage                   FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON user_prefs              FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON user_prefs              FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON user_prefs              FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON user_prefs              FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON user_sessions           FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON user_sessions           FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON user_sessions           FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON user_sessions           FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON workflow_runs           FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON workflow_runs           FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON workflow_runs           FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON workflow_runs           FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON ai_credit_purchases     FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON ai_credit_purchases     FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON ai_credit_purchases     FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON ai_credit_purchases     FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON ai_monthly_usage        FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON ai_monthly_usage        FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON ai_monthly_usage        FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON ai_monthly_usage        FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select"  ON ai_usage_logs           FOR SELECT  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert"  ON ai_usage_logs           FOR INSERT  WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update"  ON ai_usage_logs           FOR UPDATE  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete"  ON ai_usage_logs           FOR DELETE  USING (org_id = current_setting('app.current_org_id', true));

-- ===========================================================================
-- SECTION 4 — Special-case tables
-- ===========================================================================

-- organizations: restrict each org to see only its own row (id = current org)
CREATE POLICY "org_self_select" ON organizations FOR SELECT  USING (id = current_setting('app.current_org_id', true));
CREATE POLICY "org_self_update" ON organizations FOR UPDATE  USING (id = current_setting('app.current_org_id', true));
-- INSERT/DELETE on organizations only via service role (admin action)

-- users: identity table — accessible to service role only (RLS enabled = deny anon by default)
-- No policies created → only service_role (which bypasses RLS) can read users

-- magic_link_tokens: token-based, no org scoping needed — deny anon read
-- (tokens are single-use and short-lived; service role manages them)

-- industry_signals: global reference data — read-only for all (no org filter)
CREATE POLICY "global_read" ON industry_signals FOR SELECT USING (true);

-- my_table: unknown purpose — service role only (no policy = deny anon)

-- ===========================================================================
-- SECTION 5 — Performance indexes for RLS filter columns
-- ===========================================================================

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audits_org_id               ON audits (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_monitors_org_id              ON monitors (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_missions_org_id              ON missions (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_competitors_org_id           ON competitors (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tracked_keywords_org_id      ON tracked_keywords (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alert_events_org_id          ON alert_events (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_calendar_events_org_id       ON calendar_events (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_org_id         ON notifications (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_sessions_org_id         ON user_sessions (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_org_id         ON subscriptions (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_team_members_org_id          ON team_members (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_schedules_org_id       ON audit_schedules (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_seo_forecasts_org_id         ON seo_forecasts (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_workflow_runs_org_id         ON workflow_runs (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_automation_workflows_org_id  ON automation_workflows (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_connectors_org_id            ON connectors (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_google_tokens_org_id         ON google_tokens (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_org_settings_org_id          ON org_settings (org_id);

-- ===========================================================================
-- SECTION 6 — Verification query (run after applying to confirm RLS is active)
-- ===========================================================================

-- SELECT tablename, rowsecurity, forcerowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY tablename;
--
-- Expected: rowsecurity = true for ALL 51 tables listed above.
--
-- To test tenant isolation (replace 'org_xxx' with a real org id):
--   SET app.current_org_id = 'org_xxx';
--   SELECT count(*) FROM audits;  -- should return only that org's audits
--   RESET app.current_org_id;
--   SELECT count(*) FROM audits;  -- should return 0 (GUC unset → null → no match)
