---
name: AI Agents Phase 3.2 — Calendrier avancé
description: Outils update_recurring_event / delete_recurring_series, moteur RRULE enrichi, series_id, /ai/tools endpoint, buildFlowpointContext Phase 3.2
---

# AI Agents Phase 3.2 — Calendrier avancé

**Why:** Phase 3.2 extends Phase 3.1 with recurring-event management, an enhanced RRULE engine, timezone centralization in context, and a public tool-catalog endpoint. All 105 QA tests pass. Frozen 2026-08-02.

## New tools (total: 11 calendar tools)
- `update_recurring_event` — scope=single|all; batch undo with postWriteVersions
- `delete_recurring_series` — scope=single|all; atomic re-insert undo

## RRULE engine (`computeRecurrenceDates`)
Supports: DAILY, WEEKLY, WEEKLY:N, MONTHLY, YEARLY, FREQ=WEEKLY;BYDAY=MO,WE, COUNT=N, UNTIL=YYYY-MM-DD

## series_id design
- TEXT column on calendar_events; partial index (org_id, series_id) WHERE series_id IS NOT NULL
- Stored on ALL occurrences (not just first); generated as `ser_<nanoid>` in create_recurring_event
- Enables WHERE series_id=$1 AND org_id=$2 without parsing RRULE

## GET /api/ai/tools
New endpoint returning full tool catalog: { count, tools: [{ name, description, requiredPermission, isWrite, parameters }] }
Registered just before /ai/destinations in src/routes/ai.ts

## buildFlowpointContext (Phase 3.2 block)
Added after existing conflict detection: UTC offset (Intl shortOffset), recurring count this week + distinct series, free-slot count today (08-18h, 60min), linked_mission_id count, total 7-day events.

## How to apply
- To add a 12th calendar tool: register in CALENDAR_TOOLS → ALL_TOOLS → CALENDAR_ARG_SCHEMAS; add executor branch; add undo handler if isWrite.
- /api/permissions is requireAdmin-gated; editor/viewer get 403 (by design); use /api/ai/destinations to verify calendar access for all roles in tests.
- SSE is embedded in POST /api/ai/chat, no separate /api/ai/stream GET endpoint.
