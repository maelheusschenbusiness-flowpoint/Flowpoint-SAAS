-- =============================================================================
-- Migration 014 — RLS for tables added after migration 013
-- Apply via: Supabase Dashboard → SQL Editor → New query → Run
-- URL: https://supabase.com/dashboard/project/sejbsuuaeokyuxuoaxzd/sql/new
--
-- WHAT THIS DOES:
--   Enables RLS + tenant isolation policies on all tables NOT covered by 013.
--   All operations are idempotent (IF NOT EXISTS / DROP IF EXISTS guards).
--
-- TABLES COVERED:
--   Tenant tables (org_id scoped): alert_rules, report_exports, report_templates,
--   reports, team_messages, activity_logs, revenue_leaks, review_alerts,
--   review_analysis, cro_experiments, cro_recommendations, cro_scores,
--   crm_integrations, crm_sync_logs, custom_domains, share_tokens, sso_providers,
--   login_audits, org_auth_config, automation_templates, ai_alerts,
--   local_heatmaps, competitor_map_results, local_opportunities,
--   local_visibility_scores, google_oauth_states, ai_workspace_profiles,
--   ai_chat_history, ai_generated_missions, gsc_sites, gsc_keyword_data,
--   gsc_page_data, gsc_sync_logs, ga4_properties, google_accounts,
--   google_locations, google_reviews, gbp_posts, gbp_post_queue,
--   gbp_media_assets, psi_cache, psi_history, seo_domain_metrics,
--   reputation_scores, keywords, review_analysis, permission_logs,
--   onboarding_sessions, billing_events, bs_monitors, bs_incidents,
--   bs_heartbeats, bs_status_pages, github_connections, github_analyses,
--   dataforseo_quota, crm_contacts, crm_tokens, crm_webhooks,
--   webhook_integrations, cron_history, worker_failures, roles,
--   report_exports, team_messages
--
--   Public/Global tables (service_role only after RLS):
--   behavior_events, behavior_insights, behavior_sessions, behavior_site_tokens
-- =============================================================================

-- Helper macro: used repeatedly below
-- policy pattern: org_id = current_setting('app.current_org_id', true)

-- ===========================================================================
-- SECTION 1 — Add org_id to tenant tables missing it
-- ===========================================================================

DO $$ BEGIN
  -- Tenant tables that may be missing org_id
  DECLARE tables text[] := ARRAY[
    'alert_rules','report_exports','report_templates','reports','team_messages',
    'activity_logs','revenue_leaks','review_alerts','review_analysis',
    'cro_experiments','cro_recommendations','cro_scores',
    'crm_integrations','crm_sync_logs','custom_domains',
    'share_tokens','sso_providers','login_audits','org_auth_config',
    'automation_templates','ai_alerts','local_heatmaps','competitor_map_results',
    'local_opportunities','local_visibility_scores','google_oauth_states',
    'ai_workspace_profiles','ai_chat_history','ai_generated_missions',
    'gsc_sites','gsc_keyword_data','gsc_page_data','gsc_sync_logs',
    'ga4_properties','google_accounts','google_locations','google_reviews',
    'gbp_posts','gbp_post_queue','gbp_media_assets',
    'psi_cache','psi_history','seo_domain_metrics','reputation_scores',
    'keywords','permission_logs','onboarding_sessions','billing_events',
    'bs_monitors','bs_incidents','bs_heartbeats','bs_status_pages',
    'github_connections','github_analyses','dataforseo_quota',
    'crm_contacts','crm_tokens','crm_webhooks',
    'webhook_integrations','cron_history','worker_failures','roles',
    'ai_market_reports','ai_setup_logs','ai_usage_logs'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT ''default''', t);
    END IF;
  END LOOP;
END; END $$;

-- ===========================================================================
-- SECTION 2 — Enable RLS on all new tables (idempotent)
-- ===========================================================================

DO $$ DECLARE t text; tables text[] := ARRAY[
    'alert_rules','report_exports','report_templates','reports','team_messages',
    'activity_logs','revenue_leaks','review_alerts','review_analysis',
    'cro_experiments','cro_recommendations','cro_scores',
    'crm_integrations','crm_sync_logs','custom_domains',
    'share_tokens','sso_providers','login_audits','org_auth_config',
    'automation_templates','ai_alerts','local_heatmaps','competitor_map_results',
    'local_opportunities','local_visibility_scores','google_oauth_states',
    'ai_workspace_profiles','ai_chat_history','ai_generated_missions',
    'gsc_sites','gsc_keyword_data','gsc_page_data','gsc_sync_logs',
    'ga4_properties','google_accounts','google_locations','google_reviews',
    'gbp_posts','gbp_post_queue','gbp_media_assets',
    'psi_cache','psi_history','seo_domain_metrics','reputation_scores',
    'keywords','permission_logs','onboarding_sessions','billing_events',
    'bs_monitors','bs_incidents','bs_heartbeats','bs_status_pages',
    'github_connections','github_analyses','dataforseo_quota',
    'crm_contacts','crm_tokens','crm_webhooks',
    'webhook_integrations','cron_history','worker_failures','roles',
    'ai_market_reports','ai_setup_logs',
    'behavior_events','behavior_insights','behavior_sessions','behavior_site_tokens'
]; BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- ===========================================================================
-- SECTION 3 — Drop existing policies on these tables (idempotent cleanup)
-- ===========================================================================
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN SELECT tablename, policyname FROM pg_policies WHERE schemaname='public'
    AND tablename IN (
      'alert_rules','report_exports','report_templates','reports','team_messages',
      'activity_logs','revenue_leaks','review_alerts','review_analysis',
      'cro_experiments','cro_recommendations','cro_scores',
      'crm_integrations','crm_sync_logs','custom_domains',
      'share_tokens','sso_providers','login_audits','org_auth_config',
      'automation_templates','ai_alerts','local_heatmaps','competitor_map_results',
      'local_opportunities','local_visibility_scores','google_oauth_states',
      'ai_workspace_profiles','ai_chat_history','ai_generated_missions',
      'gsc_sites','gsc_keyword_data','gsc_page_data','gsc_sync_logs',
      'ga4_properties','google_accounts','google_locations','google_reviews',
      'gbp_posts','gbp_post_queue','gbp_media_assets',
      'psi_cache','psi_history','seo_domain_metrics','reputation_scores',
      'keywords','permission_logs','onboarding_sessions','billing_events',
      'bs_monitors','bs_incidents','bs_heartbeats','bs_status_pages',
      'github_connections','github_analyses','dataforseo_quota',
      'crm_contacts','crm_tokens','crm_webhooks',
      'webhook_integrations','cron_history','worker_failures','roles',
      'ai_market_reports','ai_setup_logs',
      'behavior_events','behavior_insights','behavior_sessions','behavior_site_tokens'
    )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- ===========================================================================
-- SECTION 4 — Tenant isolation policies (org_id tables)
-- ===========================================================================

-- Macro helper: CREATE POLICY blocks for each tenant table
-- Pattern: SELECT/INSERT/UPDATE/DELETE filtered by org_id GUC

CREATE POLICY "tenant_select" ON alert_rules          FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON alert_rules          FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON alert_rules          FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON alert_rules          FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON report_exports       FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON report_exports       FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON report_exports       FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON report_exports       FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON report_templates     FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON report_templates     FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON report_templates     FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON report_templates     FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON reports              FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON reports              FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON reports              FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON reports              FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON team_messages        FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON team_messages        FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON team_messages        FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON team_messages        FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON activity_logs        FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON activity_logs        FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON activity_logs        FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON activity_logs        FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON revenue_leaks        FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON revenue_leaks        FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON revenue_leaks        FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON revenue_leaks        FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON review_alerts        FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON review_alerts        FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON review_alerts        FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON review_alerts        FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON review_analysis      FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON review_analysis      FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON review_analysis      FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON review_analysis      FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON cro_experiments      FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON cro_experiments      FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON cro_experiments      FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON cro_experiments      FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON cro_recommendations  FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON cro_recommendations  FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON cro_recommendations  FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON cro_recommendations  FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON cro_scores           FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON cro_scores           FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON cro_scores           FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON cro_scores           FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON crm_integrations     FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON crm_integrations     FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON crm_integrations     FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON crm_integrations     FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON crm_sync_logs        FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON crm_sync_logs        FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON crm_sync_logs        FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON crm_sync_logs        FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON crm_contacts         FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON crm_contacts         FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON crm_contacts         FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON crm_contacts         FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON crm_tokens           FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON crm_tokens           FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON crm_tokens           FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON crm_tokens           FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON crm_webhooks         FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON crm_webhooks         FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON crm_webhooks         FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON crm_webhooks         FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON custom_domains       FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON custom_domains       FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON custom_domains       FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON custom_domains       FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON share_tokens         FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON share_tokens         FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON share_tokens         FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON share_tokens         FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON sso_providers        FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON sso_providers        FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON sso_providers        FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON sso_providers        FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON login_audits         FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON login_audits         FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON login_audits         FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON login_audits         FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON org_auth_config      FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON org_auth_config      FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON org_auth_config      FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON org_auth_config      FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON automation_templates FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON automation_templates FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON automation_templates FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON automation_templates FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON ai_alerts            FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON ai_alerts            FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON ai_alerts            FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON ai_alerts            FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON local_heatmaps       FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON local_heatmaps       FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON local_heatmaps       FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON local_heatmaps       FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON competitor_map_results FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON competitor_map_results FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON competitor_map_results FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON competitor_map_results FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON local_opportunities  FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON local_opportunities  FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON local_opportunities  FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON local_opportunities  FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON local_visibility_scores FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON local_visibility_scores FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON local_visibility_scores FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON local_visibility_scores FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON google_oauth_states  FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON google_oauth_states  FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON google_oauth_states  FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON google_oauth_states  FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON gsc_sites            FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON gsc_sites            FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON gsc_sites            FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON gsc_sites            FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON gsc_keyword_data     FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON gsc_keyword_data     FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON gsc_keyword_data     FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON gsc_keyword_data     FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON gsc_page_data        FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON gsc_page_data        FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON gsc_page_data        FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON gsc_page_data        FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON gsc_sync_logs        FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON gsc_sync_logs        FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON gsc_sync_logs        FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON gsc_sync_logs        FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON ga4_properties       FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON ga4_properties       FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON ga4_properties       FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON ga4_properties       FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON google_accounts      FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON google_accounts      FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON google_accounts      FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON google_accounts      FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON google_locations     FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON google_locations     FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON google_locations     FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON google_locations     FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON google_reviews       FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON google_reviews       FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON google_reviews       FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON google_reviews       FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON gbp_posts            FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON gbp_posts            FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON gbp_posts            FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON gbp_posts            FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON gbp_post_queue       FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON gbp_post_queue       FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON gbp_post_queue       FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON gbp_post_queue       FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON gbp_media_assets     FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON gbp_media_assets     FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON gbp_media_assets     FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON gbp_media_assets     FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON psi_cache            FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON psi_cache            FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON psi_cache            FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON psi_cache            FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON psi_history          FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON psi_history          FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON psi_history          FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON psi_history          FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON seo_domain_metrics   FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON seo_domain_metrics   FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON seo_domain_metrics   FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON seo_domain_metrics   FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON reputation_scores    FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON reputation_scores    FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON reputation_scores    FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON reputation_scores    FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON keywords             FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON keywords             FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON keywords             FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON keywords             FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON permission_logs      FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON permission_logs      FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON permission_logs      FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON permission_logs      FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON onboarding_sessions  FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON onboarding_sessions  FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON onboarding_sessions  FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON onboarding_sessions  FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON billing_events       FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON billing_events       FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON billing_events       FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON billing_events       FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON bs_monitors          FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON bs_monitors          FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON bs_monitors          FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON bs_monitors          FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON bs_incidents         FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON bs_incidents         FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON bs_incidents         FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON bs_incidents         FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON bs_heartbeats        FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON bs_heartbeats        FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON bs_heartbeats        FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON bs_heartbeats        FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON bs_status_pages      FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON bs_status_pages      FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON bs_status_pages      FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON bs_status_pages      FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON github_connections   FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON github_connections   FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON github_connections   FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON github_connections   FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON github_analyses      FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON github_analyses      FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON github_analyses      FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON github_analyses      FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON dataforseo_quota     FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON dataforseo_quota     FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON dataforseo_quota     FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON dataforseo_quota     FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON webhook_integrations FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON webhook_integrations FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON webhook_integrations FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON webhook_integrations FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

CREATE POLICY "tenant_select" ON roles                FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON roles                FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON roles                FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON roles                FOR DELETE USING (org_id = current_setting('app.current_org_id', true));

-- ===========================================================================
-- SECTION 5 — System/internal tables: service_role only (no anon policy)
-- RLS enabled = deny all for anon/authenticated; only service_role accesses
-- ===========================================================================
-- cron_history, worker_failures: internal system tables
-- behavior_*: public tracking (events collected from public pages)
-- NOTE: no policies created = deny-all for non-service roles (correct)

-- ===========================================================================
-- SECTION 6 — Indexes for new RLS filter columns
-- ===========================================================================
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_alert_rules_org_id       ON alert_rules (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_report_exports_org_id    ON report_exports (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_team_messages_org_id     ON team_messages (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_activity_logs_org_id     ON activity_logs (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_revenue_leaks_org_id     ON revenue_leaks (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_local_heatmaps_org_id    ON local_heatmaps (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gsc_sites_org_id         ON gsc_sites (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_google_reviews_org_id    ON google_reviews (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_gbp_posts_org_id         ON gbp_posts (org_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_psi_cache_org_id         ON psi_cache (org_id);

-- ===========================================================================
-- SECTION 7 — Verification
-- ===========================================================================
-- Run after applying to check coverage:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' AND rowsecurity=false ORDER BY tablename;
-- Expected: 0 rows (all tables protected)
-- SELECT COUNT(*) FROM pg_policies WHERE schemaname='public';
-- Expected: ~350+ policies (012+013+014 combined)
