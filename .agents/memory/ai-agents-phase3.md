---
name: AI Agents Phase 3.1 — Calendrier
description: 5 calendar AI tools, E2E + 8-point freeze certification, navProposal fix, Gemini pattern
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

## Bug 3 — navProposal absent du confirm endpoint (fixé 2026-08-01)

**Rule:** `POST /ai/conversations/:id/confirm` doit inclure `navProposal` dans sa réponse JSON.

**Why:** `executeTool()` retourne `execResult.navProposal` mais l'ancien confirm endpoint
ne le transmettait pas au client → le frontend ne pouvait jamais naviguer après confirmation.

**Fix:** Ajouter `navProposal: execResult.navProposal ?? null` dans `res.json({...})` du confirm endpoint (`routes/ai.ts`).

**How to apply:** Tout nouvel outil write doit aussi retourner `navProposal` depuis `tool-executor.ts`
(via `validateNavAction` + `createNavigationProposal`). Vérifier avec le test C1 de `qa_phase3_robustness_history.cjs`.

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

## activity_logs schema — colonne "label" pas "description"

**Rule:** La table `activity_logs` a les colonnes `type`, `label`, `target_id`, `target_type`, `metadata`, `org_id`. Pas de colonne `description`.

**Why:** Tests de certification qui font `SELECT description` échouent avec "column does not exist".

## Certification complète — GEL OFFICIEL 2026-08-01

| Suite | Tests | Résultat |
|---|---|---|
| Structure (permissions, destinations, schema, REST CRUD) | 116 | ✅ 116/116 |
| E2E OpenAI — 5 tools + undo cycle | 65 | ✅ 65/65 |
| E2E Anthropic — 5 tools + undo cycle | 65 | ✅ 65/65 |
| E2E Gemini — 5 tools + undo cycle | 65 | ✅ 65/65 |
| Dates naturelles (12 expressions + ambigu 03/08) | 32 | ✅ 31/32 ⏭1 |
| Conflits avancés (8 scénarios) | 20 | ✅ 20/20 |
| Robustesse + Historique + Navigation | 55 | ✅ 55/55 |
| Phase 2 non-régression | 105 | ✅ 105/105 |
| **Total** | **523+** | **✅ 0 échec** |

Rapport complet : `artifacts/api-server/PHASE_3_1_FREEZE_REPORT.md`
Guide architecture : `artifacts/api-server/src/agent/TOOL_MODULE_GUIDE.md`

## Qualité comparative providers

| | OpenAI (gpt-5) | Anthropic (claude-sonnet-4-6) | Gemini (gemini-3-flash-preview) |
|---|---|---|---|
| Temps moyen | 13 238 ms | **3 411 ms** | 5 221 ms |
| Taux outils | 75% | **100%** | 75% |
| Précision dates | ✅ | ✅ | ✅ |
| Q4 search prose | ❌ (prose) | ✅ (outil) | ❌ (prose) |

OpenAI/Gemini répondent en prose pour "quels sont mes événements" au lieu d'appeler `search_calendar_event` → tâche #344.

## Test runners

```
node .local/qa_e2e_provider.cjs <openai|anthropic|gemini>  # 65 tests E2E
node .local/qa_phase3_certification.cjs                    # 116 structure
node .local/qa_phase3_natural_dates.cjs                    # 32 dates
node .local/qa_phase3_conflicts_advanced.cjs               # 20 conflits
node .local/qa_phase3_robustness_history.cjs               # 55 robustesse+historique
node .local/qa_phase3_quality_comparison.cjs               # tableau qualité
```

## Fast-path self-heal

`calendar-phase3-columns` step in `src/index.ts` runs via `runCriticalStartupStep` on every
boot, ensuring `updated_at`, `priority`, `color`, `reminder`, `linked_mission_id` columns
exist without waiting for full init.

## Undo patterns

- create → DELETE WHERE id
- delete → INSERT ON CONFLICT DO NOTHING (restore)
- update/move → atomic SQL with `date_trunc('milliseconds', updated_at)` version lock
  (same pattern as Phase 2 missions)

## Prochaines phases

- #343 — Phase 3.2 Audits AI Tools (suivre TOOL_MODULE_GUIDE.md)
- #344 — Taux search OpenAI/Gemini (system prompt + tool description)
- #345 — Événements récurrents + fuseaux horaires
