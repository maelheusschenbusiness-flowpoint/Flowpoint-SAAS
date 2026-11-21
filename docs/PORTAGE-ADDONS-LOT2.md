# Portage lot 2 des add-ons depuis Test-Replit vers Flowpoint — 21 novembre 2026

**BROUILLON — NE PAS FUSIONNER.** PR draft, base `Flowpoint`. Même méthode que le lot 1 (`docs/PORTAGE-ADDONS-LOT1.md`, PR #507). Aucun déploiement, aucun Stripe LIVE ou TEST, aucun Render, aucune écriture en production, aucun prix / quota / abonnement existant modifié. `addon-stripe-sync.ts` et `stripe-webhook.ts` ne sont pas touchés (diff vide contre `origin/Flowpoint`, de même que `google-service.ts` et `middlewares/`).

Add-ons portés (aucune référence dans `Flowpoint` avant) : Agency Portfolio Priorities (19 €), Local Landing Opportunities (15 €), Local Presence Optimizer (9 €), GBP Performance & Leads (15 €). Rien d'autre de Test-Replit n'est repris (pas de `plans.ts` complet, pas de changement de disponibilité d'autres add-ons, pas de panier).

## 1. Garde prix (commit 1)

Le mécanisme du lot 1 (`PRICE_GATED_ADDONS`, `applyPriceGatedAddons`) est réutilisé tel quel : la clé n'apparaît dans `ADDON_DEFINITIONS`, `FLAG_ADDONS`, `PLAN_ALLOWED_ADDONS`, `ADDON_PRICE_IDS` **que si la variable de prix est posée**. Aucun identifiant de prix par défaut. Seul ajout : champ optionnel `plans` (plans payants autorisés ; défaut inchangé : standard, pro, ultra, agency).

| Add-on | Clé | Prix | Variable LIVE | Variable TEST (même nom que Test-Replit) |
|---|---|---:|---|---|
| Agency Portfolio Priorities | `agencyPortfolioPriorities` | 19 € | `STRIPE_PRICE_ID_AGENCY_PORTFOLIO_PRIORITIES` | `STRIPE_TEST_PRICE_ID_ADDON_AGENCY_PORTFOLIO_PRIORITIES` |
| Local Landing Opportunities | `localLandingOpportunities` | 15 € | `STRIPE_PRICE_ID_LOCAL_LANDING_OPPORTUNITIES` | `STRIPE_TEST_PRICE_ID_ADDON_LOCAL_LANDING` |
| Local Presence Optimizer | `localPresenceOptimizer` | 9 € | `STRIPE_PRICE_ID_LOCAL_PRESENCE_OPTIMIZER` | `STRIPE_TEST_PRICE_ID_ADDON_LOCAL_PRESENCE` |
| GBP Performance & Leads | `gbpPerformanceLeads` | 15 € | `STRIPE_PRICE_ID_GBP_PERFORMANCE_LEADS` | `STRIPE_TEST_PRICE_ID_ADDON_GBP_PERFORMANCE` |

TEST : seulement si `STRIPE_TEST_MODE=true` avec une clé `sk_test_` et la variable TEST non vide. Sans variable : invisible (catalogue, `/api/addons`, checkout, activation) et non achetable. Vérifié : catalogue 39 entrées sans variable (aucune des 4 clés), 43 avec les 4 variables factices ; Standard n'a pas Local Presence Optimizer (voir écarts).

Effets résiduels sans variable (inoffensifs) : routes montées derrière `requireAddon(<clé>)` (401 sans session, 402 `ADDON_REQUIRED` sans droit, jamais de donnée) ; tables créées vides ; 4 scripts `*-addon.js` chargés par `dashboard.html` (moteurs de rendu jamais appelés).

## 2. Commits (chacun revertable seul ; les 4 reverts ont été essayés individuellement : aucun conflit)

1. `garde prix lot 2` : emplacements `[lot2:<clé>]` + test commun `addon-price-gate-lot2.test.ts` (indépendant de l'état : valable avec 0 à 4 add-ons présents). Ne pas revert seul (les 4 add-ons en dépendent).
2. `gsc_page_data` : dépendance partagée (voir §4).
3. Agency Portfolio Priorities · 4. Local Landing Opportunities · 5. Local Presence Optimizer · 6. GBP Performance & Leads.
7. Cette doc.

| | Agency Portfolio Priorities | Local Landing Opportunities | Local Presence Optimizer | GBP Performance & Leads |
|---|---|---|---|---|
| Routes | `/api/agency-portfolio-priorities` (GET, PUT /settings) | `/api/local-landing-opportunities` (GET, PUT /settings) | `/api/local-presence` (GET, PUT /settings) | `/api/gbp-performance` (GET, PUT /settings) |
| Table (migration) | `agency_portfolio_priority_settings` | `local_landing_opportunity_settings` | `local_presence_settings` | `gbp_performance_settings` |
| Données lues | `audits`, `gsc_page_data` | `gsc_keyword_data` (lot 1) | `google_locations` | `google_locations`, API Google Business Profile Performance |
| Panneau | `agency-portfolio-priorities-addon.js` (repris tel quel) | `local-landing-opportunities-addon.js` (nouveau) | `local-presence-optimizer-addon.js` (nouveau) | `gbp-performance-leads-addon.js` (nouveau) |
| Tests | route (2), service (4), garde prix (7) | route (2), service (2), garde prix (7) | route (6, nouveau), service (3), garde prix (7) | route (6), route PostgreSQL (5), service (3), API Google (2), garde prix (7) |

Toutes les routes sont derrière `requireAddon` (le `requireAddon` de `Flowpoint` impose en plus l'état d'abonnement payé). Chaque garde prix de clé teste : invisible sans variable (vide ou blanche), visible et `available` avec la variable, prix TEST inopérant hors mode test, aucun add-on existant modifié, route montée derrière `requireAddon(<clé>)`.

## 3. Migrations (`init-data-tables.ts`, hors bloc `missing-production-tables-v3`)

Uniquement `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, RLS + 4 politiques `tenant_*` via `applyTenantRls` (supprime/recrée seulement les politiques des nouvelles tables). Aucun `DROP TABLE`, `ALTER` destructif, ni réécriture de donnée. Tables ajoutées : `gsc_page_data` (+2 index), `agency_portfolio_priority_settings` (+1 index), `local_landing_opportunity_settings`, `local_presence_settings`, `gbp_performance_settings`. Seule modification d'un bloc existant : `gbp_performance_settings` ajoutée à la liste « NO FORCE RLS » des tables lues par `pool.query` brut (comme `google_locations`), pour qu'elle reste lisible sous un rôle sans BYPASSRLS ; sans effet sur les autres tables.

Non vérifié contre la production (aucun accès pris) : l'absence de ces 5 tables y est présumée (aucune n'existait dans le code de `Flowpoint`) ; `IF NOT EXISTS` rend la migration sans effet si l'une existe déjà.

## 4. Dépendances portées (minimum, additif)

- **`gsc_page_data`** : lue par Agency Portfolio Priorities. Même situation que `gsc_keyword_data` au lot 1 : définie uniquement dans le bloc v3 déjà enregistré en production, donc jamais rejouée (le lot 1 a constaté `gsc_page_data` absente). Commit séparé, schéma identique au dépôt, test `gsc-page-data-schema-db.test.ts` (emplacement avant le bloc v3, colonnes, index unique, RLS, 4 politiques, rejeu ; simulé aussi base « v3 enregistré, tables supprimées »). `gsc_sync_logs` reste absente (hors périmètre, non nécessaire).
- **`getGbpPerformanceSeries`** (`services/gbp-performance-api.ts`) : le `getPerformance` de `Flowpoint` appelle l'ancien point de terminaison `getDailyMetricsTimeSeries` et renvoie `{metricValues}` (forme incompatible avec `summarizeGbpMetrics`) ; Test-Replit l'a corrigé (API v1 `fetchMultiDailyMetricsTimeSeries`, erreurs remontées). Pour ne pas modifier `google-service.ts` ni le comportement de `routes/google.ts`, la version corrigée est portée sous un nouveau nom dans un nouveau fichier. `getValidToken`, `requireOrgId`, `safeErrMsg`, `canWrite`, `requireAddon`, `req.orgDb`, `google_locations` existent déjà sous la forme utilisée.

## 5. Écarts de compatibilité avec Test-Replit

- **Interface** : Test-Replit intègre Local Presence, Local Landing et GBP Performance au code de `dashboard.js` (pages Local SEO / GBP, écouteurs globaux). Ici : trois panneaux autonomes dans le modèle du lot 1 (`FP_ADDON_RENDERERS`, route de tableau de bord, bouton « Ouvrir »), même logique de formulaire et de rendu ; l'ancien bouton spécifique d'Agency est remplacé par le `openFn` générique. Rien n'est ajouté aux pages Local SEO / GBP existantes. Les parcours Playwright de Test-Replit ne sont pas portés.
- **Disponibilité** : Test-Replit garde ces add-ons `coming_soon` / `VALIDATION_REQUIRED` (Local Presence) tant qu'aucun prix de test n'est posé. Ici, comme au lot 1, poser la variable LIVE est le seul geste d'ouverture et rend l'add-on `available`. Local Presence Optimizer reste réservé Pro/Ultra/Agency (`_PRO_EXCLUSIVE` de Test-Replit) ; les trois autres sont achetables sur tous les plans payants.
- **Migrations GBP** : Test-Replit crée `gbp_performance_settings` via `ensureGbpPerformanceSettingsSchema` (politiques `gbp_performance_settings_tenant_*`) ; ici, `applyTenantRls` (politiques `tenant_*`, convention de `Flowpoint`) hors bloc v3. Même table, même défaut.
- **Tests** : `gbp-performance-postgres.test.ts` adapté (réparation de schéma remplacée par un rejeu de `initDataTables`, appel Google simulé via `gbp-performance-api`) ; le test de route de Local Presence est nouveau (absent de Test-Replit).
- `gbp-performance.ts` accède à `gbp_performance_settings` et `google_locations` par `pool.query` brut (comme Test-Replit et comme `routes/google.ts`) ; cela suppose, comme le reste de `Flowpoint`, un rôle de connexion BYPASSRLS ou sans FORCE (d'où l'entrée NO FORCE ci-dessus).

## 6. Vérifications exécutées (PostgreSQL 16 jetable, port privé)

- `pnpm run typecheck` : OK. `pnpm run build` : OK. `pnpm run migrate` depuis zéro : 0 étape en échec, rejoué plusieurs fois sans erreur.
- Suite complète `vitest run --no-file-parallelism` : **145 fichiers passés, 1 ignoré ; 2 276 tests passés, 3 ignorés** ; `verifier-tests-ignores.mjs` : OK.
- `node --check` des deux `dashboard.js` (original et miroir `src/frontend`) et des 4 panneaux : OK.
- Non vérifié : parcours navigateur des 3 nouveaux panneaux (pas de script Playwright équivalent à `validation-navigateur-addons-lot1.mjs` exécuté pour ce lot), écriture authentifiée de bout en bout derrière le vrai `requireAddon`, Stripe (test ou LIVE), données GSC/GBP réelles, base de production.

## 7. Rollback

`git revert <commit de l'add-on>` (indépendant ; reverts essayés sans conflit). Les tables restent, vides et inoffensives (pas de `DROP`). Retrait sans revert : retirer la variable de prix (invisible et non achetable au redémarrage) ; **ne pas le faire pour un add-on déjà acheté par des clients** (la clé disparaîtrait de la synchronisation Stripe).

## 8. À fournir par le propriétaire (hors périmètre de cette PR)

Création des prix Stripe LIVE mensuels EUR (19 / 15 / 9 / 15 €), pose des 4 variables sur Render, migration appliquée en production après sauvegarde, validation navigateur sur l'instance de test, décision de lancement (en particulier pour Local Presence Optimizer, encore soumis à validation dans Test-Replit).
