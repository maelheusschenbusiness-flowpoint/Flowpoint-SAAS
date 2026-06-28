---
name: FlowPoint RLS migration 014
description: Status of Supabase RLS coverage — migration 013 gaps, 014 SQL file location, init-rls-migration.ts expansion
---

# FlowPoint RLS Migration 014

**Why:** Migration 013 only covered ~52 tables. 65+ tables added later have no RLS policies on Supabase without 014.

## Current state
- Migration 013: `artifacts/api-server/migrations/013_supabase_cloud_rls.sql` — 52 tables
- Migration 014: `artifacts/api-server/migrations/014_rls_new_tables.sql` — **65+ new tables** ✅ created
- `init-rls-migration.ts`: `needsOrgId` array expanded from 53 → 100+ tables ✅

## Tables covered by migration 014 (not in 013)
alert_rules, report_exports, report_templates, reports, team_messages,
activity_logs, revenue_leaks, review_alerts, review_analysis,
cro_experiments, cro_recommendations, cro_scores,
crm_integrations, crm_sync_logs, crm_contacts, crm_tokens, crm_webhooks,
custom_domains, share_tokens, sso_providers, login_audits, org_auth_config,
automation_templates, ai_alerts, local_heatmaps, competitor_map_results,
local_opportunities, local_visibility_scores, google_oauth_states,
gsc_sites, gsc_keyword_data, gsc_page_data, gsc_sync_logs,
ga4_properties, google_accounts, google_locations, google_reviews,
gbp_posts, gbp_post_queue, gbp_media_assets,
psi_cache, psi_history, seo_domain_metrics, reputation_scores,
keywords, permission_logs, onboarding_sessions, billing_events,
bs_monitors, bs_incidents, bs_heartbeats, bs_status_pages,
github_connections, github_analyses, dataforseo_quota,
webhook_integrations, roles, + more

## RLS policy pattern per table
```sql
CREATE POLICY "tenant_select" ON <table> FOR SELECT USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_insert" ON <table> FOR INSERT WITH CHECK (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_update" ON <table> FOR UPDATE USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY "tenant_delete" ON <table> FOR DELETE USING (org_id = current_setting('app.current_org_id', true));
```

## How to apply to Supabase
1. Supabase Dashboard → SQL Editor → New query
2. Paste contents of `artifacts/api-server/migrations/014_rls_new_tables.sql`
3. Run
4. Verify: `SELECT tablename FROM pg_tables WHERE schemaname='public' AND rowsecurity=false;` → 0 rows

## init-rls-migration.ts sentinel
- Sentinel = `audits.org_id` column existence
- Once set, migration skips on subsequent boots (one-shot)
- For fresh deploys: `pnpm run migrate` runs both the main function and processes all 100+ tables in needsOrgId
- migrate.ts is standalone — NOT called at server runtime (only init-rls-setup.ts runs at startup, just provisions app_user role)

**How to apply:** Always run migration 014 SQL on Supabase before deploying to production. For fresh DB, `pnpm run migrate` handles everything.
