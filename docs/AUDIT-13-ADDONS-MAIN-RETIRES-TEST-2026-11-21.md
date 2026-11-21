# Audit des 13 add-ons présents dans Main et retirés de Test-Replit — 21 novembre 2026

Lecture seule : aucune modification de dépôt de production, de Stripe, de Render ni de base. Aucun changement de commercialisation n'est proposé comme déjà décidé : les recommandations sont des options.

Références : Main = `origin/Flowpoint` (e25a0075), Test = `origin/Test-Replit` (9aa853f1). Chemins relatifs à `artifacts/api-server/src/` sauf mention. Les « Stripe TEST » ont été lus via le connecteur en lecture seule (compte `acct_1StVIr9eqtbj6iPB`, `livemode=false`). La production a été lue par une agrégation sur `org_addons` (projet Supabase `sejbsuuaeokyuxuoaxzd`), sans identifiant ni donnée personnelle.

## 1. Synthèse

| Clé | Prix Main | Fonctionnel | Facturation | Clients actifs prod | Recommandation |
|---|---:|---|---|---:|---|
| abTestingAI | 24 € | non (aucune route) | OK (coming_soon, non vendable) | 0 | CONSERVER |
| advancedWebhooks | 14 € | partiel | à corriger (prix affiché mais achat impossible) | 0 | CONSERVER |
| aiWorkflows | 34 € | partiel (route réelle, coming_soon) | OK (non vendable) | 0 | CONSERVER |
| enterprisePermissions | 19 € | non (aucun consommateur) | à corriger (prix affiché, achat impossible) | 0 | CONSERVER |
| gbpSlots10 | 19 € x qté | non (capacité jamais appliquée) | à corriger (vendu sans effet) | 0 | MASQUER TEMPORAIREMENT |
| localDominationMaps | 24 € | oui | OK (sans prix TEST) | 0 | CONSERVER |
| prioritySupport | 29 € (défini) | non | OK (déjà REMOVED dans Main) | 0 | CONSERVER (déjà retiré) |
| reviewIntelligence | 19 € | oui (bêta) | à corriger (Pro/Ultra l'ont déjà par le plan) | 0 | MASQUER TEMPORAIREMENT |
| zapierIntegration | 19 € | partiel (bêta) | OK (sans prix TEST) | 0 | CONSERVER |
| auditsPack200 | 12 € x qté | oui | OK (TEST 12 €) | 0 | CONSERVER |
| auditsPack1000 | 39 € x qté | oui | OK (TEST 39 €) | 0 | CONSERVER |
| pdfPack200 | 12 € x qté | oui | OK (TEST 12 €) | 0 | CONSERVER |
| exportsPack1000 | 14 € x qté | partiel (appliqué à un seul endpoint) | OK (TEST 14 €) | 0 | CONSERVER |

Constat transversal (point 5) : `org_addons` de production ne contient que 3 lignes au total (1 active, 1 seule clé), et aucune ligne pour ces 13 clés. Aucun client existant n'est donc touché par un retrait ou un masquage.

Constat transversal (point 4) : dans Test, ces 13 clés ne sont pas supprimées. `ADDON_DEFINITIONS` les conserve ; `RETIRED_ADDONS` (`lib/plans.ts:522-537` sur Test) les exclut des ventes (`isPlanAllowedAddon`, `getAddonPurchasablePlans`, `billing-quote.ts:164` renvoie `ADDON_RETIRED`) tout en les reconnaissant pour les droits et la réconciliation Stripe. `prioritySupport` est dans `REMOVED_ADDONS` (Test `lib/plans.ts:515`), exactement comme dans Main (`lib/plans.ts:336`) : il n'y a aucune divergence réelle pour cette clé.

## 2. Mécanismes communs (valables pour plusieurs clés)

- **Prix LIVE** : `ADDON_PRICE_IDS` (Main `lib/plans.ts:200-250`) lit une variable d'environnement et retombe sur un id LIVE codé en dur. Les noms des variables sont indiqués par clé ci-dessous ; aucune valeur secrète n'est reproduite.
- **Catalogue** : prix = `ADDON_DEFINITIONS[...].priceEur` (Main `lib/plans.ts:287-315`). Les 13 sont récurrents (`oneTime: false`). Les add-ons à quantité (`QTY_ADDONS`, `lib/plans.ts:462-467`) sont `gbpSlots10`, `auditsPack200`, `auditsPack1000`, `pdfPack200`, `exportsPack1000`.
- **Disponibilité** : `getAddonAvailability` (`lib/plans.ts:439-445`) donne `coming_soon` si la clé est dans `COMING_SOON_ADDONS` (`lib/plans.ts:347-388`), `beta` si dans `BETA_ADDONS` (`lib/plans.ts:418-436`), sinon `available`.
- **Plans autorisés** : `PLAN_ALLOWED_ADDONS` (`lib/plans.ts:556-594`), `_STANDARD_PURCHASABLE` = capacités (lignes 556-566), `_PRO_EXCLUSIVE` = lignes 570-583. Inclusions : `PLAN_INCLUDED_ADDONS` (lignes 506-531).
- **Garde d'activation** : `routes/addons.ts:60-110` (REMOVED → 410, coming_soon → 503, inclus dans le plan → pas de facturation, plan non autorisé → 403, quantité bornée 1 à 20, activation seulement si Stripe confirme). Devis/checkout : `services/billing-quote.ts:160-175`.
- **Garde de fonctionnalité** : `requireAddon` (`middlewares/planGate.ts:181-225`) accepte un add-on inclus dans le plan ou une ligne `org_addons.active`.
- **Quotas** : `QTY_ADDON_GRANTS` (`lib/plans.ts:480-489`) puis `checkQuota` (`services/billing-service.ts:282-395`) lit `org_addons.quantity` et additionne `perPack x quantité` à la limite du plan.
- **Retrait des droits** : `persistAddonsFromSubscription` (`routes/stripe-webhook.ts:~245-375`) désactive, sur `subscription.updated/deleted`, toute ligne `org_addons` payante (clé avec prix Stripe, hors inclus dans le plan) absente de l'union des abonnements vivants du client. C'est générique : il s'applique à ces 13 clés sans cas particulier. Le webhook ne reconnaît la clé que via l'id de prix ou `metadata.addonKey` (`stripe-webhook.ts:~196-215`).
- **Quantité côté Stripe** : `services/addon-stripe-sync.ts:247-272` met la quantité à jour en place sur l'élément existant (valeur absolue, pas un cumul) ; une activation `quantity: 5` fixe donc 5 paquets.
- **UI dashboard** : cartes data-driven dans `artifacts/flowpoint-export/dashboard.js:10168-10205` (liste `allAddons`). Les paquets de capacité n'y ont pas de carte dédiée dans Main (non retrouvés par recherche de clé dans ce fichier).
- **Stripe TEST (lu)** : prix actifs avec `metadata.cert="cert2026"` pour `auditsPack200` 12 €, `auditsPack1000` 39 €, `pdfPack200` 12 €, `exportsPack1000` 14 € (tous récurrents mensuels, EUR), ainsi que monitorsPack10/50, extraSeats (35 €), retention90d/365d, advancedSeoLab, keywordDomination, backlinkIntelligence et les packs de crédits IA. **Aucun prix TEST n'existe** pour les 8 autres clés auditées (gbpSlots10, localDominationMaps, reviewIntelligence, zapierIntegration, aiWorkflows, abTestingAI, enterprisePermissions, advancedWebhooks).
- **Mode TEST dans Main** : `ADDON_PRICE_IDS_TEST` (`lib/plans.ts:149-168`) ne déclare que gbpSlots10, enterprisePermissions et advancedWebhooks parmi nos 13 ; les quatre paquets n'y sont pas, donc `getAddonPriceId` (`lib/plans.ts:170-174`) retombe sur l'id LIVE avec une clé `sk_test_`, ce qui échoue côté Stripe. Test-Replit déclare les variables TEST des paquets (`lib/plans.ts:214-217` sur Test).

## 3. Détail par add-on

### abTestingAI — AB Testing IA
1. **Main** : 24 € (`lib/plans.ts:294`), `coming_soon` (`:359`), plans : aucun (absent des ensembles autorisés, `:574` le confirme). Prix : variable `STRIPE_PRICE_ID_AB_TESTING_AI` avec repli LIVE codé en dur (`:211`).
2. **Fonction** : aucune route, aucun consommateur (seulement l'étiquette de `billing-service.ts:72` et la carte `dashboard.js:10182`). Commentaire Main `:354` : « no routes exist ». Fonctionnalité absente.
3. **Facturation** : récurrent, sans quantité ; non vendable (503 / `ADDON_COMING_SOON`, `billing-quote.ts:162`). Pas de prix TEST. Retrait des droits générique.
4. **Test** : retiré par le commit f5ac6cda (24/10/2026, « Retire the eight replaced add-ons from new sales »), `RETIRED_ADDONS` Test `lib/plans.ts:522-530` ; Test garde une description réécrite (« variantes servies … expositions réelles », `:463`) et un commentaire `:570` indiquant qu'il reste non achetable tant que la livraison d'expériences n'existe pas. Client existant : droits conservés (reconnu par l'entitlement et la réconciliation), aucun nouvel achat.
5. **Production** : 0 organisation.
6. **Recommandation** : CONSERVER (déjà coming_soon, aucun effet à attendre). Risque : la carte promet un produit inexistant tant que la description Main n'est pas alignée.

### advancedWebhooks — Webhooks Avancés
1. **Main** : 14 € (`:305`), `available`, plans autorisés à l'achat : aucun (absent de `_STANDARD_PURCHASABLE` et `_PRO_EXCLUSIVE`), inclus dans Pro et Ultra (`:524`, `:536`). Prix : `STRIPE_PRICE_ID_ADVANCED_WEBHOOKS` (`:232`) ; TEST : `STRIPE_TEST_PRICE_ID_ADDON_WEBHOOKS` (`:164`).
2. **Fonction** : `routes/integrations.ts:274` (`POST /integrations/webhooks`, enregistrement) et `:289` (test de ping avec garde SSRF) sont protégés par `requireAddon`. UI : onglet webhooks du dashboard (`dashboard.js:12686`, `:62572`). Partiel : la garde est contournable, car `POST /integrations/connections` (`integrations.ts:~177`) crée un webhook sortant avec n'importe quelle `platform` sans `requireAddon`, limité seulement par `getIntegrationLimit` (`services/integrations-service.ts:14-17`, standard 2).
3. **Facturation** : récurrent. Prix 14 € affiché mais achat impossible pour tous les plans : cohérence catalogue/achat à corriger. Pas de prix TEST dans Stripe. Un client Pro/Ultra ne peut pas payer deux fois (`routes/addons.ts:90-95` répond « inclus »).
4. **Test** : retiré par f5ac6cda ; reste inclus dans Pro et Ultra par le plan (Test `lib/plans.ts:779`, `:790` ; test `addon-catalog-ui.test.ts:~362` : « ultra contains advancedWebhooks »). Client existant : inchangé.
5. **Production** : 0.
6. **Recommandation** : CONSERVER (droit de plan). Risque : prix affiché sans chemin d'achat ; contournement de la garde par `/integrations/connections`.

### aiWorkflows — AI Automation Workflows
1. **Main** : 34 € (`:300`), `coming_soon` (`:362`), plans : aucun. Variable `STRIPE_PRICE_ID_AI_AUTOMATION_WORKFLOWS` (`:221`).
2. **Fonction** : `routes/automation.ts:16` protège toutes les routes `/automation/*` par `requireAddon("aiWorkflows")` (CRUD de workflows, exécution `:108`, historique `:155`) ; service `services/automation-service.ts` ; UI `dashboard.js:69761-69808`. Réel mais non commercialisé (coming_soon bloque l'achat). Aucun test dédié à la clé.
3. **Facturation** : récurrent sans quantité ; non vendable, pas de prix TEST.
4. **Test** : retiré par f5ac6cda ; aussi en coming_soon dans Test. Client existant : droits conservés.
5. **Production** : 0.
6. **Recommandation** : CONSERVER (coming_soon). Risque : un org sans achat ne peut pas accéder à la route ; aucune autre voie d'activation que l'admin.

### enterprisePermissions — Permissions Avancées
1. **Main** : 19 € (`:302`), `available` (non coming_soon dans Main ; Test l'y a ajouté), achetable : aucun plan (`_PRO_EXCLUSIVE` `:581` mais inclus dans Pro et Ultra, `:531`, `:544`, et absent de Standard). Variable `STRIPE_PRICE_ID_ENTERPRISE_PERMISSIONS` (`:225`) ; TEST `STRIPE_TEST_PRICE_ID_ADDON_ENT` (`:163`).
2. **Fonction** : aucune garde `requireAddon("enterprisePermissions")` dans le code ; les rôles personnalisés dépendent de la fonction de plan `rbacCustomRoles` (`planGate.ts:292`, `lib/config.ts:122-150`). L'add-on ne débloque rien : factice.
3. **Facturation** : récurrent ; impossible à acheter (inclus ou non autorisé). Pas de prix TEST dans Stripe.
4. **Test** : retiré (f5ac6cda) et placé en `COMING_SOON_ADDONS` (Test `lib/plans.ts:~560`) ; reste inclus dans Pro/Ultra.
5. **Production** : 0.
6. **Recommandation** : CONSERVER comme droit de plan. Risque : la carte annonce « RBAC complet » alors que la capacité est portée par le plan.

### gbpSlots10 — +10 Emplacements GBP
1. **Main** : 19 € par lot (`:287`), `available`, achetable sur Standard, Pro, Ultra (`:563`). Variable `STRIPE_PRICE_ID_10GBPLOCATIONS` (`:202`) ; TEST `STRIPE_TEST_PRICE_ID_ADDON_GBP10` (`:169`).
2. **Fonction** : `QTY_ADDON_GRANTS.gbpSlots10` accorde `gbpLocations` (+10, `:488`) mais aucun code n'applique `gbpLocations` (aucune occurrence hors `plans.ts` et libellés) : `routes/google.ts` lit une seule ligne `google_locations` (`:390`, `:442`, `:563`, `:634`). La capacité vendue n'est ni appliquée ni mesurée : factice.
3. **Facturation** : récurrent, quantité 1 à 20. Le client paie un entitlement sans effet. Pas de prix TEST dans Stripe.
4. **Test** : retiré par f5ac6cda ; commentaire Test `lib/plans.ts:730` identique. Client existant : droits conservés.
5. **Production** : 0.
6. **Recommandation** : MASQUER TEMPORAIREMENT. Comment : ajouter la clé à `COMING_SOON_ADDONS` (ou la sortir de `_STANDARD_PURCHASABLE`) ; effet : achat refusé (503), lignes `org_addons` existantes intactes (aucune pour l'instant). Risque principal : facturer une capacité non livrée (litige, remboursement).

### localDominationMaps — Local Domination Maps
1. **Main** : 24 € (`:290`), `available`, Pro et Ultra (`:577`). Variable `STRIPE_PRICE_ID_LOCAL_DOMINATION_MAPS` (`:205`).
2. **Fonction** : `routes/local-maps.ts:15` (`requireAddon`), 11 routes (heatmaps, concurrents, opportunités, scores, recommandations IA, `:18-158`), service `local-maps-service.ts`, UI `dashboard.js:70811-70856`, `:70972`. Tests : `routes/addon-entitlement.test.ts`. Réel. (`lib/config.ts:120-148` met aussi un drapeau `localDominationMaps:true` sur tous les plans, sans effet sur cette garde.)
3. **Facturation** : récurrent, sans quantité ; cohérent avec la harmonisation de prix du 21/11 (`docs/HARMONISATION-PRIX-CATALOGUE.md`). Pas de prix TEST dans Stripe : la certification TEST n'est pas possible aujourd'hui.
4. **Test** : retiré par 681c77cf (23/10, premier retrait) puis f5ac6cda ; remplacé commercialement par `localPresenceOptimizer` (9 €) et ses voisins. Client existant : droits conservés.
5. **Production** : 0.
6. **Recommandation** : CONSERVER. Risque : produit réel sans certification TEST.

### prioritySupport — Support Prioritaire
1. **Main** : défini à 29 € (`:311`) avec id LIVE codé en dur (`:242`, variable `STRIPE_PRICE_ID_PRIORITY_SUPPORT`) mais `REMOVED_ADDONS` (`:336`) : activation 410 (`routes/addons.ts:66-71`), devis refusé (`billing-quote.ts:163`), masqué dans `/me` (`routes/me.ts:561`), fonction de plan `prioritySupport:false` partout (`lib/config.ts:125-153`).
2. **Fonction** : aucune (« feature not implemented »).
3. **Facturation** : non vendable. Un abonnement Stripe historique éventuel resterait reconnu seulement par la réconciliation.
4. **Test** : même état dans Test (`REMOVED_ADDONS` `:515`) ; aucun retrait supplémentaire.
5. **Production** : 0.
6. **Recommandation** : CONSERVER (déjà retiré). Aucun écart à porter.

### reviewIntelligence — Review Intelligence
1. **Main** : 19 € (`:289`), `beta` (`:429`), Pro et Ultra à l'achat (`:577`). Variable `STRIPE_PRICE_ID_REVIEW_INTELLIGENCE` (`:204`).
2. **Fonction** : `routes/review-intelligence.ts:23` (`requireAddonOrFeature("reviewIntelligence","reviewIntelAI")`, 10 routes `:25-133`), service `review-intel-service.ts`, UI `dashboard.js:70083-70096`. Tests : `local-seo-entitlement.test.ts`, `addon-entitlement.test.ts`. Réel (dépendance DFS/GBP partielle, d'où bêta).
3. **Facturation** : récurrent. **Problème** : `reviewIntelAI` est vrai pour Pro, Ultra et agency (`lib/config.ts:131`, `:140`, `:149`) et faux pour Standard (`:121`) : les seuls plans autorisés à l'acheter (Pro/Ultra) ont déjà la fonction par le plan, et Standard ne peut pas acheter. L'achat à 19 € ne débloque donc rien de plus : double facturation fonctionnelle. Pas de prix TEST.
4. **Test** : retiré par f5ac6cda ; `docs/HARMONISATION-PRIX-CATALOGUE.md` note « add-on retiré en Test-Replit ». Client existant : droits conservés.
5. **Production** : 0.
6. **Recommandation** : MASQUER TEMPORAIREMENT (retrait de `_PRO_EXCLUSIVE` ou coming_soon). Effet : aucun client touché ; la fonction reste accessible par le plan. Risque principal : faire payer 19 € un droit déjà inclus.

### zapierIntegration — Zapier / Make
1. **Main** : 19 € (`:306`), `beta` (`:432`), Pro et Ultra (`:579`). Variable `STRIPE_PRICE_ID_ZAPIER_MAKE_INTEGRATION` (`:233`).
2. **Fonction** : `integrations.ts:131` (Zapier) et `:158` (Make) protégés par `requireAddon`, création d'une intégration sortante ; l'ensemble repose sur une URL de webhook fournie par l'utilisateur (pas d'OAuth bundlé). UI `dashboard.js:69714-69716`. Partiel : contournable par `POST /integrations/connections` (même constat que advancedWebhooks) ; le drapeau `zapierIntegration` de `lib/config.ts:142`, `:151` n'est pas utilisé par la garde. Aucun test dédié à la clé.
3. **Facturation** : récurrent, sans quantité ; pas de prix TEST.
4. **Test** : retiré par f5ac6cda. Client existant : droits conservés.
5. **Production** : 0.
6. **Recommandation** : CONSERVER. Risque : garde contournable, absence de certification TEST.

### auditsPack200, auditsPack1000, pdfPack200, exportsPack1000 — paquets de capacité
1. **Main** : 12 € (`:312`), 39 € (`:313`), 12 € (`:314`), 14 € (`:315`) par paquet, `available`, tous plans (`:564-566`). Variables : `STRIPE_PRICE_ID_AUDITS_PACK200` / `…PACK1000` (`:245-246`, avec repli sur les variables nommées `auditsPack200` / `auditsPack1000`), `STRIPE_PRICE_ID_PDF_PACK200` (`:247`), `STRIPE_PRICE_ID_EXPORTS_PACK1000` (`:248`).
2. **Fonction (la limite est réellement augmentée)** : `QTY_ADDON_GRANTS` (`:483-486`) : +200 / +1000 audits, +200 rapports, +1000 exports par paquet ; `checkQuota` (`billing-service.ts:312-378`) additionne à la limite du plan ; appliquée à la création : audits `routes/audits.ts:114` (verrou transactionnel, réponse 402), rapports PDF `routes/reports.ts:112` (402), exports `routes/org-data-export.ts:157` (402). `getQuotaLimits` (`addons-service.ts:213-218`) alimente l'API `/api/me` et `/billing/usage`. Limite : l'application de `exports` ne se fait qu'à l'export de données de l'organisation ; les autres exports CSV/PDF remontent seulement des événements d'usage. C'est pourquoi `exportsPack1000` est noté « partiel ». Tests : `services/monitor-addon-quota.test.ts:108-130` (limites), `:240-262` (application dans `checkQuota` avec quantités 1 à 3), `:280-290` (contexte billing) ; `routes/addon-entitlement-quantity.test.ts:203`, `routes/addon-activate-quantity.test.ts:46-106`. Aucun test d'une route HTTP qui refuse (402) avec un paquet actif.
3. **Facturation** : récurrent mensuel, quantité 1 à 20 (`routes/addons.ts`), lue depuis `item.quantity` au webhook (`stripe-webhook.ts:~224`) et stockée dans `org_addons.quantity`. Prix catalogue égaux aux prix Stripe TEST `[CERT]` lus : 12 / 39 / 12 / 14 € (ids TEST `price_1U4p1Z9eqtbj6iPBMK549pDG`, `…PBiAru9aAj`, `price_1U4p1a9eqtbj6iPB6sfEvQxC`, `…PBw9O0eaJU`, tous actifs). Réserve : mode TEST de Main sans override pour ces clés (voir §2). Main met la quantité à jour sur un seul abonnement d'add-ons ; les durcissements récents de Test (verrou par organisation, somme sur plusieurs abonnements, commits bdcdac4f et b8434535) ne sont pas dans Main. Pas de double facturation constatée dans le code Main pour ces clés ; retrait des droits : générique.
4. **Test** : retirés des ventes par b8434535 (31/10/2026, « Retire legacy add-on offers and harden checkout », commentaire : « Historical capacity packs remain recognized for existing subscriptions and quota grants, but are no longer offered for new purchases ») et couverts par 99186b5a. Aucun document de Test ne motive la décision commerciale elle-même. Client existant : droits et quotas conservés, aucune nouvelle vente.
5. **Production** : 0 pour chacune des quatre clés.
6. **Recommandation** : CONSERVER dans Main. Si la décision de Test est durable, la porter explicitement dans Main plutôt que d'y laisser vendre. Risque principal : une promotion de Test vers Main supprimerait silencieusement quatre offres réellement fonctionnelles et déjà certifiées en TEST (prix `[CERT]` présents) ; réintégrer dans la bêta (définition + tests) serait la contrepartie si la vente doit continuer.

## 4. Points à traiter (hors périmètre de cet audit)

- Garde contournable : `POST /integrations/connections` crée des intégrations sortantes sans `requireAddon` (advancedWebhooks, zapierIntegration).
- Clés dont le prix est affiché sans chemin d'achat : advancedWebhooks, enterprisePermissions.
- `gbpSlots10` vendu sans application de la capacité ; `reviewIntelligence` vendu à des plans qui l'ont déjà.
- Prix TEST Stripe absents pour 8 de ces 13 clés ; surcharges TEST absentes de Main pour les quatre paquets.
- Les montants LIVE réellement configurés dans Stripe n'ont pas été lus (compte TEST seulement) : à confirmer dans le Dashboard LIVE.
