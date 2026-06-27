-- =============================================================================
-- Migration 013 — Supabase Cloud RLS (targeted to actual Supabase schema)
-- Based on OpenAPI introspection of sejbsuuaeokyuxuoaxzd.supabase.co
-- 
-- HOW TO APPLY:
--   Supabase Dashboard → SQL Editor → New query → paste this → Run
--   URL: https://supabase.com/dashboard/project/sejbsuuaeokyuxuoaxzd/sql/new
--
-- WHAT THIS DOES:
--   1. Adds org_id to 9 tables that are missing it
--   2. Enables RLS on all 52 exposed tables
--   3. Creates tenant isolation policies (org_id GUC-based)
--   4. Grants correct permissions to anon/authenticated/service_role
--   5. service_role automatically bypasses RLS (no data access regression)
--
-- TENANT CONTEXT: set before each query in app middleware:
--   SELECT set_config('app.current_org_id', '<org_id>', true);
-- =============================================================================

-- ===========================================================================
-- SECTION 1 — Add org_id to tables missing it (9 tables)
-- DEFAULT 'default' preserves all existing rows
-- ===========================================================================
ALTER TABLE alert_events      ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE audits            ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE competitors       ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE connectors        ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE crm_field_mappings ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE notifications     ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE subscriptions     ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE usage             ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';
ALTER TABLE workflow_runs     ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default';

-- ===========================================================================
-- SECTION 2 — Enable RLS on ALL 52 tables
-- ===========================================================================
ALTER TABLE ai_credit_purchases    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_monthly_usage       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_schedules        ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_trail            ENABLE ROW LEVEL SECURITY;
ALTER TABLE audits                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_workflows   ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_movements   ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_rankings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitors            ENABLE ROW LEVEL SECURITY;
ALTER TABLE connectors             ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_field_mappings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE gbp_locations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_tokens          ENABLE ROW LEVEL SECURITY;
ALTER TABLE incoming_webhooks      ENABLE ROW LEVEL SECURITY;
ALTER TABLE industry_signals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_clusters       ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_history        ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_opportunities  ENABLE ROW LEVEL SECURITY;
ALTER TABLE magic_link_tokens      ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_opportunities   ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_trends          ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission_ai_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE mission_history        ENABLE ROW LEVEL SECURITY;
ALTER TABLE missions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_checks         ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_incidents      ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitor_logs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitors               ENABLE ROW LEVEL SECURITY;
ALTER TABLE my_table               ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications          ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_connections      ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_addons             ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_settings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranking_alerts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_forecasts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_reports            ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members           ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracked_keywords       ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_prefs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_sessions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_runs          ENABLE ROW LEVEL SECURITY;

-- ===========================================================================
-- SECTION 3 — Drop any pre-existing policies (idempotent cleanup)
-- ===========================================================================
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- ===========================================================================
-- SECTION 4 — Tenant isolation policies (38 tables that have org_id)
-- Policy: org_id must match current_setting('app.current_org_id', true)
-- If GUC not set → NULL → no rows returned (safe deny-all default)
-- ===========================================================================

-- ai_credit_purchases
CREATE POLICY "tenant_select" ON ai_credit_purchases FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON ai_credit_purchases FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON ai_credit_purchases FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON ai_credit_purchases FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- ai_monthly_usage
CREATE POLICY "tenant_select" ON ai_monthly_usage FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON ai_monthly_usage FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON ai_monthly_usage FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON ai_monthly_usage FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- ai_usage_logs
CREATE POLICY "tenant_select" ON ai_usage_logs FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON ai_usage_logs FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON ai_usage_logs FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON ai_usage_logs FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- alert_events (org_id added in section 1)
CREATE POLICY "tenant_select" ON alert_events FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON alert_events FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON alert_events FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON alert_events FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- audit_schedules
CREATE POLICY "tenant_select" ON audit_schedules FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON audit_schedules FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON audit_schedules FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON audit_schedules FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- audit_trail
CREATE POLICY "tenant_select" ON audit_trail FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON audit_trail FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON audit_trail FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON audit_trail FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- audits (org_id added in section 1)
CREATE POLICY "tenant_select" ON audits FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON audits FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON audits FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON audits FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- automation_integrations
CREATE POLICY "tenant_select" ON automation_integrations FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON automation_integrations FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON automation_integrations FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON automation_integrations FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- automation_logs
CREATE POLICY "tenant_select" ON automation_logs FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON automation_logs FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON automation_logs FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON automation_logs FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- automation_runs
CREATE POLICY "tenant_select" ON automation_runs FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON automation_runs FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON automation_runs FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON automation_runs FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- automation_workflows
CREATE POLICY "tenant_select" ON automation_workflows FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON automation_workflows FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON automation_workflows FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON automation_workflows FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- calendar_events
CREATE POLICY "tenant_select" ON calendar_events FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON calendar_events FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON calendar_events FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON calendar_events FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- competitor_movements
CREATE POLICY "tenant_select" ON competitor_movements FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON competitor_movements FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON competitor_movements FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON competitor_movements FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- competitor_rankings
CREATE POLICY "tenant_select" ON competitor_rankings FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON competitor_rankings FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON competitor_rankings FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON competitor_rankings FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- competitors (org_id added in section 1)
CREATE POLICY "tenant_select" ON competitors FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON competitors FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON competitors FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON competitors FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- connectors (org_id added in section 1)
CREATE POLICY "tenant_select" ON connectors FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON connectors FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON connectors FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON connectors FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- crm_field_mappings (org_id added in section 1)
CREATE POLICY "tenant_select" ON crm_field_mappings FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON crm_field_mappings FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON crm_field_mappings FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON crm_field_mappings FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- gbp_locations
CREATE POLICY "tenant_select" ON gbp_locations FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON gbp_locations FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON gbp_locations FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON gbp_locations FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- google_tokens
CREATE POLICY "tenant_select" ON google_tokens FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON google_tokens FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON google_tokens FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON google_tokens FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- incoming_webhooks
CREATE POLICY "tenant_select" ON incoming_webhooks FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON incoming_webhooks FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON incoming_webhooks FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON incoming_webhooks FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- industry_signals
CREATE POLICY "tenant_select" ON industry_signals FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON industry_signals FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON industry_signals FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON industry_signals FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- keyword_clusters
CREATE POLICY "tenant_select" ON keyword_clusters FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON keyword_clusters FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON keyword_clusters FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON keyword_clusters FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- keyword_history
CREATE POLICY "tenant_select" ON keyword_history FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON keyword_history FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON keyword_history FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON keyword_history FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- keyword_opportunities
CREATE POLICY "tenant_select" ON keyword_opportunities FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON keyword_opportunities FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON keyword_opportunities FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON keyword_opportunities FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- market_opportunities
CREATE POLICY "tenant_select" ON market_opportunities FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON market_opportunities FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON market_opportunities FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON market_opportunities FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- market_trends
CREATE POLICY "tenant_select" ON market_trends FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON market_trends FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON market_trends FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON market_trends FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- mission_ai_logs
CREATE POLICY "tenant_select" ON mission_ai_logs FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON mission_ai_logs FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON mission_ai_logs FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON mission_ai_logs FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- mission_history
CREATE POLICY "tenant_select" ON mission_history FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON mission_history FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON mission_history FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON mission_history FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- missions
CREATE POLICY "tenant_select" ON missions FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON missions FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON missions FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON missions FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- monitor_checks
CREATE POLICY "tenant_select" ON monitor_checks FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON monitor_checks FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON monitor_checks FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON monitor_checks FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- monitor_incidents
CREATE POLICY "tenant_select" ON monitor_incidents FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON monitor_incidents FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON monitor_incidents FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON monitor_incidents FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- monitor_logs
CREATE POLICY "tenant_select" ON monitor_logs FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON monitor_logs FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON monitor_logs FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON monitor_logs FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- monitors
CREATE POLICY "tenant_select" ON monitors FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON monitors FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON monitors FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON monitors FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- notifications (org_id added in section 1)
CREATE POLICY "tenant_select" ON notifications FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON notifications FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON notifications FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON notifications FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- oauth_connections
CREATE POLICY "tenant_select" ON oauth_connections FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON oauth_connections FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON oauth_connections FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON oauth_connections FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- org_addons
CREATE POLICY "tenant_select" ON org_addons FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON org_addons FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON org_addons FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON org_addons FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- org_settings
CREATE POLICY "tenant_select" ON org_settings FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON org_settings FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON org_settings FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON org_settings FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- ranking_alerts
CREATE POLICY "tenant_select" ON ranking_alerts FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON ranking_alerts FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON ranking_alerts FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON ranking_alerts FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- seo_forecasts
CREATE POLICY "tenant_select" ON seo_forecasts FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON seo_forecasts FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON seo_forecasts FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON seo_forecasts FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- sla_reports
CREATE POLICY "tenant_select" ON sla_reports FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON sla_reports FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON sla_reports FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON sla_reports FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- subscriptions (org_id added in section 1)
CREATE POLICY "tenant_select" ON subscriptions FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON subscriptions FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON subscriptions FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON subscriptions FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- team_members
CREATE POLICY "tenant_select" ON team_members FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON team_members FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON team_members FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON team_members FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- tracked_keywords
CREATE POLICY "tenant_select" ON tracked_keywords FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON tracked_keywords FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON tracked_keywords FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON tracked_keywords FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- usage (org_id added in section 1)
CREATE POLICY "tenant_select" ON usage FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON usage FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON usage FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON usage FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- user_prefs
CREATE POLICY "tenant_select" ON user_prefs FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON user_prefs FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON user_prefs FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON user_prefs FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- user_sessions
CREATE POLICY "tenant_select" ON user_sessions FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON user_sessions FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON user_sessions FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON user_sessions FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- workflow_runs (org_id added in section 1)
CREATE POLICY "tenant_select" ON workflow_runs FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON workflow_runs FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON workflow_runs FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON workflow_runs FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- ===========================================================================
-- SECTION 5 — Special tables: service-role access only (no tenant policy)
-- RLS is enabled → deny-all for anon/authenticated by default
-- service_role has BYPASSRLS → still has full access
-- ===========================================================================
-- magic_link_tokens: auth tokens — no tenant policy, only service_role
-- organizations: org master record — no tenant policy
-- users: identity table — no tenant policy
-- my_table: system table — no tenant policy

-- ===========================================================================
-- SECTION 6 — Role permissions
-- ===========================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;

-- ===========================================================================
-- SECTION 7 — Verification query (run after to confirm)
-- ===========================================================================
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' AND rowsecurity=false ORDER BY tablename;
-- Expected: 0 rows (all tables have RLS)
-- SELECT COUNT(*) FROM pg_policies WHERE schemaname='public';
-- Expected: ~192 policies (48 tables × 4 ops)
