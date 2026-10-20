# RAPPORT FREEZE — Phase 6 : IA Monitors, Alertes & Incidents
**Date :** 2026-08-02  
**Statut :** ✅ CERTIFIÉ — 124/124 tests passés

---

## Résumé

Phase 6 transforme FlowPoint en copilote opérationnel : l'IA comprend en temps réel l'état de santé des sites surveillés, détecte les incidents, en explique les causes, mesure l'impact, propose les actions prioritaires, crée les missions associées et suit la résolution — le tout fondé sur les données réelles de FlowPoint.

---

## Périmètre livré

### 12 nouveaux outils IA

| Outil | Permission | confirmationLevel | isWrite | Undo |
|---|---|---|---|---|
| `search_monitors` | `monitors.read` | none | false | — |
| `search_incidents` | `incidents.read` | none | false | — |
| `explain_incident` | `incidents.read` | none | false | — |
| `compare_incidents` | `incidents.read` | none | false | — |
| `acknowledge_incident` | `incidents.resolve` | preview | true | — |
| `resolve_incident` | `incidents.resolve` | full | true | ✅ |
| `create_missions_from_incident` | `monitors.write` | full | true | ✅ |
| `optimize_monitors` | `monitors.read` | none | false | — |
| `configure_monitor` | `monitors.configure` | full | true | ✅ |
| `suspend_monitor` | `monitors.write` | preview | true | ✅ |
| `resume_monitor` | `monitors.write` | preview | true | — |
| `delete_monitor` | `monitors.delete` | full | true | ✅ |

### 7 nouvelles permissions

| Permission | Owner | Admin | Member | Viewer |
|---|---|---|---|---|
| `monitors.read` | ✅ | ✅ | ✅ | ✅ |
| `monitors.write` | ✅ | ✅ | ✅ | ❌ |
| `monitors.delete` | ✅ | ✅ | ❌ | ❌ |
| `monitors.configure` | ✅ | ✅ | ✅ | ❌ |
| `incidents.read` | ✅ | ✅ | ✅ | ✅ |
| `incidents.resolve` | ✅ | ✅ | ✅ | ❌ |
| `alerts.manage` | ✅ | ✅ | ❌ | ❌ |

### 8 nouvelles destinations

| id | route → sub | Permission requise |
|---|---|---|
| `monitor-list` | monitors | monitors.read |
| `monitor-detail` | monitors/detail | monitors.read |
| `monitor-health` | monitors/health | monitors.read |
| `incident-list` | monitors/incidents | incidents.read |
| `incident-detail` | monitors/incident | incidents.read |
| `incident-history` | monitors/incident-history | incidents.read |
| `incident-timeline` | monitors/incident-timeline | incidents.read |
| `alert-center` | alerts | alerts.read |

---

## Fichiers créés / modifiés

| Fichier | Changement |
|---|---|
| `src/agent/monitor-tools.ts` | **NOUVEAU** — 12 ToolDef, Zod schemas, helpers `snapMonitor` / `snapIncident` / `fmtMonitorStatus` / `fmtDurationS` / `fmtUptimePct` |
| `src/agent/permissions.ts` | +7 permissions Phase 6, ROLE_BUNDLES member mis à jour |
| `src/agent/tool-executor.ts` | +12 branches dispatch Phase 6 (~500 lignes) + imports MONITOR_TOOL_BY_NAME/MONITOR_ARG_SCHEMAS |
| `src/agent/undo.ts` | +`create_missions_from_incident` batch undo + handlers `resolve_incident` / `suspend_monitor` / `delete_monitor` / `configure_monitor` ; array `monitorTools` ajouté au targetType |
| `src/agent/destinations.json` | +8 destinations Phase 6 |
| `src/routes/ai.ts` | Import `MONITOR_TOOLS`, extension `ALL_TOOLS`, bloc `=== MONITOR HEALTH ===` dans `buildFlowpointContext` |
| `qa_phase6_certification.cjs` | **NOUVEAU** — 124 assertions, 19 groupes |

---

## Architecture technique clé

### Tables utilisées
- `monitors` : id, org_id, name, url, status, uptime, latency, is_critical, frequency, enabled, alert_email, alert_phone
- `monitor_checks` : id, monitor_id, org_id, checked_at, ok, latency, status_code, error
- `monitor_incidents` : id, monitor_id, org_id, started_at, resolved_at, duration_s, error
- `alert_events` : id, org_id, monitor_id, rule_name, type, severity, message, triggered_at, read_at

### delete_monitor — 3 protections (sans `force=true`)
1. Incidents ouverts (`monitor_incidents.resolved_at IS NULL`)
2. Alertes non lues (`alert_events.read_at IS NULL AND resolved_at IS NULL`)
3. Missions liées (titre contient l'ID du monitor)

### create_missions_from_incident — 4 types de missions
- `investigation` : Analyser la cause → priorité high
- `correction` : Déployer le fix → priorité high
- `verification` : Tester après correction → priorité medium
- `suivi` : Surveiller 48h post-fix → priorité low

### optimize_monitors — jamais automatique
L'outil analyse uniquement et retourne des propositions. Aucune modification automatique.
Il faut appeler `configure_monitor` / `suspend_monitor` / `delete_monitor` pour appliquer.

### Contexte `=== MONITOR HEALTH ===`

Injecté dans `buildFlowpointContext()` après SEO INTELLIGENCE :
- Uptime global moyen + latence moyenne
- Nombre de monitors hors ligne / suspendus
- Incidents actifs (liste compacte)
- Monitors critiques hors ligne
- Alertes non lues
- Dernière panne + dernier incident résolu
- 12 règles STRICT_AI_RULE pour le dispatch des outils

---

## Corrections détectées pendant QA

1. **`src/agent/undo.ts`** — le handler batch `create_missions_from_incident` était positionné APRÈS `const id = snap["id"]` qui throw si l'id est absent. Déplacé AVANT cette ligne (même position que `create_missions_from_audit` / `create_missions_from_strategy`).

2. **`qa_phase6_certification.cjs`** — le tool Phase 2 s'appelle `search_mission` (singulier) pas `search_missions`.

---

## Résultats QA (124/124)

| Groupe | Tests | Résultat |
|---|---|---|
| G1 — Catalogue outils (12 tools × structure) | 14+36=50 | ✅ 50/50 |
| G2 — Permissions (7 nouvelles + matrix) | 18 | ✅ 18/18 |
| G3 — search_monitors | 3 | ✅ 3/3 |
| G4 — search_incidents | 3 | ✅ 3/3 |
| G5 — explain_incident | 3 | ✅ 3/3 |
| G6 — compare_incidents | 1 | ✅ 1/1 |
| G7 — acknowledge_incident | 1 | ✅ 1/1 |
| G8 — resolve_incident + undo | 4 | ✅ 4/4 |
| G9 — create_missions_from_incident + undo | 4 | ✅ 4/4 |
| G10 — optimize_monitors | 1 | ✅ 1/1 |
| G11 — configure_monitor + undo | 4 | ✅ 4/4 |
| G12 — suspend_monitor + undo | 4 | ✅ 4/4 |
| G13 — resume_monitor | 2 | ✅ 2/2 |
| G14 — delete_monitor (protections + undo) | 5 | ✅ 5/5 |
| G15 — Destinations Phase 6 (8 nouvelles) | 9 | ✅ 9/9 |
| G16 — Permission matrix (viewer/member) | 3 | ✅ 3/3 |
| G17 — Cross-org isolation | 2 | ✅ 2/2 |
| G18 — Contexte MONITOR HEALTH | 1 | ✅ 1/1 |
| G19 — Non-régression Phases 1-5 | 6 | ✅ 6/6 |
| **TOTAL** | **124** | **✅ 124/124** |

---

## État final du moteur IA Phases 1–6

| Phase | Outils | Permissions | Destinations | Statut |
|---|---|---|---|---|
| Phase 1 — Navigation | N/A | N/A | 28+ | ✅ GELÉE |
| Phase 2 — Missions | 6 | 2 | 3 | ✅ GELÉE |
| Phase 3 — Calendrier | 8 | 2 | 6 | ✅ GELÉE |
| Phase 4 — Audits | 9 | 3 | 5 | ✅ GELÉE |
| Phase 5 — Intelligence SEO | 10 | 6 | 6 | ✅ GELÉE |
| Phase 6 — Monitors & Alertes | **12** | **7** | **8** | ✅ GELÉE |
| **TOTAL** | **45+** | **20+** | **56+** | ✅ |

---

## Prochaines étapes suggérées

- **Frontend Phase 6** : tableau de bord santé monitors, liste incidents, timeline, centre alertes
- **Notifications temps réel** : webhook/SSE pour incidents critiques détectés
- **SSL monitoring** : ajouter colonne `ssl_expiry` sur `monitors` + outil `check_ssl_certificate`
- **Alertes proactives** : l'IA propose des missions avant que l'utilisateur ne pose la question (mode "push")
