# FlowPoint — Diagnostic : Source de vérité de l'abonnement
**Date :** 24 juillet 2026  
**Contexte :** Cas réel — suppression manuelle de tous les clients Stripe → accès dashboard maintenu + email "essai se termine dans 4 jours" envoyé.  
**Statut :** Diagnostic uniquement — aucune correction dans ce document.

---

## 1. Pourquoi l'accès au dashboard est maintenu après suppression Stripe

### Flux complet de connexion → autorisation

```
1. Utilisateur saisit email → POST /api/auth/signup
   └─ upsertOrgSettings(email, { subscriptionStatus:"trialing", trialEndsAt:+14j })
   └─ store.me.subscriptionStatus = "trialing"       ← singleton, volatile
   └─ Fire-and-forget: stripe.customers.create()
      └─ upsertOrgSettings(email, { stripeCustomerId: cus_xxx })

2. Utilisateur clique le magic link → GET /api/auth/login-verify?token=xxx
   └─ getMagicToken(token) → lit magic_link_tokens (PostgreSQL)
   └─ createSession({ userId: email, orgId: email, role: "owner" })
      └─ INSERT INTO user_sessions (token, org_id=email, ..., expires_at=NOW()+24h)
   └─ Cookie HttpOnly fp_token = <session_token>

3. Dashboard charge → GET /api/me (ou n'importe quelle route /api/*)
   └─ requireAuth middleware
      └─ getSession(token) → SELECT FROM user_sessions WHERE token=$1 AND expires_at > NOW()
      └─ Si trouvé : next()  ← SEULE VÉRIFICATION DE SÉCURITÉ
   └─ orgContext middleware
      └─ req.orgId = session.org_id  (= l'email de l'utilisateur)
   └─ /api/me → loadOrgSettings(orgId) → lit org_settings (PostgreSQL)
      └─ Retourne plan, subscriptionStatus, trialEndsAt depuis DB
```

**Conclusion : l'accès au dashboard ne dépend PAS de Stripe.**  
La vérification d'accès (`requireAuth`) consulte uniquement la table `user_sessions` (PostgreSQL). Il n'y a aucune vérification du statut d'abonnement, du plan, ou du client Stripe dans ce middleware. Un cookie valide = accès accordé.

**Suppression manuelle d'un client Stripe = zéro effet sur `user_sessions`.**  
Il n'existe aucun handler webhook `customer.deleted` dans le code. La suppression Stripe ne génère aucun événement qui modifie `org_settings` ou révoque les sessions.

---

## 2. Pourquoi l'email "essai se termine dans 4 jours" a été envoyé

### Source : `services/monitor-cron.ts` — cron trial-ending

```sql
SELECT org_id, email, first_name, plan, trial_ends_at
FROM org_settings
WHERE subscription_status = 'trialing'
  AND trial_ends_at IS NOT NULL
  AND trial_ends_at::timestamptz BETWEEN (NOW() + INTERVAL '2 days') AND (NOW() + INTERVAL '4 days')
  AND trial_ending_notified_at IS NULL
  AND email IS NOT NULL
```

**Cette requête ne consulte pas Stripe.** Elle lit uniquement `org_settings` (PostgreSQL).

**Chronologie :**
1. Inscription → `org_settings.subscription_status = "trialing"`, `trial_ends_at = signup_date + 14j`
2. Suppression manuelle du client Stripe → **aucune modification de `org_settings`**
3. 10 jours après l'inscription → le cron s'exécute, trouve l'org dans la fenêtre 2–4 jours
4. Envoie l'email à `org_settings.email` (qui est l'email réel de l'org — lecture DB, pas store.me)
5. Met à jour `org_settings.trial_ending_notified_at = NOW()`

**Le système de trial est entièrement indépendant de Stripe.** La date de fin de trial et le statut "trialing" vivent en DB sans lien avec un objet Stripe. La suppression du customer Stripe ne remet pas à zéro l'état trial.

---

## 3. Où est stockée chaque donnée

### 3.1 Qui autorise l'accès au dashboard

| Vérification | Source | Durée |
|---|---|---|
| Token de session valide | `user_sessions.token` (PostgreSQL) | 24h (TTL strict) |
| Session non expirée | `user_sessions.expires_at > NOW()` | — |
| **Abonnement actif** | **NON VÉRIFIÉ** | N/A |
| **Plan suffisant** | **NON VÉRIFIÉ (pas de paywall)** | N/A |

La condition d'accès est uniquement : cookie `fp_token` valide ET enregistrement dans `user_sessions` non expiré.

### 3.2 Statut d'essai (trial status)

| Stockage | Valeur | Mise à jour |
|---|---|---|
| `org_settings.subscription_status` (PostgreSQL) | `"trialing"` | Signup, OAuth login, webhook (P0-1 bug) |
| `store.me.subscriptionStatus` (RAM, volatile) | `"trialing"` | Signup, webhooks (P0-3 bug) |
| `UserProfile.subscriptionStatus` (MongoDB) | `"trialing"` | **Jamais mis à jour par le code actuel** (modèle legacy) |

**Source de vérité :** `org_settings.subscription_status` (PostgreSQL)  
**Attention :** Les webhooks Stripe écrivent actuellement sur `org_id = "default"` et non l'org réelle (P0-1).

### 3.3 Date de fin d'essai (trial end date)

| Stockage | Valeur | Mise à jour |
|---|---|---|
| `org_settings.trial_ends_at` (PostgreSQL) | ISO 8601 | Signup (+14j), OAuth login (+14j), `startTrial()` |
| `store.me.trialEndsAt` (RAM, volatile) | ISO 8601 | Signup, `startTrial()`, webhooks (P0-3) |
| `UserProfile.trialEndsAt` (MongoDB) | ISO 8601 | **Jamais mis à jour** (legacy) |

**Source de vérité :** `org_settings.trial_ends_at`  
**Jamais modifiée** par une suppression Stripe.

### 3.4 Plan actif

| Stockage | Valeur | Mise à jour |
|---|---|---|
| `org_settings.plan` (PostgreSQL) | `"standard"/"pro"/"ultra"` | Signup, OAuth, `/billing/verify`, webhooks (bug P0-1/P0-4) |
| `store.me.plan` (RAM, volatile) | identique | Signup, webhooks (P0-3), `startTrial()` |
| `UserProfile.plan` (MongoDB) | `"standard"` (default) | **Jamais mis à jour** (legacy) |

**Source de vérité :** `org_settings.plan`  
**Bug P0-4 :** `customer.subscription.deleted` ne remet PAS `org_settings.plan = "standard"`.

### 3.5 Statut d'abonnement

Identique au §3.2. Source de vérité = `org_settings.subscription_status`.

### 3.6 stripe_customer_id

| Stockage | Valeur | Mise à jour |
|---|---|---|
| `org_settings.stripe_customer_id` (PostgreSQL) | `"cus_xxx"` ou `null` | Signup fire-and-forget, `/billing/verify`, webhook (P0-1 bug) |
| `store.me.stripeCustomerId` (RAM, volatile) | idem | Signup, webhooks (P0-3) |
| `UserProfile.stripeCustomerId` (MongoDB) | `null` (jamais mis à jour) | Legacy |

**Après suppression manuelle Stripe :** la valeur reste dans `org_settings`. Le prochain appel à `ensureStripeCustomer()` détecte que le customer n'existe plus (API Stripe retourne 404) et en crée un nouveau (logique de récupération déjà correcte).

---

## 4. Cartographie de toutes les bases de données

### PostgreSQL (Supabase)

```
Tables billing-related :
┌─────────────────────────────────────────────────────────────────────┐
│ org_settings (org_id TEXT PRIMARY KEY = email de l'utilisateur)     │
│   plan, subscription_status, stripe_customer_id, trial_ends_at,    │
│   trial_ending_notified_at, addons JSONB, email, first_name, ...   │
│   → SOURCE DE VÉRITÉ pour toutes les décisions billing              │
├─────────────────────────────────────────────────────────────────────┤
│ org_addons (org_id TEXT, addon_key TEXT, active BOOLEAN)            │
│   → Source de vérité pour les add-ons actifs                        │
├─────────────────────────────────────────────────────────────────────┤
│ user_sessions (token TEXT, org_id TEXT, expires_at TIMESTAMPTZ)     │
│   → Source de vérité pour l'authentification                        │
├─────────────────────────────────────────────────────────────────────┤
│ billing_events (org_id TEXT, stripe_event_id TEXT UNIQUE, ...)      │
│   → Historique + idempotence webhook                                │
│   Bug : org_id = "default" toujours (P0-1)                         │
├─────────────────────────────────────────────────────────────────────┤
│ ai_monthly_usage, ai_usage_logs, ai_credit_purchases                │
│   → Crédits IA — isolés par orgId, correctement DB-first           │
├─────────────────────────────────────────────────────────────────────┤
│ magic_link_tokens (token TEXT, email TEXT, expires_at, used)        │
│   → Tokens temporaires de connexion (15 min)                        │
└─────────────────────────────────────────────────────────────────────┘
```

### MongoDB

```
Collections :
┌─────────────────────────────────────────────────────────────────────┐
│ Audit          → Audits SEO (org_id TEXT)                           │
│ Monitor        → Monitors uptime (org_id TEXT)                      │
│ Notification   → Notifications (org_id TEXT)                        │
│ Competitor     → Concurrents (org_id TEXT)                          │
│ UserProfile    → LEGACY — plan/status/stripeCustomerId JAMAIS mis   │
│                  à jour par le code actuel. Désynchronisé dès J+1.  │
└─────────────────────────────────────────────────────────────────────┘
```

**MongoDB ne stocke AUCUNE décision de facturation active.** Le modèle `UserProfile` avec `plan`, `subscriptionStatus`, `stripeCustomerId`, `trialEndsAt` est un artifact legacy qui n'est jamais lu ni mis à jour par les routes billing actuelles.

### RAM — `store.me` (singleton Node.js)

```
Champs billing dans store.me :
  plan, subscriptionStatus, trialEndsAt, stripeCustomerId,
  addons.{customDomain, prioritySupport, extraSeats, ...},
  email, firstName, name

Durée de vie : jusqu'au redémarrage du process
Scope : GLOBAL — partagé entre toutes les organisations
Mise à jour : webhooks Stripe, signup, OAuth login, startTrial()
```

**`store.me` est une copie secondaire non fiable.** Voir audit P0-1 à P0-6.

### JWT / Cookies

```
Cookie fp_token (HttpOnly, Secure en prod) :
  Contenu : token opaque HMAC-SHA256 signé (src/services/sessions.ts)
  Format : base64url(`${userId}:${orgId}:${rand}:${ts}.${sig}`)
  Durée : 24h (SESSION_TTL_MS)
  
Le cookie ne contient AUCUNE donnée billing (plan, status, etc.).
Il est uniquement une clé pour lire user_sessions en DB.
```

**Aucun JWT à proprement parler** — le token est un HMAC signé, non un JWT standard. L'orgId dans le token est redondant avec la DB (la source de vérité est toujours `user_sessions.org_id`).

### Cache

```
Pas de cache applicatif (Redis/Memcached) configuré.
store.me joue le rôle de cache volatile — non invalidé à la déconnexion.
```

---

## 5. Données dupliquées et risques d'incohérence

| Donnée | PostgreSQL | store.me | MongoDB | Cohérence |
|---|---|---|---|---|
| plan | ✅ source | ⚠️ copie volatile | ❌ legacy figé | Incohérent en multi-tenant |
| subscriptionStatus | ✅ source | ⚠️ copie volatile | ❌ legacy figé | Incohérent (webhook bug P0-1) |
| trialEndsAt | ✅ source | ⚠️ copie volatile | ❌ legacy figé | Incohérent après redémarrage |
| stripeCustomerId | ✅ source | ⚠️ copie volatile | ❌ legacy null | Incohérent après create |
| addons | ✅ (org_addons) + JSONB | ⚠️ copie volatile | ❌ absent | Incohérent (P0-3) |
| email (billing) | ✅ org_settings | ⚠️ store.me.email | ❌ UserProfile | Incohérent (P0-5 — mauvais recipient) |
| session auth | ✅ user_sessions | ❌ absent | ❌ absent | Correct |
| crédits IA | ✅ ai_monthly_usage | ❌ absent | ❌ absent | Correct |

---

## 6. Scénarios et comportement réel

### Scénario 1 — Suppression du Customer Stripe

| | Comportement actuel |
|---|---|
| Accès dashboard | **Maintenu** — auth basée sur user_sessions uniquement |
| Plan obtenu | Plan en DB (org_settings.plan) — inchangé |
| Quotas obtenus | Basés sur plan DB — inchangés |
| Emails envoyés | Trial ending si fenêtre active (DB-based, indépendant Stripe) |
| Webhooks déclenchés | **Aucun** — customer.deleted non géré |
| Base utilisée | user_sessions (auth) + org_settings (plan/quotas) |

### Scénario 2 — Suppression d'une Subscription Stripe

| | Comportement actuel |
|---|---|
| Accès dashboard | **Maintenu** |
| Plan obtenu | Plan en DB inchangé (P0-4 : customer.subscription.deleted ne reset pas plan) |
| Quotas | Inchangés |
| Emails | store.me.email utilisé (peut être mauvais destinataire — P0-5) |
| Webhooks | `customer.subscription.deleted` : désactive org_addons ✓, mais plan reste ✗ |
| Base utilisée | org_settings pour addons (correct), store.me pour plan (bug) |

### Scénario 3 — Suppression Customer + Subscription

Combinaison des scénarios 1 et 2. Plan reste inchangé en DB. Accès maintenu.

### Scénario 4 — Utilisateur sans Customer Stripe

| | Comportement actuel |
|---|---|
| Accès dashboard | **Maintenu** |
| Plan obtenu | `org_settings.plan` (défaut "standard" si jamais mis à jour) |
| `ensureStripeCustomer()` | Crée un nouveau customer à la prochaine action billing |
| Quotas | Standard |
| Emails | Trial starting si la logique l'a déclenché au signup |

### Scénario 5 — Customer présent, Subscription absente

| | Comportement actuel |
|---|---|
| Accès dashboard | **Maintenu** |
| Plan | DB : "trialing" ou "standard" selon l'historique |
| `/billing/upgrade` | ensureStripeCustomer retourne le customer existant ✓ |
| `/billing/verify` | Échoue si pas de session_id valide |

### Scénario 6 — Trial expiré (date passée, status toujours "trialing")

| | Comportement actuel |
|---|---|
| Accès dashboard | **Maintenu** — aucun paywall, aucune vérification de trial_ends_at |
| Plan | "standard" ou le plan sélectionné à l'inscription (DB) |
| Quotas | Ceux du plan en DB — pas de downgrade automatique à l'expiration |
| Emails | Plus envoyés (trial_ending_notified_at déjà positionné) |
| **Comportement attendu** | Devrait restreindre l'accès aux features payantes — non implémenté |

### Scénario 7 — Trial actif (dans les 14 jours)

| | Comportement actuel |
|---|---|
| Accès dashboard | **Maintenu** |
| Plan | Plan sélectionné à l'inscription (DB) |
| Quotas | Ceux du plan (basé sur store.me via checkQuota — P0-6) |
| Emails | `sendTrialStarted` à J0, `sendTrialEnding` à J10-J12 (DB-based, correct) |
| Webhooks | Aucun (trial FlowPoint ≠ trial Stripe sauf si `startTrial()` appelé) |

---

## 7. Points de divergence Stripe ↔ MongoDB ↔ FlowPoint

| Situation | Stripe | MongoDB | PostgreSQL (réel) |
|---|---|---|---|
| Après inscription | `cus_xxx` créé (fire-and-forget) | `plan="standard"` figé | `plan=selectedPlan`, `status="trialing"`, `stripeCustomerId=cus_xxx` |
| Après suppression customer | Customer absent | Inchangé | `stripeCustomerId` pointe vers customer supprimé |
| Après annulation sub | Sub absente | Inchangé | `plan` inchangé (P0-4), `addons` désactivés |
| Après paiement réussi | Invoice `paid` | Inchangé | `status="active"` sur org "default" (P0-1) |
| Après payment_failed | Invoice `open` | Inchangé | `status="past_due"` sur org "default" (P0-1) |

---

## 8. Cause racine du bug observé (résumé)

1. **Auth découplée de Stripe** : `requireAuth` vérifie uniquement le cookie de session. Il n'y a pas de middleware qui bloque l'accès en cas d'abonnement expiré ou de customer Stripe absent.

2. **Trial stocké en DB, indépendant de Stripe** : `org_settings.trial_ends_at` et `subscription_status="trialing"` sont écrits au signup. La suppression manuelle du customer Stripe ne déclenche aucun webhook qui remette ces champs à zéro.

3. **Cron trial-ending lit la DB directement** : `monitor-cron.ts` scanne `org_settings` en DB sans consulter Stripe. Le résultat est correct (email envoyé à `org_settings.email`, pas à `store.me.email`) mais correspond à un état Stripe stale.

4. **Pas de reconciliation Stripe ↔ DB** : il n'existe aucun mécanisme qui re-synchronise périodiquement l'état Stripe avec `org_settings`. Une suppression manuelle dans le dashboard Stripe est invisible pour FlowPoint.

---

## 9. Bug UUID — `fragilearea172@mail.bu.app`

**Explication :** L'orgId de cet utilisateur est son email : `"fragilearea172@mail.bu.app"`. C'est la convention générale (auth.ts L.544 : `const orgId = normalizedEmail`).

Les tables PostgreSQL avec `org_id TEXT` acceptent l'email comme valeur. Mais certaines tables ont `org_id UUID` (identifiées dans l'audit RLS : `gsc_keyword_data`, `gsc_page_data`, `ga4_accounts`, etc.). Quand une requête SQL `WHERE org_id = $1` passe l'email sur une colonne UUID, PostgreSQL lève : `ERROR: invalid input syntax for type uuid`.

Ce n'est pas un problème de transmission de l'email comme orgId — c'est une incohérence de type entre les tables. La correction (validée pour les P0) : ajouter une validation `isValidOrgId` avant toute requête sur colonne UUID.
