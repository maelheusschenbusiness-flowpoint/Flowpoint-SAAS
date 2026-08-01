---
name: Phase 2 Blockers — Undo atomic SQL + UNDO_VERSION_UNAVAILABLE + Gemini French + Undo UI
description: 5 fixes certifiés pour le gel Phase 2 AI Agents : SQL atomique, refus logs legacy, messages Gemini naturels, message max rounds, bouton Annuler frontend
---

## Undo — SQL atomique compare+restore (Bloquer 3)

**Rule:** L'UPDATE de restauration doit inclure `AND date_trunc('milliseconds', updated_at) = date_trunc('milliseconds', $N::TIMESTAMPTZ)`. Pas de SELECT séparé pour la version + UPDATE séparé.

**Why:** Race condition entre lecture de version et écriture. Aussi : PostgreSQL stocke les TIMESTAMP avec une précision microseconde, mais JS `Date.toISOString()` tronque à la milliseconde → comparaison directe échoue toujours. Troncature à la ms des deux côtés est la seule solution correcte.

**How to apply:** Dans tout service qui compare un `updated_at` stocké comme ISO string JS avec un TIMESTAMP PostgreSQL, utiliser `date_trunc('milliseconds', col) = date_trunc('milliseconds', $N::TIMESTAMPTZ)`.

---

## UNDO_VERSION_UNAVAILABLE — logs sans version_after refusés (Bloquer 2)

**Rule:** Si `version_after IS NULL` (log antérieur au déploiement), retourner `{ ok: false, code: "UNDO_VERSION_UNAVAILABLE" }` avec HTTP 409. Ne jamais appliquer l'undo sans validation de version.

**Why:** Un log legacy sans version_after ne peut pas garantir l'absence de modifications concurrentes invisibles. Refuser > écraser des données récentes silencieusement.

**How to apply:** Dans `undo.ts`, guard précoce avant applySnapshot : `if (!versionAfter) return { versionUnavailable: true }`. Dans les tests QA, les INSERTs dans ai_action_logs doivent inclure `version_after` (= updated_at après la mutation) pour les tests update/complete/assign.

---

## HTTP status codes pour les erreurs Undo

| Code | HTTP |
|------|------|
| NOT_FOUND | 404 |
| TTL_EXPIRED | 410 |
| ALREADY_UNDONE | 409 |
| PROPOSAL_STALE | 409 |
| UNDO_VERSION_UNAVAILABLE | 409 |

**Why:** Status sémantiques corrects. Les QA suites doivent matcher ces codes, pas systématiquement 400.

---

## Gemini messages naturels en français (Bloquer 4)

**Rule:** Les messages `appendText` de `normalizeGeminiFinishReason()` doivent être en français conversationnel à la première personne, sans : `*(...)`, `)*`, constantes (MAX_TOKENS, SAFETY…), "tronquée", "token".

Mapping des keywords QA :
- MAX_TOKENS → "terminer" ("Je n'ai pas pu terminer cette réponse.")
- SAFETY → "répondre" ("Je ne peux pas répondre à cette demande.")
- RECITATION → "reproduire" ("Je ne peux pas reproduire ce contenu.")
- ERROR → "erreur"
- ABORTED → "interrompue"

---

## Max rounds — finalTextEmitted: true + message utilisateur

**Rule:** Quand `runToolCallingLoop` atteint `MAX_TOOL_ROUNDS`, émettre un delta SSE avec un message utilisateur français (`res.write({ delta: "..." })`) puis retourner `{ finalTextEmitted: true }`. Ne pas retourner `finalTextEmitted: false` qui laisse le streaming ouvert.

---

## Bouton Annuler frontend — architecture

Fichiers : `dashboard.js` (main chat) + `fp-backend.js` (panel flottant).

- `enableTools: true` dans les deux fetch bodies
- `_confirmReq`, `_undoToken` tracking dans sendAIMessage (dashboard.js)
- SSE events parsés : `confirmation_request` → `_confirmReq`, `undo_available` → `_undoToken`
- Helpers dans renderAIMessages : `renderConfirmCard(cr)`, `renderUndoButton(ut)`
- Globals au module level : `window.fpAiConfirmAction`, `window.fpAiUndoAction`, `window.fpAiDismissConfirm`, `window.fpAiPanelConfirm`, `window.fpAiPanelUndo`
- Panel flottant : `onConfirmationRequest`, `onUndoAvailable`, `onToolCall` callbacks dans sendMessage
- FP_AI_CHAT_API (fp-backend.js) expose déjà `confirmAction(convId, proposalId)` et `undoAction(logId)`
