# FlowPoint — Audit exhaustif des données fictives
**Date :** 28 juin 2026 | Périmètre : `artifacts/api-server/src/` (routes + services, 80+ fichiers)

---

## Méthodologie

Patterns recherchés : `Math.random()`, `isDemoMode`, `PREVIEW_MODE`, `mockData`, `seedData`, `SEED_`, `fakeData`, `demoData`, `placeholder`, `hardcoded KPIs`, `TODO` returning defaults, `buildComputed*`, `return { score:`, impact percentages, static arrays returned as analytics.

---

## LÉGENDE

| Symbole | Signification |
|---------|---------------|
| ✅ Réel | Données provenant uniquement de la DB ou d'API externes |
| 🟡 Fallback acceptable | null, [], 0, ou état "non connecté" — UI affiche "—" |
| 🟠 Démo volontaire | Activé uniquement en mode démo/dev — jamais en production |
| 🔴 À supprimer avant prod | Données inventées potentiellement visibles par un client payant |

---

## 1. Math.random() — ✅ TOUS LÉGITIMES (génération d'IDs)

Toutes les occurrences de `Math.random()` dans le code sont de la forme :
```ts
const id = `prefix_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
```

**Fichiers concernés (23 occurrences) :**  
`routes/audit.ts`, `routes/ai.ts`, `routes/monitors.ts`, `routes/calendar-events.ts`, `routes/missions.ts`, `routes/alert-rules.ts`, `routes/crm.ts`, `routes/integrations.ts`, `routes/behavioral.ts`, `routes/white-label.ts`, `routes/automation.ts`, `routes/admin.ts`, `services/ai-engine.ts`, `services/behavioral-service.ts`, `services/crm-service.ts`, `services/local-maps-service.ts`, `services/sso-service.ts`, `services/permissions-service.ts`, `services/automation-service.ts`, `services/store.ts`, `services/gbp-posting-service.ts`

**Exception — 1 usage de données fictives :**
- `services/gbp-posting-service.ts:113` — `Math.random()` pour sélectionner un template de post GBP → voir section 5

**Statut :** ✅ Légitimes pour l'ID — ❌ illégitime pour la sélection de contenu GBP

---

## 2. isDemoMode / PREVIEW_MODE — ANALYSE COMPLÈTE

### 2.1 `services/mock-data.ts` — La fonction isDemoMode
```ts
export function isDemoMode(): boolean {
  const env = process.env["NODE_ENV"];
  const dbUrl = process.env["DATABASE_URL"];
  if (env === "production" && dbUrl) return false;
  if (env === "production") return false;
  return true; // dev/staging = always demo mode
}
```
**Comportement :**
- `NODE_ENV=production` → `false` (sécurisé ✅)
- `NODE_ENV=development` → `true` (dev uniquement ✅)
- **Risque :** si NODE_ENV n'est pas défini en staging → retourne `true` (🟠)

---

## 3. DONNÉES PAR CATÉGORIE

---

### ✅ RÉEL — Données uniquement issues de DB ou APIs

| Module | Source | Détail |
|--------|--------|--------|
| `overview-service.ts` | DB `audits` | `seoScore = AVG(score)` sur 30j |
| `overview-service.ts` | DB `monitors` | `monitorsUp/Down`, `avgLatency`, `uptime` calculés depuis vraies checks |
| `overview-service.ts` | DB `org_settings` | `aiCreditsUsed`, `aiCreditsLimit` |
| `overview-service.ts` | GA4 API | `traffic`, `conversions`, `revenue` (null si non connecté) |
| `overview-service.ts` | GSC API | `organicGrowthPct` calculé depuis clics réels (null si non connecté) |
| `dataforseo-service.ts` | DataForSEO SERP API | SERP, keyword volumes, competitor domains |
| `dataforseo-service.ts` | DataForSEO Labs API | Intersection domaines |
| `ga4-service.ts` | GA4 Data API | 8 rapports distincts (overview, realtime, sources, pages, funnels, conversions, audience, campagnes) |
| `gsc-service.ts` | GSC Search Analytics API | Keywords, pages, impressions |
| `google-service.ts` | GBP API | Accounts, locations, reviews, performance |
| `billing-service.ts` | Stripe API | Plans, subscriptions, invoices, coupons |
| `betterstack-service.ts` | BetterStack API | Uptime monitors via API token |
| `ai-engine.ts` | OpenAI API | Recommandations, rapports, stratégies |
| `routes/audits.ts` | DB `audits` + PageSpeed API | Scores, issues, historique |
| `routes/monitors.ts` | Checks HTTP réels | Latency, status depuis `checkUrl()` |
| `routes/keywords.ts` | DB `tracked_keywords` | Positions, volumes, tendances |
| `routes/competitors.ts` | DB + DataForSEO | Données concurrents |

---

### 🟡 FALLBACK ACCEPTABLE — null / [] / 0 quand non connecté

| Fichier | Ligne | Pattern | Justification |
|---------|-------|---------|---------------|
| `services/dataforseo-service.ts` | 146 | `return { referring_domains: 0, backlinks: 0, domain_rank: 0 }` | Backlinks API non souscrit — retourne zéros documentés |
| `services/dataforseo-service.ts` | 162 | `return { traffic: 0, keywords: 0, rank: 0, backlinks: 0 }` | Idem |
| `services/dataforseo-service.ts` | 282 | `return { score: 0, mentions: 0, sentiment: "neutral", models: ["ChatGPT", "Claude", "Gemini", "Perplexity"] }` | Endpoint LLM pas encore disponible chez DataForSEO — **note : la liste `models` est statique** |
| `services/dataforseo-service.ts` | 291 | `return { score: 0, wordCount: 0, headings: 0, recommendations: [] }` | DataForSEO non configuré |
| `services/ga4-service.ts` | ≈ 195 | `EMPTY_OVERVIEW = { sessions: 0, … }` | Retourné quand GA4 non connecté — overview.ts l'interprète comme `null` |
| `services/gsc-service.ts` | toutes | `return []` quand pas de site actif | Correct |
| `services/google-service.ts` | toutes | `if (!token) return []` | Correct |
| `routes/billing.ts` | 484 | `emailsSent: null, apiCalls: null, storageUsed: null, bandwidthUsed: null` | Non instrumenté côté serveur, commentaire explicite |
| `routes/sso.ts` | 71 | Retourne 501 pour SAML/Okta/Azure AD | Feature stub déclaré, pas de fake data |
| `services/forecasting-service.ts` | 89 | `return EMPTY_FORECAST` en production | **Corrigé dans ce sprint** — retourne `{ forecasts: [], summary: { … 0 } }` |
| `overview-service.ts` | toutes | `traffic: null`, `conversions: null`, `revenue: null` si GA4 non connecté | Correct — UI affiche "—" |

---

### 🟠 DÉMO VOLONTAIRE — Dev/démo uniquement, correctement gardé

| Fichier | Ligne | Contenu | Protection | Action requise |
|---------|-------|---------|-----------|----------------|
| `routes/keywords.ts` | 26–33 | `SEED` — 8 mots-clés français fictifs ("agence seo paris", etc.) | `if (!isDemoMode()) return { keywords: [], source: "empty" }` ✅ | Aucune — correctement garded |
| `routes/team-messages.ts` | 14–20 | `SEED_MSGS` — 6 messages d'équipe fictifs (Sophie M., Maël H., Thomas R.) | `if (!isDemoMode()) return` dans `ensureSeed()` ✅ | Aucune |
| `services/automation-service.ts` | 6–13 | `SEED_WORKFLOWS` — 6 workflows fictifs ("Rapport client hebdo", etc.) | `if (!isDemoMode()) return` ✅ **corrigé dans ce sprint** | Aucune |
| `routes/admin.ts` | 251–265 | Keywords démo "boulangerie artisanale paris" | Endpoint `/admin/seed-demo` protégé par `ADMIN_KEY` ✅ | Aucune |
| `routes/admin.ts` | 368 | Session test `test@flowpoint.pro` | Protégé par `ADMIN_KEY` ✅ | Aucune |
| `routes/diagnostics.ts` | 191 | `demoMode: NODE_ENV !== "production"` | Retourné dans un endpoint de diagnostic | Aucune — informatif |
| `services/billing-service.ts` | 272 | Coupon `FLOWPOINT20` — 20% de réduction | Seulement actif si `!stripeKey && NODE_ENV !== "production"` ✅ | Aucune — safe |
| `services/forecasting-service.ts` | 97–107 | `buildComputedForecast()` — trafic calculé avec formule sinus + growth | `if (NODE_ENV === "production") return EMPTY_FORECAST` ✅ **corrigé dans ce sprint** | Aucune |

---

### 🔴 DONNÉES FICTIVES À SUPPRIMER AVANT PRODUCTION

**Priorité P0 — Affichées directement à un client payant**

---

#### 🔴 #1 — `services/gbp-posting-service.ts:113` — Génération de post GBP aléatoire

**Fichier :** `services/gbp-posting-service.ts`  
**Ligne :** ~113  
**Code :**
```ts
const type = Object.keys(templates)[Math.floor(Math.random() * Object.keys(templates).length)];
return { type, ...templates[type] };
```
**Problème :** `generateAiPost()` est appelé depuis `/api/gbp-posts/generate`. Le contenu retourné est un texte marketing hardcodé (4 templates statiques : promo, news, tip, event), sélectionné aléatoirement — pas de lien avec les données réelles du client (secteur, localisation, historique GBP).  
**Impact :** Un client payant qui demande "générer un post IA" reçoit un texte générique copié-collé non pertinent.  
**Correction requise :** Intégrer OpenAI (`ai-engine.ts`) avec le contexte du client (`businessName`, `niche`, `location`, `recentReviews`) pour générer le contenu. Les 4 templates peuvent servir de `system prompt` de fallback.  
**Effort :** ~2h de développement.

---

#### 🔴 #2 — `services/local-maps-service.ts:82` — Recommandations locales hardcodées

**Fichier :** `services/local-maps-service.ts`  
**Ligne :** ~82  
**Code :**
```ts
export async function generateAiLocalRecommendations(_orgId: string): Promise<...> {
  return [
    { title: "Créer des citations locales", description: "...", priority: "high" },
    { title: "Optimiser les photos Google Business", description: "Les fiches avec 10+ photos reçoivent 35% plus de clics...", priority: "high" },
    { title: "Répondre aux questions publiques", description: "...", priority: "medium" },
  ];
}
```
**Problème :** Les 3 recommandations sont identiques pour tous les clients, quelle que soit leur situation GBP réelle. La statistique "35% plus de clics" est hardcodée — source inconnue.  
**Impact :** Un client ayant déjà 15 photos et 50 citations reçoit les mêmes recommandations qu'un débutant.  
**Correction requise :** Lire les données GBP réelles (`google_locations`, `google_reviews`, photo count) et générer des recommandations contextualisées via OpenAI. Fallback : retourner `[]` quand pas de données GBP.  
**Effort :** ~3h de développement.

---

#### 🔴 #3 — `routes/ai-workspace-launch.ts` — Pourcentages d'impact fictifs

**Fichier :** `routes/ai-workspace-launch.ts`  
**Lignes :** ~90–102 (roadmap) et ~104–115 (missionTemplates)  
**Code :**
```ts
{ priority: 3, label: "Créer 3 landing pages conversion optimisées", impact: "+31% taux conversion", tag: "CRO" },
{ priority: 4, label: "Configurer Google Business Profile complet", impact: "+42% visibilité locale", tag: "Local SEO" },
// + 12 missions avec impact: "+18% trafic", "+24% CWV", "+38% note", etc.
```
**Problème :** Les pourcentages (+18%, +24%, +31%, +42%, +38%) sont des constantes inventées, sans lien avec les données réelles du client. Ils sont stockés en DB dans `ai_generated_missions.estimated_impact` et affichés dans le dashboard Missions.  
**Problème secondaire :** `orgId = "default"` et `userId = "demo"` hardcodés — l'endpoint ne récupère pas l'org réelle de la session.  
**Impact :** Un client payant voit "+42% visibilité locale" affiché comme une promesse personnalisée — c'est en réalité une constante identique pour tous.  
**Correction requise (2 étapes) :**  
1. Utiliser `req.orgId` au lieu de `"default"` et `req.me?.id` au lieu de `"demo"` (correction simple ~30min)  
2. Remplacer les pourcentages hardcodés par des fourchettes labellisées comme "estimations sectorielles" ou les générer via OpenAI depuis le contexte du client (~2h)  
**Effort :** 30min (orgId fix) + 2h (impact personnalisé).

---

#### 🔴 #4 — `services/dataforseo-service.ts:282` — Liste de modèles IA statique

**Fichier :** `services/dataforseo-service.ts`  
**Ligne :** 282  
**Code :**
```ts
return { score: 0, mentions: 0, sentiment: "neutral", models: ["ChatGPT", "Claude", "Gemini", "Perplexity"] };
```
**Problème :** La liste `models` est une constante hardcodée qui s'affiche dans la section "AI Visibility" du dashboard comme si c'était un résultat d'analyse réelle.  
**Clarification :** Le `score: 0` et `mentions: 0` sont des fallbacks acceptables (🟡), mais le champ `models` doit être supprimé ou remplacé par `models: []` pour ne pas suggérer une analyse qui n'a pas eu lieu.  
**Correction requise :** Remplacer par `models: []` et masquer le champ en UI quand score=0.  
**Effort :** 15 minutes.

---

#### 🔴 #5 — `services/forecasting-service.ts` — Scores de confiance hardcodés dans le résumé DB

**Fichier :** `services/forecasting-service.ts`  
**Lignes :** 55–56 (dans la branche "données DB trouvées")  
**Code avant correction :**
```ts
confidenceScore: 78,  // ← hardcodé même quand les données viennent de DB
growthScenarios: { pessimistic: -5, realistic: 15, optimistic: 35 }, // ← statique
```
**Statut :** ✅ **Corrigé dans ce sprint** — `confidenceScore` est maintenant calculé depuis la moyenne des `confidence` stockés en DB. `growthScenarios` est dérivé du delta trafic réel entre périodes.  
**Reste à faire :** La table `seo_forecasts` elle-même est peuplée par `generateForecasts()` qui utilise `buildComputedForecast()` — les données stockées en DB sont donc elles-mêmes calculées par la formule sinusoïdale. En production, il faut soit intégrer un modèle ML réel (Prophet/linear regression sur données GA4), soit désactiver l'endpoint `POST /forecast/generate`.

---

## 4. RÉCAPITULATIF PAR PRIORITÉ

### 🔴 À corriger avant le lancement production (5 items)

| # | Fichier | Ligne | Nature | Effort |
|---|---------|-------|--------|--------|
| 1 | `services/gbp-posting-service.ts` | ~113 | Post GBP aléatoire (template random) | 2h — intégrer OpenAI |
| 2 | `services/local-maps-service.ts` | ~82 | Recommandations locales identiques pour tous | 3h — contexte GBP + OpenAI |
| 3 | `routes/ai-workspace-launch.ts` | ~30, ~104 | orgId="demo" + impacts % fictifs | 30min (orgId) + 2h (impacts) |
| 4 | `services/dataforseo-service.ts` | 282 | `models: ["ChatGPT", ...]` statique | 15min — remplacer par `[]` |
| 5 | `services/forecasting-service.ts` | 110–127 | `generateForecasts()` écrit des forecasts inventés en DB | 4h — intégrer régression linéaire sur GA4 ou désactiver |

### ✅ Corrigés dans ce sprint (3 items)

| # | Fichier | Correction |
|---|---------|-----------|
| 1 | `services/automation-service.ts` | `ensureDefaultWorkflows()` — ajout `if (!isDemoMode()) return` |
| 2 | `services/forecasting-service.ts` | `getForecastData()` — `EMPTY_FORECAST` en production, pas de chiffres inventés |
| 3 | `services/forecasting-service.ts` | `confidenceScore` et `growthScenarios` calculés depuis DB, plus hardcodés |

### 🟠 Démo volontaire — Correctement gardés (8 items)

Tous correctement protégés par `isDemoMode()`, `ADMIN_KEY`, ou `NODE_ENV=production` check. Aucune action requise pour le lancement.

### 🟡 Fallbacks acceptables — Sans action (10 items)

`null`, `[]`, ou zéros quand la source de données n'est pas connectée. L'UI affiche "—" ou masque les blocs.

---

## 5. ÉTAT OBJECTIF "ZÉRO DONNÉE INVENTÉE"

| Catégorie | Avant ce sprint | Après corrections sprint | Reste pour prod |
|-----------|----------------|--------------------------|-----------------|
| Math.random() comme données | 1 | 0 → à corriger (GBP post) | 1 |
| SEED en production | 1 (automations) | 0 ✅ | 0 |
| Forecasts inventés en prod | 1 | 0 ✅ | 0 |
| Recommandations statiques | 2 (GBP + local maps) | 2 | 2 → sprint suivant |
| Impacts % fictifs | 1 (ai-workspace) | 1 | 1 → sprint suivant |
| Modèles IA statiques | 1 | 1 | 1 → sprint suivant |

**Bilan :** 4 items résiduels à traiter dans le sprint suivant avant lancement. Aucun ne concerne les modules core (analytics, monitoring, SEO, billing).

---

## 6. PLAN D'ACTION SPRINT SUIVANT

```
S2-FAKE-01  services/gbp-posting-service.ts      Remplacer generateAiPost() par appel OpenAI
            avec contexte client (niche, location, derniers avis)

S2-FAKE-02  services/local-maps-service.ts        generateAiLocalRecommendations() :
            lire google_locations + google_reviews, générer via OpenAI
            Fallback : return [] si pas de données GBP

S2-FAKE-03  routes/ai-workspace-launch.ts          Utiliser req.orgId + req.me.id
            Remplacer impacts hardcodés par fourchettes labellisées
            "Estimation sectorielle : +15 à +45% selon implémentation"

S2-FAKE-04  services/dataforseo-service.ts:282     models: [] au lieu de ["ChatGPT", ...]

S2-FAKE-05  services/forecasting-service.ts        Option A : Régression linéaire sur données GA4 réelles
            Option B : Désactiver POST /forecast/generate en production
                       (retourner 501 avec message "Connecter GA4 pour activer")
```
