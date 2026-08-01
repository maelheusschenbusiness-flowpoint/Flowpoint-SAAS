---
name: AI Agents Phase 2 — Tool Calling Missions
description: Architecture tool-calling Phase 2 : 7 outils missions + navigate_to, boucle SSE, confirmation/undo.
---

# AI Agents Phase 2 — Tool Calling Missions

## Fichiers clés
- `agent/mission-tools.ts` — définitions universelles (JSON Schema), niveaux confirmation, permissions requises
- `agent/tool-executor.ts` — validation Zod → permission → snapshot → service → log
- `agent/undo.ts` — restaure depuis `ai_action_logs.undo_snapshot` (TTL 30 min)
- `agent/proposals.ts` — `createPendingToolProposal()` pour kind=pending_tool_call
- `services/ai-tool-calling.ts` — adaptateurs function-calling OpenAI/Anthropic/Gemini (non-streaming)
- `routes/ai.ts` — `runToolCallingLoop()` helper + 3 nouveaux endpoints

## Niveaux de confirmation
- `none` — exécution immédiate dans la boucle SSE
- `preview` — suspend SSE, émet `confirmation_request`, stocke dans ai_action_proposals
- `full` — idem preview (pas de différence technique en Phase 2)

## Protocole SSE Phase 2 (nouveaux events)
```
{"tool_call":    {"id","name","args","confirmationLevel"}}
{"tool_result":  {"id","toolCallId","name","ok","content"}}
{"confirmation_request": {"proposalId","toolName","confirmationLevel","preview","args","expiresAt"}}
{"undo_available": {"actionLogId","label","ttlMinutes":30}}
```

## Nouveaux endpoints
- `GET  /api/ai/actions` — liste ai_action_logs de l'org
- `POST /api/ai/actions/:id/undo` — annuler (TTL 30 min, snapshot requis)
- `POST /api/ai/conversations/:id/confirm` — exécuter un pending_tool_call

## Opt-in
- `enableTools: true` dans le body de `/api/ai/chat` active la boucle
- Sans ce flag : comportement Phase 1 identique

## Permissions Phase 2
- `missions.write` ajouté au catalogue — owner/admin/member ont ce droit ; viewer non
- `missions.read` requis pour activer la boucle

## QA
- `.local/qa_agent_phase2.cjs` — 21 checks : permissions, undo, cross-org, confirm, timeline, enableTools=false
- Requiert `pg` depuis `/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg`
- Utilise `org_settings` (pas `organizations`) pour créer les orgs de test

**Why:** La confirmation évite les actions accidentelles. L'undo est borné à 30 min pour éviter les états inconsistants après d'autres modifications. FAIL-CLOSED sur les permissions comme Phase 1.
