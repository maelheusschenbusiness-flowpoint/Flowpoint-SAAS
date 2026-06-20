---
name: FlowPoint migration schema state
description: Complete list of PostgreSQL tables by migration, and which Drizzle tables needed schema corrections
---

# Migrations state as of migration 005

## Migrations run order
001 → 002 → 003 → 004 → 005

## Tables by migration (cumulative)

### 001 auth_tables
- magic_link_tokens, user_sessions

### 002 dashboard_tables (some had wrong schema — fixed by 005)
- audits, audit_schedules, monitors* (fixed by 003), monitor_checks*
- reports, share_tokens
- keywords (legacy Drizzle keywordsTable — still used as fallback)
- competitors (basic, no org_id)
- alert_rules** (missing operator/duration_min/site_urls — fixed by 005)
- team_members
- team_messages** (missing sender_name/type — fixed by 005)
- notifications* (recreated by 003 with correct schema)
- connectors** (wrong columns type/name/enabled — DROP+RECREATE in 005)
- automation_workflows, workflow_runs
- automation_integrations** (missing endpoint_url/secret_key/headers/timeout_ms/max_retries/retry_enabled — fixed by 005)
- automation_templates, automation_logs
- org_addons
- behavior_events, behavior_sessions, behavior_insights, behavior_site_tokens
- cro_recommendations, cro_scores, cro_experiments
- revenue_leaks
- report_templates, custom_domains, report_exports
- ai_usage_logs, ai_monthly_usage, ai_alerts
- missions, mission_history, mission_ai_logs
- crm_integrations, crm_sync_logs
- sso_providers, org_auth_config, login_audits
- review_analysis, review_alerts

### 003 fix_monitors_notifications
- Fixes monitors (drop+recreate to match Drizzle schema)
- Fixes notifications (drop+recreate with correct columns)

### 004 org_settings_activity_logs
- org_settings (org_id PK, seeds 'default' row)
- activity_logs

### 005 missing_tables (NEW)
- tracked_keywords (UNIQUE org_id+keyword)
- keyword_clusters
- keyword_opportunities
- ranking_alerts
- competitor_rankings
- keyword_history
- user_prefs (org_id PK)
- automation_runs (FK automation_integrations)
- incoming_webhooks (token UNIQUE)
- market_trends
- market_opportunities
- industry_signals
- competitor_movements

## Drizzle table → SQL column mappings that caught bugs

### teamMessagesTable
- JS field `senderId` → column `sender_id`
- JS field `senderName` → column `sender_name` (added in 005)
- JS field `content` → column `content`
- JS field `type` → column `type` (added in 005)
- **Bug in old route:** SEED used `from`, `text`, `self` which don't exist in schema — fixed in team-messages.ts

### alertRulesTable
- JS field `durationMin` → column `duration_min` (added in 005)
- JS field `siteUrls` → column `site_urls` (added in 005)
- JS field `operator` → column `operator` (added in 005)

### connectorsTable
- Old migration 002 had: type, name, config, enabled, last_sync
- Drizzle schema needs: provider, status, connected, access_token, refresh_token, webhook_secret, config, last_sync, sync_status
- Fixed: DROP+RECREATE in 005 if `provider` column missing

**Why:** esbuild doesn't do type checking, so TypeScript type mismatches between Drizzle $inferInsert and actual INSERT values don't fail the build — catch these by comparing INSERT statements to pgTable() definitions.
