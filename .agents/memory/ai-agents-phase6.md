---
name: AI Agents Phase 6 — Monitors & Alertes
description: 12 outils monitors/incidents/alertes, 7 permissions, 8 destinations, undo handlers, 124/124 QA certifiés 2026-08-02
---

## Outils (12)
search_monitors, search_incidents, explain_incident, compare_incidents, acknowledge_incident,
resolve_incident, create_missions_from_incident, optimize_monitors, configure_monitor,
suspend_monitor, resume_monitor, delete_monitor

## Permissions (7)
monitors.read ✅✅✅✅ | monitors.write ✅✅✅❌ | monitors.delete ✅✅❌❌
monitors.configure ✅✅✅❌ | incidents.read ✅✅✅✅ | incidents.resolve ✅✅✅❌ | alerts.manage ✅✅❌❌

## Tables
- monitors: id, org_id, name, url, status, uptime, latency, is_critical, frequency, enabled, alert_email, alert_phone
- monitor_checks: id, monitor_id, org_id, checked_at, ok, latency, status_code, error
- monitor_incidents (NOT incidents): id, monitor_id, org_id, started_at, resolved_at, duration_s, error
- alert_events: id, org_id, monitor_id, rule_name, type, severity, message, triggered_at, read_at

## CRITICAL: batch undo handler placement
create_missions_from_incident batch undo MUST be placed BEFORE `const id = snap["id"]` in undo.ts.
That line throws if id is absent — batch snaps have `batchType`/`missions` but no top-level `id`.
**Why:** Same rule applies to all create_missions_from_* batch handlers (audit, strategy, incident).

## delete_monitor protections (without force=true)
1. Open incidents (monitor_incidents.resolved_at IS NULL)
2. Unread alerts (alert_events.read_at IS NULL AND resolved_at IS NULL)
3. Linked missions (mission title ILIKE '%monitorId%')

## optimize_monitors
Read-only — never modifies automatically. Returns proposals only.
User must call configure_monitor/suspend_monitor/delete_monitor to apply.

## undo handlers added to undo.ts
- resolve_incident: SET resolved_at=NULL, duration_s=NULL
- suspend_monitor: SET enabled=true (resume)
- delete_monitor: re-INSERT from snapshot (ON CONFLICT DO NOTHING)
- configure_monitor: if action="create" → DELETE; else → restore all fields from snapshot
- create_missions_from_incident: batch DELETE missions (batchType check BEFORE const id= line)

## ai_action_logs column: undo_snapshot (not snapshot, no duration_ms)

## Tool catalog
Phase 2 mission tool is named `search_mission` (singular), not `search_missions`.
