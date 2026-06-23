---
name: FlowPoint production context
description: Architecture globale FlowPoint SaaS, phases de correction, état des modules — lire en premier à chaque session
---

# FlowPoint SaaS — Production Context

## Architecture
- **Frontend**: dashboard.js (~30 750 lignes) — JS vanilla, template literals, renders côté client
- **Backend**: Express/TypeScript dans `artifacts/api-server/src/routes/`
- **DB**: Supabase PostgreSQL + MongoDB
- **Migrations**: `artifacts/api-server/migrations/` (001-009)

## Règle absolue
**0 showToast('success') sans action réelle derrière**

## État de persistance DB (Phase 3 — vérifié code source)

| Fonctionnalité | Table DB | État |
|---|---|---|
| Profil (PATCH /api/me) | org_settings | ✅ upsertOrgSettings() |
| Préférences | user_prefs | ✅ Drizzle |
| Plan Stripe webhook | org_settings.plan | ✅ broadcastPlanUpdate() → DB |
| Subscription status webhook | org_settings.subscription_status | ✅ persistSubscriptionMeta() |
| Stripe customer ID | org_settings.stripe_customer_id | ✅ persistSubscriptionMeta() |
| Addons activate/deactivate | org_addons | ✅ Drizzle activateAddon() |
| AI Credits | ai_credit_purchases + ai_monthly_usage | ✅ |
| Rapports (CRUD + share + PDF) | reports + share_tokens | ✅ Drizzle |
| Équipe | team_members | ✅ Drizzle |
| Missions | missions | ✅ SQL direct |
| Alert rules | alert_rules | ✅ SQL direct |
| Automations (CRUD + run) | automation_workflows + workflow_runs | ✅ Drizzle |
| Keywords tracking | tracked_keywords | ✅ |
| SSO providers | sso_providers | ✅ |
| GBP Posts | gbp_posts | ⚠️ Local DB seulement — pas Google API |
| Monitors | via BetterStack API | ⚠️ MongoDB Atlas 503 (côté user) |
| CRM connect | crm_integrations | ✅ Token stocké en DB |
| GA4/GSC | via Google OAuth | ⚠️ Requiert connexion UI |
| A/B Tests | — | ❌ Pas de backend — état vide correct affiché |

## Bugs critiques corrigés (Phase 3 — cette session)

### 1. broadcastPlanUpdate manquant dans store.ts
- **Problème**: `store.broadcastPlanUpdate()` appelé dans billing.ts, stripe-webhook.ts, billing-service.ts, me.ts — MAIS la méthode n'existait PAS dans la classe Store
- **Fix**: Ajout de `broadcastPlanUpdate(plan)` dans Store: met à jour store.me.plan + broadcast SSE + INSERT ON CONFLICT org_settings (fire-and-forget)
- **Impact**: Plan d'abonnement perdu à chaque restart — critique pour les clients payants

### 2. Stripe webhook ne persistait pas subscriptionStatus/stripeCustomerId
- **Fix**: `persistSubscriptionMeta()` helper dans stripe-webhook.ts → INSERT ON CONFLICT org_settings
- Appelé dans: checkout.session.completed, subscription.created/updated, invoice.payment_succeeded, invoice.payment_failed

### 3. URL bug addon-checkout
- **Fix**: `/billing/addon-checkout` → `/api/billing/addon-checkout` (ligne 6655 dashboard.js)

### 4. Automations + Monitor faux success toasts
- Toggle/Run sans wf.id → `error toast` (plus de `success` fictif)
- FP_MONITORS_API absent → `info toast` (plus de `success` fictif)

### 5. GBP Posts wording trompeur
- Bouton "Publier" renommé "Enregistrer"
- Toast "Post GBP publié ✓" → "Post sauvegardé localement — connectez GBP pour publier"

## Colonnes org_settings (confirmées Supabase)
org_id, first_name, last_name, org_name, plan, subscription_status, trial_ends_at, stripe_customer_id, addons (jsonb), usage (jsonb), updated_at, address, city, postal_code, country, latitude, longitude, service_area (jsonb), location_configured, location_source, website, email, created_at

## Fichiers clés
- `artifacts/flowpoint-export/dashboard.js` — 30 750 lignes (node --check doit passer)
- `artifacts/api-server/src/services/store.ts` — Store class + broadcastPlanUpdate()
- `artifacts/api-server/src/routes/stripe-webhook.ts` — persistSubscriptionMeta()
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

## État CRM / OAuth
- CRM connect = vraie implémentation (crm-service.ts → crm_integrations table) ✅
- GA4/GSC = OAuth Google dans dashboard, rien de fictif
- A/B Tests = 0 backend, UI montre état vide "Connectez vos données CRO" ✅

## STRIPE_LIVE_API_KEY valide
- `STRIPE_LIVE_API_KEY` = valide pour Stripe production
- `STRIPE_SECRET_KEY` = expiré (Replit env) — webhook utilise LIVE_API_KEY en priorité
