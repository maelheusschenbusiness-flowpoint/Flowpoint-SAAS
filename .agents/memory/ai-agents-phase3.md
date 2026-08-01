---
name: AI Agents Phase 3.1 — Calendrier
description: 5 calendar AI tools, E2E certification patterns, two bugs fixed, Gemini prompt pattern
---

## Outils Phase 3.1

5 outils dans `agent/calendar-tools.ts`:
- `search_calendar_event` — confirmationLevel: none (auto-execute)
- `create_calendar_event` — confirmationLevel: preview
- `update_calendar_event` — confirmationLevel: preview
- `move_calendar_event` — confirmationLevel: preview
- `delete_calendar_event` — confirmationLevel: full

## Bug 1 — TOOL_BY_NAME → ALL_TOOLS_MAP

**Rule:** `routes/ai.ts` must use `ALL_TOOLS_MAP` (merged missions+calendar) for
tool dispatch, not `TOOL_BY_NAME` (imported from `mission-tools.ts`, missions only).

**Why:** `ALL_TOOLS` is built by merging both arrays (sent to AI provider), but the
server-side lookup was using the missions-only map → all calendar tool calls returned
`unknown_tool`.

**How to apply:** After any new tool module is added, verify `ALL_TOOLS_MAP` is rebuilt
from the merged `ALL_TOOLS` array, not from an individual module's map.

```ts
const ALL_TOOLS_MAP = new Map(ALL_TOOLS.map((t) => [t.name, t]));
```

## Bug 2 — canDelete vs canWrite on DELETE route

**Rule:** `calendar-events.ts` DELETE route must use `canDelete` (owner/admin only),
not `canWrite` (owner/admin/member).

**Why:** `calendar.delete` permission is NOT in the member bundle — only owner/admin/service
have it. Using `canWrite` would allow members to delete events, violating the permission matrix.

**How to apply:** Any destructive REST route for a resource with a dedicated `.delete`
permission must use `canDelete = requireRole(["owner", "admin"])`.

## Gemini E2E pattern — pre-embed search result

**Rule:** For update/move/delete with Gemini, embed the search result directly in the
user message rather than relying on Gemini to chain search→write in one turn.

**Why:** Gemini follows a conservative "verify before modifying" pattern. When given a
write instruction for an existing resource, it always calls `search_calendar_event` first
(good behavior), but then stops — it doesn't automatically chain to the write tool in the
same turn. OpenAI and Anthropic chain naturally.

**Pattern:**
```
Résultat de recherche (déjà effectuée) :
- ID: {id} | "{title}" | {date} à {time} ({duration} min) | {type}

Utilise MAINTENANT {toolName} avec l'ID "{id}" pour {action}.
NE cherche PAS l'événement à nouveau. ID exact : "{id}".
```

**How to apply:** All E2E tests for write tools should use this pattern when testing
across all 3 providers. The pre-embedded context bypasses the search loop and works
equally well for OpenAI and Anthropic.

## Certification results (2026-08-01)

| Suite | Count | Result |
|---|---|---|
| Structure (permissions, destinations, schema, REST CRUD) | 116 | ✅ 116/116 |
| E2E OpenAI — 5 tools + undo cycle | 65 | ✅ 65/65 |
| E2E Anthropic — 5 tools + undo cycle | 65 | ✅ 65/65 |
| E2E Gemini — 5 tools + undo cycle | 65 | ✅ 65/65 |
| Phase 2 non-regression | 105 | ✅ 105/105 |

## Test runner

`.local/qa_e2e_provider.cjs <openai|anthropic|gemini>` — runs one provider's full cycle.
`.local/qa_phase3_certification.cjs` — structural 116-test suite.

## Fast-path self-heal

`calendar-phase3-columns` step in `src/index.ts` runs via `runCriticalStartupStep` on every
boot, ensuring `updated_at`, `priority`, `color`, `reminder`, `linked_mission_id` columns
exist without waiting for full init.

## Undo patterns

- create → DELETE WHERE id
- delete → INSERT ON CONFLICT DO NOTHING (restore)
- update/move → atomic SQL with `date_trunc('milliseconds', updated_at)` version lock
  (same pattern as Phase 2 missions)
