---
name: Monitors PostgreSQL migration
description: monitors and monitor_checks tables pre-existed in Supabase with old column names; migration strategy and final state
---

## Rule
The `monitors` and `monitor_checks` tables already existed in Supabase with column names that differ from the spec. Always use `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS` pattern — never assume a clean slate.

## Existing column names (use these in all SQL)
- `monitors`: uptime (real), latency (real), frequency (text) — NOT uptime_pct / latency_ms / check_interval
- `monitor_checks`: latency (real) — NOT latency_ms
- `monitor_incidents`: new table, created fresh

## Final table state
- **monitors**: id, name, url, status, uptime, latency, last_check, alert_email, alert_phone, is_critical, frequency, last_alert_sent, created_at, org_id, updated_at
- **monitor_checks**: id, monitor_id, checked_at, ok, latency, org_id, status_code, error
- **monitor_incidents**: id, monitor_id, org_id, started_at, resolved_at, duration_s, error

## Key decisions
- `toPublic()` maps DB columns directly to frontend-expected JSON names (no rename needed — dashboard.js uses `uptime`, `latency`, `frequency` which match DB)
- `DELETE /monitors/:id` cascades: deletes monitor_checks and monitor_incidents before the monitor row
- Uptime % recalculated from monitor_checks on every check (last 30 days rolling window)
- Incident lifecycle: UP→DOWN creates row in monitor_incidents; DOWN→UP sets resolved_at + duration_s
- `/check` and `/ping` are aliases — both call the same handler

**Why:** Supabase already had monitors data from a previous Drizzle schema migration. Dropping and recreating would destroy existing monitor configurations. The ALTER TABLE approach is non-destructive.

**How to apply:** Any future column additions must go through `ALTER TABLE monitors ADD COLUMN IF NOT EXISTS` in `init-monitors.ts`. The routes must use existing column names unless a full migration (rename + data copy) is explicitly planned.
