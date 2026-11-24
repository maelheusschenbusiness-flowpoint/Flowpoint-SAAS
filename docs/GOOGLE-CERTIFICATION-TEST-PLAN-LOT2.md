# Plan de test certification Google — add-ons lot 2 (bêta)

Pré-requis : la bêta a les 4 variables de prix des add-ons (sinon routes en 402), l'organisation de test a les add-ons activés, et le propriétaire a connecté Google (OAuth, scopes `business.manage` + `webmasters.readonly`). Toutes les routes sont préfixées `/api` et authentifiées (cookie de session ou Bearer). Aucune des routes ci-dessous n'écrit chez Google, sauf mention.

```
B=https://<url-beta>/api ; H='-H "Authorization: Bearer <token>"'   # ou le cookie de session
```

## 0. Ce qui a été corrigé côté code (cette PR)

| Appel | Avant | Après |
|---|---|---|
| Liste des fiches | `GET mybusinessaccountmanagement/v1/accounts/{id}/locations` : **endpoint inexistant**, erreur avalée, `[]` | `GET mybusinessbusinessinformation.googleapis.com/v1/accounts/{id}/locations?readMask=…&pageSize=100` + `pageToken` ; erreur typée `GoogleApiError` |
| Comptes | pas de pagination, erreur avalée | `pageToken`, erreur typée |
| Avis (v4) | `v4/{locations/L}/reviews` (nom sans compte, invalide) ; `starRating` « FIVE » lu comme chiffre = 0 | `v4/accounts/{A}/locations/{L}/reviews` + pagination ; ONE..FIVE → 1..5 |
| Réponse à un avis | `…/{location}/{reviewId}/reply` (segment `reviews/` manquant) | `…/accounts/{A}/locations/{L}/reviews/{id}/reply` |
| Post local | corps sans `topicType` | `topicType: "STANDARD"` + `languageCode` |
| Performance (route legacy `/google/performance`) | `getDailyMetricsTimeSeries?dailyMetric=ALL` (inexistant) | `fetchMultiDailyMetricsTimeSeries` (`dailyMetrics` répété, dates UTC `start_date`/`end_date`), erreurs remontées |
| `POST /org/location/sync-gbp` | passait `account_id='primary'` (pas un compte GBP) | liste les vrais comptes puis leurs fiches |
| `google_locations` | seuls `name` + `raw_data` remplis ; `raw_data.name` = nom v4 | `location_id`, `primary_category`, `phone`, `website`, `lat`, `lng`, `rating`, `reviews_count` remplis ; `raw_data` = payload Google + `primaryCategory` (lu par le Local Presence Optimizer) + `accountName` + `v4Name` |
| `google_reviews.location_id` | nom Google | `google_locations.id` (cohérent avec `GET /google/reviews/:locationId`) |
| Échec Google | « 0 fiche » sans raison | `POST /google/sync` renvoie 401/502 + `code`, `googleStatus`, `reason` ; `GET /gbp-performance` idem |

Codes d'erreur : `NOT_CONNECTED`, `UNAUTHORIZED`, `API_NOT_ENABLED` (403 `SERVICE_DISABLED`), `QUOTA_EXCEEDED` (429 / quota 0), `FORBIDDEN` (scope ou droit), `NOT_FOUND`, `BAD_REQUEST`, `UPSTREAM_ERROR`, `NETWORK_ERROR`.

## 1. Étape préalable commune : diagnostic Google (lecture seule)

```
curl $H $B/google/gbp/diagnostics
```
Renvoie `{ ok, steps: { accounts, locations, reviews, performance }, db: { locations, reviews } }`. Chaque étape : `{ ok:true, count }` ou `{ ok:false, code, googleStatus, reason, error }`. Lecture :

- `accounts` KO `API_NOT_ENABLED` → activer « My Business Account Management API » dans la console Cloud.
- `locations` KO `API_NOT_ENABLED` → activer « My Business Business Information API ».
- `locations` / `accounts` KO `QUOTA_EXCEEDED` → quota 0 : le projet Cloud n'a pas encore l'accès GBP API approuvé (formulaire d'accès Google, délai de plusieurs jours) ; rien à corriger dans le code.
- `reviews` KO → « My Business API (v4) » (reviews/posts) non activée ou non approuvée.
- `performance` KO → « Business Profile Performance API » non activée.
- `FORBIDDEN` → scope `business.manage` non accordé : déconnecter/reconnecter Google.
- `NOT_CONNECTED` / `UNAUTHORIZED` → reconnecter Google.

Puis synchroniser : `curl -X POST $H $B/google/sync` → `{ ok:true, accounts, locations, reviews, errors:[] }`. `errors` non vide avec `ok:true` = succès partiel (ex. avis refusés mais fiches importées). Vérifier : `curl $H $B/google/locations` (doit lister les fiches avec `phone`, `website`, `lat`, `lng`).
Logs Render : lignes `[google] API call failed` (api, status, code, reason) et `[google] syncAll: …`.

## 2. Local Presence Optimizer (`localPresenceOptimizer`)

Données requises : ≥ 1 ligne `google_locations` (sync §1). Appel : `GET $B/local-presence`.
Attendu : `connected:true`, `locations[]`, `profile` et `analysis` (champs suivis : titre, catégorie principale, téléphone, site web, adresse, horaires, description ; chacun rempli/manquant + recommandations). Contrôle : comparer avec la fiche réelle sur business.google.com — un champ vide côté Google doit apparaître « manquant ». `connected:false` = sync pas faite ou échouée (voir §1). Réglages : `PUT $B/local-presence/settings` `{ "locationId": "<id>", "trackedFields": ["title","phone"] }`.

## 3. GBP Performance & Leads (`gbpPerformanceLeads`)

Données requises : ≥ 1 fiche synchronisée avec `raw_data.name` (`locations/…`) ; la fiche doit avoir des vues/appels (Google publie les métriques avec ~3 jours de retard).
Appel : `GET $B/gbp-performance` (30 jours par défaut, comparés aux 30 précédents).
Attendu : `configured:true`, `current` / `previous` = totaux de CALL_CLICKS, WEBSITE_CLICKS, BUSINESS_DIRECTION_REQUESTS, BUSINESS_IMPRESSIONS_DESKTOP_MAPS, BUSINESS_IMPRESSIONS_MOBILE_MAPS ; `drops` = métriques en baisse ≥ seuil. Contrôle : mêmes chiffres que l'onglet « Performances » de la fiche Google. Erreurs : HTTP 502 avec `code`/`reason` (voir §1) ; HTTP 409 `GBP_LOCATION_RESOURCE_MISSING` = refaire une sync. Variante : `GET $B/google/performance?locationId=locations/<id>` (route legacy, `summary` par métrique).

## 4. Agency Portfolio Priorities (`agencyPortfolioPriorities`) — dépend de GSC, pas de GBP

Données requises : ≥ 2 audits terminés (`status` ok/warn) sur des domaines différents dans les 180 jours (lancer des audits depuis l'app), et pour les clics : une propriété Search Console vérifiée et active, puis `POST $B/gsc/sync`.
Appel : `GET $B/agency-portfolio-priorities`.
Attendu : `priorities[]` triées par priorité (score, issues critiques, poids), `monthlyOrganicClicks` renseigné pour le domaine de la propriété GSC synchronisée et `null` pour les autres (« inconnu », jamais 0 inventé). Réglages : `PUT …/settings` `{ "priorityWeights": { "exemple.fr": 5 } }`.
Limite connue (non bloquante) : `syncGSCData` ne synchronise qu'**une** propriété active vérifiée par organisation ; les clics des autres domaines du portefeuille restent `null`. Le classement fonctionne quand même (audits + poids). Une synchronisation multi-propriétés exigerait de stocker la propriété dans `gsc_page_data` et de relâcher la règle fail-closed de provenance : hors périmètre de cette PR, à faire si la certification l'exige.

## 5. Local Landing Opportunities (`localLandingOpportunities`) — dépend de GSC

Données requises : propriété GSC active vérifiée + `POST $B/gsc/sync` (alimente `gsc_keyword_data`, 28 jours) avec des requêtes à connotation locale (ville, « près de moi », etc.).
Appel : `GET $B/local-landing-opportunities`.
Attendu : `source:"google-search-console"`, `periodDays:28`, `opportunities[]` (requêtes locales à forte impression / faible CTR sans page dédiée, avec mots-clés, position, impressions). `count:0` avec des données GSC = aucune requête ne passe les seuils (régler via `PUT …/settings`). Limite : mots-clés agrégés de la seule propriété active (même limite qu'au §4).
Vérifier la présence de données avant : `GET $B/gsc/status` (site actif, dernière sync) et `GET $B/gsc/keywords`.

## 6. Ordre recommandé le jour de la certification

1. Connecter Google (OAuth) → `GET /google/gbp/diagnostics` → corriger les APIs non activées / quotas.
2. `POST /google/sync` puis `GET /google/locations`.
3. §2 Local Presence, §3 GBP Performance.
4. `POST /gsc/sync`, §5 Local Landing, §4 Agency Portfolio.
5. Noter pour chaque add-on : HTTP, extrait de réponse, comparaison avec l'interface Google.

## 7. Blocages dépendant de Google (hors code)

Activation des 4 APIs sur le projet Cloud (Account Management, Business Information, Performance, My Business v4), approbation de l'accès GBP API (quota initial 0 sans demande validée), scope `business.manage` accordé par un compte propriétaire/gestionnaire d'une vraie fiche, et fiche avec historique de métriques. Tests unitaires : `src/services/google-service-gbp.test.ts` (fetch mocké). Ce plan complète `docs/PORTAGE-ADDONS-LOT2.md`, dont la mention « `google-service.ts` non touché » ne vaut plus pour cette correction.
