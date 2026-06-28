---
name: FlowPoint Drizzle ↔ PostgreSQL Audit
description: Complete audit of Drizzle schema vs actual DB — drifts found and fixed, tables not in Drizzle
---

## Summary
33 tables defined in Drizzle (`lib/db/src/index.ts`). Audit completed 2026-06-28.

## Drifts FIXED (this session)
| Table | Issue | Fix |
|---|---|---|
| `audits` | Missing `org_id` | Added to Drizzle |
| `reports` | Missing `org_id` | Added to Drizzle |
| `competitors` | Missing `org_id` | Added to Drizzle |
| `alert_rules` | Missing `org_id` | Added to Drizzle |
| `team_members` | Missing `org_id` | Added to Drizzle |
| `team_messages` | Missing `org_id` | Added to Drizzle |
| `notifications` | Missing `org_id` | Added to Drizzle |
| `connectors` | Missing `org_id` | Added to Drizzle |
| `workflow_runs` | Missing `org_id` | Added to Drizzle |
| `keywords` → `tracked_keywords` | Wrong table name + wrong column names | Renamed to `trackedKeywordsTable`, pg table `"tracked_keywords"`, updated columns |
| `monitors` | Wrong column names: `uptime_pct`/`latency_ms`/`check_interval` | Fixed to `uptime`/`latency`/`frequency` per migration 003 |
| `monitors` | Extra cols `response_time`/`last_checked` (dropped by mig 003) | Removed from Drizzle |
| `monitors` | `last_alert_sent` was BIGINT, should be TIMESTAMPTZ | Fixed to timestamp |

## Tables ✅ already aligned (have org_id or don't need it)
`audit_schedules`, `monitor_checks`, `monitor_incidents`, `share_tokens`,
`automation_workflows`, `org_addons`, `behavior_site_tokens`, `report_templates`,
`custom_domains`, `report_exports`, `ai_usage_logs`, `ai_monthly_usage`, `ai_alerts`,
`magic_link_tokens`, `user_sessions`, `behavior_events`, `behavior_sessions`,
`behavior_insights`, `cro_recommendations`, `cro_scores`, `cro_experiments`, `revenue_leaks`

## Tables in DB but NOT in Drizzle schema (raw SQL only)
- `automation_integrations`, `automation_templates`, `automation_logs`, `automation_runs`
- `incoming_webhooks`
- `missions`, `mission_history`, `mission_ai_logs` (in `missionsSchemaRef` only)
- `alert_events`, `calendar_events` (created by init-data-tables)
- `crm_integrations`, `crm_sync_logs`, `crm_field_mappings`
- `org_settings`, `activity_logs` (migration 004)
- `audit_trail`, `google_tokens`, `seo_forecasts`, `gbp_locations` (migration 007)
- `ai_credit_purchases` (migration 009)
- `user_prefs`, `org_auth_config`, `sso_providers`, `login_audits`, `rank_alerts` (various)
- `keywords` (migration 002, legacy — routes use `tracked_keywords` exclusively)

**Why:** These tables exist in DB via migrations or init scripts, but routes query them
via raw SQL. Drizzle ORM is NOT used for these tables. No runtime impact.

## admin/stats bug fixed
- Was querying `FROM keywords` (legacy table) → changed to `FROM tracked_keywords`
- Was using `client.query()` in parallel (pg deprecation) → changed to `pool.query()`

## admin/users bug fixed
- Was `COUNT(s.id)` but `user_sessions` PK is `token` → changed to `COUNT(s.token)`
- Was `last_seen_at` column (doesn't exist) → changed to `expires_at`

## Production RLS gap (NOT fixed — requires manual migration)
- Production Render DB: 43 RLS-enabled tables, 10 policies
- Expected after migration 010: 67 tables, 481 policies
- Cause: migration 010_rls_hardening_clean.sql NOT applied to Render DB
- Fix: run migration 010 manually against the Render DB connection string
