---
name: Scheduled audits cron pattern
description: How audit_schedules rows are executed safely (atomic claim, bigint vs timestamp, dup guard) and pitfalls around next_run
---

## Rule
Scheduled-audit execution lives in `services/audit-schedule-cron.ts` (tick every 60 s from `startMonitorCron`), sharing `services/audit-runner.ts::launchAudit()` with POST /audits so both origins get identical side effects (PSI, alert rules, broadcast, activity, usage event).

**Why:** duplicating the launch logic caused drift; and any *display-time* roll-forward of `next_run` (the old self-heal in routes/audits.ts) races with the executor and silently skips runs. Only the cron may advance `next_run`.

## How to apply
- **Atomic claim before launch** (multi-instance safe): `UPDATE audit_schedules SET next_run=$new WHERE id=$x AND next_run <= $now AND org_id=$org RETURNING id` — row locks serialize instances; the loser matches 0 rows. Never use equality on the old value (timestamp µs precision can wedge the row forever).
- `next_run`/`last_run` are **BIGINT epoch-ms in live DBs**, TIMESTAMP on fresh installs. Detect once via `information_schema.columns` and write the matching type; for timestamp mode compare with `to_timestamp($ms/1000.0)`.
- Same-day dup guard via `findAuditToday(orgId,url)` (compares `created_at`, never the TEXT `audits.date` column). Claim first, then dup-check: a dup still rolls the schedule forward without launching.
- Roll forward from *now* (not from stored next_run) so a long-overdue schedule fires once, not N times. `ORDER BY next_run ASC` + bounded batch prevents starvation.
- `status='error'` on audits is ALSO the legitimate low-score bucket (<50); a real PSI failure sets score=0. QA must assert `score > 0`, not `status !== 'error'`.
