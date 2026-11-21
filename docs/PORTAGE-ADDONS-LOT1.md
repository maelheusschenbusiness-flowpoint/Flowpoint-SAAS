# Portage lot 1 des add-ons depuis Test-Replit vers Flowpoint — 18 novembre 2026

**BROUILLON — NE PAS FUSIONNER.** PR draft, base `Flowpoint`. Aucun déploiement, aucun Stripe LIVE, aucune écriture en production. Contexte : `docs/ADDONS-24-MATRICE-PUBLICATION-2026-11-18.md` (PR #505).

Add-ons portés (aucune référence dans `Flowpoint` avant, 19 fichiers dans `Test-Replit`) : Organic Campaign Tracker (12 €), Technical SEO Fix Verification (19 €), SEO Change Impact (15 €), Conversion Opportunity Engine (12 €). Rien d'autre du backend de Test-Replit n'est repris.

## 1. Mécanisme commun : la « garde prix » (commit 1)

`lib/plans.ts` : `PRICE_GATED_ADDONS`, `applyPriceGatedAddons()`, `isPriceGatedAddonKey()`.

Un add-on du lot est ajouté à `ADDON_DEFINITIONS`, `FLAG_ADDONS`, `PLAN_ALLOWED_ADDONS` (standard, pro, ultra, agency) et `ADDON_PRICE_IDS` **uniquement si sa variable de prix est définie** :

- LIVE : `STRIPE_PRICE_ID_<NOM>` non vide (convention de `Flowpoint` ; **aucun identifiant de prix par défaut**, contrairement aux add-ons existants) ;
- TEST : seulement si `STRIPE_TEST_MODE=true` avec une clé `sk_test_` et `STRIPE_TEST_PRICE_ID_ADDON_<NOM>` non vide.

Variable absente : la clé n'existe dans aucune structure. Conséquences vérifiées : absente de `/api/plans/catalog` et `/api/billing/plans` (JSON **identique octet pour octet** avant/après sur base neuve), de `/api/addons`, du checkout (`KNOWN_ADDON_KEYS`, `FLAG_ADDONS`), de `POST /addons/:key/activate` (clé inconnue). Le tableau de bord filtre les cartes marquées `gated:true` absentes du catalogue serveur. Sans variable, un add-on ouvert ne peut donc pas être acheté, activé, ni vu.

Avec la variable : disponibilité `available` (ni bêta ni « bientôt »), achetable sur tous les plans payants, comme dans Test-Replit. Ouvrir la garde est le seul geste commercial : il se fait en posant la variable sur Render, après création du prix LIVE par le propriétaire.

Effets résiduels sans variable (inoffensifs, à connaître) :
- les routes `/api/<add-on>` sont montées derrière `requireAddon(<clé>)` : sans session → 401 (comme tout `/api` inconnu), organisation sans droit → 402 `ADDON_REQUIRED`, jamais de donnée ;
- les 4 tables existent, vides ;
- les 4 scripts `*-addon.js` sont chargés par `dashboard.html` (définissent un moteur de rendu jamais appelé).

Éléments partagés ajoutés au tableau de bord (commit 1, `artifacts/flowpoint-export/dashboard.js` **et** son miroir `src/frontend/dashboard.js`, qui diffère déjà de l'original sur l'intro vidéo) : filtre garde prix, bouton « Ouvrir » générique (`openFn`), ensemble `FP_SELF_RENDERED_ADDON_ROUTES` et garde de rendu (le panneau monté n'est pas reconstruit par les rafraîchissements d'arrière-plan), emplacements de `switch`/`fpOpen*`.

## 2. Par add-on

| | Organic Campaign Tracker | Technical SEO Fix Verification | SEO Change Impact | Conversion Opportunity Engine |
|---|---|---|---|---|
| Commit | `portage Organic Campaign Tracker` | `portage Technical SEO Fix Verification` | `portage SEO Change Impact` | `portage Conversion Opportunity Engine` |
| Clé / prix affiché | `organicCampaignTracker` 12 € | `technicalSeoFixVerification` 19 € | `seoChangeImpact` 15 € | `conversionOpportunityEngine` 12 € |
| Variable de prix LIVE attendue (nom seul) | `STRIPE_PRICE_ID_ORGANIC_CAMPAIGN_TRACKER` | `STRIPE_PRICE_ID_TECHNICAL_SEO_FIX_VERIFICATION` | `STRIPE_PRICE_ID_SEO_CHANGE_IMPACT` | `STRIPE_PRICE_ID_CONVERSION_OPPORTUNITY_ENGINE` |
| Variable TEST (même noms que Test-Replit) | `STRIPE_TEST_PRICE_ID_ADDON_ORGANIC_CAMPAIGN_TRACKER` | `…_ADDON_TECHNICAL_SEO_FIX_VERIFICATION` | `…_ADDON_SEO_CHANGE_IMPACT` | `…_ADDON_CONVERSION_OPPORTUNITY` |
| Routes | `/api/organic-campaign-tracker` (GET, POST, DELETE /:id) | `/api/technical-seo-fix-verification` (GET, POST /verify) | `/api/seo-change-impact` (GET, PUT /settings) | `/api/conversion-opportunity-engine` (GET, PUT /settings) |
| Table (migration au démarrage/`pnpm migrate`) | `organic_campaign_goals` | `technical_seo_fix_verifications` | `seo_change_impact_settings` | `conversion_opportunity_settings` |
| Données lues | `gsc_keyword_data` | `audits` | `audits` | GA4 (`getGA4ConversionPages`) |
| Tests portés | route (3) + service + garde prix (5) | route + service + garde prix | route + service + garde prix | route + service + garde prix |

Fichiers par add-on : `routes/<slug>.ts` (+ `.test.ts`), `services/<slug>.ts` (+ `.test.ts`), `lib/addon-<slug>-gate.test.ts`, `flowpoint-export/<slug>-addon.js`, et blocs dans `plans.ts`, `billing-service.ts` (icône/unité de présentation), `routes/index.ts`, `init-data-tables.ts`, `vitest.config.ts`, `dashboard.html`, `dashboard.js` + miroir (carte du marché, route, `fpOpen*`).

Adaptation : Conversion Opportunity Engine renvoyait `error.message` dans ses réponses 500 ; remplacé par `safeErrMsg` (rien d'interne en production). Aucune autre dépendance de Test-Replit n'a été nécessaire : `requireAddon`, `canWrite`, `safeErrMsg`, `req.orgDb`, `getGA4ConversionPages` existent déjà dans `Flowpoint` sous la forme utilisée (la version de Test-Replit de `getGA4ConversionPages` renvoie en plus `totals`/`currencyCode`, non utilisés ici).

## 3. Migrations

Il n'y a pas de dossier SQL pour ces tables : `Flowpoint` crée ses tables dans `init-data-tables.ts` (exécuté par `pnpm migrate`, étape CI « Appliquer la migration du dépôt »). Les 4 blocs sont placés **hors** du bloc `missing-production-tables-v3` (déjà enregistré dans `schema_migrations` en production, il ne serait jamais rejoué) ; ils s'exécutent à chaque migration. Uniquement `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, RLS + 4 politiques `tenant_*` via l'aide `applyTenantRls` existante (supprime/recrée seulement les politiques de ces 4 nouvelles tables). Aucune suppression, renommage ni réécriture de donnée existante.

Commits : garde prix · `gsc_keyword_data` · Organic Campaign Tracker · Technical SEO Fix Verification · SEO Change Impact · Conversion Opportunity Engine · doc. Collision vérifiée en **lecture seule** sur le projet « Flowpoint project » (métadonnées uniquement, aucune ligne lue) : aucune des 4 tables, aucun des 2 index, aucune politique n'existe ; `audits` possède bien `url, score, issues, speed, status, created_at, org_id`. **Constat** : la table `gsc_keyword_data` n'existe **pas** en production (collision vérifiée en lecture seule : ni la table, ni ses index, ni ses politiques ; `gsc_page_data` et `gsc_sync_logs` sont aussi absentes). Elle est dans le bloc v3 déjà enregistré en production, donc jamais rejoué. Sans elle, `GET /api/organic-campaign-tracker` répondrait 500. **Correctif inclus, commit séparé et revertable placé avant Organic Campaign Tracker** : `CREATE TABLE IF NOT EXISTS gsc_keyword_data` (+ 2 index, RLS `tenant_*`), schéma identique à celui du dépôt et de Test-Replit, hors du bloc v3, avec test (`gsc-keyword-data-schema-db.test.ts` : emplacement avant le bloc v3, colonnes, index unique, RLS, 4 politiques, migration rejouée deux fois). Hors périmètre, signalé : `gsc_page_data` et `gsc_sync_logs` (écrites par la synchro GSC) restent absentes en production.

## 4. Vérifications exécutées (base PostgreSQL 16 jetable, port privé)

- `pnpm run typecheck` : OK. `pnpm run build` : OK (via `pnpm run migrate`).
- Étapes de la CI « Types, build, tests » : migration depuis zéro (104 → 108 tables, 0 étape en échec, **rejouée 2 fois** sans erreur, RLS actif et 4 politiques sur chaque nouvelle table, upserts `ON CONFLICT` validés en transaction annulée), suite complète `vitest run --no-file-parallelism` : **129 fichiers passés, 1 ignoré ; 2 203 tests passés, 3 ignorés** (après ajout du correctif `gsc_keyword_data`) ; `verifier-tests-ignores.mjs` : OK.
- `scripts/verifier-tests-orphelins.mjs` : **n'existe pas dans `Flowpoint`** (il existe dans Test-Replit) et n'est pas une étape de la CI de `Flowpoint` ; non exécuté. Les nouveaux tests sont ajoutés à la liste blanche `vitest.config.ts` (sinon ils ne tourneraient jamais).
- Serveur de `Flowpoint` démarré avec le portage sur la base migrée : `/api/plans/catalog` et `/api/billing/plans` **identiques** au serveur d'origine (diff JSON vide). Avec les 4 variables définies (valeurs factices) : les anciens add-ons et les plans sont identiques ; 4 entrées nouvelles apparaissent (12/19/15/12 €, `available`, standard/pro/ultra). GET des 4 routes OK sur la vraie base migrée (réponses vides cohérentes).
- Non vérifié : parcours navigateur des panneaux (les parcours Playwright de Test-Replit ne sont pas portés), écriture authentifiée de bout en bout, Stripe (test ou LIVE), données GSC/GA4 réelles.

## 4 bis. Validation navigateur locale (preuves chiffrées)

Script versionné : `scripts/validation-navigateur-addons-lot1.mjs` (refuse toute cible non locale). Conditions : copie de l'arbre, PostgreSQL 16 jetable lancé sous l'utilisateur `postgres` sur un port privé, base neuve migrée depuis zéro (108 tables, 0 étape en échec), serveur de la branche portée en `NODE_ENV=test` (debugLink de connexion), organisation de recette `provision-qa-account`, Chromium (Playwright) bureau 1440x900 puis mobile 390x844. Aucun Stripe. Le droit d'add-on est donné par écriture directe dans `org_addons` de la base jetable. Résultats bruts : `docs/preuves-addons-lot1/resultats-{sans,avec}.json` (+ 2 captures).

| Mode | Vérifications | Résultat |
|---|---:|---|
| `sans` : les 4 variables `STRIPE_PRICE_ID_*` absentes | 19 | **19 / 19** |
| `avec` : 4 variables factices posées | 52 | **52 / 52** |

Sans variables : les 4 add-ons absents de `/api/plans/catalog`, **cartes invisibles** dans le marché des add-ons (les add-ons existants, eux, restent affichés), lecture et écriture → **402** pour une organisation connectée sans droit, aucune erreur de script. Non connecté, en `NODE_ENV=production` : 401 (comme tout `/api` inconnu ; en `NODE_ENV=test` le mode développement accepte l'organisation `default`, ce qui n'est pas observable en production).

Avec variables, pour **chacun des 4 add-ons** : présent au catalogue, carte visible, **402 sans droit** (lecture et écriture), puis après octroi du droit : panneau affiché à 1440 px et à 390 px sans débordement horizontal, enregistrement des réglages **relus exacts après rechargement de la page** aux deux tailles (Organic : objectif + position/clics, relu aussi par l'API, mesure GSC lue depuis `gsc_keyword_data` = 12 clics / position 3,2 / « objectif atteint », suppression d'un objectif ; SEO Change Impact : période et seuil, comparaison d'audits 58 → 78 ; Technical SEO Fix Verification : comparaison 5 → 2 problèmes enregistrée puis relue ; Conversion Opportunity Engine : sessions minimales et taux maximal), puis **402 de nouveau après retrait du droit**, aucune erreur de script.

Limites : les scénarios de `e2e/parcours/10-addons-authorises.spec.mjs` de Test-Replit n'ont pas été rejoués tels quels (dépendent du socle et de fixtures propres à Test-Replit) : les mêmes comportements ont été vérifiés par le script ci-dessus ; GA4 réel absent (Conversion Opportunity Engine : état « aucune page mesurée », réglages seuls prouvés) ; rôle `viewer` et isolation entre deux organisations non rejoués ici (couverts par les tests unitaires de routes et la RLS) ; une exécution isolée du mode `avec` a échoué au démarrage du script avant la moindre vérification (relancée sans changement : 52/52), cause probable : limite de provisionnement QA en mémoire/lancement concurrent, non investiguée.

## 5. Rollback (par add-on)

1. `git revert <commit de l'add-on>` — chaque commit est indépendant ; les 4 reverts ont été essayés individuellement sur HEAD : aucun conflit. (Ne pas revert le commit « garde prix » seul : les 4 add-ons en dépendent.)
2. Migrations : la table reste, vide et inoffensive (aucun code ne la lit plus) ; pas de `DROP` automatique.
3. Retrait sans revert : retirer la variable de prix → add-on invisible et non achetable au redémarrage. **Attention** : un add-on déjà acheté par des clients ne doit pas être retiré ainsi (la clé disparaîtrait de la synchronisation Stripe) ; en production, aucune organisation n'a aujourd'hui d'add-on actif (matrice §5).

## 6. À fournir par le propriétaire (hors périmètre de cette PR)

Création des prix Stripe LIVE mensuels EUR (12 / 19 / 15 / 12 €), pose des 4 variables sur Render, migration appliquée en production après sauvegarde, validation navigateur sur l'instance de test, décision de lancement.
