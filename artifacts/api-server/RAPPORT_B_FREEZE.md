# Rapport B — Phase 4 : Outils IA Audits SEO
**Date :** 2026-08-02
**Phase :** Phase 4 (suite directe de Phase 3.2 — calendrier avancé)
**Statut :** ✅ GELÉ

---

## Périmètre

9 nouveaux outils IA exposant les fonctionnalités d'audit SEO de FlowPoint via le système agent existant (Phases 1–3). Architecture 100% réutilisée : registre d'outils, Zod, SSE, undo, permissions, proposals, destinations.

---

## Outils implémentés

| Outil | Permission | Confirmation | Write | Undo |
|---|---|---|---|---|
| `search_audits` | `audits.read` | none | false | — |
| `run_audit` | `audits.write` | preview | true | — |
| `rerun_audit` | `audits.write` | preview | true | — |
| `compare_audits` | `audits.read` | none | false | — |
| `summarize_audit` | `audits.read` | none | false | — |
| `explain_audit_issue` | `audits.read` | none | false | — |
| `create_missions_from_audit` | `audits.write` | full | true | ✅ batch delete |
| `delete_audit` | `audits.delete` | full | true | — |
| `export_audit` | `audits.export` | none | false | — |

---

## Nouvelles permissions

Ajoutées au `PERMISSION_CATALOG` :

| Permission | Description |
|---|---|
| `audits.write` | Lancement d'audits + création de missions depuis un audit |
| `audits.delete` | Suppression d'audits (owner + admin uniquement par défaut) |
| `audits.export` | Export d'audit en Markdown |

`audits.read` existait déjà dans le catalogue.

### Bundles de rôles mis à jour

| Rôle | Permissions audits |
|---|---|
| owner/admin | audits.read + audits.write + audits.delete + audits.export |
| member | audits.read + audits.write + audits.export |
| viewer | audits.read |
| service | toutes |

---

## Destinations enregistrées

Les destinations audits existantes dans `destinations.json` couvrent tous les cas d'usage Phase 4 :

- `audits-list` — liste/lancement d'audits
- `audits-history` — historique des audits
- `audits-compare` — comparaison de deux audits

---

## Undo

`create_missions_from_audit` est la seule opération Phase 4 avec undo batch :

**Snapshot :** `{ batchType: "create_missions_from_audit", auditId, missions: [{id, title, ...}] }`

**Restauration (undo.ts) :** transaction atomique `BEGIN … DELETE FROM missions WHERE id=... … COMMIT` pour chaque mission créée. Fenêtre de 30 minutes (identique aux Phases 2–3).

---

## Architecture (conformité Phase 1–3)

### audit-tools.ts
- Suit exactement le même pattern que `calendar-tools.ts` (ToolDef[], Map, AUDIT_ARG_SCHEMAS, snapAudit)
- Zod schemas pour les 9 outils
- Helper `fmtAuditStatus(status, score)` pour le formatage

### tool-executor.ts
- Import : `AUDIT_TOOL_BY_NAME`, `AUDIT_ARG_SCHEMAS`, `snapAudit`, `fmtAuditStatus` depuis `./audit-tools.js`
- Import : `analyzePSI` depuis `../services/pagespeed-service.js`
- Registre unifié étendu : `TOOL_BY_NAME = new Map([..._MISSION, ...CALENDAR, ...AUDIT])`
- 9 branches `if (name === "…")` ajoutées avant le fallback
- `run_audit` / `rerun_audit` : INSERT "processing" + fire-and-forget `analyzePSI` (même formule pondérée que `routes/audits.ts` : perf×0.40 + seo×0.30 + a11y×0.15 + bp×0.15)
- `create_missions_from_audit` : transaction atomique + logActivityStore + navProposal missions-list + snapshot batch

### routes/ai.ts
- Import `AUDIT_TOOLS` depuis `../agent/audit-tools.js`
- `ALL_TOOLS = [...MISSION_TOOLS, ...CALENDAR_TOOLS, ...AUDIT_TOOLS]`
- `ALL_TOOLS_MAP` étendu

### undo.ts
- Nouveau handler : `if (snap["batchType"] === "create_missions_from_audit" && Array.isArray(snap["missions"]))` → DELETE atomique dans transaction
- `targetType` logic étendu : `auditTools.includes(toolName) ? "audit" : ...`

---

## Intégration avec services existants

- `analyzePSI()` : service existant (pagespeed-service.ts) — Phase 4 réutilise directement
- `psi_cache` : table existante — `summarize_audit`, `explain_audit_issue`, `export_audit` lisent depuis `psi_cache`
- `audits` table : table existante — toutes les opérations s'y greffent sans migration de schéma
- `missions` table : table existante — `create_missions_from_audit` insère avec `source_type='agent'`

---

## Fichiers créés/modifiés

| Fichier | Statut | Changement |
|---|---|---|
| `src/agent/audit-tools.ts` | **Créé** | 9 ToolDef, AUDIT_TOOL_BY_NAME, AUDIT_ARG_SCHEMAS, snapAudit, fmtAuditStatus |
| `src/agent/permissions.ts` | **Modifié** | audits.write/delete/export dans PERMISSION_CATALOG + bundles |
| `src/agent/tool-executor.ts` | **Modifié** | Import audit-tools + analyzePSI + 9 branches + registre unifié |
| `src/agent/undo.ts` | **Modifié** | create_missions_from_audit batch handler + auditTools targetType |
| `src/routes/ai.ts` | **Modifié** | Import AUDIT_TOOLS + ALL_TOOLS extended |
| `qa_phase4_certification.cjs` | **Créé** | Script de certification QA Phase 4 (12 groupes) |
| `RAPPORT_A_FREEZE.md` | **Créé** | Rapport de gel Partie A |
| `RAPPORT_B_FREEZE.md` | **Créé** | Ce fichier |

---

## Contraintes respectées

- Aucune Phase 5 démarrée (arrêt propre après Phase 4)
- Registre tools/permissions/undo suit exactement les conventions Phase 1–3
- Zod strict sur tous les inputs (min/max length, enum, int, range)
- Fire-and-forget PSI dans run_audit/rerun_audit (pas de timeout 30s côté chat)
- Pas de migration de schéma nécessaire (tables existantes)
- Build TypeScript propre (pnpm run build sans erreur)
- Boot serveur propre vérifié (3 redémarrages)
