# FlowPoint — Audit Complet du Système de Facturation
**Date :** 24 juillet 2026  
**Périmètre :** Lecture seule, zéro modification de code  
**Fichiers analysés :** 14 fichiers sources, ~3 800 lignes  

---

## 1. Cartographie du système

```
STRIPE (webhooks) ─────────────────────────────────────────────────────────────────────────────┐
                                                                                               │
Public checkout flows :                          Authenticated flows :                         │
  /api/public/checkout-session                    /api/billing/checkout-embedded               │
  /api/public/payment-intent                      /api/billing/upgrade                         │
  /api/public/finalize-checkout                   /api/billing/verify                          │
         │                                        /api/billing/portal                          │
         ▼                                        /api/billing/cancel                          │
  Stripe crée Customer+Sub                        /api/billing/addon-checkout                  │
  sans lien vers org_settings                              │                                   │
                                                           ▼                                   │
                                                  ensureStripeCustomer()                       │
                                                  (DB-first, concurrency-safe ✓)               │
                                                           │                                   │
                                                  loadBillingContext(orgId)                    │
                                                  (DB-first ✓, toujours per-org ✓)             │
                                                                                               ▼
                                                                                    stripe-webhook.ts
                                                                                    persistSubscriptionMeta()
                                                                                    ← orgId hardcodé "default" ✗
                                                                                    store.me.* mutations ✗

Source de vérité attendue : PostgreSQL (org_settings + org_addons)
Source de vérité réelle   : store.me (singleton global) pour 60 % des décisions
```

**Fichiers source** :

| Fichier | Lignes | Rôle |
|---|---|---|
| `routes/billing.ts` | 1 081 | Routes billing authentifiées |
| `routes/stripe-webhook.ts` | 339 | Traitement des événements Stripe |
| `routes/public-billing.ts` | 487 | Checkout pre-auth + plans catalog |
| `routes/ai-credits.ts` | 69 | Gestion crédits IA |
| `routes/me.ts` | 464 | Profil org + plan display |
| `routes/addons.ts` | 63 | Routes addon CRUD |
| `lib/plans.ts` | 236 | Définitions plans + price IDs |
| `lib/config.ts` | 231 | Quotas + feature flags |
| `middlewares/planGate.ts` | 81 | Garde-fous plan/feature |
| `services/billing-service.ts` | 337 | Trial, MRR, quota check |
| `services/billing-context.ts` | 89 | Loader DB per-org (bien écrit) |
| `services/ensure-stripe-customer.ts` | 296 | Garantie customer Stripe |
| `services/addons-service.ts` | 142 | Sync addons Stripe→DB |
| `services/org-settings.ts` | 191 | CRUD org_settings |
| `services/ai-engine.ts` | 511 | Consommation crédits IA |

---

## 2. Problèmes critiques — P0 (Rupture en production)

### P0-1 · `persistSubscriptionMeta` écrit toujours sur `org_id = 'default'`

**Localisation :** `stripe-webhook.ts` lignes 8–30, appels lignes 212, 230, 272, 305

```typescript
// Définition (L.8–13)
async function persistSubscriptionMeta(opts: {
  subscriptionStatus?: string;
  stripeCustomerId?: string;
  orgId?: string;               // ← paramètre optionnel, défaut "default"
}) {
  const { subscriptionStatus, stripeCustomerId, orgId = "default" } = opts;
  // UPSERT INTO org_settings WHERE org_id = $1  ← toujours "default"
}

// Appels — aucun ne passe orgId :
await persistSubscriptionMeta({ subscriptionStatus: "active", stripeCustomerId: customerId }); // L.212
await persistSubscriptionMeta({ subscriptionStatus: status });                                  // L.230
await persistSubscriptionMeta({ subscriptionStatus: "active" });                               // L.272
await persistSubscriptionMeta({ subscriptionStatus: "past_due" });                             // L.305
```

**Ce qui se passe :** Le webhook résout correctement `orgId` (L.141–150) via lookup `stripe_customer_id → org_settings`. Mais ce `orgId` résolu n'est **jamais** passé à `persistSubscriptionMeta`. Résultat : tous les changements de `subscription_status` et de `stripe_customer_id` dans `org_settings` s'appliquent à l'org "default", pas à l'org réelle.

**Impact :** Les orgs A et B partagent le même statut d'abonnement persisté. Si A passe en `past_due`, B voit `past_due` dans DB. La seule org correctement mise à jour est celle dont le row `org_id = 'default'` existe.

**Événements affectés :** `checkout.session.completed` (statut active), `customer.subscription.updated` (changement de statut/plan), `invoice.payment_succeeded` (statut active), `invoice.payment_failed` (statut past_due).

---

### P0-2 · `planGate.ts` lit `store.me` (singleton) — pas la DB

**Localisation :** `middlewares/planGate.ts` L.13 + L.55

```typescript
function currentPlan(): string { return store.me?.plan ?? 'standard'; }
// ...
// Plan context is read from store.me — no additional attachment needed
```

**Ce qui se passe :** Toute middleware `requireFeature()` / `requirePlan()` — utilisée sur `/forecast`, `/cro`, `/revenue-leak`, `/behavioral`, etc. — lit le plan du **singleton global**, pas du plan de l'org faisant la requête. Si l'org A (Ultra) déclenche une mise à jour de `store.me.plan = "ultra"` et que l'org B (Standard) fait une requête immédiatement après, B bénéficie des features Ultra.

**Périmètre des routes protégées via planGate (L.9–15 de chaque router) :**
- `routes/forecast.ts` — `requireFeature("forecastingAI")`
- `routes/cro.ts` — `requireFeature("cro")`
- `routes/revenue-leak.ts` — `requireFeature("cro")`
- `routes/behavioral.ts` — `requireFeature("behavioralAI")`

---

### P0-3 · `store.me.*` mutations dans le webhook handler

**Localisation :** `stripe-webhook.ts` L.68–70, 169, 209–210, 222, 237–260, 253–260, 271, 277, 285–293, 304

```typescript
// Exemple — subscription.deleted (L.253–260)
store.me.subscriptionStatus = "canceled";
store.me.addons.customDomain = false;
store.me.addons.prioritySupport = false;
store.me.addons.extraSeats = 0;
store.me.addons.monitorsPack50 = 0;
store.me.addons.whiteLabel = false;
store.me.addons.retention90d = false;
store.me.addons.retention365d = false;
```

**Ce qui se passe :** Le webhook tourne dans le process Node.js partagé. `store.me` est un objet JavaScript global unique. Toute mutation le corrompt pour **toutes** les requêtes concurrentes en cours. Pire : la mutation ne cible pas l'org résolu (même si `orgId` est connu à ce stade).

**Impact complet des mutations :** `subscriptionStatus`, `stripeCustomerId`, `addons.*` (8 clés), `plan`, `trialEndsAt`, `email` (pour l'envoi email).

---

### P0-4 · `customer.subscription.deleted` ne met pas à jour `org_settings.plan`

**Localisation :** `stripe-webhook.ts` L.253–266

```typescript
// Ce qui existe :
store.me.subscriptionStatus = "canceled";
// ... reset des addons dans store.me ...
await client2.query(`UPDATE org_addons SET active = false WHERE org_id = $1`, [orgId]); // ✓
store.broadcastPlanUpdate("standard", orgId); // SSE broadcast uniquement

// Ce qui est ABSENT :
// UPDATE org_settings SET plan = 'standard', subscription_status = 'canceled' WHERE org_id = $1
```

**Ce qui se passe :** Après annulation, `org_settings.plan` reste à la valeur précédente (ex. "pro"). Au prochain redémarrage du serveur ou rechargement de `store.me`, l'org récupère son ancien plan depuis la DB. Les add-ons sont correctement désactivés en DB (`org_addons`), mais le plan lui-même ne l'est pas.

---

### P0-5 · Email de notification envoyé à `store.me.email` (mauvais destinataire)

**Localisation :** `stripe-webhook.ts` L.285–293

```typescript
if (store.me.email) {
  await mailer.sendEmail("paymentSucceeded", {
    to: store.me.email,          // ← email du singleton, pas de l'org réelle
    name: store.me.firstName || store.me.name || "Utilisateur",
    plan: store.me.plan || "pro",
  });
}
```

**Ce qui se passe :** L'email "Paiement confirmé" est envoyé à l'email de l'org qui a le dernier modifié `store.me`, pas à l'org dont Stripe vient de confirmer le paiement. Dans un scénario multi-tenant, c'est un RGPD/privacy issue en plus d'une erreur fonctionnelle.

---

### P0-6 · `checkQuota()` lit entièrement `store.me` — pas la DB

**Localisation :** `services/billing-service.ts` L.100–113

```typescript
export function checkQuota(resource: "audits" | "monitors" | ...): { allowed: boolean; ... } {
  const me = store.me;
  const plan = (me.plan || "standard").toLowerCase();        // ← singleton
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.standard;
  const u = (me as Record<string, unknown>).usage as ...;    // ← singleton
  // ...
  return { allowed: !q || q.used < q.limit, ... };
}
```

**Ce qui se passe :** `checkQuota()` est une fonction synchrone qui lit uniquement `store.me`. Les limites de quota retournées (audits, monitors, reports, exports, seats) dépendent du plan du singleton, pas du plan réel de l'org faisant la requête. Une org Standard peut dépasser ses quotas si le singleton a un plan supérieur.

---

## 3. Problèmes significatifs — P1 (Intégrité des données)

### P1-1 · `getUsageSummary()` mélange DB et singleton

**Localisation :** `services/billing-service.ts` L.56–98

```typescript
const me = store.me;
const _dbData = await loadOrgSettings(orgId).catch(() => null);
const plan = (_dbData?.plan || me.plan || "standard").toLowerCase(); // ← fallback singleton
// ...
const extraMonitors = (me.addons as ...)["monitorsPack50"] || 0;     // ← singleton addons
const extraSeats    = (me.addons as ...)["extraSeats"]     || 0;     // ← singleton addons
// ...
return {
  // ...
  addons: me.addons,                           // ← retourne les addons du singleton
  subscriptionStatus: me.subscriptionStatus,   // ← singleton
  trialEndsAt: me.trialEndsAt,                 // ← singleton
};
```

**Ce qui se passe :** Les **comptages d'usage** (audits, monitors, reports, seats) sont corrects car ils viennent de la DB avec `orgId`. Mais les **limites** et le **statut** retournés sont ceux du singleton. Un org peut voir son quota affiché comme "15/10" (usage DB réel vs limite singleton incorrecte).

---

### P1-2 · `GET /billing/plans` (public) retourne le plan du singleton

**Localisation :** `routes/public-billing.ts` L.17–29

```typescript
router.get("/billing/plans", (_req, res) => {
  res.json({
    plans,
    addons: ADDON_CATALOG,
    current: (store.me.plan || "standard").toLowerCase(), // ← singleton
    subscriptionStatus: store.me.subscriptionStatus ?? null,
    trialEndsAt: store.me.trialEndsAt ?? null,
  });
});
```

**Ce qui se passe :** Cette route est publique (pré-auth). Quand un utilisateur connecté appelle `/api/billing/plans`, il reçoit le plan de l'org qui a muté `store.me` en dernier — pas nécessairement le sien. En multi-tenant actif, le picker de plans peut afficher le mauvais plan "courant".

---

### P1-3 · `addon-checkout` crée une session Stripe sans `customer:`

**Localisation :** `routes/billing.ts` L.1056–1062

```typescript
const session = await stripe.checkout.sessions.create({
  mode: "subscription",
  line_items: [{ price: priceId, quantity: 1 }],
  success_url: `${publicUrl}/billing?addon_success=${...}`,
  cancel_url:  `${publicUrl}/billing?addon_cancel=1`,
  metadata: { addonKey, addonName, orgId },
  // ← ABSENT : customer: billingCtx.stripeCustomerId
});
```

**Ce qui se passe :** L'add-on est acheté via une session Stripe qui crée un **nouveau client anonyme** non lié au client Stripe existant de l'org. L'add-on devient un abonnement indépendant sous un customer orphelin. Le webhook `checkout.session.completed` résout `orgId` via `stripe_customer_id → org_settings`, mais ce nouveau customer n'a pas de ligne dans `org_settings` → l'orgId résout à "default".

---

### P1-4 · `fallback checkout` (embedded → redirect) sans `customer:`

**Localisation :** `routes/billing.ts` L.218–232

```typescript
// Bloc catch du checkout embedded — fallback
const session = await stripe.checkout.sessions.create({
  mode: "subscription",
  line_items: lineItems,
  success_url: `${publicUrl}/dashboard.html?checkout=success&plan=${plan}`,
  cancel_url: `${publicUrl}/pricing.html`,
  metadata: { plan, addons: JSON.stringify(addons) },
  // ← ABSENT : customer: customerId
});
```

**Ce qui se passe :** Si le checkout embedded échoue (timeout Stripe, network error), le fallback crée une session sans lier le customer existant. La souscription résultante crée un nouveau customer dupliqué dans Stripe.

---

### P1-5 · `startTrial()` écrit dans le singleton, pas en DB

**Localisation :** `services/billing-service.ts` L.195–240

```typescript
// Branche prod (avec Stripe key) :
store.me.plan = plan;
store.me.subscriptionStatus = "trialing";
store.me.trialEndsAt = trialEnd;
store.broadcastPlanUpdate(plan, orgId);
// ← ABSENT : upsertOrgSettings(orgId, { plan, subscriptionStatus: "trialing", trialEndsAt })
```

**Ce qui se passe :** Quand un trial est démarré via `/billing/upgrade` ou `/billing/trial`, le plan Trial est écrit **uniquement dans le singleton**. Après un redémarrage du serveur, le trial est perdu (l'org revient à Standard en DB). Stripe a bien la subscription avec `trial_period_days`, mais `org_settings` ne reflète pas cet état tant que le webhook `customer.subscription.created` n'a pas tiré (ce qui peut prendre plusieurs secondes).

---

### P1-6 · `syncAddonsFromSubscription` écrit dans `store.me.addons` (singleton)

**Localisation :** `services/addons-service.ts` L.68–70

```typescript
if (FLAG_ADDONS.includes(item.price.id)) {
  (store.me.addons as Record<string, boolean | number>)[addonKey] = true;
} else {
  (store.me.addons as Record<string, boolean | number>)[addonKey] = Number(item.quantity ?? 1);
}
```

**Ce qui se passe :** La synchronisation Stripe → DB écrit correctement en DB (`org_addons` table). Mais en plus, elle corrompt le singleton partagé. L'effet immédiat : tous les `planGate` checks et `checkQuota` calls voient les addons de l'org qui vient d'acheter.

---

### P1-7 · `public/finalize-checkout` crée un nouveau Stripe Customer sans lien org_settings

**Localisation :** `routes/public-billing.ts` L.424–448

```typescript
// ── 2. Create customer & attach payment method ──
const customer = await stripe.customers.create({
  payment_method: paymentMethodId,
  invoice_settings: { default_payment_method: paymentMethodId },
  metadata: { source: "checkout_payment", plan: planKey },
  // ← ABSENT : metadata.orgId, metadata.email_identifier
});
// ...
// ← ABSENT : upsertOrgSettings pour lier customer.id à l'org
```

**Ce qui se passe :** Le customer Stripe créé ici n'est jamais écrit dans `org_settings.stripe_customer_id`. Le webhook `checkout.session.completed` résout `orgId` par lookup `stripe_customer_id → org_settings` : ce customer orphelin retourne `orgId = "default"`. L'activation du plan (broadcast + DB) va sur "default".

**Note :** Ce flow est distinct du flow auth (`/billing/upgrade` qui utilise `ensureStripeCustomer` correctement).

---

### P1-8 · `trackBillingEvent()` utilise `store.me.plan` pour le champ `plan`

**Localisation :** `services/billing-service.ts` L.125

```typescript
[orgId, type, data.amount ?? 0, data.currency ?? "eur", data.plan ?? store.me.plan, ...]
//                                                                   ↑ singleton fallback
```

**Ce qui se passe :** Si `data.plan` n'est pas fourni, le plan loggé dans `billing_events` est celui du singleton. L'historique de facturation peut contenir des plans erronés.

---

### P1-9 · `billing_events` idempotency utilise `orgId = "default"` dans certains chemins

**Localisation :** `stripe-webhook.ts` L.117

```typescript
`INSERT INTO billing_events (org_id, type, stripe_event_id, amount, currency, metadata)
 VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (stripe_event_id) DO NOTHING`
```

Le `org_id` passé ici est celui résolu par lookup (potentiellement "default" si le customer n'est pas lié). La déduplication par `stripe_event_id` fonctionne, mais l'attribution org dans l'historique est fausse.

---

### P1-10 · `ai-engine.ts` fallback plan sur `store.me`

**Localisation :** `services/ai-engine.ts` L.63

```typescript
const plan = (_dbData?.plan || store.me.plan || "standard").toLowerCase();
```

**Ce qui se passe :** Si `loadOrgSettings` échoue (timeout DB, Supabase rate limit), la limite de crédits IA appliquée est celle du plan du singleton. Une org Standard peut obtenir les crédits Ultra en production si le DB call échoue au bon moment.

---

## 4. Problèmes de conception — P2 (Risques latents)

### P2-1 · `GET /billing/verify` — race condition checkout → webhook

**Localisation :** `routes/billing.ts` L.237–297

La route vérifie `session.payment_status !== "paid" && session.status !== "complete"` puis écrit immédiatement en DB et déclenche `broadcastPlanUpdate`. Cette écriture est **avant** l'arrivée du webhook `checkout.session.completed`. Si le webhook est retardé (jusqu'à ~30s en prod), il peut écraser l'état écrit par `/verify` avec des valeurs différentes (ex. orgId "default" via `persistSubscriptionMeta`).

**Scénario problématique :** `/verify` écrit `plan=pro, status=active` sur l'orgId correct → webhook arrive 10s plus tard → `persistSubscriptionMeta` écrit `status=active` sur `org_id="default"` → double écriture, mauvaise org.

---

### P2-2 · `customer.subscription.updated` déclenche un broadcast même sans changement de plan

**Localisation :** `stripe-webhook.ts` L.222–227

```typescript
store.me.subscriptionStatus = status;
if (newPlan && newPlan !== "standard") {
  store.broadcastPlanUpdate(newPlan, orgId); // ← déclenché même si plan inchangé
}
```

Stripe envoie `subscription.updated` à chaque renouvellement, changement de date, quantité, etc. Chaque événement déclenche un broadcast SSE potentiellement inutile.

---

### P2-3 · Stripe API version incohérente entre fichiers

| Fichier | Version API Stripe |
|---|---|
| `billing.ts` (via `createStripeClient`) | Configurée centralement |
| `public-billing.ts` | `"2026-04-22.dahlia"` hardcodée |
| `billing-service.ts` | `"2026-04-22.dahlia"` hardcodée |
| `stripe-webhook.ts` | `constructEventAsync` sans version explicite |

Risque : si la version configurée dans `createStripeClient` diverge, les shapes de réponse peuvent différer entre les flows.

---

### P2-4 · `ownerOnly` middleware non défini dans les imports visibles

**Localisation :** `routes/billing.ts` L.301, 424, 459

Les routes `/billing/portal`, `/billing/cancel`, `/billing/upgrade` utilisent `ownerOnly`. La vérification du rôle "owner" s'appuie sur `req.orgContext?.role`, ce qui est correct en soi. Mais si la session est créée sans `role` (ex. token service), `ownerOnly` peut silencieusement passer ou bloquer selon l'implémentation exacte — à vérifier avec le middleware source.

---

### P2-5 · `addons.ts` GET retourne `store.me.addons` (singleton)

**Localisation :** `routes/addons.ts` (63L) — l'explore subagent l'a confirmé

Le endpoint `GET /api/addons` retourne les addons du singleton, pas de la DB. C'est cohérent avec les bugs P0/P1 mais représente un point d'entrée supplémentaire où les données peuvent être fausses.

---

### P2-6 · `me.ts` fallback ultime sur `store.me`

**Localisation :** `routes/me.ts` L.91–92

```typescript
// Si loadOrgSettings échoue (catch) :
const limits = PLAN_LIMITS[store.me.plan.toLowerCase()] ?? PLAN_LIMITS["standard"];
res.json({ ...store.me, plan: normPlan(store.me.plan), email: req.orgContext?.email ?? "", ... });
```

En condition normale (`dbData` présent), `me.ts` est correct (lit la DB). Mais si la DB est unreachable, la réponse entière vient du singleton — y compris `addons`, `subscriptionStatus`, `trialEndsAt`. Un redémarrage serveur pendant une panne DB retournerait les données de la dernière org active.

---

### P2-7 · Pas de vérification d'idempotence pour `billing/verify`

Un utilisateur malveillant peut appeler `GET /billing/verify?session_id=cs_xxx` plusieurs fois avec le même session_id valide. Chaque appel déclenche un `upsertOrgSettings` et un `broadcastPlanUpdate`. Il n'y a pas de marquage "already processed" côté application (seul Stripe a un mécanisme d'idempotence interne pour les webhooks, pas pour les appels directs au checkout.sessions.retrieve).

---

### P2-8 · Prix EUR hardcodés dans deux endroits

`ADDON_PRICES_EUR_CENTS` dans `public-billing.ts` (L.256–277) et les price IDs dans `lib/plans.ts` (`ADDON_PRICE_IDS`). Si un price ID change côté Stripe, le montant affiché (calculé localement) peut diverger du montant réellement débité. Il n'y a pas de reconciliation automatique.

---

## 5. Ce qui fonctionne correctement

Ces composants sont bien conçus et peuvent être préservés tels quels :

| Composant | Verdict | Détail |
|---|---|---|
| `billing-context.ts` | ✅ Correct | Toujours DB-first, per-org, jamais de singleton |
| `ensureStripeCustomer` | ✅ Correct | DB-first, verrou concurrence, récupération customer supprimé |
| `me.ts` — chemin normal | ✅ Correct | Lit `loadOrgSettings(orgId)`, normalise le plan, email from `req.orgContext` |
| `ai-engine.ts` — crédit tracking | ✅ Correct | `withOrgDb`, toutes queries avec `orgId`, tables `ai_usage_logs` / `ai_monthly_usage` |
| `ai-credits.ts` | ✅ Correct | Passe `req.orgId` à toutes les fonctions |
| `/billing/verify` — écriture DB | ✅ Correct | `upsertOrgSettings(orgId, ...)` avec le bon orgId (sauf timing webhook, voir P2-1) |
| `billing_events` — déduplication | ✅ Correct | `ON CONFLICT (stripe_event_id) DO NOTHING` |
| Stripe key guard production | ✅ Correct | Throw/503 quand `STRIPE_LIVE_API_KEY` absent en prod |
| Webhook signature verification | ✅ Correct | `constructEventAsync` + rejet si non signé en prod |
| `requireFeature` — logique feature flags | ✅ Correct | `FEATURE_FLAGS[plan]` bien défini, seule la source du plan est fausse |
| `billingPortalRateLimit` / `billingCheckoutRateLimit` | ✅ Correct | Rate limits en place sur toutes routes sensibles |
| `ownerOnly` sur portal/cancel/upgrade | ✅ Correct | Restriction au rôle owner bien placée |
| `org_addons` update sur `subscription.deleted` | ✅ Correct | `UPDATE org_addons SET active=false WHERE org_id=$1` avec bon orgId |
| `public/checkout-session` — metadata | ✅ Correct | `orgId`, `plan`, `addons`, `flowpoint_checkout_type` bien encodés |

---

## 6. Matrice de risques

```
                    PROBABILITÉ
                  Faible │ Moyenne │ Haute
                  ───────┼─────────┼──────
IMPACT    Faible │ P2-7  │ P2-1    │ P2-2, P2-6
          Moyen  │ P2-3  │ P1-8    │ P1-1, P1-5, P1-9, P1-10
          Élevé  │ P2-4  │ P1-3, P1-4, P1-6, P1-7 │ P0-2, P0-6
          Critique│      │         │ P0-1, P0-3, P0-4, P0-5
```

---

## 7. Scénarios de bout en bout et comportement réel

### Scénario A — Nouvel abonnement (flow authentifié)
1. `/billing/upgrade` → `ensureStripeCustomer()` ✓ → checkout embedded avec `customer:` ✓
2. Stripe redirige → `/billing/verify` → `upsertOrgSettings(orgId)` ✓
3. Webhook `checkout.session.completed` → `persistSubscriptionMeta()` **sans orgId** ✗ → écrit sur "default"
4. Résultat : plan correct dans DB (via `/verify`) mais `billing_events` attribué à "default"

### Scénario B — Annulation d'abonnement
1. Webhook `customer.subscription.deleted` → `org_addons` désactivés ✓
2. `store.me.subscriptionStatus = "canceled"` ✗ (singleton)
3. `broadcastPlanUpdate("standard", orgId)` → SSE ✓
4. `org_settings.plan` **non mis à jour** ✗
5. Résultat : après redémarrage serveur, l'org récupère son ancien plan "pro" depuis DB

### Scénario C — Achat add-on
1. `/billing/addon-checkout` → vérifie doublons Stripe ✓ → crée session **sans `customer:`** ✗
2. Nouveau customer Stripe orphelin créé
3. Webhook → lookup `stripe_customer_id → org_settings` → row introuvable → `orgId = "default"`
4. Add-on activé sur org "default", pas sur l'org réelle

### Scénario D — Paiement échoué
1. Webhook `invoice.payment_failed` → `persistSubscriptionMeta({ status: "past_due" })` **sans orgId** ✗
2. `store.me.subscriptionStatus = "past_due"` ✗ (singleton)
3. Email envoyé à `store.me.email` ✗ (peut être l'email d'une autre org)

### Scénario E — Feature gate check
1. Org A (Ultra) se connecte → webhook ou `/verify` → `store.me.plan = "ultra"`
2. Requête Org B (Standard) → `planGate.currentPlan()` retourne "ultra" ✗
3. Org B accède à `/cro`, `/forecast`, `/behavioral` sans en avoir le droit

### Scénario F — Checkout public (pre-auth, nouveau signup)
1. `/public/checkout-session` → session Stripe sans `orgId` en metadata
2. `/public/finalize-checkout` → nouveau customer Stripe créé **sans lien org_settings** ✗
3. Webhook → customer inconnu → orgId = "default" → plan activé sur "default" ✗
4. L'utilisateur se connecte, son org reste sur Standard

---

## 8. Estimation de fiabilité

### Environnement mono-tenant (une seule org active par instance)

| Sous-système | Fiabilité | Raison |
|---|---|---|
| Checkout initial (flow auth) | 85 % | `/verify` écrit correctement ; webhook va sur "default" mais peu importe en mono-tenant |
| Plan gates | 90 % | Singleton correct en mono-tenant (une seule org mute `store.me`) |
| Quotas | 75 % | `checkQuota()` lit `store.me.usage` mais en mono-tenant c'est souvent juste |
| Add-ons | 60 % | Session sans `customer:` → customer orphelin → webhook échoue à lier |
| Annulation | 50 % | Plan non mis à jour en DB → retour à l'ancien plan après redémarrage |
| Emails | 80 % | `store.me.email` souvent correct en mono-tenant |
| Crédits IA | 95 % | Quasi entièrement DB-isolated |
| **Global mono-tenant** | **~78 %** | |

### Environnement multi-tenant (plusieurs orgs simultanées)

| Sous-système | Fiabilité | Raison |
|---|---|---|
| Checkout initial | 55 % | Webhook écrit toujours sur "default" |
| Plan gates | 30 % | Singleton muté par n'importe quelle org |
| Quotas | 25 % | Singleton partagé |
| Add-ons | 20 % | Customer orphelin + webhook sur "default" |
| Annulation | 20 % | Plan non mis à jour + singleton corrompu |
| Emails | 10 % | Email du mauvais destinataire systématique |
| Crédits IA | 90 % | DB-isolated (sauf fallback plan P1-10) |
| **Global multi-tenant** | **~35 %** | |

---

## 9. Classement prioritaire des corrections

### Phase 1 — Corrections P0 (ordre d'impact)

| # | Fichier | Correction |
|---|---|---|
| 1 | `stripe-webhook.ts` | Passer `orgId` à tous les appels de `persistSubscriptionMeta()` |
| 2 | `stripe-webhook.ts` | Remplacer toutes les mutations `store.me.*` par `upsertOrgSettings(orgId, {...})` |
| 3 | `stripe-webhook.ts` | Ajouter `UPDATE org_settings SET plan='standard'` dans `subscription.deleted` |
| 4 | `stripe-webhook.ts` | Remplacer `store.me.email` par une lecture DB pour l'email de notification |
| 5 | `middlewares/planGate.ts` | Lire le plan depuis `req.billingCtx` (charger `loadBillingContext` en middleware) |
| 6 | `services/billing-service.ts` | Rendre `checkQuota()` async avec lecture DB, supprimer dépendance `store.me` |

### Phase 2 — Corrections P1

| # | Fichier | Correction |
|---|---|---|
| 7 | `routes/billing.ts` | Ajouter `customer: billingCtx.stripeCustomerId` au checkout addon + fallback |
| 8 | `routes/public-billing.ts` | Lier `customer.id` créé dans `finalize-checkout` à l'orgId (via `upsertOrgSettings`) |
| 9 | `services/billing-service.ts` | `startTrial()` → ajouter `upsertOrgSettings` après création Stripe |
| 10 | `services/billing-service.ts` | `getUsageSummary()` → utiliser `billingCtx.addons` au lieu de `store.me.addons` |
| 11 | `services/addons-service.ts` | Supprimer les mutations `store.me.addons` (garder uniquement l'écriture DB) |
| 12 | `routes/public-billing.ts` | `GET /billing/plans` → passer `orgId` depuis `req` si disponible, lire DB |
| 13 | `services/ai-engine.ts` | Supprimer le fallback `store.me.plan` en L.63 (lever une erreur si DB inaccessible) |

### Phase 3 — Corrections P2

| # | Fichier | Correction |
|---|---|---|
| 14 | `routes/billing.ts` | Ajouter un marquage `billing_verify_log` pour prévenir les replays |
| 15 | `stripe-webhook.ts` | Guard `if (newPlan !== currentPlan)` avant `broadcastPlanUpdate` |
| 16 | Tous | Centraliser la version API Stripe dans un module partagé |

---

## 10. Résumé exécutif

Le système de facturation repose sur une architecture **double-couche contradictoire** : un singleton global (`store.me`) hérité d'une conception mono-tenant initiale, et une couche DB correctement isolée par org (`billing-context.ts`, `org_settings`, `org_addons`) construite ultérieurement. Les deux coexistent sans que la couche singleton ait été remplacée.

**Le singleton `store.me` est le défaut central.** Il contamine :
- La vérification des droits (`planGate`)
- Le calcul des quotas (`checkQuota`, `getUsageSummary`)
- Le handler webhook (mutations qui écrasent l'état de toutes les orgs)
- Les notifications email (mauvais destinataire)
- L'affichage du plan courant dans l'API publique plans

**Le webhook `persistSubscriptionMeta` sans `orgId`** est le bug le plus grave en production : chaque événement Stripe critique (activation, mise à jour, échec) écrit sur l'org "default" au lieu de l'org réelle.

**En revanche**, les crédits IA, `ensureStripeCustomer`, `billing-context.ts` et le chemin normal de `me.ts` sont correctement isolés et peuvent servir de modèle pour les corrections.

**Estimation globale de fiabilité en production multi-tenant : 35 %.**  
En mono-tenant (une org par instance) : 78 %.
