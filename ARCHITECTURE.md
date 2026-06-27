# FlowPoint — Documentation Technique Complète
> État au 27 juin 2026 — après migration RLS sessions 1–3

---

## Table des matières

1. [Architecture globale](#1-architecture-globale)
2. [Tech Stack](#2-tech-stack)
3. [Schéma d'architecture](#3-schéma-darchitecture)
4. [Parcours utilisateur complet](#4-parcours-utilisateur-complet)
5. [Authentification](#5-authentification)
6. [Base de données](#6-base-de-données)
7. [RLS (Row Level Security)](#7-rls-row-level-security)
8. [Organisation & Multi-tenant](#8-organisation--multi-tenant)
9. [Flux de données API → Frontend](#9-flux-de-données-api--frontend)
10. [APIs par page du dashboard](#10-apis-par-page-du-dashboard)
11. [Stripe & Billing](#11-stripe--billing)
12. [Automatisation, Cron & Webhooks](#12-automatisation-cron--webhooks)
13. [Services externes](#13-services-externes)
14. [Migrations & Initialisation](#14-migrations--initialisation)
15. [Tableau de complétude par module](#15-tableau-de-complétude-par-module)
16. [Points techniques prioritaires avant prod](#16-points-techniques-prioritaires-avant-prod)

---

## 1. Architecture globale

FlowPoint est un **SaaS SEO multi-tenant** organisé en monorepo pnpm. Il comprend :

| Couche | Technologie | Rôle |
|--------|-------------|------|
| **Frontend** | Vanilla JS SPA (HTML/CSS/JS) | Dashboard interactif servi statiquement |
| **Backend** | Express + TypeScript (Node.js) | API REST, SSE, auth, webhooks |
| **Base de données** | PostgreSQL (Supabase) | Stockage principal + RLS |
| **ORM** | Drizzle ORM + pg pool raw | Schéma typé + requêtes brutes |
| **In-memory store** | Singleton `Store` (Node.js) | Plan actif, SSE clients, état org |
| **Services externes** | Stripe, Resend, DataForSEO, Google, BetterStack, GitHub | Paiements, email, SEO data, monitoring |

### Structure des répertoires

```
/
├── artifacts/
│   ├── api-server/          # Backend Express (TypeScript)
│   │   ├── src/
│   │   │   ├── routes/      # 65+ fichiers de routes (un par module)
│   │   │   ├── services/    # Logique métier (keyword-engine, billing-service, etc.)
│   │   │   ├── middlewares/ # requireAuth, dbContext, rateLimiter, cacheControl
│   │   │   ├── workers/     # cron-scheduler, cron jobs
│   │   │   └── lib/         # logger, plans, safe-error
│   │   ├── migrations/      # 14 fichiers SQL (001 → 013)
│   │   └── build.mjs        # Bundle esbuild → dist/index.mjs
│   └── flowpoint-export/    # Frontend SPA (HTML/JS/CSS statique)
│       ├── index.html / dashboard.html / login.html
│       ├── dashboard.js     # ~14 500 lignes — logique UI complète
│       └── fp-backend.js    # Couche d'intégration API ↔ frontend
├── lib/
│   ├── db/                  # Package @workspace/db — schéma Drizzle + pool + withOrgDb
│   ├── api-zod/             # Schémas de validation Zod partagés
│   ├── api-spec/            # Types d'API partagés
│   └── api-client-react/    # Client React (non utilisé par le frontend actuel)
├── scripts/                 # Scripts de maintenance DB
└── audit/                   # Scripts Playwright d'audit UI
```

---

## 2. Tech Stack

| Composant | Choix | Version / Notes |
|-----------|-------|-----------------|
| Runtime | Node.js | ≥ 20 |
| Framework backend | Express | 5.x |
| Langage backend | TypeScript | compilé par esbuild |
| Frontend | Vanilla JS | Pas de framework — SPA custom |
| Base de données | PostgreSQL | Supabase (cloud) |
| ORM | Drizzle ORM | `lib/db/src/index.ts` |
| Driver SQL brut | `pg` (node-postgres) | Pool + client.query |
| Validation | Zod | `lib/api-zod/` |
| Email | Resend SDK | Magic links + notifications |
| Paiements | Stripe SDK | Checkout, Portal, Webhooks |
| AI | OpenAI GPT-4o / GPT-4o-mini | Missions, recommendations |
| SEO data | DataForSEO API | Keywords, SERP, backlinks |
| Monitoring | BetterStack API | Monitors, incidents, heartbeats |
| Auth SSO | Google OAuth 2.0 + GitHub OAuth | Tokens chiffrés en DB |
| Real-time | SSE (Server-Sent Events) | Pas de WebSocket |
| Bundler backend | esbuild | `build.mjs` → `dist/index.mjs` |
| Gestionnaire de paquets | pnpm workspaces | Monorepo |

---

## 3. Schéma d'architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           UTILISATEUR                                    │
│                    (navigateur, appli, API client)                       │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │  HTTPS  (cookie fp_token / Bearer token)
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         FRONTEND  (SPA Vanilla JS)                       │
│   flowpoint-export/dashboard.html + dashboard.js (~14 500 lignes)        │
│                                                                          │
│  ┌──────────┐  ┌──────────────────┐  ┌──────────────────────────────┐  │
│  │ STATE {} │  │ navigate(route)  │  │ SSE listener (fp:*  events)  │  │
│  │ (global) │  │ render() → HTML  │  │ billing:plan_updated, alerts  │  │
│  └────┬─────┘  └────────┬─────────┘  └──────────────────────────────┘  │
│       │                 │                                                │
│  ┌────▼─────────────────▼───────────────────────────────────────────┐   │
│  │  fp-backend.js  (bridge API)                                      │   │
│  │  apiFetch(path) · apiAction(method, path, body)                   │   │
│  │  window.FP_MISSIONS_API · FP_MONITORS_API · FP_NOTIF_API …        │   │
│  └───────────────────────────┬───────────────────────────────────────┘  │
└──────────────────────────────┼──────────────────────────────────────────┘
                               │  fetch /api/*  (credentials: 'include')
                               ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                  BACKEND  (Express + TypeScript)                         │
│                  artifacts/api-server  · PORT 8081                       │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Middlewares globaux                                               │  │
│  │  cors · helmet · compression · rateLimiter · orgContext            │  │
│  │  dbContext (attache req.orgDb) · requireAuth                       │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Routes publiques (avant requireAuth)                              │  │
│  │  /health · /api/auth/* · /api/share/:token · /api/webhooks/stripe  │  │
│  │  /api/events (SSE) · /api/billing/config                          │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  Routes protégées (après requireAuth)                              │  │
│  │  /api/missions · /api/monitors · /api/audits · /api/keywords       │  │
│  │  /api/reports · /api/billing/* · /api/team · /api/connectors …    │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌────────────────┐  ┌─────────────────┐  ┌──────────────────────┐     │
│  │  Store (mémoire│  │  Services métier │  │  Workers (cron)      │     │
│  │  plan, addons, │  │  keyword-engine  │  │  monitor-cron 5min   │     │
│  │  sseClients)   │  │  mission-engine  │  │  dataforseo-sync 6h  │     │
│  │                │  │  billing-service │  │  mission-engine 6h   │     │
│  └────────────────┘  │  pdf · store     │  │  forecast 24h        │     │
│                       └─────────────────┘  └──────────────────────┘     │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                 ┌─────────────┴──────────────┐
                 │                            │
                 ▼                            ▼
┌────────────────────────────┐  ┌────────────────────────────────────────┐
│   PostgreSQL (Supabase)     │  │   Services externes                    │
│                            │  │                                        │
│  145+ tables               │  │  ┌─────────┐  Checkout / Webhooks      │
│  RLS via app_user role     │  │  │  Stripe  │  Subscriptions / Credits  │
│  GUC app.current_org_id    │  │  └─────────┘                           │
│                            │  │  ┌─────────┐  Magic links / Notifs     │
│  withOrgDb()               │  │  │  Resend  │                           │
│    SET ROLE app_user       │  │  └─────────┘                           │
│    SET app.current_org_id  │  │  ┌──────────────┐  Keywords/SERP/Rank  │
│    RLS policy evaluée      │  │  │  DataForSEO  │                       │
│                            │  │  └──────────────┘                       │
│  Drizzle ORM (schéma typé) │  │  ┌────────────┐  GSC / GA4 / GBP       │
│  pool.query (superuser)    │  │  │  Google API│  OAuth tokens DB         │
│                            │  │  └────────────┘                         │
│                            │  │  ┌────────────┐  Monitors / SLA        │
│                            │  │  │ BetterStack│                         │
│                            │  │  └────────────┘                         │
│                            │  │  ┌────────────┐  Repo analysis         │
│                            │  │  │   GitHub   │                         │
└────────────────────────────┘  │  └────────────┘                         │
                                └────────────────────────────────────────┘
```

---

## 4. Parcours utilisateur complet

### 4.1 Inscription

```
1. Utilisateur → GET /signup.html (frontend)
2. Frontend → POST /api/auth/signup { email, name }
3. Backend :
   a. Crée un enregistrement user dans user_sessions (pré-session)
   b. Génère token 32 bytes hex → INSERT magic_link_tokens (expire 15min)
   c. Envoie email via Resend : "Confirmez votre email"
4. Utilisateur clique le lien magic → /login-verify.html?token=XXX
5. Frontend → GET /api/auth/login-verify?token=XXX
6. Backend :
   a. SELECT magic_link_tokens WHERE token = $1 AND used = false AND expires_at > NOW()
   b. Marque used = true
   c. createSession() → signe HMAC-SHA256 → INSERT user_sessions
   d. Set-Cookie: fp_token=... (httpOnly, secure, sameSite=lax, 24h)
7. Redirect → /dashboard.html
```

### 4.2 Connexion (utilisateur existant)

```
1. Utilisateur → POST /api/auth/login-request { email }
2. Backend → magic link (même flow inscription step 3–7)
   OU
2b. OAuth Google → GET /api/auth/google/start → redirect → callback
   → createSession() → Set-Cookie fp_token
```

### 4.3 Utilisation du dashboard

```
1. GET /dashboard.html → charge dashboard.js + fp-backend.js
2. fp-backend.js → GET /api/me → renvoie { plan, orgId, email, addons, ... }
3. STATE.me = response → render() déclenche l'affichage
4. navigate("overview") → _doRender() → renderOverview()
   → FP_OVERVIEW_API.load() → GET /api/overview
   → STATE.overview = data → render() → HTML injecté dans #fp-page
5. SSE : EventSource /api/events → écoute fp:monitor:alert, billing:plan_updated, etc.
```

### 4.4 Expiration de session

```
- Sessions TTL : 24h (SESSION_TTL_MS)
- requireAuth vérifie expires_at en DB
- Si expiré : 401 → frontend redirige vers /login.html
- Pas de refresh token — l'utilisateur doit se reconnecter via magic link
```

---

## 5. Authentification

### 5.1 Token de session

```
Format : <payload_base64url>.<signature_base64url>
Payload : userId:orgId:randomBytes:timestamp
Signature : HMAC-SHA256(payload, JWT_SECRET)
```

Le token est **à la fois dans un cookie HttpOnly** (`fp_token`) et accepté comme `Authorization: Bearer <token>` ou `X-Api-Key` header.

### 5.2 Tables concernées

| Table | Rôle |
|-------|------|
| `user_sessions` | Sessions actives : token (PK), user_id, org_id, email, role, expires_at |
| `magic_link_tokens` | Tokens à usage unique : token, email, expires_at, used |
| `login_audits` | Historique des connexions |

### 5.3 Middlewares

| Middleware | Position | Rôle |
|-----------|---------|------|
| `orgContext` | Avant tout | Extrait et valide le token → attache `req.orgContext` |
| `dbContext` | Après orgContext | Attache `req.orgDb(sql, params)` scopé RLS |
| `requireAuth` | Route protégée | Bloque si pas de session valide (renvoie 401) |
| `requireAdmin` | Routes admin | Vérifie `req.orgContext.role === 'admin'` |

### 5.4 OAuth (Google / GitHub)

- Tokens OAuth chiffrés **AES-256-GCM** et stockés dans `google_tokens`
- Flow : `/api/auth/google/start` → Google → `/api/auth/google/callback` → `createSession()`
- Scopes Google : `openid email profile https://www.googleapis.com/auth/searchconsole.readonly`

### 5.5 SAML SSO (Enterprise)

- Configuration via `sso_providers` (table DB)
- Routes : `publicSsoRouter` — `/api/sso/saml/metadata`, `/api/sso/saml/callback`
- Disponible comme add-on Stripe (`ssoEnterprise`)

---

## 6. Base de données

### 6.1 Connexion et configuration

```typescript
// lib/db/src/index.ts
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Drizzle ORM — utilise le même pool (SANS set app.current_org_id → bypass RLS)
export const db = drizzle(pool, { schema });

// Requête RLS-scoped (attribue le rôle app_user + GUC org_id)
export async function withOrgDb<T>(
  orgId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE app_user");
    await client.query("SET LOCAL \"app.current_org_id\" = $1", [orgId]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
```

### 6.2 Tables principales (par module)

#### Auth & Sessions
| Table | Colonnes clés | Notes |
|-------|--------------|-------|
| `user_sessions` | token(PK), user_id, org_id, email, role, expires_at | RLS : select by token only |
| `magic_link_tokens` | token(PK), email, used, expires_at | Expire 15min, usage unique |
| `login_audits` | org_id, email, success, ip, created_at | Historique connexions |

#### Organisation
| Table | Colonnes clés | Notes |
|-------|--------------|-------|
| `org_settings` | org_id(PK), plan, email, name, trial_ends_at, stripe_customer_id, subscription_status | Config principale |
| `user_prefs` | user_id, org_id, prefs_json | Préférences UI par utilisateur |
| `org_addons` | org_id, addon_key, enabled, quantity | Add-ons Stripe actifs |

#### Audits SEO
| Table | Colonnes clés | Notes |
|-------|--------------|-------|
| `audits` | id, org_id, url, name, score, status, data_json, created_at | Résultats d'audit complets |
| `audit_schedules` | org_id, url, frequency, next_run_at | Audits programmés |

#### Monitoring Uptime
| Table | Colonnes clés | Notes |
|-------|--------------|-------|
| `monitors` | id, org_id, name, url, interval, status, uptime, response_time | Config moniteur |
| `monitor_checks` | monitor_id, status, response_time, checked_at | Historique checks |
| `monitor_incidents` | monitor_id, started_at, resolved_at, duration | Incidents de downtime |

#### Missions (IA)
| Table | Colonnes clés | Notes |
|-------|--------------|-------|
| `missions` | id, org_id, title, description, category, type, priority, priority_score, status, impact, effort, ai_quick_win, ai_explanation, ai_action_steps, due_date | Tasks IA |
| `mission_history` | id, mission_id, org_id, action, from_status, to_status | Audit trail |
| `mission_ai_logs` | org_id, trigger, missions_created, model_used, created_at | Logs génération IA |

#### Keywords & SEO
| Table | Colonnes clés | Notes |
|-------|--------------|-------|
| `tracked_keywords` | id, org_id, keyword, url, device, location, current_position, prev_position, trend, search_volume, tag, cluster_id | Keywords suivis |
| `keyword_history` | keyword_id, org_id, recorded_at, position, search_volume | Historique positions |
| `keyword_clusters` | id, org_id, name, intent, count | Clusters thématiques |
| `keyword_opportunities` | id, org_id, keyword, type, opportunity_score | Gaps SEO |
| `ranking_alerts` | id, org_id, keyword_id, old_position, new_position, triggered_at, read | Alertes chute |
| `keywords` | id, keyword, position, volume, difficulty, trend, tag | Table legacy (Drizzle) |

#### Reports
| Table | Colonnes clés | Notes |
|-------|--------------|-------|
| `reports` | id, name, type, date, pages, shared, audit_id, white_label, pdf_ready, meeting_notes_json | Rapports générés |
| `share_tokens` | token(PK), report_id, report_json, branding_json, views, expires_at | Partage public |
| `report_templates` | org_id, logo_url, primary_color, footer_msg | Branding white-label |

#### Billing
| Table | Colonnes clés | Notes |
|-------|--------------|-------|
| `billing_events` | org_id, type, amount, currency, plan, stripe_event_id, created_at | Audit trail Stripe |
| `ai_monthly_usage` | org_id, month, credits_used, credits_extra, total_tokens | Quota IA mensuel |
| `ai_credit_purchases` | org_id, credits, stripe_session_id, created_at | Achats one-time |
| `ai_usage_logs` | org_id, endpoint, tokens_used, model, created_at | Logs granulaires IA |

#### Team
| Table | Colonnes clés | Notes |
|-------|--------------|-------|
| `team_members` | id, org_id, name, email, role, joined | Membres de l'org |
| `team_messages` | id, org_id, from_id, content, created_at | Messages internes |

#### Autres modules
| Table | Module | Notes |
|-------|--------|-------|
| `competitors` | Concurrents | domain, metrics_json, last_checked |
| `notifications` | Notifs | type, title, message, read, link |
| `calendar_events` | Calendrier | title, type, date, start_time |
| `connectors` | Connecteurs | provider, credentials_json (chiffré), status |
| `alert_rules` | Alertes | type, operator, threshold, channels, enabled |
| `automation_workflows` | Automation | trigger_type, actions_json, enabled |
| `behavior_events` | Analytics | session_id, event_type, url, metadata |
| `cro_recommendations` | CRO | page_url, type, priority, status |
| `revenue_leaks` | Revenue Leak | page, issue_type, impact_euros |
| `seo_forecasts` | Forecast | org_id, metric, predictions_json |
| `gbp_locations` | Local SEO | place_id, name, address, rating |
| `review_analysis` | Reviews | source, rating, sentiment, text |
| `crm_integrations` | CRM | provider (salesforce/hubspot), status |
| `google_tokens` | OAuth | access_token (chiffré), refresh_token, scopes |
| `sso_providers` | SSO | provider, metadata_url, entity_id |
| `incoming_webhooks` | Webhooks | name, secret_token, actions_json |

---

## 7. RLS (Row Level Security)

### 7.1 Fonctionnement

```sql
-- Rôle applicatif (migration 011_app_user.sql)
CREATE ROLE app_user NOLOGIN NOSUPERUSER;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;

-- Politique type sur chaque table tenant-scoped (migration 012, 013)
ALTER TABLE missions ENABLE ROW LEVEL SECURITY;
CREATE POLICY rls_org_isolation ON missions
  USING (org_id = current_setting('app.current_org_id', true));
CREATE POLICY tenant_insert ON missions FOR INSERT
  WITH CHECK (org_id = current_setting('app.current_org_id', true));
-- + tenant_update, tenant_delete
```

Quand `withOrgDb` est utilisé :
1. `BEGIN`
2. `SET LOCAL ROLE app_user` → perd les droits superuser
3. `SET LOCAL "app.current_org_id" = 'xxx'` → le GUC est lu par les policies
4. La requête est exécutée → RLS filtre automatiquement par org
5. `COMMIT`

### 7.2 État de migration par route (au 27/06/2026)

| Route | Méthode DB | RLS actif | Notes |
|-------|-----------|-----------|-------|
| `missions.ts` | `req.orgDb` | ✅ | Migré session 3 |
| `notifications.ts` | `req.orgDb` | ✅ | Migré session 3 |
| `calendar-events.ts` | `req.orgDb` | ✅ | Migré session 3 |
| `team.ts` | `req.orgDb` | ✅ | Raw SQL (schema Drizzle manque org_id) |
| `keywords.ts` | `req.orgDb` + Drizzle | ⚠️ Partiel | tracked_keywords = RLS ; keywords legacy = Drizzle bypass |
| `reports.ts` | `req.orgDb` + Drizzle | ⚠️ Partiel | share_tokens = RLS ; reports table = Drizzle bypass |
| `billing.ts` | `req.orgDb` + rawPool | ⚠️ Partiel | usage-details = RLS ; webhook = pool intentionnel (Stripe ≠ org user) |
| `monitors.ts` | `req.orgDb` + pool | ⚠️ Partiel | Lectures = RLS ; writes background = pool |
| `audits.ts` | `req.orgDb` + pool | ⚠️ Partiel | Lectures = RLS ; writes PSI background = pool |
| `competitors.ts` | `req.orgDb` | ✅ | Migré |
| `alert-rules.ts` | Drizzle `db` | ❌ | Drizzle bypass RLS |
| `connectors.ts` | Drizzle `db` | ❌ | Drizzle bypass RLS |
| `crm.ts` | `pool` | ❌ | Pool superuser |
| `integrations.ts` | `pool` | ❌ | Pool superuser |
| `market-intelligence.ts` | `pool` | ❌ | Pool superuser |
| `review-intelligence.ts` | `pool` | ❌ | Pool superuser |
| `gbp-posts.ts` | `pool` | ❌ | Pool superuser |
| `local-maps.ts` | `pool` | ❌ | Pool superuser |
| `gsc.ts` | `pool` | ❌ | Pool superuser |
| `me.ts` | `pool` | ❌ | Pool superuser |
| `google.ts` | `pool` | ❌ | Pool superuser |
| `automation.ts` | Drizzle `db` | ❌ | Drizzle bypass RLS |
| `behavioral.ts` | Drizzle `db` | ❌ | Drizzle bypass RLS |
| `cro.ts` | Drizzle `db` | ❌ | Drizzle bypass RLS |
| `revenue-leak.ts` | Drizzle `db` | ❌ | Drizzle bypass RLS |
| `share.ts` | Drizzle `db` | ❌ | Public endpoint — pas d'orgId |
| `auth.ts` | `pool` | N/A | Global par design (magic links) |
| `health.ts` | `pool` | N/A | Infrastructure |
| `admin.ts` | `pool` | N/A | Admin superuser intentionnel |
| `diagnostics.ts` | `pool` | N/A | Infrastructure |

> **Résumé :** ~35% des routes utilisent `req.orgDb` (RLS actif). Les Drizzle `db` calls et les `pool` directs dans les routes métier représentent le principal risque d'isolation à corriger avant mise en production.

---

## 8. Organisation & Multi-tenant

### 8.1 Création d'une organisation

Actuellement, l'org `default` est la seule organisation active. La table `org_settings` est le pivot :

```sql
CREATE TABLE org_settings (
  org_id TEXT PRIMARY KEY DEFAULT 'default',
  plan TEXT DEFAULT 'standard',
  email TEXT,
  name TEXT,
  trial_ends_at TIMESTAMPTZ,
  subscription_status TEXT DEFAULT 'trial',
  stripe_customer_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

À l'inscription d'un utilisateur : si `org_settings` pour son `org_id` n'existe pas, un enregistrement est créé via `upsertOrgSettings()`.

### 8.2 Lien utilisateur ↔ organisation

- Chaque session (`user_sessions`) porte un `org_id`
- `req.orgContext.orgId` est extrait de la session active
- `req.orgId` est un shortcut = `req.orgContext?.orgId ?? 'default'`

### 8.3 In-memory Store (singleton)

Le `Store` en mémoire (`services/store.ts`) représente l'état de l'org active côté serveur :

```typescript
class Store {
  me: {
    plan: string;         // "standard" | "pro" | "ultra" | "agency"
    orgId: string;        // "default" (actuellement mono-org)
    email?: string;
    name?: string;
    addons: Record<string, boolean>;  // whiteLabel, prioritySupport, etc.
    seats: number;
    trialEndsAt?: string;
    subscriptionStatus?: string;  // "trial" | "active" | "past_due" | "canceled"
    stripeCustomerId?: string;
  };
  triggeredAlerts: Array<...>;
  sseClients: Set<(data: string) => void>;  // SSE connectés
}
```

Au démarrage serveur, `store.refresh()` recharge le plan depuis `org_settings` DB.

---

## 9. Flux de données API → Frontend

```
1. Utilisateur clique sur "Missions" dans le menu
          │
          ▼
2. navigate("missions")   [dashboard.js]
   → STATE.route = "missions"
   → render()
          │
          ▼
3. renderMissions()   [dashboard.js]
   → Affiche skeleton/loading
   → FP_MISSIONS_API.loadAll()
          │
          ▼
4. apiFetch("/api/missions")   [fp-backend.js]
   → fetch("https://[host]/api/missions", { credentials: 'include' })
   → Header automatique : Cookie fp_token=...
          │
          ▼
5. Express route handler   [routes/missions.ts]
   → requireAuth → vérifie session DB
   → req.orgDb("SELECT * FROM missions WHERE org_id = $1", [orgId])
   → withOrgDb : SET ROLE app_user + SET app.current_org_id
   → PostgreSQL RLS policy filtre par org_id
   → Retourne rows[]
          │
          ▼
6. res.json(missions)   → 200 JSON
          │
          ▼
7. fp-backend.js reçoit la réponse
   → normalise (dates, id mapping)
   → STATE.missions = missions
          │
          ▼
8. render()   → _doRender()
   → renderMissions() avec STATE.missions rempli
   → Template literals → chaîne HTML
   → document.getElementById('fp-page').innerHTML = html
          │
          ▼
9. Utilisateur voit la liste des missions
```

### SSE (Server-Sent Events)

```
EventSource /api/events (connection permanente)
  ↓ fp:monitor:alert    → STATE.alerts.push(...) → render()
  ↓ billing:plan_updated → STATE.me.plan = plan → render()
  ↓ fp:audit:complete   → STATE.audits reload   → render()
  ↓ payment_failed      → affiche banner rouge  → render()
```

---

## 10. APIs par page du dashboard

| Page | Endpoints GET principaux | Endpoints CRUD |
|------|--------------------------|----------------|
| **Overview** | `GET /api/overview` | — |
| **Audits** | `GET /api/audits` | `POST /api/audits`, `DELETE /api/audits/:id` |
| **Monitors** | `GET /api/monitors` | `POST /api/monitors`, `PATCH /api/monitors/:id`, `DELETE /api/monitors/:id` |
| **Missions** | `GET /api/missions`, `/api/missions/stats`, `/api/missions/quick-wins`, `/api/missions/roadmap` | `POST /api/missions`, `PATCH /api/missions/:id`, `DELETE /api/missions/:id` |
| **Keywords** | `GET /api/keywords`, `/api/keywords/stats`, `/api/keywords/clusters`, `/api/keywords/opportunities` | `POST /api/keywords/track`, `DELETE /api/keywords/:id` |
| **Competitors** | `GET /api/competitors` | `POST /api/competitors`, `DELETE /api/competitors/:id` |
| **Reports** | `GET /api/reports` | `POST /api/reports`, `POST /api/reports/:id/share`, `DELETE /api/reports/:id` |
| **Billing** | `GET /api/billing/subscription`, `/api/billing/invoices`, `/api/billing/usage`, `/api/billing/usage-details` | `POST /api/billing/checkout`, `POST /api/billing/portal` |
| **Alert Rules** | `GET /api/alert-rules` | `POST /api/alert-rules`, `PATCH /api/alert-rules/:id`, `DELETE /api/alert-rules/:id` |
| **Team** | `GET /api/team` | `POST /api/team/invite`, `PATCH /api/team/:id`, `DELETE /api/team/:id` |
| **Calendar** | `GET /api/calendar-events` | `POST /api/calendar-events`, `PATCH /api/calendar-events/:id`, `DELETE /api/calendar-events/:id` |
| **Notifications** | `GET /api/notifications` | `POST /api/notifications`, `PATCH /api/notifications/:id/read`, `DELETE /api/notifications/:id` |
| **Connectors** | `GET /api/connectors` | `POST /api/connectors/:provider/connect`, `POST /api/connectors/:provider/disconnect` |
| **Market Intel** | `GET /api/market-intelligence` | `POST /api/market-intelligence/refresh` |
| **Review Intel** | `GET /api/review-intelligence` | `POST /api/review-intelligence/reply` |
| **GBP Posts** | `GET /api/gbp-posts` | `POST /api/gbp-posts` |
| **Local Maps** | `GET /api/local-seo/citations` | — |
| **CRM** | `GET /api/crm/status`, `/api/crm/providers`, `/api/crm/logs` | `POST /api/crm/connect/:provider`, `POST /api/crm/sync` |
| **Automation** | `GET /api/automation/workflows` | `POST /api/automation/workflows`, `POST /api/automation/workflows/:id/run` |
| **Forecast** | `GET /api/forecast` | `POST /api/forecast/refresh` |
| **AI** | `GET /api/ai/recommendations` | `POST /api/ai-workspace-launch` |
| **Settings/Me** | `GET /api/me`, `GET /api/me/prefs` | `PATCH /api/me`, `PUT /api/me/prefs` |

---

## 11. Stripe & Billing

### 11.1 Plans disponibles

| Plan | Prix Stripe | Audits | Monitors | Reports | Team seats | AI crédits/mois |
|------|-------------|--------|----------|---------|-----------|-----------------|
| Standard | `STRIPE_PRICE_ID_STANDARD` | 30 | 3 | 30 | 1 | 30 000 |
| Pro | `STRIPE_PRICE_ID_PRO` | 300 | 50 | 300 | 5 | 100 000 |
| Ultra | `STRIPE_PRICE_ID_ULTRA` | 2 000 | 300 | 2 000 | 10 | 500 000 |
| Agency | custom | illimité | illimité | illimité | illimité | 2 000 000 |

### 11.2 Add-ons disponibles (25+)

Catégories :
- **Monitoring** : monitorsPack10, monitorsPack50, globalMonitoring, slaMonitoring
- **SEO Lab** : advancedSeoLab, keywordDomination, backlinkIntelligence, aiContentStrategist
- **Local SEO** : gbpSlots10, aiGbpPosting, reviewIntelligence, localDominationMaps
- **CRO / Conversion** : aiCro, behavioralAI, revenueLeak, abTestingAI
- **Rapports** : whiteLabel, agencyPacks, aiExecutiveReport, aiForecasting
- **Intelligence** : marketIntelligence, aiWorkflows
- **Team** : extraSeats, enterprisePermissions
- **Rétention data** : retention90d, retention365d
- **Intégrations** : advancedWebhooks, zapierIntegration, crmIntegration
- **Enterprise** : customDomain, ssoEnterprise, aiWorkspaceLaunch, prioritySupport
- **Crédits IA** : aiCreditsPack50k, aiCreditsPack200k, aiCreditsPack500k

### 11.3 Flux de paiement

```
1. POST /api/billing/checkout { plan, addons[], trialDays }
   → buildLineItems() → Stripe Checkout Session (14j trial)
   → { url: "https://checkout.stripe.com/..." }

2. Utilisateur paye → Stripe redirige → /billing?success=1

3. GET /api/billing/verify?session_id=xxx
   → Vérifie payment_status === "paid"
   → Met à jour store.me.plan en mémoire + org_settings DB

4. Stripe envoie webhook → POST /api/webhooks/stripe
   → Vérifie signature (STRIPE_WEBHOOK_SECRET)
   → Traite les events (voir tableau ci-dessous)
```

### 11.4 Events Stripe traités

| Event Stripe | Action FlowPoint |
|-------------|-----------------|
| `checkout.session.completed` | Active plan, stocke stripeCustomerId, broadcastPlanUpdate |
| `customer.subscription.created` | Synchro plan + add-ons → DB |
| `customer.subscription.updated` | Mise à jour plan/status/trial + add-ons |
| `customer.subscription.deleted` | Downgrade → standard, désactive add-ons |
| `customer.subscription.trial_will_end` | Log (TODO: envoyer email reminder Resend) |
| `invoice.payment_succeeded` | Status → active, trackBillingEvent |
| `invoice.payment_failed` | Status → past_due, broadcast payment_failed SSE |

### 11.5 Crédits IA

```
Achats one-time → POST /api/billing/checkout-ai-credits
  → checkout.session.completed
  → INSERT ai_credit_purchases
  → UPDATE ai_monthly_usage SET credits_extra += N

Consommation :
  → POST /api/ai/* (recommendations, missions/generate, etc.)
  → checkQuota() vérifie ai_monthly_usage
  → logUsage() INSERT ai_usage_logs + UPDATE ai_monthly_usage
```

---

## 12. Automatisation, Cron & Webhooks

### 12.1 Cron jobs actifs

| Job | Intervalle | Source | Action |
|-----|-----------|--------|--------|
| `monitor-health` | 5 min | `monitor-cron.ts` + `setInterval` | Vérifie uptime de tous les monitors actifs, crée incidents, déclenche alertes |
| `dataforseo-sync` | 6h | `dataforseo-cron.ts` + `setInterval` | Rafraîchit métriques SEO des domaines stale (>6h), régénère missions |
| `mission-engine` | 6h | `cron-scheduler.ts` | Analyse données SEO + monitoring → génère/met à jour missions IA |
| `audit-scheduler` | 1h | `cron-scheduler.ts` | Exécute les audits planifiés (audit_schedules) |
| `forecast-refresh` | 24h | `cron-scheduler.ts` | Refraisîchit prédictions SEO (seo_forecasts) |

### 12.2 Système d'automatisation

```
automation_workflows (table DB)
  trigger_type: "schedule" | "event" | "condition" | "manual"
  actions_json: [{ type: "send_report", ... }, { type: "send_email", ... }]
  enabled: boolean

POST /api/automation/workflows/:id/run
  → automation-service.ts → execute chaque action séquentiellement
  → INSERT workflow_runs (log)

Workflows prédéfinis (seedés au démarrage) :
  - Weekly Client Report
  - Strict SLA Monitoring  
  - Full SEO Pipeline
  - Client Onboarding
  - Competitor Intelligence
```

### 12.3 Webhooks entrants

```
incoming_webhooks (table DB)
  name, secret_token, actions_json, enabled

POST /api/webhooks/:token
  → Vérifie secret_token
  → Déclenche les actions configurées
```

### 12.4 Webhooks Stripe

```
Endpoint public (avant requireAuth) :
  POST /api/webhooks/stripe  [stripe-webhook.ts]
  POST /api/billing/webhook  [billing.ts - backup]

Sécurité :
  stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)
  
Idempotence :
  billing_events table avec stripe_event_id unique
```

---

## 13. Services externes

| Service | Variables d'env | Statut | Usage |
|---------|----------------|--------|-------|
| **Stripe** | `STRIPE_SECRET_KEY`, `STRIPE_LIVE_API_KEY`, `STRIPE_WEBHOOK_SECRET`, `PUBLIC_STRIPE_API_KEY` | ✅ Complet | Abonnements, checkout, portal, webhooks, crédits IA |
| **Resend** | `RESEND_API_KEY` | ✅ Complet | Magic links, notifications email |
| **DataForSEO** | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` | ⚠️ Hybride | Keywords, SERP, backlinks — fallback mock si non configuré |
| **Google OAuth** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | ✅ Complet | Auth OAuth, tokens chiffrés DB |
| **Google GBP** | (tokens OAuth) | ✅ Complet | GMB posts, reviews, locations |
| **Google GSC** | (tokens OAuth) | ⚠️ Stub | syncGSCData retourne 0, getTopKeywords retourne mock |
| **Google GA4** | (tokens OAuth) | ⚠️ Stub | ga4-service.ts retourne données mock |
| **BetterStack** | `BETTERSTACK_API_TOKEN` | ✅ Complet | Sync monitors, incidents, heartbeats, SLA |
| **GitHub** | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | ✅ Complet | OAuth, repo analysis |
| **OpenAI** | `OPENAI_API_KEY` | ✅ Complet | GPT-4o pour missions, CRO, market intel, forecast |
| **SMTP** | `SMTP_PASS` (env présent) | ⚠️ Non implémenté | Remplacé par Resend |
| **Google Maps** | `GOOGLE_MAPS_API_KEY` (MCP) | ⚠️ Partiel | Lookups basiques via MCP, DataForSEO pour maps SERP |

---

## 14. Migrations & Initialisation

### 14.1 Migrations SQL (ordre d'application)

| Migration | Contenu |
|-----------|---------|
| `001_auth_tables.sql` | `user_sessions`, `magic_link_tokens`, `login_audits` |
| `002_dashboard_tables.sql` | `audits`, `reports`, `keywords`, `competitors`, `monitors`, `alert_rules`, `team_members`, `notifications`, `connectors`, `billing_events`, `behavior_*`, `cro_*`, `crm_*`, `sso_*`, `ai_*` |
| `003_fix_monitors_notifications.sql` | Corrections colonnes monitors + notifications |
| `004_org_settings_activity_logs.sql` | `org_settings`, `activity_logs` |
| `005_missing_tables.sql` | `tracked_keywords`, `keyword_clusters`, `keyword_history`, `keyword_opportunities`, `ranking_alerts`, `competitor_rankings`, `user_prefs`, `market_trends`, `industry_signals` |
| `006_location.sql` | Tables géolocalisation |
| `007_missing_tables_2.sql` | `google_tokens`, `seo_forecasts`, `gbp_locations`, `crm_field_mappings`, `competitor_movements` |
| `008_automation_missions.sql` | `missions`, `mission_history`, `mission_ai_logs`, `automation_workflows`, `workflow_runs`, `incoming_webhooks`, `automation_runs` |
| `009_ai_credit_purchases.sql` | `ai_credit_purchases` |
| `010_rls_hardening_clean.sql` | Enable RLS + policies de base sur toutes les tables |
| `011_app_user.sql` | Rôle `app_user`, GRANT sur toutes les tables |
| `012_supabase_rls_tenant_isolation.sql` | Policies `rls_org_isolation` (5 policies/table) pour 145 tables |
| `013_supabase_cloud_rls.sql` | Ajustements pour Supabase cloud (SECURITY DEFINER views) |

### 14.2 Initialisation au démarrage serveur

```typescript
// artifacts/api-server/src/index.ts
await initMissionsTables();     // Vérifie missions, mission_history, mission_ai_logs
await initAutomationTables();   // Vérifie automation_workflows, workflow_runs
await initMonitorsTables();     // Vérifie monitors, monitor_checks, monitor_incidents
await initDataTables();         // Vérifie audits, notifications, competitors, calendar_events
await store.refresh();          // Recharge plan + addons depuis org_settings DB
startCronJobs();                // Lance les workers periodiques
```

---

## 15. Tableau de complétude par module

| Module | Complétude | Endpoints principaux | Tables principales | RLS | Points restants |
|--------|-----------|---------------------|-------------------|-----|-----------------|
| **Audits** | 80% | GET/POST/DELETE /api/audits, GET /api/audits/:id/details | `audits`, `audit_schedules` | ⚠️ Partiel | GSC/GA4 réels (actuellement mock) ; rapport complet PDF |
| **Monitors** | 85% | CRUD /api/monitors, /api/monitors/:id/checks | `monitors`, `monitor_checks`, `monitor_incidents` | ⚠️ Partiel | BetterStack sync complet ; SSL checker |
| **Missions** | 90% | CRUD /api/missions, /api/missions/generate, /api/missions/roadmap | `missions`, `mission_history`, `mission_ai_logs` | ✅ | Engine AI améliorable ; intégration GSC réelle |
| **Keywords** | 75% | CRUD /api/keywords, /api/keywords/track, /api/keywords/stats | `tracked_keywords`, `keyword_clusters`, `keyword_history` | ⚠️ Partiel | DataForSEO sync réel (stub) ; SERP live |
| **Competitors** | 70% | CRUD /api/competitors | `competitors`, `competitor_rankings` | ✅ | Analyses IA plus poussées ; tracking SERP live |
| **Reports** | 80% | CRUD /api/reports, /api/reports/:id/share, /api/reports/:id/download | `reports`, `share_tokens`, `report_templates` | ⚠️ Partiel | Drizzle sans org_id à corriger ; envoi email auto |
| **Billing** | 85% | GET /api/billing/*, POST /api/billing/checkout, portal | `org_settings`, `billing_events`, `org_addons`, `ai_monthly_usage` | ⚠️ Partiel | Gestion multi-org ; reminder email trial |
| **Alert Rules** | 75% | CRUD /api/alert-rules | `alert_rules` | ❌ Drizzle | Migrate vers req.orgDb ; SMS channel |
| **Team** | 80% | CRUD /api/team, /api/team/invite | `team_members`, `team_messages` | ✅ | Invitation email réelle ; permissions granulaires |
| **Calendar** | 80% | CRUD /api/calendar-events | `calendar_events` | ✅ | Intégration Google Calendar |
| **Notifications** | 85% | CRUD /api/notifications, /api/notifications/read-all | `notifications` | ✅ | Push notifications browser |
| **Connectors** | 65% | GET/POST /api/connectors/* | `connectors` | ❌ Drizzle | Migrate ; OAuth flows complets Slack/Jira |
| **CRM** | 50% | GET /api/crm/status, /providers, /logs | `crm_integrations`, `crm_sync_logs`, `crm_field_mappings` | ❌ Pool | Sync HubSpot/Salesforce réel (stub) |
| **Market Intelligence** | 60% | GET /api/market-intelligence | `market_trends`, `market_opportunities`, `industry_signals` | ❌ Pool | DataForSEO live ; tendances réelles |
| **Review Intelligence** | 65% | GET /api/review-intelligence, POST /reply | `review_analysis`, `review_alerts` | ❌ Pool | GBP review sync automatique |
| **GBP Posts** | 70% | CRUD /api/gbp-posts | `gbp_locations` | ❌ Pool | Planification avancée ; analytics posts |
| **Local SEO / Maps** | 50% | GET /api/local-seo/citations | `gbp_locations` | ❌ Pool | /api/local-seo 404 ; local rank live |
| **Forecast** | 65% | GET /api/forecast | `seo_forecasts` | N/A | Modèle prédictif plus précis |
| **CRO** | 60% | GET /api/cro | `cro_recommendations`, `cro_scores`, `cro_experiments` | ❌ Drizzle | A/B testing réel ; heatmaps |
| **Revenue Leak** | 55% | GET /api/revenue-leak | `revenue_leaks` | ❌ Drizzle | Calculs réels (scraping + analytics) |
| **AI / Workspace** | 70% | GET /api/ai/recommendations, POST /api/ai-workspace-launch | `ai_usage_logs`, `ai_monthly_usage` | N/A | Contexte plus riche ; RAG sur données client |
| **Automation** | 65% | CRUD /api/automation/workflows, POST /run | `automation_workflows`, `workflow_runs` | ❌ Drizzle | Triggers event réels ; Zapier/Make |
| **Analytics Comportement** | 55% | GET /api/behavioral, snippet JS | `behavior_events`, `behavior_sessions`, `behavior_insights` | ❌ Drizzle | Entonnoirs ; replay sessions |
| **SSO Enterprise** | 60% | GET/POST /api/sso/* | `sso_providers`, `org_auth_config` | N/A | Tests SAML réels |
| **White Label** | 70% | GET/PATCH /api/white-label | `report_templates`, `custom_domains` | ❌ Drizzle | DNS validation custom domain |
| **GSC / GA4** | 30% | GET /api/gsc/*, /api/ga4/* | `google_tokens` | ❌ Pool | syncGSCData stub → vraies données |
| **Overview** | 85% | GET /api/overview | Agrégat multi-tables | N/A | Métriques historiques plus riches |
| **Activity** | 90% | GET /api/activity | `activity_logs` | N/A | Filtres avancés |
| **Settings/Me** | 75% | GET/PATCH /api/me, /api/me/prefs | `org_settings`, `user_prefs` | ❌ Pool | Migrate vers req.orgDb |

---

## 16. Points techniques prioritaires avant prod

### 🔴 Bloquants (sécurité / isolation)

1. **~65% des routes utilisent encore pool/Drizzle (bypass RLS)**
   - `alert-rules.ts`, `connectors.ts`, `automation.ts`, `me.ts`, `crm.ts`, `integrations.ts`, `market-intelligence.ts`, `review-intelligence.ts`, `gbp-posts.ts`, `local-maps.ts`, `gsc.ts`, `google.ts`, `behavioral.ts`, `cro.ts`, `revenue-leak.ts`, `white-label.ts`
   - **Action** : migrer `pool`/Drizzle → `req.orgDb` dans les 20+ routes restantes

2. **Drizzle ORM n'est pas RLS-scoped**
   - `db.select().from(reportsTable)` retourne les données de TOUTES les orgs
   - **Action** : soit ajouter `org_id` aux schémas Drizzle + `.where(eq(table.orgId, orgId))`, soit wrapper Drizzle dans `withOrgDb`

3. **`store.ts` utilise pool superuser pour broadcastPlanUpdate**
   - Fire-and-forget pool.connect() dans le store singleton
   - **Action** : remplacer par un appel `upsertOrgSettings()` qui accepte un client RLS-scoped

### 🟡 Importants (qualité / fiabilité)

4. **Sessions sans refresh token**
   - TTL 24h seulement — l'utilisateur doit refaire un magic link quotidiennement
   - **Action** : implémenter refresh token (7j) + rotation automatique

5. **Mono-org (`default`) hardcodé dans le store**
   - Le `Store` singleton ne supporte qu'un seul `orgId` à la fois
   - **Action** : si multi-org est prévu, le store doit être scopé par requête, pas singleton

6. **GSC et GA4 sont des stubs**
   - `syncGSCData` retourne 0 ; `ga4-service.ts` retourne des campagnes fictives
   - **Action** : implémenter les vraies APIs Google pour les données de performance

7. **DataForSEO en mode hybride**
   - `getKeywordSuggestions`, `getBacklinks` etc. retournent du mock si API non configurée
   - **Action** : activer les credentials DataForSEO et valider les flows live

8. **CI/CD check RLS manquant**
   - Aucune vérification automatique qu'une nouvelle table a ses policies RLS
   - **Action** : ajouter `pnpm run check:rls` qui compare tables avec org_id vs tables avec policies

### 🟢 Nice-to-have (avant GA)

9. **Email d'invitation équipe non envoyé**
   - `POST /api/team/invite` crée le membre en DB mais n'envoie pas d'email
   - **Action** : ajouter Resend pour email d'invitation avec magic link inclus

10. **Reminder email "trial se termine dans 3 jours"**
    - L'event `customer.subscription.trial_will_end` est loggué mais le TODO Resend n'est pas implémenté

11. **Local SEO `/api/local-seo` → 404**
    - La route de summary n'existe pas
    - **Action** : créer `GET /api/local-seo` comme alias de `/api/local-seo/citations`

12. **PDF download en production**
    - `streamReportPdf` utilise une lib PDF qui peut consommer beaucoup de mémoire sous charge
    - **Action** : tester avec gros volume, envisager génération async + stockage objet

---

*Document généré automatiquement par introspection du codebase FlowPoint le 27 juin 2026.*
*Tous les pourcentages de complétude sont des estimations basées sur l'état fonctionnel des endpoints (CRUD complet, données réelles vs mock, RLS actif).*
