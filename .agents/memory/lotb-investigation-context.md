---
name: Wave 2 Lot B investigation context
description: Pre-investigation requirements for MON-001, ALT-002, ALT-003, REP-001, MON-002 before any code change
---

# Wave 2 Lot B — Investigation requirements before any fix

## BUG-W2-MON-001 (pause/resume)
Must read: monitor DB schema, cron selector logic, identify real pause field
(enabled/active/isPaused/pausedAt). Must trace UI pause button handler.
Must verify no dedicated endpoint exists already.
Fix must be end-to-end: backend field + cron exclusion + UI render + persist.

## BUG-W2-ALT-002 (alert-rules type-discriminated validation)
Current state: operator+threshold required unconditionally.
Required: discriminate by type — monitor_down does NOT need operator/threshold.
Must audit actual UI payload sent for each type before aligning contract.

## BUG-W2-ALT-003 (alert_events empty — not yet confirmed)
Must NOT fix on empty collection alone.
Required steps:
1. Create a monitor_down rule linked to a controllable monitor
2. Trigger real UP→DOWN transition (or use test endpoint if one exists)
3. Wait for cron execution
4. Verify alert_events insertion → API → UI
Only then fix the engine if no events are created.

## BUG-W2-REP-001 (PDF download 404)
Must trace: POST create → status → worker/generator → file storage → download endpoint.
Must determine: does a worker exist? what field holds file path/URL?
what statuses are used? is download signed/sessioned?
Fix must produce a real downloadable file OR an explicit error state.
Masking the button alone is FORBIDDEN.

## BUG-W2-MON-002 (latency 0 display)
Must distinguish: never-checked (lastCheckedAt null) vs checked-with-zero vs absent.
Use a reliable signal (lastCheckedAt, checksCount, or status flag).
Do NOT blindly convert latency===0 to —.
