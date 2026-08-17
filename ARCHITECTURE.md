# FlowPoint — Cartographie Technique Complète
> Branche : `Test-Replit` · Généré le 2026-08-17 · Dashboard.js : 68 718 lignes · ai.ts : 3 301 lignes

---

## 1. Navigation complète

### Système de routing

Le routing est **entièrement hash-based côté client**. Le switch canonique est `dashboard.js:15019-15110`.

**Fonctions clés :**
- `navigate(route, sub?)` → `history.replaceState('#route/sub')` + localStorage + `_doRender()` immédiat (`dashboard.js:14795-14805`)
- `navigateSub(sub)` → `history.pushState` + localStorage (`dashboard.js:14808-14826`)
- `_doRender()` → debounce 30ms → sélectionne renderer → remplace `#fp-page` → injecte subnav (`dashboard.js:15018-15183`)
- `popstate` + `hashchange` listeners : `dashboard.js:17442-17461`

**Noms canoniques** : `PAGE_NAMES` — `dashboard.js:14681-14697`  
**Sous-pages** : `SUB_NAVS` — `dashboard.js:14699-14734`

**Normalisation des alias** (`dashboard.js:15099-15109`) :
- `automations` → `settings/automations`
- `integrations` → `settings/integrations`
- `addons` → `billing/addons`
- `competitors` → `competitor`
- `activity` → `activity-feed`
- `alerts` → `alerts-center`
- `keywords` → `growth/keywords`
- `content` → `growth`

---

### Pages et sous-pages

| Route / Hash | Renderer | Fichier | Conditions | Plan requis |
|---|---|---|---|---|
| `#overview` | `renderOverview()` | `dashboard.js:5195` | auth | tous |
| `#overview/insights` | `renderOverviewInsights()` | — | auth | tous |
| `#overview/quick-wins` | — | — | auth | tous |
| `#overview/checklist` | — | — | auth | tous |
| `#missions` | `renderMissions()` | `dashboard.js` | auth | tous |
| `#missions/todo`, `in_progress`, `done`, `ai` | sub-tabs | — | auth | tous |
| `#audits` | `renderAudits()` | `dashboard.js` | auth | tous |
| `#audits/analysis`, `compare`, `history`, `opportunites` | sub-tabs | — | auth | tous |
| `#monitors` | `renderMonitors()` | `dashboard.js` | auth | tous |
| `#monitors/performance`, `incidents`, `config`, `sla` | sub-tabs | — | auth | tous |
| `#local-seo` | `renderLocalSEO()` | `dashboard.js` | auth | tous |
| `#local-seo/map` | `renderLocalSEOMap()` | `dashboard.js:58436` | auth | tous |
| `#local-seo/competitors-map` | `renderCompetitorsMap()` | `dashboard.js:58736` | auth | tous |
| `#local-seo/zones`, `opportunities`, `reviews`, `gbp` | sub-tabs | — | auth | — |
| `#reports` | `renderReports()` | `dashboard.js` | auth | tous |
| `#reports/exec`, `seo`, `monitoring`, `local`, `conversion`, `client`, `ai` | sub-tabs | — | auth | — |
| `#team` | `renderTeam()` | `dashboard.js` | auth | tous |
| `#team/chat`, `activity`, `files`, `performance` | sub-tabs | — | auth | — |
| `#growth` | `renderGrowth()` | `dashboard.js` | auth | tous |
| `#growth/projections`, `objectives`, `keywords` | sub-tabs | — | auth | — |
| `#competitor` | `renderCompetitor()` | `dashboard.js:51761` | auth | tous |
| `#competitor/overview`, `keywords`, `content`, `backlinks`, `local`, `alerts` | sub-tabs | — | auth | — |
| `#conversion` | `renderGA4Conversion()` | `dashboard.js:52899` | auth | GA4 connecté |
| `#conversion/funnel`, `ux-lab`, `cta`, `revenue-leak`, `cro` | sub-tabs | — | auth | — |
| `#alerts-center` | `renderAlertsCenter()` | `dashboard.js:53920` | auth | tous |
| `#alerts-center/incidents`, `seo`, `performance`, `conversion`, `local`, `competitor`, `ai` | sub-tabs | — | auth | — |
| `#activity-feed` | `renderActivityFeed()` | `dashboard.js:54818` | auth | tous |
| `#activity-feed/team`, `seo`, `monitoring`, `ai`, `reports`, `competitor`, `ops` | sub-tabs | — | auth | — |
| `#data-explorer` | `renderDataExplorer()` | `dashboard.js:55752` | auth | tous |
| `#data-explorer/traffic`, `behavior`, `dashboards`, `insights`, `forecast`, `export` | — | — | auth | — |
| `#client-mode` | `renderGA4ClientMode()` | `dashboard.js:56604` | auth | White-label |
| `#client-mode/dashboards`, `reporting`, `communication`, `onboarding`, `projects`, `analytics`, `agency` | — | — | auth | — |
| `#billing` | `renderBilling()` | `dashboard.js` | auth | tous |
| `#billing/plans`, `addons`, `usage`, `invoices`, `ai-strategist`, `enterprise` | sub-tabs | — | auth | — |
| `#settings` | `renderSettings()` | `dashboard.js` | auth | tous |
| `#settings/workspace`, `team`, `security`, `alerts`, `automations`, `integrations`, `api`, `ai-config`, `data`, `localisation`, `sso` | sub-tabs | — | auth | — |
| `#ai` | `renderAI()` | `dashboard.js` | auth | tous |
| `#ai/usage`, `intelligence`, `insights`, `actions`, `strategist` | sub-tabs | — | auth | — |
| `#analytics` | `renderGA4*()` | `dashboard.js:60098+` | auth | GA4 connecté |
| `#analytics/realtime`, `pages`, `conversions`, `connect` | — | — | auth | — |
| `#traffic/organic`, `paid`, `social`, `direct`, `anomalies` | — | — | auth | — |
| `#funnels/goals`, `paths`, `dropoff` | — | — | auth | — |
| `#audience/geo`, `devices`, `demographics` | — | — | auth | — |
| `#campaigns/utm`, `roi`, `compare` | — | — | auth | — |
| `#live/events`, `pages`, `geo` | — | — | auth | — |
| `#performance` | `renderPerformance*()` | `dashboard.js:63504` | auth | tous |
| `#performance/mobile`, `desktop`, `history`, `opportunities`, `ai` | — | — | auth | — |
| `#core-web-vitals/lcp`, `cls`, `inp`, `ttfb`, `compare` | — | — | auth | — |
| `#technical-audit/render-blocking`, `js-css`, `images`, `accessibility`, `seo`, `ai` | `dashboard.js:63779` | — | auth | — |
| `#github-integration` | `dashboard.js:64348` | — | auth | — |
| `#github-integration/repos`, `commits`, `ci-cd`, `security`, `config` | — | — | auth | — |
| `#code-analysis/seo`, `performance`, `security`, `quality`, `ai` | `dashboard.js:64703` | — | auth | — |
| `#search-console` | `renderSearchConsole()` | `dashboard.js:64847` | auth | GSC connecté |
| `#search-console/keywords`, `pages`, `impressions`, `indexing`, `connect` | — | — | auth | — |
| `#crm/connections`, `sync`, `logs`, `field-mapping` | `dashboard.js:66377` | — | auth | — |
| `#market-intelligence/trends`, `opportunities`, `competitors`, `signals`, `reports` | — | — | auth | — |
| `#permissions/matrix`, `audit` | `dashboard.js:66843` | — | auth | admin/owner |

---

## 2. Redirections

### Frontend → pricing
```
navigate() → if plan gate → location.href = '/pricing.html?from=dashboard&plan=...'
dashboard.js:14771-14793
```

### Frontend → Auth
```
apiFetch /api/me → 401 → _clearAuth() → window.location.replace('/login.html')
fp-backend.js:87-112
```

### Logout
```
window.fpLogout() / logout button → DELETE /api/auth/logout → _clearAuth() → location.replace('/login.html')
```

### magic link
```
login.html → POST /api/auth/magic-link → email → login-verify.html?token=xxx
login-verify.js:36-55 → POST /api/auth/verify → sessionStorage fp_session_token → location.replace('/dashboard.html?_cb=...')
```

### OAuth Google
```
signin.html:201 → location.href = /api/auth/google → Google OAuth → /api/auth/google/callback → session → dashboard.html
```

### checkout / billing
```
fpGoToPricing() → /pricing.html
fpUpgradeOrCheckout() → /api/billing/upgrade (si sub active) → ou /api/billing/create-checkout-session → /checkout.html → Stripe → /checkout-return.html
```

### Back/Forward navigateur
```
popstate → listener dashboard.js:17442 → lit window.location.hash → navigate()
BFCache pageshow → fp-backend.js:pageshow listener → force session-restore si bfcache
```

### Fonctions de navigation recensées

| Fonction | Mécanisme | Fichier |
|---|---|---|
| `navigate(route, sub)` | `history.replaceState` | `dashboard.js:14795` |
| `navigateSub(sub)` | `history.pushState` | `dashboard.js:14808` |
| `window.fpGoToBillingPlans()` | `navigate('billing','plans')` | `dashboard.js:14829` |
| `window.fpGoToPricing()` | `location.href = '/pricing.html?...'` | `dashboard.js:14771` |
| `window.fpUpgradeOrCheckout()` | `/api/billing/upgrade` ou pricing | `dashboard.js:14771+` |
| OAuth / externe | `location.href` | `dashboard.js:64825,65288,65381,65540` |
| OAuth URL cleanup | `history.replaceState` | `dashboard.js:46009-46021` |
| 401 auto-redirect | `window.location.replace('/login.html')` | `fp-backend.js:87` |
| login-verify → dashboard | `location.replace('/dashboard.html?_cb=...')` | `login-verify.js:81` |

---

## 3. Architecture Auth

### Flux complet Sign In → Dashboard

```
1. login.html   → user saisit email
2. POST /api/auth/magic-link (auth.ts:544)
   → valide email + statut compte
   → génère token 64 hex chars (auth.ts:639)
   → INSERT magic_link_tokens (TTL 1h) (auth.ts:644-650)
   → envoie email avec link /login-verify.html?token=xxx
3. User clique le lien → login-verify.html
4. login-verify.js:36-55
   → lit URL token
   → POST /api/auth/verify avec credentials:include
5. Backend auth.ts:1404-1701
   → vérifie token en DB (expires_at, used=false) (1404-1540)
   → consume token (1616-1629)
   → crée session DB user_sessions (1635-1649)
   → Set-Cookie: fp_token, HttpOnly, Secure, SameSite=None, maxAge=7j (1660-1668)
   → répond { token: '...', orgId, role, ... }
6. login-verify.js:59-89
   → sessionStorage['fp_session_token'] = token
   → sessionStorage['fp_tab_uid'] = uid
   → setTimeout 1200ms → location.replace('/dashboard.html?_cb=...')
```

### Flux Dashboard Load → Render

```
1. dashboard.html charge
2. fp-backend.js:23-29  → lit sessionStorage['fp_session_token']
3. fp-backend.js:32-71  → POST /api/auth/session-restore
   → Bearer token si présent, credentials:include (cookie fp_token en fallback)
   → stocke canonical token retourné (fp-backend.js:53-60)
4. dashboard.js:1453-1491 → répète session-restore
5. dashboard.js:1493-1511 → GET /api/me {force:true} OBLIGATOIRE
6. STATE.me = résultat /api/me
7. render() → Phase 1 (squelette) puis Phase 2 (données) puis Phase 3 (modules secondaires)
```

### Stockage session

| Clé | Store | Valeur | TTL |
|---|---|---|---|
| `fp_token` | Cookie HttpOnly | token opaque HMAC-SHA256 | 7 jours |
| `fp_session_token` | sessionStorage | même token | onglet |
| `fp_tab_uid` | sessionStorage | identifiant onglet | onglet |

**Format token** : `userId:orgId:random:base36timestamp.HMACsignature` (`services/sessions.ts:23-35`)

**Table DB** : `user_sessions(token, user_id, org_id, email, role, expires_at, created_at, user_id_v2, ip_address, user_agent)`

### Session restore — ordre de priorité (auth.ts:2045-2117)
1. `Authorization: Bearer` header
2. Cookie `fp_token` (fallback)
3. → 401 + cookie clear si aucun valide

### 401 handling
```
fp-backend.js:87-112
  apiFetch → response.status === 401
  → _clearAuth() (supprime fp_session_token, fp_tab_uid, legacy localStorage keys)
  → window.location.replace('/login.html')
```

### Logout
```
DELETE /api/auth/logout (auth.ts:2137-2145)
  → deleteSession(token) → DELETE FROM user_sessions WHERE token=$1
  → clear-cookie fp_token
  → réponse { success: true }
```

### BFCache
```
fp-backend.js: pageshow listener
  → si event.persisted → force session-restore
  → évite token périmé sur navigation arrière
```

### Expiration magic link
- TTL **1 heure** (`services/sessions.ts` + `index.ts:220-236`, le schéma par défaut est 15m mais `storeMagicToken` surcharge explicitement à 1h)

### requireAuth middleware (`middlewares/requireAuth.ts:28-121`)
1. Extrait `Authorization: Bearer`
2. Puis `X-Api-Key`
3. Puis cookie `fp_token`
4. Appelle `getSession(token)` → `SELECT ... WHERE token=$1 AND expires_at>NOW()`
5. Accepte également API secret/service keys et FlowPoint API keys
6. Sinon → 401

---

## 4. Architecture de rendu du dashboard

### Phases de chargement (`dashboard.js:1418-1963`)

```
init()
  ├── session-restore + /api/me (Phase 0 — auth)
  ├── loadData() ← Phase 1 : données critiques (bloquantes)
  │     ├── GET /api/overview, /api/plans, /api/billing/*
  │     ├── GET /api/audits, /api/monitors, /api/reports, /api/team, /api/alerts
  │     ├── GET /api/activity, /api/missions, /api/competitors, /api/keywords
  │     └── STATE.loading = false ← déblocage render
  ├── render() ← Phase 2 : premier render complet après Phase 1
  └── loadDataSecondary() ← Phase 3 : données non-bloquantes
        ├── GET /api/billing/usage, /api/schedules, /api/calendar/*
        ├── GET /api/ga4/*, /api/gsc/*, /api/google/*
        ├── GET /api/reviews, /api/market-intelligence, /api/team/files
        └── render() (si page concernée)
```

**Skeleton :** affiché pendant Phase 0/1 via `.fp-skeleton` CSS. Disparaît quand `STATE.loading = false`.

**Safety timer :** 12s (`dashboard.js:1418-1428`) — force `STATE.loading = false` si les APIs ne répondent pas.

**Render debounce :** 30ms (`dashboard.js:15018-15022`) — évite les renders multiples simultanés.

### `_doRender(route, sub)` (`dashboard.js:15018-15183`)
1. Détecte route vs refresh même-route (préserve scroll sur data update)
2. Sélectionne renderer selon `route` (switch 15019-15110)
3. Remplace `innerHTML` de `#fp-page`
4. Injecte subnav/subpage
5. Bind les event listeners de la page
6. Masque le spinner

### Déclencheurs de `render()` global

| Déclencheur | Localisation |
|---|---|
| `navigate(route)` | `dashboard.js:14795` |
| `navigateSub(sub)` | `dashboard.js:14808` |
| Phase 1 terminée | `dashboard.js:1556` |
| Phase 3 terminée (page concernée) | `dashboard.js:1942` |
| SSE `monitor_update` | `fp-backend.js:3004-3015` |
| SSE `alert:new/update` | `fp-backend.js:2971-3001` |
| Action CRUD réussie (missions, competitors, etc.) | divers |
| Polling 60s — overview/monitors | `fp-backend.js:3055-3101` (patch STATE + re-render ciblé) |

### SSE / Événements temps réel (`fp-backend.js:2916-3053`)

**EventSource :** `GET /api/events?token=...`

| Événement SSE | Action frontend |
|---|---|
| `monitor_update` | Patch `STATE.monitors` → re-render monitors/overview |
| `notification` | Unshift `STATE.notifications` + update badge |
| `chat:message` / `team:message` | CustomEvent dispatch |
| `billing:plan_updated` | CustomEvent billing → re-fetch /api/me |
| `alert:new` / `alert:update` | Re-fetch `/api/alert-events` → render |
| `heartbeat` | Maintient la connexion |

**Reconnect :** max 5 tentatives avec backoff exponentiel. Banner "connexion perdue" si dépassé.

**Polling 60s :** refresh `/api/monitors` + `/api/notifications` chaque tick ; `/api/overview` tous les 5 ticks. Patch `STATE`, pas de full render.

---

## 5. STATE frontend

STATE est un objet global mutable (`window.STATE`) défini dans `dashboard.js`. Voici les propriétés principales :

| Propriété | Contenu | Remplit par | Utilisé par | Actualisé |
|---|---|---|---|---|
| `STATE.me` | Profil user : email, firstName, plan, billing, limits, addons, permissions | `GET /api/me` | Toutes pages | init + polling |
| `STATE.billing` | stripeCustomerId, status normalisé, trial, plan, addons | `GET /api/billing/*` | Billing, toutes gates | init + SSE billing |
| `STATE.audits` | Liste audits (score, url, status, date) | `GET /api/audits` | Audits, Overview | Phase 1 |
| `STATE.monitors` | Liste monitors (status, url, latency, incidents) | `GET /api/monitors` | Monitors, Overview | Phase 1 + SSE + polling 60s |
| `STATE.missions` | Liste missions (titre, priorité, statut, steps) | `GET /api/missions` | Missions, AI | Phase 1 |
| `STATE.reports` | Liste reports (titre, date, type, pdf_url) | `GET /api/reports` | Reports | Phase 1 |
| `STATE.competitors` | Liste concurrents (domain, rating, keywords) | `GET /api/competitors` | Competitor, Local SEO | Phase 1 |
| `STATE.keywords` | Mots-clés trackés (keyword, position, volume, trend) | `GET /api/keywords` | Growth, Overview | Phase 1 |
| `STATE.alerts` | Alertes actives + événements | `GET /api/alert-events` | Alerts Center, sidebar | Phase 1 + SSE |
| `STATE.team` | Membres équipe + invitations | `GET /api/team` | Team, Settings | Phase 1 |
| `STATE.activity` | Fil activité (actions, timestamps, users) | `GET /api/activity` | Activity Feed | Phase 1 |
| `STATE.notifications` | Notifications non-lues | `GET /api/notifications` | Badge sidebar | Phase 1 + SSE + polling |
| `STATE.overview` | Métriques overview (score moyen, counts) | `GET /api/overview` | Overview | Phase 1 + polling 5min |
| `STATE.loading` | `true` pendant Phase 0/1 | init() / safety timer | Skeleton | Une fois |
| `STATE.currentRoute` | Route active | navigate() | Render switch | À chaque nav |
| `STATE.currentSub` | Sous-page active | navigate()/navigateSub() | Subnav render | À chaque nav |
| `STATE.plan` | Plan actif normalisé | `/api/me` billing | Toutes gates plan | init |
| `STATE.seatUsage` | { used, limit } | `GET /api/billing/usage` | Settings/Team | Phase 3 |
| `STATE.aiCredits` | { used, limit, extra } | `/api/me` + `/api/ai/usage` | AI page, billing | init + après action AI |

**Autres stores globaux :**
- `window._fpReportsState` + `window._fpReportsAPI` → Reports (`dashboard.js:68061`)
- `window._fpAnalyticsState`, `_fpTrafficState`, `_fpConversionState`, etc. → GA4 pages (`dashboard.js:59875-60087`)
- `window.FP_DATA` → Local SEO map data
- `window.FP_MAPS_API` → Wrapper Maps
- `window.FP_COMPETITORS_API` → Wrapper Competitors
- `window.STATE._aiConversationId` → Conversation IA active

---

## 6. API utilisée par chaque page

> Format : `Page → Méthode endpoint → Stockage frontend`

### Overview
- `GET /api/overview` → `STATE.overview`
- `GET /api/audits` → `STATE.audits`
- `GET /api/monitors` → `STATE.monitors`
- `GET /api/missions?status=todo&limit=5` → overview widget
- `POST /api/ai/overview-insights` → insights card

### Missions
- `GET /api/missions` → `STATE.missions`
- `POST /api/missions` → création
- `PATCH /api/missions/:id` → modification
- `DELETE /api/missions/:id` → suppression
- `POST /api/missions/:id/complete` → marquer terminée

### Audits
- `GET /api/audits` → `STATE.audits`
- `POST /api/audits` → déclenche nouvel audit
- `DELETE /api/audits/:id` → suppression
- `GET /api/audits/:id/score-history` → historique scores
- `POST /api/ai/audit` → analyse IA d'un audit

### Monitors
- `GET /api/monitors` → `STATE.monitors`
- `POST /api/monitors` → création
- `PATCH /api/monitors/:id` → modification
- `DELETE /api/monitors/:id` → suppression
- `GET /api/monitor-checks/:monitorId` → historique checks
- `GET /api/monitors/:id/sla` → SLA stats

### Reports
- `GET /api/reports` → `STATE.reports` (LIMIT 500)
- `GET /api/reports/clients` → clients list
- `POST /api/reports` → création rapport
- `GET /api/reports/:id/download` → PDF blob
- `POST /api/reports/:id/share` → token partage 30j
- `DELETE /api/reports/:id` → suppression

### Local SEO / Map
- `GET /maps/config` → clé Maps publique browser
- `GET /maps/geocode?address=...` → coordonnées
- `GET /maps/heatmap?...` → données heatmap
- `GET /maps/competitors?...` → pins concurrents
- `GET /maps/place-details?placeId=...` → détails POI
- `GET /api/local-maps/*` → données SEO local
- `GET /api/reviews/*` → avis GBP
- `GET /api/gbp-posts` → posts GBP

### Growth / Keywords
- `GET /api/keywords` → `STATE.keywords`
- `POST /api/keywords` → ajout mot-clé
- `DELETE /api/keywords/:id` → suppression
- `GET /api/growth-objectives` → objectifs
- `GET /api/forecast` → prévisions

### Competitor
- `GET /api/competitors` → `STATE.competitors`
- `POST /api/competitors` → ajout
- `DELETE /api/competitors/:id` → suppression
- `POST /api/ai/competitors` → analyse IA

### Team
- `GET /api/team` → `STATE.team`
- `POST /api/team/invite` → invitation
- `DELETE /api/team/members/:id` → suppression
- `GET /api/team/chat/messages` → messages
- `POST /api/team/chat/messages` → envoi message
- `GET /api/team/files` → fichiers partagés

### AI Chat
- `POST /api/ai/chat` (SSE) → stream delta
- `POST /api/ai/cancel` → stop génération
- `GET /api/ai/history` → historique conversation
- `POST /api/ai/confirm` → confirmer action tool
- `GET /api/ai/usage` → crédits consommés
- `GET /api/ai/tools` → outils disponibles

### Billing
- `GET /api/billing/payment-methods` → méthodes paiement
- `GET /api/billing/usage` → usage/seats
- `GET /api/billing/invoices` → factures
- `POST /api/billing/create-checkout-session` → session Stripe
- `POST /api/billing/upgrade` → changement plan
- `POST /api/billing/portal` → Customer Portal Stripe
- `POST /api/billing/checkout-ai-credits` → achat crédits IA

### Settings
- `GET /api/me` → profil org
- `PATCH /api/me` → modification profil
- `GET /api/settings/api-keys` → clés API
- `POST /api/settings/api-keys` → création clé
- `GET /api/sessions` (security) → sessions actives
- `DELETE /api/sessions/:id` → révocation session

### Search Console
- `GET /api/gsc/status` → statut connexion
- `GET /api/gsc/sites` → sites disponibles
- `POST /api/gsc/select-site` → sélection
- `GET /api/gsc/keywords` → mots-clés GSC
- `GET /api/gsc/pages` → pages GSC
- `GET /api/gsc/impressions` → impressions
- `GET /api/gsc/indexing` → indexation
- `POST /api/gsc/sync` → synchronisation

### GA4 / Analytics
- `GET /api/ga4/status`, `/accounts`, `/properties`
- `POST /api/ga4/select-property`
- `GET /api/ga4/overview`, `/realtime`, `/sources`, `/pages`, `/funnels`, `/conversions`, `/audience`, `/campaigns`
- `GET /api/conversion/revenue-leak`, `/cro`
- `GET /api/analytics/*` (multiples sous-endpoints)

---

## 7. Billing complet

### Plans et limites (`lib/plans.ts:29`)

| Plan | Prix mensuel | Audits | Monitors | Sièges | PDFs |
|---|---|---|---|---|---|
| Standard | — | 100 | 10 | 3 | 50 |
| Pro | — | 300 | 50 | 10 | 300 |
| Ultra | — | Illimité | Illimité | Illimité | Illimité |

`PLAN_PRICE_IDS` → **live Stripe price IDs uniquement** (pas test). Les tests utilisent des prix séparés.

### Normalisation du statut

```
organizations.subscription_status (raw DB) → billing-context.ts
  "active"    → "active"       (hasPremiumAccess = true)
  "trialing"  + subscriptionId → "trialing"    (hasPremiumAccess = true)
  "trialing"  + NO subscriptionId → "pending_billing"
  "canceled"  → "canceled"
  "past_due"  → "past_due"     (hasPremiumAccess = true)
  null/vide   → "pending_billing"
```

### Trial

- `canStartTrial` = `trialConsumedAt IS NULL AND stripeSubscriptionId IS NULL` (`billing-context.ts:canStartTrial`)
- Trial Stripe démarre via webhook `checkout.session.completed` (`stripe-webhook.ts:778+`)
- Email trial envoyé au signup immédiat (pas via webhook)

### Flux Checkout complet

```
1. fpGoToPricing() → /pricing.html
2. pricing.html → sélection plan/addons → fp_cart localStorage
3. pricing.js → POST /api/billing/create-checkout-session (billing.ts:133)
   → createStripeCustomer si inexistant
   → Stripe Checkout Session (mode:'subscription')
   → subscription_data.metadata = { plan, orgId }
   → trial_period_days si éligible
4. Redirect → Stripe hosted page
5. Stripe → /checkout-return.html?session_id=...
6. checkout-return.html → GET /api/billing/verify?session_id=...
   → billing.ts:276-378 → retrieve session → persist plan/status/customer/subscriptionId
   → OR : webhook checkout.session.completed arrive en parallèle (source de vérité)
7. Redirect → /dashboard.html#billing ou #overview
```

### Webhooks (`routes/stripe-webhook.ts`)

| Événement | Action |
|---|---|
| `checkout.session.completed` | Activate plan, provision addons, update DB |
| `payment_intent.succeeded` | AI credits, addon credits, accounting |
| `customer.subscription.created/updated` | Sync status/plan/trial/subscriptionId |
| `customer.subscription.deleted` | Cancel account, downgrade |
| `invoice.payment_succeeded` | Renewal tracking |
| `invoice.payment_failed` | Past due handling |

**HMAC signing :** clé brute `whsec_...` (prefix inclus dans la signature), lue depuis `STRIPE_WEBHOOK_SECRET || STRIPE_WEBHOOK_SECRET_RENDER`.

### Add-ons (`lib/plans.ts:231+`, `services/addons-service.ts`)

`ADDON_DEFINITIONS` = source de vérité unique pour prix/nom. Stockage : table `org_addons(org_id, addon_key, active, quantity, stripe_item_id)`.

| Add-on clé | Type | Description |
|---|---|---|
| `monitorsPack10` | quantité | +10 monitors |
| `gbp` | flag | Google Business Profile |
| `extraSeats` | quantité | Sièges supplémentaires |
| `auditPack100` | quantité | +100 audits |
| `aiCredits50k/200k/500k` | quantité | Crédits IA |
| `customDomain` | flag | White-label domaine |
| `webhooks` | flag | Webhooks |
| `retention90d/365d` | flag | Rétention données |

### AI Credits

- Packs : 50k/4€, 200k/9€, 500k/19€
- Achat : `POST /api/billing/checkout-ai-credits` → Stripe Checkout `mode:'payment'`
- Comptage : table `ai_monthly_usage(org_id, month, credits_used)` + `ai_credit_purchases`
- Déduction : après chaque réponse IA réussie (estimé chars/4 tokens)

### Payment Methods (`billing.ts:501-590`)

- `resource_missing` (customer supprimé) → warning structuré + nettoyage DB + `200 { paymentMethods: [] }`
- Pas de création automatique de customer sur GET

### Customer Portal

- `POST /api/billing/portal` (owner-only) → `billing.ts:380+` → redirect Stripe portal
- Déclenché par : Add card, Manage, Default, Delete, Invoice dans l'UI billing

### Redirections billing importantes

| Condition | Redirection |
|---|---|
| `pending_billing` (pas de sub) | CTAs → `#billing/plans` |
| Plan insuffisant (gate feature) | `fpGoToPricing()` → `/pricing.html` |
| Sub active + upgrade | `POST /api/billing/upgrade` |
| Checkout succès AI credits | `#billing` tab |
| Checkout cancel | `/pricing.html` |

---

## 8. Reports

### Structure backend (`routes/reports.ts`)

| Endpoint | Action |
|---|---|
| `GET /api/reports` | Liste (org, date DESC, LIMIT 500) |
| `GET /api/reports/clients` | Rapports clients |
| `GET /api/reports/:id` | Un rapport |
| `POST /api/reports` | Création |
| `POST /api/reports/clients` | Rapport client |
| `POST /api/reports/approve` | Approbation |
| `GET /api/reports/:id/download` | PDF (chargement audit+monitors+missions+branding → `streamReportPdf`) |
| `POST /api/reports/:id/share` | Token partage 30 jours → table `share_tokens` |
| `GET /api/reports/:id/shares` | Liste tokens |
| `DELETE /api/reports/share/:tokenId` | Révocation token |
| `DELETE /api/reports/:id` | Suppression (+ share_tokens) |

### Frontend (`dashboard.js:68061+`)

- Stores : `window._fpReportsState`, `window._fpReportsAPI`
- Renderer principal : `renderGA4Reports()` — `dashboard.js:68319`
- `renderNewReportPanel()` — `dashboard.js:8391` (panel création)
- Templates : boutons de création rapide par type (`dashboard.js:68444`)
- Téléchargement : blob fetch → lien download
- Partage : génère URL avec token, 30j

### Templates disponibles

Types reportés dans les routes : `exec`, `seo`, `monitoring`, `local`, `conversion`, `client`, `ai`.

---

## 9. Local SEO / Maps / Rankings / Competitors

### Local SEO — sous-pages et APIs

| Sous-page | Renderer | APIs principales |
|---|---|---|
| `map` | `renderLocalSEOMap()` (`dashboard.js:58436`) | `/maps/geocode`, `/maps/heatmap`, `/maps/competitors` |
| `competitors-map` | `renderCompetitorsMap()` (`dashboard.js:58736`) | `/maps/competitors`, `/api/competitors` |
| `zones` | — | `/api/local-maps/zones` |
| `opportunities` | — | `/api/local-maps/opportunities` |
| `reviews` | — | `/api/reviews/*` |
| `gbp` | `renderLocalSEOGBP()` (`dashboard.js:57662`) | `/api/google/gbp`, `/api/gbp-posts` |

### Google Maps Backend (`routes/maps.ts`)

- Clé serveur : `FLOWPOINT_MAP_BACKEND` (alias `GOOGLE_MAPS_API_KEY`) — **jamais exposée au browser**
- Clé browser : `GOOGLE_MAPS_PUBLIC_KEY` — servie par `GET /maps/config`
- Double-injection guard : `dashboard.js` et `fp-backend.js` vérifient la présence d'un script Maps existant avant d'en créer un autre
- Proxy `/maps/place-details?placeId=...` → appel serveur-side vers Google Places API
- Infobulles sombres : `.gm-style-iw` CSS override

### Rankings / Keywords (`routes/keywords.ts`)

- Table : `tracked_keywords(org_id, keyword, current_position, prev_position, search_volume, trend, active)`
- `GET /api/keywords` → liste filtrée org
- `POST /api/keywords` → ajout
- DataForSEO : `/serp/google/organic/live/advanced` pour positions réelles
- Cron `dataforseo-sync` (`workers/cron-scheduler.ts:11`) → update positions périodique

### Competitors (`routes/competitors.ts`)

- Table : `competitors(org_id, name, url, domain_rating, keywords, threat_level, delta)`
- Recherche manuelle → `POST /api/competitors` → INSERT
- Map pins = résultats Google Maps temps réel (NON auto-persistés)
- Ajout depuis map → `FP_COMPETITORS_API.create()` (`dashboard.js:67907`) → persist en DB

### DataForSEO

- Base URL : `https://api.dataforseo.com/v3`
- Auth : Basic (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD)
- Endpoints utilisés : `/serp/google/organic/live/advanced`, `/serp/google/local_pack/live/advanced`
- Quota : `dataforseo_quota` table, config `lib/config.ts:169` (20 000 unités/plan)

### Flux complet : Recherche utilisateur → Rendu carte

```
User saisit adresse (Enter)
  → FP_MAPS_API.searchAddress() (dashboard.js:58477)
  → GET /maps/geocode?address=...
  → GET /maps/heatmap?lat=...&lng=...&keyword=...
  → GET /maps/competitors?lat=...&lng=...
  → Réponse { competitors, count, center }
  → FP_DATA = { competitors, ... }
  → renderLocalSEOMap() consomme FP_DATA (dashboard.js:58449)
  → Render pins Google Maps + heatmap overlay
```

### GSC / GA4

- GSC : `routes/gsc.ts` — données clics/impressions/CTR/position
- GA4 : `routes/ga4.ts` — sessions/users/realtime/sources/pages/funnels/conversions/audience/campaigns
- Statut connexion : vérifié au load Phase 3 (`dashboard.js:1878-1885`)
- Enforcement quota : `ga4-funnel-service.ts:382-399`

---

## 10. Agents IA

### Endpoint principal : `POST /api/ai/chat`

```
Request reçue → auth (requireAuth)
  ↓
Résolution provider/model/economy/quota (ai.ts:1520-1705)
  ↓
buildFlowpointContext(orgId, contextFactor) (ai.ts:243-812)
  ├── Promise.allSettled: keywords, competitors, google_tokens, seo_domain_metrics
  ├── GSC/GA4 presence checks
  ├── Audits + monitors (Drizzle parallel)
  ├── PSI cache
  ├── Calendar + missions + alerts + credits
  └── Monitor health + recommendations
  ↓
resolveEffectivePermissions() → permissions utilisateur
  ↓
System prompt = systemPromptBase + STRICT_AI_RULE + fpContext + navPrompt + attachments
  ↓
[SSE path] Tool loop (si hasAnyToolPermission)
  → runToolCallingLoop() (ai.ts:1042)
  → MAX 6 rounds, ROUND_TIMEOUT 35s/60s, TOOL_TIMEOUT 95s, LOOP_DEADLINE 180s
  → SSE: delta chunks + confirmation_request + undo_available + _ai + [DONE]
  ↓
[Non-SSE] aiChat() → JSON response
  ↓
Persist assistant message + deferred usage accounting
```

### STRICT_AI_RULE (`ai.ts:814-950`)

Forçages globaux sur CHAQUE réponse :
- Pas de salutations sauf 1er message
- Max 3 priorités : 🔴 / 🟠 / 🟢
- Hiérarchie visuelle : `📊 Résumé / ✅ Ce qui fonctionne / ⚠️ Ce qui mérite / 🎯 Les 3 priorités / 👉 Prochaine étape`
- Clôture systématique : "Si vous le souhaitez..."
- Pas de chiffres précis d'impact

### Agents disponibles

Il n'existe **pas de classes agent distinctes**. Le chat est un unique consultant SEO senior. Les endpoints spécialisés ont des prompts différents mais partagent la même infrastructure :

| Endpoint | Prompt spécialisé | Ligne |
|---|---|---|
| `POST /api/ai/chat` | Consultant SEO senior + STRICT_AI_RULE | `ai.ts:1854` |
| `POST /api/ai/seo` | Analyse SEO | `ai.ts:2760` |
| `POST /api/ai/conversion` | Conversion | `ai.ts:2811` |
| `POST /api/ai/local` | Local SEO | `ai.ts:2862` |
| `POST /api/ai/competitors` | Concurrents | `ai.ts:2910` |
| `POST /api/ai/audit` | Audit SEO | `ai.ts:2543` |
| `POST /api/ai/missions` | Génération missions | `ai.ts:3062` |
| `POST /api/ai/reports` | Rapport | `ai.ts:2924` |
| `POST /api/ai/generate` | Marketing content | `ai.ts:3255` |
| `POST /api/ai/pagespeed-insights` | PSI | `ai.ts:3139` |

### ALL_TOOLS (`ai.ts:56-71`)

| Tool | confirmationLevel | Permission |
|---|---|---|
| `search_mission` | none | missions.read |
| `create_mission` | **preview** | missions.write |
| `update_mission` | preview | missions.write |
| `complete_mission` | preview | missions.write |
| `assign_mission` | none | missions.write |
| `delete_mission` | **full** | missions.delete |
| `navigate_to` | none | overview.read |
| Outils calendar (5) | none/preview | calendar.read/write |
| Outils audits (9) | none/preview/full | audits.read/write/delete |
| Outils recommendations (10) | none/preview | recommendations.read/write |
| Outils monitors (12) | none/preview/full | monitors.read/write/delete |
| Outils URL (analyze_url, run_audit) | none | overview.read |

### Providers / Sélection (`services/ai-provider.ts`)

**Strict (user-selected)** : `strictProvider=true` → 1 retry → PROVIDER_UNAVAILABLE si fail. Pas de fallback cross-provider.

**Internal** : fallback chain `openai → anthropic → gemini` automatique.

**Task defaults (`task-router.ts:16-49`) :**
- chat → `openai/gpt-5-mini`
- executive_report → `anthropic/claude-sonnet-4-6`
- seo_audit → `anthropic/claude-sonnet-4-6`
- forecasting → `openai/gpt-5`
- vision → `gemini/gemini-2.5-flash`
- image → `openai/gpt-image-1`

### SSE Streaming

Chunks → `data: { delta: "..." }` → `data: { _ai: { provider, model } }` → `data: [DONE]`

Frontend (`dashboard.js:13685-13730`) : reader ReadableStream → parse `delta` / `confirmation_request` / `undo_available` / `_ai` / errors.

### Crédits IA

- Comptage : estimé chars/4 en tokens pour streaming ; exact pour non-stream
- Déduction : après stream terminé (deferred)
- Tables : `ai_monthly_usage`, `ai_credit_purchases`
- Quota gate : vérifié avant chaque requête (`checkAIQuota`)

---

## 11. Traductions (`fpT()`)

### Mécanisme

```javascript
window.fpT(key)  →  FP_I18N[currentLang][key] || FP_I18N['fr'][key] || key
```

- `FP_I18N` : objet global dans `dashboard.js`, catalogues par langue
- Fallback en chaîne : lang actif → français → clé brute
- Appel : `fpT('Clé exacte française')` — la clé IS le texte français

### Langues supportées (catalogues présents)

| Code | Langue | Lignes dashboard.js |
|---|---|---|
| `fr` | Français (défaut) | — |
| `en` | Anglais | `~17495` |
| `es` | Espagnol | `~20803` |
| `de` | Allemand | `~23686` |
| `it` | Italien | `~26548` |
| `pt` | Portugais | `~29410` |
| `nl` | Néerlandais | `~32272` |
| `pl` | Polonais | `~35134` |
| `sv` | Suédois | `~37996` |
| `ro` | Roumain | `~40858` |
| `cs` | Tchèque | `~43720` |

### Persistance

- Langue stockée dans `localStorage['fp_lang']` ou préférence org (`/api/me`)
- Changement → `fpT()` réévalue + `render()` ou `fpApplyTranslations()`

### Règle de code

Tout texte visible DOIT passer par `fpT()`. Les textes hardcodés ne sont PAS traduits.

### Traductions backend

Les emails (mailer.ts) sont en français uniquement — pas de système i18n côté backend.

---

## 12. Responsive / Dark mode

### Fichier CSS principal

`artifacts/flowpoint-export/dashboard.css` — styles centralisés, variables CSS, responsive, dark mode.

### Variables CSS (thème)

```css
:root {
  --fp-bg             /* fond principal */
  --fp-bg-sidebar     /* fond sidebar */
  --fp-surface        /* cartes/surfaces */
  --fp-border         /* bordures */
  --fp-text           /* texte principal */
  --fp-text-muted     /* texte secondaire */
  --fp-accent         /* couleur d'accentuation */
  --fp-danger         /* rouge erreurs */
  --fp-track          /* fond inputs/tracks */
  --fp-radius-md      /* border-radius medium */
}
```

### Dark mode

- Mécanisme : attribut `data-theme` sur `<html>`
- Sélecteur : `html[data-theme="dark"]` → surcharge variables
- Sélecteur safe : `html:not([data-theme="light"])` pour dark-only
- **Pitfall** : `bare :not([data-theme])` matche tout ancêtre → utiliser `html:not([data-theme="light"])`
- Toggle : settings/localisation → `document.documentElement.setAttribute('data-theme', 'dark'/'light')`
- Persistance : `localStorage['fp_theme']` ou préférence org

### Responsive

- Breakpoints dans `dashboard.css` (mobile-first)
- Sidebar : collapse sous ~768px
- Grilles : `fp-grid-2`, `fp-grid-3` → 1 colonne sur mobile
- **Pitfall mobile** : checkboxes hidden absolues échappent au clip → `overflow:hidden` requis sur parent
- Bars fixées : `left: var(--sidebar-width)` sur desktop → `left: 0` sur mobile

---

## 13. Legacy / Dead code

> Ces éléments existent dans le code actuel mais ne sont plus actifs ou sont partiellement obsolètes.

### Pages / Routes sans vraie implémentation backend

Les routes suivantes ont un renderer dans `dashboard.js` mais peu/pas de données backend réelles :
- `#github-integration`, `#code-analysis`, `#deployments`, `#repository-health` → UI présente, données GitHub limitées
- `#crm`, `#market-intelligence`, `#permissions` → UI présente, backends partiels ou INCERTAIN
- `#data-explorer` → UI présente, plusieurs sous-pages potentiellement vides

### Ancien système billing

- `org_settings.stripe_customer_id` → **legacy**, ne plus utiliser ; source de vérité = `organizations.stripe_customer_id`
- `org_settings` encore lue pour fallback legacy dans `resolveOrCreateLegacyOrg()` (`auth.ts:80-191`)
- Colonnes `org_settings` encore patchées lors de la purge customer Stripe par compatibilité

### Mock data / Données hardcodées

- Concurrents DFS : partiellement hardcodés dans certaines vues — task #113 existante
- Dashboard.js : certaines sections de forecast/projections peuvent utiliser des courbes calculées sur données synthétiques

### Anciens systèmes Reports

- `renderNewReportPanel()` (`dashboard.js:8391`) peut être legacy (le renderer principal est `renderGA4Reports()` `68319`)

### Preview mode / Flags

- Pas de flag "preview mode" global identifié
- `fp-config.js` : constantes de configuration frontend

### `window.fn && window.fn()` guards

`dashboard.js` utilise des guards `window.fn && window.fn()` qui indiquent des fonctions qui peuvent être absentes — signe de dead UI ou de chargement conditionnel (`dashboard-global-onclick-scope.md` memory).

### Redirections obsolètes

- `GET /api/auth/login-verify` rétrocompatible pour anciens liens (`:1691-1701`)
- Anciens patterns `org_id` email-shaped (ex: `support@flowpoint.pro` comme org_id) → migrés vers UUID mais code de compatibilité encore présent dans `resolveOrCreateLegacyOrg()`

---

## 14. Arbre des fichiers

### Frontend (`artifacts/flowpoint-export/`)

| Fichier | Rôle |
|---|---|
| `dashboard.html` | Shell HTML du dashboard authentifié |
| `dashboard.js` | **68 718 lignes** — State, routing, rendering, i18n, toutes les pages |
| `dashboard.css` | Styles, variables CSS, dark mode, responsive |
| `fp-backend.js` | Wrapper API, session restore, SSE/polling, auth redirect |
| `fp-config.js` | Constantes runtime frontend |
| `signin.html` | Page sign-in (lien Google OAuth) |
| `login.html` | Formulaire saisie email → magic link |
| `login-verify.html` + `login-verify.js` | Consommation token magic link → création session |
| `pricing.html` + `pricing.js` | Catalogue plans, sélection, cart → checkout |
| `checkout.html` + `checkout.js` | Étapes checkout Stripe |
| `checkout-payment.html` | UI paiement |
| `checkout-return.html` | Retour Stripe → vérification session → redirect |
| `success.html` | Confirmation post-checkout |
| `cancel.html` | Annulation checkout |
| `accept-invitation.html` | Acceptation invitation équipe |
| `report-view.html` | Viewer rapport partagé (public, token) |

### Backend routes (`artifacts/api-server/src/routes/`)

| Fichier | Rôle |
|---|---|
| `index.ts` | Composition routers public/auth, middlewares globaux |
| `auth.ts` | Magic link, verify, session, logout, OAuth |
| `me.ts` | Profil user/org, plan, limits, addons |
| `billing.ts` | Checkout, upgrade, payment-methods, portal, usage, invoices |
| `ai.ts` | **3 301 lignes** — Chat SSE, tools, context, tous endpoints IA |
| `audits.ts` + `audit.ts` | CRUD audits, PSI, score history |
| `monitors.ts` | CRUD monitors, checks, SLA, incidents |
| `missions.ts` | CRUD missions, progress, assign |
| `reports.ts` | CRUD reports, PDF, share tokens |
| `competitors.ts` | CRUD concurrents |
| `keywords.ts` | CRUD keywords, positions |
| `maps.ts` | Proxy Google Maps config/browser key |
| `local-maps.ts` | Heatmap, geocode, competitors map, zones |
| `gsc.ts` | Search Console — sync, keywords, pages, impressions |
| `ga4.ts` | GA4 — properties, overview, realtime, sources, funnels |
| `google.ts` | OAuth Google, GBP, AI reply |
| `alert-rules.ts` | CRUD règles alertes, évaluation |
| `events.ts` | SSE endpoint `/api/events` |
| `activity.ts` | Fil d'activité |
| `team.ts` | Membres, invitations, chat, fichiers |
| `calendar-events.ts` | CRUD événements calendrier |
| `billing.ts` (stripe-webhook) | Webhooks Stripe |
| `admin.ts` | Opérations admin (purge, support) |
| `settings.ts` | API keys, sessions security |
| `automation.ts` | Workflows automation CRUD |
| `integrations.ts` | Catalogue connecteurs |
| `health.ts` | `GET /health` public |

### Services (`artifacts/api-server/src/services/`)

| Fichier | Rôle |
|---|---|
| `billing-context.ts` | Charge état billing par requête depuis organizations |
| `ensure-stripe-customer.ts` | DB-first customer creation, concurrency lock |
| `ai-provider.ts` | Unified chat/stream API, fallback chain |
| `ai-providers/task-router.ts` | Defaults provider/model par task type |
| `ai-providers/openai-provider.ts` | Adapteur OpenAI |
| `ai-providers/anthropic-provider.ts` | Adapteur Anthropic |
| `ai-providers/gemini-provider.ts` | Adapteur Gemini |
| `ai-engine.ts` | Comptage usage, credits accounting |
| `mailer.ts` | Envoi emails (Resend/SMTP), 11 types |
| `sessions.ts` | Création/validation/suppression sessions |
| `org-data.ts` | Chargement données org (organizations + fallback org_settings) |
| `billing-quote.ts` | Calcul devis billing |
| `addons-service.ts` | Activation/désactivation add-ons, Stripe sync |
| `store.ts` | Store global serveur, SSE broadcast, logActivity |
| `ga4-funnel-service.ts` | GA4 funnels, quota enforcement |
| `init-data-tables.ts` | Auto-création/migration tables au démarrage |

### Agents IA (`artifacts/api-server/src/agent/`)

| Fichier | Rôle |
|---|---|
| `tool-executor.ts` | Registry ALL_TOOLS, dispatch, validation Zod, permission check |
| `mission-tools.ts` | Définitions tools missions (search/create/update/complete/assign/delete) |
| `calendar-tools.ts` | Définitions tools calendrier (5 outils) |
| `audit-tools.ts` | Définitions tools audits (9 outils) |
| `recommendation-tools.ts` | Définitions tools recommandations (10 outils) |
| `monitor-tools.ts` | Définitions tools monitors (12 outils) |
| `url-tools.ts` | analyze_url, run_audit |
| `permissions.ts` | Résolution permissions effectives |
| `nav-agent.ts` | navigate_to tool |
| `destination-registry.ts` | Registre destinations navigation |
| `proposals.ts` | Proposals SSE frame |
| `undo.ts` | Undo handlers par action |

### Middlewares (`artifacts/api-server/src/middlewares/`)

| Fichier | Rôle |
|---|---|
| `requireAuth.ts` | Validation session Bearer/cookie |
| `requireRole.ts` | Gate owner-only (`ownerOnly`) |
| `rateLimiter.ts` | Rate limiting global + par route |
| `dbContext.ts` | Injection pool DB dans req |

### Lib (`artifacts/api-server/src/lib/`)

| Fichier | Rôle |
|---|---|
| `plans.ts` | PLAN_LIMITS, PLAN_PRICE_IDS, ADDON_DEFINITIONS, PLAN_INCLUDED_ADDONS |
| `config.ts` | Configuration runtime (quotas, timeouts) |
| `logger.ts` | Pino logger structuré |
| `subscription-state.ts` | Normalisation statut Stripe → état interne |

---

## 15. Diagrammes ASCII

### Auth
```
signin.html
    │
    ▼
POST /api/auth/magic-link
    │ génère token (1h) + email
    ▼
login-verify.html?token=xxx
    │
    ▼
POST /api/auth/verify
    │ consume token → créer user_session → Set-Cookie fp_token
    ▼
sessionStorage fp_session_token
    │ location.replace
    ▼
dashboard.html
    │
    ▼
fp-backend.js: POST /api/auth/session-restore
    │ Bearer → session validate
    ▼
GET /api/me
    │
    ▼
STATE.me → render()
```

---

### Dashboard render
```
dashboard.html load
    │
    ▼
fp-backend.js: session-restore
    │ fail → /login.html
    ▼
dashboard.js: init()
    │
    ├─ Phase 0: GET /api/me (obligatoire)
    │
    ├─ Phase 1: loadData() [bloquant]
    │   ├── /api/overview, /api/plans
    │   ├── /api/audits, /api/monitors, /api/missions
    │   ├── /api/reports, /api/alerts, /api/team
    │   └── STATE.loading = false
    │
    ├─ render() ← premier render complet
    │   └── _doRender(route, sub)
    │         ├── select renderer
    │         ├── innerHTML #fp-page
    │         └── bind events
    │
    └─ Phase 3: loadDataSecondary() [non-bloquant]
        ├── /api/ga4/*, /api/gsc/*, billing, calendar...
        └── render() si page concernée

                    ┌──────────────────────────┐
                    │  SSE /api/events          │
                    │  poll 60s                 │
                    │  → patch STATE → rerender │
                    └──────────────────────────┘
```

---

### Navigation
```
User click nav item
    │
    ▼
navigate('route', 'sub')
    │
    ├─ history.replaceState('#route/sub')
    ├─ localStorage['fp_last_route'] = route
    └─ _doRender(route, sub) [debounce 30ms]
                │
                ▼
        route switch (dashboard.js:15019)
                │
                ▼
        renderXxx() → innerHTML #fp-page
                │
                ▼
        bindGlobalEvents()
        initChartTooltips()
        ...

Hash change / popstate
    │
    ▼
listener → parse hash → navigate()
```

---

### Billing
```
Dashboard CTA (upgrade/trial)
    │
    ▼
fpGoToPricing() → /pricing.html
    │
    ▼
pricing.js: sélection plan/addons → fp_cart localStorage
    │
    ▼
POST /api/billing/create-checkout-session
    │ createStripeCustomer (DB-first, ensureStripeCustomer)
    │ Stripe Checkout Session (mode:'subscription')
    ▼
Redirect → Stripe hosted checkout
    │
    ▼
/checkout-return.html?session_id=...
    │
    ├─ GET /api/billing/verify?session_id=...
    │   → persist plan/status/customer/subscriptionId
    │
    └─ [parallel] Stripe webhook checkout.session.completed
        → stripe-webhook.ts:778
        → activate plan, provision addons
        → UPDATE organizations SET subscription_status='trialing'/'active'
    │
    ▼
/dashboard.html#billing ou #overview
    │
    ▼
SSE billing:plan_updated → re-fetch /api/me → render
```

---

### IA
```
User prompt → sendAIMessage() (dashboard.js:13559)
    │ context + history + provider + enableTools
    ▼
POST /api/ai/chat (SSE)
    │
    ├─ Auth: requireAuth
    ├─ Quota: checkAIQuota
    ├─ Context: buildFlowpointContext() [15+ DB queries]
    │   └── keywords, competitors, GBP, GSC, audits, monitors,
    │       missions, PSI, calendar, credits, recommendations
    │
    ├─ Permissions: resolveEffectivePermissions()
    │
    ├─ System prompt: systemPromptBase + STRICT_AI_RULE + fpContext
    │
    ├─ [si tools activés] runToolCallingLoop() [max 6 rounds]
    │   └── LLM → tool_call → executeTool() → result → LLM synthesis
    │       └── SSE: confirmation_request (preview/full) → user confirms
    │           → undo snapshot → DB write → undo_available SSE
    │
    └─ [sinon] aiStream() → SSE delta chunks
        │
        ▼
    SSE: delta → confirmation_request → undo_available → _ai → [DONE]
        │
        ▼
    dashboard.js reader (13685)
        → renderAIMessages() update
        → usage debit (deferred)
        → reload AI credits display
```

---

## Contradictions / Doublons identifiés

| # | Problème | Détail |
|---|---|---|
| 1 | `org_settings` vs `organizations` | Deux tables stockent les infos billing ; `organizations` est la source de vérité mais `org_settings` persiste pour compatibilité legacy |
| 2 | `store.broadcast()` vs `/api/events` | Deux registres SSE disjoints — `events.ts` bridge `store.addSseClient()` au connect |
| 3 | `search_mission` query requise | Impossible de lister toutes les missions sans paramètre query — `list_missions` absent |
| 4 | `oid ?? "default"` dans buildFlowpointContext | Si orgId absent, toutes les requêtes utilisent `org_id='default'` — risque cross-tenant silencieux |
| 5 | STRICT_AI_RULE template imposé | Template `📊/✅/⚠️/🎯/👉` sur chaque réponse, même les simples — task #592 prévoit la correction |
| 6 | Agents IA visuellement distincts | Les agents SEO/Local/Concurrents sont le même endpoint avec prompts différents, pas de vraie spécialisation |
| 7 | dashboard.js + fp-backend.js loadent Maps | Double injection Google Maps JS — guard de déduplication ajouté (`maps-double-injection.md`) |
| 8 | `confirmationLevel: "preview"` sur create_mission | Le modèle demande confirmation avant d'appeler l'outil, au lieu de l'appeler et laisser le système gérer la confirmation |
