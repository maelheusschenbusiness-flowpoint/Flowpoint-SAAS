---
name: AI Agents Phase 1 — navigation par registre
description: Architecture livrée pour la navigation IA (registre partagé, marqueur SSE retenu, propositions journalisées) — à respecter pour les Phases 2+
---

# AI Agents Phase 1 — patterns durables

## Registre = source de vérité unique
`src/agent/destinations.json` est consommé par : backend (validation), frontend (`GET /api/ai/destinations`), prompt IA, tests (`.local/qa_agent_destinations.cjs`). Toute nouvelle destination/ancre/permission passe par ce fichier — jamais de route en dur ailleurs. Zod le valide au chargement du module : registre invalide = boot refusé.
**Why:** exigence utilisateur n°1 — toute divergence registre↔frontend doit faire échouer la certification, pas être rattrapée silencieusement.

## Marqueur SSE retenu côté serveur
Le modèle émet `<<<FP_NAV>>>{json}<<<END_NAV>>>` en fin de réponse. `NavMarkerFilter` (nav-agent.ts) le retient du flux (préfixe partiel multi-chunks géré, capture bornée à 8 Ko — au-delà : drop silencieux, jamais de fuite). Protocole SSE additif : `delta → action_proposal → _ai → [DONE]` — les clients qui ignorent `action_proposal` fonctionnent inchangés.

## Décisions de sécurité verrouillées (revue architecte)
- `resolveEffectivePermissions` est **FAIL-CLOSED** : panne de lecture `org_member_permissions` → Set vide (zéro destination agent), jamais le bundle du rôle seul — sinon une panne transitoire restaurerait une permission révoquée.
- Prefill validé **des deux côtés** contre `dest.prefill` (champs déclarés, type/maxLength/enum) : serveur dans `validateNavAction`, client dans `navigateToDestination`. Pas de spec déclarée → aucun param accepté.
- Destination inventée / permission absente / plan insuffisant / ancre non déclarée → action jetée + log, jamais montrée.
- Proposition non journalisable (échec INSERT `ai_action_proposals`) → proposition supprimée : jamais de bouton non traçable.

## Frontend
- `window.navigateToDestination` défini au niveau module (leçon window.apiAction timing), boutons via data-attributes + `_fpNavDest(this)` (jamais de JSON dans onclick).
- Ancres : `data-fp-anchor="…"` dans les renderers ; flash CSS `.fp-anchor-flash` dans dashboard.css. L'ancre doit exister dans dashboard.js sinon la QA statique échoue.
- L'heuristique `_detectNavActions` (side panel) a été SUPPRIMÉE — ne pas la réintroduire : les boutons viennent exclusivement des propositions serveur.

## Phases suivantes (contrat v2)
2 = Missions (tool-calling), 3 = Calendar, 4 = extension. Billing : zéro write tool + hard guard, toujours. Autonomie préparée non activée (`organizations.ai_autonomy_level` = 'copilot', `ai_autopilot_grants`). Undo via snapshot dans `ai_action_logs`.

## QA
`.local/qa_agent_destinations.cjs` (statique + API, 221 checks) et `.local/qa_agent_live_cert.cjs` (live 3 providers, 50 checks) doivent repasser à chaque évolution du registre ou du pipeline chat.
