---
name: FlowPoint production context
description: Architecture globale FlowPoint SaaS, phases de correction, état des modules
---

# FlowPoint SaaS — Production Context

## Architecture
- **Frontend**: dashboard.js (~30 728 lignes) — JS vanilla, template literals, renders côté client
- **Backend**: Express/TypeScript dans `artifacts/api-server/src/routes/`
- **DB**: Supabase PostgreSQL + MongoDB
- **Migrations**: `artifacts/api-server/migrations/` (001-009)

## Règle absolue
**0 showToast('success') sans action réelle derrière**

## État des corrections (Phase 1 + 2 complètes)

### ✅ DONE — Backend
- `me.ts`: PATCH /api/me accepte lastName, website, timezone, address, city, postalCode, country
- `billing.ts`: POST /billing/addon-checkout (Stripe checkout pour add-ons individuels)
- `org-settings.ts`: upsertOrgSettings gère tous les champs profil
- `plans.ts`: ADDON_PRICE_IDS complet

### ✅ DONE — Frontend dashboard.js
- Profile form: IDs ajoutés (prof-fname, prof-lname, etc.), save button wired
- Settings header "Sauvegarder": délègue à #profile-save-btn ou PATCH /api/me/prefs
- Team Retirer/Role: DELETE /api/team/:id et PATCH /api/team/:id
- AI modules toggles/intensity: PATCH /api/me/prefs
- Billing add-ons: fpActivateAddon(idx) → POST /billing/addon-checkout
- Event stream: villes hardcodées wrappées dans isDemoMode()/PREVIEW_MODE
- Storage AI block: métriques dynamiques (totalUsed/totalTotal)
- Tous les boutons "Lien copié": navigator.clipboard
- GBP post publish: POST /api/gbp-posts
- Webhook save: POST /api/integrations/webhooks
- Alertes mark-all-read: POST /api/alert-rules/mark-all-read
- Settings presets: PATCH /api/me/prefs avec g.key et o.val
- SSO policies: PATCH /api/sso/policies
- Missions create: POST /api/missions (expansion, locale, équipe)
- ~50 faux success toasts corrigés (→ API réelle ou info/navigate)

### ✅ DONE — aiBlock coverage
Toutes les pages majeures ont aiBlock dynamique:
renderOverview, renderAudits, renderMonitors, renderMissions, renderReports,
renderLocalSEO, renderTeam, renderBilling, renderAlertRules, renderSettings,
renderAI, renderGrowth (via sub-fonctions), renderCompetitor, renderConversion

### ✅ DONE — DB migrations
Toutes les tables existent (missions, mission_history, mission_ai_logs,
automation_workflows, automation_integrations, automation_logs, automation_runs)

## Fichiers clés
- `artifacts/flowpoint-export/dashboard.js` — 30 728 lignes (node --check doit passer)
- `artifacts/api-server/src/routes/billing.ts` — addon-checkout endpoint
- `artifacts/api-server/src/routes/me.ts` — profil étendu
- `artifacts/api-server/src/services/org-settings.ts`
- `artifacts/api-server/src/lib/plans.ts` — ADDON_PRICE_IDS

## Patterns importants
- `displayStat(liveVal, previewFallback)` — guard métriques
- `isDemoMode()` — import depuis services/mock-data.js
- `PREVIEW_MODE` — const globale
- `apiAction(method, url, body)` — helper global AJAX
- `escHtml(str)` — escape HTML
- `CUR_MONTH/PREV_MONTH` — constantes dynamiques mois courant/précédent
