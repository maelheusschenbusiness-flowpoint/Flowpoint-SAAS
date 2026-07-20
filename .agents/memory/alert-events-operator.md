---
name: alert_events operator nullable
description: alert_events.operator must allow NULL; event-based alert types have no operator value
---

## Rule
`alert_events.operator` must be nullable. The original CREATE TABLE has `operator TEXT NOT NULL DEFAULT 'lt'`, which blocks INSERTs for event-based alert types (monitor_down, monitor_up) that pass NULL as operator.

**Why:** Threshold-based alerts (seo_score, etc.) use operators like `lt`/`gt`. Event-based alerts (monitor_down/up) have no meaningful operator — there is no threshold comparison, only a state transition. Forcing NOT NULL causes a 500 on every monitor_down event creation.

**How to apply:**
- In `init-data-tables.ts`, after the ADD COLUMN block for ALT-003, add:
  ```sql
  ALTER TABLE alert_events ALTER COLUMN operator DROP NOT NULL;
  ALTER TABLE alert_events ALTER COLUMN operator DROP DEFAULT;
  ```
- If the live DB already has the constraint, patch it directly via pool query before the next QA run.
- When inserting alert_events for monitor_down/up, pass `null` (not `''`) for operator, threshold, and metric_value — they are semantically absent.

## QA token note
When generating a QA session token, the `org_id` in `user_sessions` must not be `'default'` — the `requireValidOrg` middleware in `routes/index.ts` blocks `orgId === 'default'` with 401. Use an existing non-default org from `org_settings` (e.g. `qa@flowpoint.test`).
