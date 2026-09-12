---
name: Purge table schema gaps
description: Correct table names and absent-in-prod tables discovered during purge dry-run audit
---

# Purge table schema gaps

## Critical renames
- `org_members` does NOT exist → correct table is `organization_members` with column `organization_id` (not `org_id`)
- `invitations` does NOT exist → correct table is `team_invitations` (has `org_id` + `email`)
- `activity_log` does NOT exist → correct table is `activity_logs`
- `ga4_accounts` does NOT exist in prod → prod uses `ga4_properties`

## `organization_members` special handling
Uses `organization_id` column, not `org_id`. Must use raw query:
`DELETE FROM organization_members WHERE organization_id::text = ANY($1)`

## Tables confirmed ABSENT from Supabase production (404)
psi_cache, tracked_keywords_history, mission_steps, report_schedules, user_notifications,
activity_events, behavior_events, behavior_sessions, cro_experiments, cro_scores,
ga4_accounts, gsc_keyword_data, gsc_page_data, gsc_sync_logs, org_monitor_quota,
org_quota_usage, revenue_leaks, traffic_losses, traffic_sources,
sessions, enterprise_sessions, billing_events, identity_mappings,
organization_auth, org_roles, org_permissions, auth_providers, subscription_analytics,
custom_domains, crm_tokens, access_audits, ai_market_reports, ai_review_replies,
mission_impact_scores, mission_priorities, mission_templates, pagespeed_history, pagespeed_results,
team_member_roles, crm_sync_jobs, crm_webhooks, bs_monitors, bs_incidents, bs_heartbeats

## Verified in-prod tables with org_id (non-exhaustive additions to note)
organization_members (organization_id col), org_member_permissions, sso_providers,
org_auth_config, subscriptions, usage_events, user_prefs, user_activity_days,
notifications, login_audits, audit_trail, permission_logs, google_accounts,
google_locations, google_reviews, google_product_connections, gsc_sites, ga4_properties,
competitors, activity_logs, ai_chat_history, ai_action_logs, ai_action_proposals,
ai_autopilot_grants, ai_usage_pending_writes, connectors, dataforseo_quota,
market_trends, team_invitations, checkout_post_tokens, market_opportunities,
industry_signals, local_heatmaps, gbp_locations, gbp_posts, roles, reviews

## How to verify table existence
Use Supabase REST: GET /rest/v1/table_name?select=*&limit=0 with service-role key.
200/206 + content-range header = table exists and is exposed.
404 = not exposed via REST (table may not exist OR not in PostgREST config).
Use local psql + pg_tables for ground truth; Supabase REST only confirms exposure.

**Why:** purge-all-clients endpoint had 6 wrong/missing table names that would have silently
skipped real data. Discovered via information_schema + Supabase REST audit 2026-08-17.
