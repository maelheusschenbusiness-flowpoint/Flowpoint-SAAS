---
name: API audit results (June 2026)
description: Results of the full functional audit + RLS verification — bugs found and fixed
---

## Bugs Fixed

### Bug #1 — POST /api/keywords → 500
- Root cause: Drizzle ORM db.insert() failed because DB has `language TEXT NOT NULL DEFAULT 'fr'`
  and `updated_at TIMESTAMP NOT NULL DEFAULT now()` columns not in Drizzle schema
- Fix: Replaced with raw SQL via req.orgDb(), added ON CONFLICT DO NOTHING + 409 on duplicate
- File: `src/routes/keywords.ts`

### Bug #2 — GET /api/diagnostics/workers → 500
- Root cause: getCronStatus() returns {jobs, totalJobs, runningJobs} object, handler used it as array
- Fix: Use cronResult.jobs for list, cronResult.totalJobs/runningJobs for counts
- Fields: CronJob has `interval` (not `schedule`), no `enabled` field (use `status !== "error"`)
- File: `src/routes/diagnostics.ts`

### Bug #3 — DELETE /api/reports/:id → 500
- Root cause: `share_tokens` real DB schema has `report_id` column but NO `org_id` column
  The Drizzle schema was wrong (had `target_id` and `orgId`)
- Fix: `DELETE FROM share_tokens WHERE report_id=$1` (no org_id filter)
- File: `src/routes/reports.ts`

**Why:** Drizzle schema in lib/db/src/index.ts diverges from actual DB schema in several places.
Always verify against `\d tablename` in psql before trusting the Drizzle TS definitions.

## Route Paths Reference
Non-obvious routes (common mistakes):
- /api/audits/schedules (NOT /api/audit-schedules)
- /api/market-intelligence (NOT /api/market-intel)
- /api/forecast (NOT /api/forecasts)
- /api/automation/workflows (NOT /api/automations)
- /api/org/location (NOT /api/locations)
- /api/crm/leads (NOT /api/crm/contacts)
- /api/missions/roadmap (NOT /api/missions/leaderboard)
- /api/ai-credits (NOT /api/ai/credits)
- /api/me/prefs (NOT /api/me/settings)
- /api/team (NOT /api/team/members)
- /api/billing/config|plans|invoices|usage|subscription (no root /api/billing)

## Mission POST requires `title` field (not `name`)
## Alert-rule POST type must be: seo_score|latency|uptime|monitor_down|keyword_ranking_drop
## share_tokens table: has report_id, NO org_id, NO target_id, NO id PK (token is PK)
