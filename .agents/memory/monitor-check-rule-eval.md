---
name: Monitor check rule evaluation scope
description: Latency/uptime threshold rules must run on every check, not inside the notifyAfterCommit block.
---

## Rule
The latency/uptime alert_event evaluation in `saveCheckResult` (monitors.ts) must be a
**standalone fire-and-forget IIFE** placed AFTER the `if (notifyAfterCommit) { ... }` block,
not inside it.

**Why:** `notifyAfterCommit` is only set on monitor state transitions (up→down or down→up).
A monitor that stays `up` across repeated checks never enters that block, so threshold rules
would never fire — this was BUG-W2-ALT-003.

**How to apply:**
- Keep `if (notifyAfterCommit)` for email/SMS notifications and monitor_down/up alert events.
- Add a separate `(async () => { ... })()` block (unconditional) that evaluates latency/uptime rules.
- Inside that block, fetch monitor URL via `pool.query` since `notifyAfterCommit.mon` is not in scope.
- Uses `result.latencyMs` (from performCheck) and `capturedUptimePct` (hoisted from withOrgDb callback).

## QA harness gotchas
- Filter events by `ruleId` (not just type+monitorId) — leftover enabled rules from prior test
  runs will also fire and pollute counts.
- Uptime threshold must be in [0,100] (strict validation); use threshold=50/operator=lt to always
  trigger when uptime=0%, and threshold=0 to resolve (0%<0 = false).
- Use unique URL per run (append `Date.now()` suffix) to avoid the "URL already monitored" dedup guard.
- Pass `null` as body (not `{}`) for PATCH endpoints with no payload — `api()` must skip body when null.
