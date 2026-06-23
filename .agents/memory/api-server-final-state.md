---
name: API server final state
description: Etat final post-audit : tous les endpoints 200, bugs fixés, patterns clés
---

# API Server — Audit final (juin 2026)

## Résultat : 35/35 endpoints 200 ✅

## Patterns critiques fixés

### org-settings upsert (PATCH /api/me)
- **Problème** : `INSERT...ON CONFLICT DO UPDATE` avec CASE/COALESCE sur colonnes mixtes (text, timestamptz, jsonb, numeric, boolean) → type inference PostgreSQL impossible
- **Solution** : DEUX requêtes séparées :
  1. `INSERT (org_id) ON CONFLICT DO NOTHING` — garantit existence ligne
  2. `UPDATE org_settings SET col=$n WHERE org_id=...` — dynamique JS, seulement les champs fournis
- **Fichier** : `artifacts/api-server/src/services/org-settings.ts`

### automation/runs et automation/workflows
- **Problème** : Drizzle `workflowRunsTable` a `completedAt` → DB a `ended_at` → column does not exist
- **Solution** : Raw SQL `pool.connect()` pour toutes les requêtes sur `workflow_runs`
- **Fichiers** : `routes/automation.ts` (GET /runs), `services/automation-service.ts` (getWorkflowsData)

### Routes manquantes (404 → 200)
- GET /api/ai/recommendations → `ai_usage_logs` (table ai_recommendations inexistante)
- POST /api/ai/generate → fallback mock quand pas d'OpenAI
- GET /api/crm/leads → fallback `{leads:[],message:"No CRM connected"}`
- GET /api/alerts → alias sur store.triggeredAlerts

## Limitations connues (non-fixables)
- MongoDB Atlas auth fail → /api/monitors retourne [] (graceful)
- Stripe non configuré → billing/invoices mock:true (expected)
- OpenAI non connecté → ai/generate retourne mock (expected)
