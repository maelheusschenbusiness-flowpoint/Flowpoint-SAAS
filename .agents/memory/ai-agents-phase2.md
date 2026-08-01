---
name: AI Agents Phase 2 — correctifs certifiés
description: 3 correctifs livrés et certifiés (198+68 tests): missions.delete, Undo version_after exact, normalizeGeminiFinishReason
---

# AI Agents Phase 2 — correctifs certifiés (2026-08-01)

## Correctif 1 — missions.delete distinct de missions.write
`src/agent/permissions.ts` : `missions.delete` ajouté au PERMISSION_CATALOG, absent de `ALL_READ`, present dans bundles owner/admin/service uniquement.
`src/agent/mission-tools.ts` : `delete_mission.requiredPermission = "missions.delete"` (était `missions.write`).
**Why:** un membre pouvait supprimer des missions car il avait `missions.write`; suppression et modification sont des risques différents.
**Pattern clé:** `org_member_permissions` avec `mode: 'grant'|'revoke'` surcharge le bundle du rôle à l'exécution via `resolveEffectivePermissions`. Test §1-E/F le prouve.

## Correctif 2 — Undo version_after exact (zéro tolérance temporelle)
`src/agent/tool-executor.ts` : après chaque write (UPDATE/INSERT), un `SELECT updated_at` immédiat capture l'horodatage réel de la ligne; converti en ISO 8601 et stocké dans `ai_action_logs.version_after` (TEXT).
`src/services/init-agent-tables.ts` : `ALTER TABLE ai_action_logs ADD COLUMN IF NOT EXISTS version_after TEXT` dans le bloc self-heal.
`src/agent/undo.ts` : comparaison exacte `current.updated_at.toISOString() === log.version_after`. Toute différence → `PROPOSAL_STALE` (409). Si `version_after IS NULL` (ligne legacy) → skip (compat). Opérations idempotentes (create→DELETE, delete→INSERT) n'ont jamais besoin du check.
**Why:** l'approche `updated_at > created_at + 5s` tolérait les modifications concurrentes; l'utilisateur l'a rejetée explicitement.
**Codes de retour:** `PROPOSAL_STALE` (409), `TTL_EXPIRED` (410), `ALREADY_UNDONE` (409), `NO_SNAPSHOT` (422).

## Correctif 3 — normalizeGeminiFinishReason extractée et testée
`src/services/ai-providers/gemini-provider.ts` : `normalizeGeminiFinishReason(reason, textSoFar)` — fonction pure exportée. 6 cas : STOP/null→rien, MAX_TOKENS, SAFETY, RECITATION, ERROR, ABORTED. Messages en français, jamais d'internals. ABORTED avec textSoFar vide → appendText null. Retourne `{ appendText, logLevel, userFriendly }`.
`src/routes/qa-fixtures.ts` : `POST /api/qa/gemini-finish-reason` — fixture d'injection (gated par isQaFixturesEnabled()); monte en preuve sans clé Gemini réelle.
Note: la certification Phase 2 avait "finishReason non normalisé" dans ses limitations connues — cette limitation est maintenant corrigée.

## Routes QA fixtures (préfixe /api/)
CRITIQUE: les routes QA sont montées sous `/api/` (app.use("/api", router) dans app.ts). Appeler `/qa/...` sans le `/api/` → 404. Le test script doit cibler `http://localhost:8081/api/qa/...`.

## Scores finaux
- `qa_phase2_certification.cjs` : **198/198** (§1–§11, 2 runs post-correctifs)
- `qa_phase2_p2fixes.cjs` v2 : **68/68** (§1 permissions 8 tests, §2 undo 9 tests, §3 Gemini 33+Z tests, §4 frozen files 18 tests)

## Commits Phase 2
5 commits : `03bac7b` (permissions.ts + mission-tools.ts), `e45a8e4` (undo.ts v1), `abbb88e` (gemini-provider.ts), `435fc9d` (tool-executor + init-agent-tables + qa-fixtures), `91c833d` (undo.ts v2 exact + gemini-provider.ts final).

## Phase 3 — prête à démarrer
5 calendar tools : search_calendar, create_event, update_event, move_event, delete_event. Respecter le pattern confirmation+undo; `calendar_events` table existante (calendarEventsRouter).
