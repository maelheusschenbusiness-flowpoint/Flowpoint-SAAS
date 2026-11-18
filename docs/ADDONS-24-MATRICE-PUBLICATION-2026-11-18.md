# Matrice de publication des 24 add-ons — 18 novembre 2026

Analyse en lecture seule (aucun achat Stripe, aucun déploiement, aucun accès à `flowpoint-test.onrender.com`, rien vers `Flowpoint`). Base : `Test-Replit` @ `af43e406` ; production comparée : `origin/Flowpoint` @ `9062968d`. Les certifications déjà valides n'ont pas été refaites : aucun fichier de code ni de test n'a changé depuis leurs dates de preuve, sauf #493 (voir §4). Les chiffres de tests viennent des matrices et rapports cités ; **ils n'ont pas été rejoués aujourd'hui**.

## 0. Verdict

| Classement | Nombre | Add-ons |
|---|---:|---|
| READY | **0** | aucun |
| BLOCKED | **23** | tous sauf CRM Integrations |
| INCOMPLETE | **1** | CRM Integrations (HubSpot seul, 7 autres fournisseurs en 501, sync contacts seulement) |

**Aucun add-on n'est publiable aujourd'hui.** Raison commune : aucune transaction d'achat/activation **réelle** d'add-on n'a été exécutée de bout en bout sur l'instance de test (seul le plan Standard/Pro/Ultra l'a été). Le plus avancé, Agency Reporting Packs, a un achat réel partiel (§3) mais il lui manque le webhook réel et un cycle complet. Le simulé n'est jamais présenté comme équivalent.

## 1. Critères de classement

**READY** exige TOUT ceci : (a) fonctionnalité implémentée sans donnée fabriquée ; (b) prix Stripe TEST actif, cohérent avec le catalogue du code (montant, mensuel) ; (c) droits, quotas, annulation/désactivation prouvés par tests ; (d) parcours navigateur validé et stable ; (e) achat + activation **RÉELS** Stripe TEST (transaction réellement exécutée, avec preuve et date, webhook compris) — à défaut, l'add-on est **BLOCKED « achat réel manquant »**.
**BLOCKED** : fonctionnalité faite mais une certification ou un défaut manque (la colonne dit laquelle).
**INCOMPLETE** : fonctionnalité non terminée par rapport à son annonce.
Colonne distincte « compatible Flowpoint sans changement backend ? » : oui / non / à analyser.
Vocabulaire des preuves : **RÉEL** = objet créé dans Stripe TEST par une transaction réellement exécutée ; **SIMULÉ** = Stripe factice, vitest, Playwright sur fixtures ; **AUCUN**.

## 2. Lien registre → clé de catalogue → prix Stripe TEST (lecture, compte « Flowpoint », `livemode:false`)

Prix actifs lus : 9 prix « replacement/agency » cohérents, 3 prix `[CERT]`, 12 add-ons **sans aucun prix TEST**. Ids tronqués (début masqué).

| # | Registre (`ADDON_REGISTRY`) | addonKey | Variable TEST attendue (nom seul) | Prix TEST lu | Catalogue code | Cohérent |
|---:|---|---|---|---|---:|---|
| 1 | ai-gbp-posting | aiGbpPosting | STRIPE_TEST_PRICE_ID_ADDON_AI_GBP_POSTING | **aucun** | 12 € | non (absent) |
| 2 | behavioral-ai | behavioralAI | …_ADDON_BEHAVAI | **aucun** | 44 € | non (absent) |
| 3 | revenue-leak-ai | revenueLeak | …_ADDON_REVENUE_LEAK | **aucun** | 29 € | non (absent) |
| 4 | ai-executive-reporting | aiExecutiveReport | …_ADDON_AI_EXECUTIVE_REPORT | **aucun** | 24 € | non (absent) |
| 5 | ai-forecasting-engine | aiForecasting | …_ADDON_FORECAST | **aucun** | 39 € | non (absent) |
| 6 | ai-market-intelligence | marketIntelligence | …_ADDON_MARKET_INTELLIGENCE | **aucun** | 49 € | non (absent) |
| 7 | crm-integrations | crmIntegration | …_ADDON_CRM | **aucun** | 29 € | non (absent) |
| 8 | keyword-domination-engine | keywordDomination | …_ADDON_KDE | `price_1U4p1R…bbmM4bng5` 39 €/mois, produit « keywordDomination [CERT] » (metadata `addonKey`, `cert2026`) | 39 € | montant oui ; prix de certification, variable Render à confirmer |
| 9 | advanced-seo-lab | advancedSeoLab | …_ADDON_SEOLA | `price_1U4p1Q…EXaHdc9o` 29 €/mois, `[CERT]` | 29 € | idem |
| 10 | global-monitoring | globalMonitoring | …_ADDON_GLOBAL_MONITORING | **aucun** | 15 € | non (absent) |
| 11 | sla-monitoring-avance | slaMonitoring | …_ADDON_SLA_MONITORING | **aucun** | 19 € | non (absent) |
| 12 | ai-cro-strategist | aiCro | …_ADDON_AI_CRO | **aucun** | 34 € | non (absent) |
| 13 | ai-workspace-launch | aiWorkspaceLaunch | …_ADDON_AI_WORKSPACE_LAUNCH | **aucun** | 15 € | non (absent) |
| 14 | seo-content-decay-radar | aiContentStrategist | …_ADDON_AI_CONTENT_STRATEGIST | **aucun** | 12 € | non (absent) |
| 15 | backlink-intelligence | backlinkIntelligence | …_ADDON_BACKLINK | `price_1U4p1R…9eqtbj6iPBRsXtSnQo` 24 €/mois, `[CERT]` | 24 € | idem 8 |
| 16 | agency-reporting-packs | agencyPacks | …_ADDON_AGENCY_PACKS | `price_1UZZau…q1vN3EpE` 12 €/mois, lookup `flowpoint_agency_packs_monthly_test_v1`, produit « [TEST] Agency Reporting Packs » | 12 € | oui |
| 17 | gbp-performance-leads | gbpPerformanceLeads | …_ADDON_GBP_PERFORMANCE | `price_1UTosB…QmWEC2T` 15 €/mois (`flowpoint_addon_key`) | 15 € | oui |
| 18 | local-presence-optimizer | localPresenceOptimizer | …_ADDON_LOCAL_PRESENCE | `price_1UUTPc…b5PEFUk5` 9 €/mois | 9 € | oui (le code corrige déjà une valeur Render erronée `…5PEFUk5`) |
| 19 | local-landing-opportunities | localLandingOpportunities | …_ADDON_LOCAL_LANDING | `price_1UUTPc…Zlbay` 15 € | 15 € | oui (id codé en dur dans `VERIFIED_TEST_ADDON_PRICE_IDS`) |
| 20 | conversion-opportunity-engine | conversionOpportunityEngine | …_ADDON_CONVERSION_OPPORTUNITY | `price_1UUTPc…DZykLW` 12 € | 12 € | oui (idem) |
| 21 | seo-change-impact | seoChangeImpact | …_ADDON_SEO_CHANGE_IMPACT | `price_1UUTPd…18duKFQq` 15 € | 15 € | oui (idem) |
| 22 | agency-portfolio-priorities | agencyPortfolioPriorities | …_ADDON_AGENCY_PORTFOLIO_PRIORITIES | `price_1UUTPd…R5a5qz9E` 19 € | 19 € | oui ; id **non** codé en dur : dépend de la variable Render (non lisible ici) |
| 23 | technical-seo-fix-verification | technicalSeoFixVerification | …_ADDON_TECHNICAL_SEO_FIX_VERIFICATION | `price_1UUTPd…e2g6bpJF` 19 € | 19 € | oui ; idem 22 |
| 24 | organic-campaign-tracker | organicCampaignTracker | …_ADDON_ORGANIC_CAMPAIGN_TRACKER | `price_1UUTPd…6fNR5kLx` 12 € | 12 € | oui (codé en dur) |

Tous les prix lus : EUR, `recurring month`, `licensed`, produit actif, `livemode:false`. Les variables `STRIPE_TEST_PRICE_ID_*` définies sur Render ne sont pas lisibles ici : leur valeur reste à confirmer (rapport 13/11 : plusieurs valeurs Render s'étaient révélées fausses).

## 3. Achat/activation : RÉEL vs SIMULÉ vs AUCUN

Vérification faite en Stripe TEST (lecture des abonnements par prix, statut `all`) :
- **0 abonnement**, tous statuts, sur les 8 prix « replacement » (gbpPerformanceLeads, localPresenceOptimizer, localLandingOpportunities, conversionOpportunityEngine, seoChangeImpact, agencyPortfolioPriorities, technicalSeoFixVerification, organicCampaignTracker) et sur les 3 prix `[CERT]`.
- **11 abonnements** sur le prix Agency Packs TEST, créés les 8 et 9 novembre 2026 (premier 19:14 UTC le 8/11, dernier 16:26 UTC le 9/11), tous `canceled` quelques secondes après création, `metadata.source=checkout_payment_addons`, `addons={"agencyPacks":1}`, plan `standard`, essai (`trial_end` ≈ +30 j), carte de test, aucune facture payée. Origine : runner `certify-addons.mjs --combined-checkout-agency` / `--checkout-abandonment` (PR #408/#409/#349) contre un serveur **local isolé** avec Stripe TEST réel et base jetable. Les webhooks étaient signés localement et rejoués contre ce serveur local, pas livrés par Stripe à `flowpoint-test`.
- Plans Standard/Pro/Ultra : réels sur `flowpoint-test` le 13/11 (docs `CERTIFICATION-STRIPE-TEST-E2E-2026-11-13.md`), hors périmètre add-ons.

| Add-on | Achat/activation | Détail |
|---|---|---|
| agencyPacks | **RÉEL partiel** | création d'abonnement + annulation réels (11, 8–9/11) via serveur local ; **pas** de webhook Stripe réel vers une instance déployée, **pas** de renouvellement/prélèvement, activation côté entitlement simulée (webhook signé local) |
| Les 23 autres | **AUCUN réel** | simulé seulement (vitest `addon-stripe-sync`, `stripe-webhook-addon-reconcile`, `addons-provisioning`, parcours Playwright sur fixtures). 12 d'entre eux n'ont même pas de prix TEST |

## 4. Matrice exhaustive

Colonnes : **(1)** fonctionnalité · **(2)** prix TEST (cf. §2) · **(3)** achat réel · **(4)** droits/quotas/isolation (tests) · **(5)** renouvellement/annulation · **(6)** tests et navigateur · **(7)** production et compatibilité · **Classe**.

Éléments communs aux colonnes (4) et (5) : garde serveur `requireAddon(<clé>)` sur chaque route de l'add-on (`middlewares/planGate.ts`) ; entitlement `org_addons`/`organizations.addons` ; quotas et isolation par organisation testés add-on par add-on (nombres ci-dessous) ; annulation/désactivation : `POST /addons/:key/deactivate` (propriétaire) + webhooks `customer.subscription.updated|deleted`, `invoice.payment_failed` → retrait des droits, données conservées ; prouvé **par simulation uniquement** (`addon-stripe-sync.test.ts`, `stripe-webhook-addon-reconcile.test.ts`, `stripe-webhook-past-due-db.test.ts`, scénarios `ADDON_E2E_SCENARIOS.md` qui précise lui-même ne pas être une preuve navigateur). Seul l'abandon/annulation d'Agency Packs a été observé réellement (annulation de l'abonnement côté Stripe, §3).

Rejeu navigateur isolé du 17/11 (arbre intégré @ `6437e0b3`, branche `claude/matrice-rejeu-navigateur`, commit `40d1d57a`) : 10 modules validés ; 4 instables (déjà instables sans l'intégration : témoin Test-Replit) ; Agency Packs 1 timeout isolé ; 7 sans parcours navigateur. **PR #493 (fusionnée le 17/11 21:28 UTC, `cdb2c28b`)** corrige la cause identifiée des 4 instabilités (rendu d'arrière-plan qui écrasait la saisie) avec 3 tests de régression déterministes ; typecheck OK, 715/715 vitest dashboard. **Stabilité 30/30 des parcours réglages : chiffre communiqué par le coordinateur, non retrouvé dans le dépôt** (aucun commentaire sur #493 ; la PR annonçait « 10x » à venir) — ne pas le citer comme preuve du dépôt tant qu'il n'est pas consigné. Le rejeu complet des modules corrigés n'a pas été refait ici.

| # | Add-on | (1) Fonction | (3) Achat | (4)/(5) Droits, quotas, annulation | (6) Tests / navigateur | (7) Prod, compat. | Classe |
|---:|---|---|---|---|---|---|---|
| 1 | AI GBP Posting | oui : routes `gbp-posts`, génération IA, approbation, calendrier ; publication exige un id Google ; Google simulé | AUCUN | 51 tests/7 fichiers, gate réelle, quota emplacements, isolation org | navigateur 17/11 **validé** ; pas de Google réel | prod : présent, beta, vendable (29 €). TR : `VALIDATION_REQUIRED` → coming_soon (retrait de vente) ; prix catalogue 29→12 ; routes +120/-26. **Compat : non** | BLOCKED : achat réel manquant ; prix TEST absent ; dérive de prix |
| 2 | Behavioral AI | oui : snippet consenti, ingestion attestée, agrégats ; repli règles | AUCUN | 26 tests/4 fichiers ; gate | **aucun parcours navigateur** ; site réel non certifié | prod : beta vendable (44 €) ; TR coming_soon. `behavioral.ts` +202/-20, service +427/-42. **non** | BLOCKED : prix TEST absent, achat réel, parcours navigateur |
| 3 | Revenue Leak AI | partielle→oui : opportunités observées, pas de perte inventée | AUCUN | 4 tests + attribution ; gate | navigateur 17/11 **validé** | prod : beta vendable (29 €) ; TR coming_soon. routes +180/-16. **non** | BLOCKED : prix TEST absent, achat réel, source de revenus réelle |
| 4 | AI Executive Reporting | oui, périmètre réduit annoncé (à la demande, sans e-mail/Slack/planning) | AUCUN | 3 + `agency-packs` ; gate dans `reports.ts` | **aucun parcours navigateur** | prod : coming_soon ; `reports.ts` +557/-31. **non** | BLOCKED : prix TEST absent, achat, navigateur |
| 5 | AI Forecasting Engine | oui : « données insuffisantes » honnête, id haché corrigé | AUCUN | 29 tests/6 fichiers dont table réelle, 2 orgs | navigateur 17/11 **validé** ; GA4 réel absent | prod : beta vendable (39 €) ; TR coming_soon. service +194/-55. **non** | BLOCKED : prix TEST absent, achat réel, GA4 réel |
| 6 | AI Market Intelligence | oui (GSC + classements) ; 503 explicite ; **titres de rapports persistés en français** | AUCUN | 15 tests ; isolation, rôles | **aucun parcours navigateur** | prod : beta vendable (49 €) ; TR coming_soon. **non** | BLOCKED : défaut i18n, prix TEST absent, achat, navigateur, DataForSEO réel |
| 7 | CRM Integrations | **partielle** : HubSpot seul ; 7 autres fournisseurs 501 ; contacts seulement, pas de planificateur ; aucune connexion réelle | AUCUN | 35 + 8 tests ; OAuth chiffré, quota | **aucun parcours navigateur** | prod : coming_soon ; crm.ts +151/-47, `services/crm/*` nouveaux. **non** | **INCOMPLETE** (+ prix TEST absent) |
| 8 | Keyword Domination Engine | oui ; fuite inter-orgs corrigée | AUCUN (prix `[CERT]` sans abonnement) | 12 tests ; garde anti-exemples | **aucun parcours navigateur** ; DataForSEO réel absent | prod : `available` (vendable, 39 €), service **absent** en prod, UI minimale (1 occurrence) ; keywords.ts +218/-61. **non** | BLOCKED : achat réel, navigateur, prix de production à valider |
| 9 | Advanced SEO Lab | oui ; paramètres obligatoires, plus d'exemples substitués | AUCUN | 69 tests/8 fichiers ; quotas isolés | navigateur 17/11 **validé** ; DFS interceptée | prod : `available` (29 €) ; `seo.ts` +287/-114. **non** | BLOCKED : achat réel, DFS réel |
| 10 | Global Monitoring | oui fail-closed (503 sans Better Stack), résumé des régions configurées seulement | AUCUN | 66 tests/5 fichiers | 17/11 **instable** → #493 ; Better Stack QA non autorisé | prod : coming_soon, `global-monitoring.ts` absent ; prix catalogue 49→15. **non** | BLOCKED : prix TEST absent, achat, monitor QA réel, rejeu après #493 |
| 11 | SLA Monitoring Avancé | partielle assumée : disponibilité, cibles, CSV ; aucune alerte automatique | AUCUN | 1 test ciblé + gate route | **aucun parcours navigateur** | prod : coming_soon ; betterstack +199/-38. **non** | BLOCKED : couverture de tests faible (1 fichier), prix TEST absent, achat, navigateur |
| 12 | AI CRO Strategist | oui, observations réelles, repli IA | AUCUN | 17 tests, rôles owner/viewer | navigateur 17/11 **validé** | prod : beta vendable (34 €) ; TR coming_soon. cro-service +327/-228. **non** | BLOCKED : prix TEST absent, achat, IA réelle |
| 13 | AI Workspace Launch | oui ; rapports planifiés exigent aussi `aiWorkflows` (**clé retirée**, donc non achetable) et sont désactivés par défaut en prod | AUCUN | 34 tests/5 fichiers | navigateur 17/11 **validé** | prod : coming_soon, sans gate `requireAddon` ; prix 49→15. **non** | BLOCKED : prix TEST absent, achat, incohérence planification/`aiWorkflows` |
| 14 | SEO Content Decay Radar | oui (`content-decay*`) ; **renommage** de `aiContentStrategist` (« AI Content Strategist » 34 € en prod) | AUCUN | 13 tests | E2E local 9/11 ; **aucun parcours navigateur au registre** | prod : coming_soon, produit différent ; 34→12. **non** | BLOCKED : changement de nature du produit sous la même clé, prix TEST absent, achat |
| 15 | Backlink Intelligence | oui : 503 `BACKLINK_DATA_UNAVAILABLE`, quota remboursé | AUCUN | 10 tests + E2E | navigateur 17/11 **validé** ; DFS réel absent | prod : beta vendable (24 €) ; seo.ts. **non** | BLOCKED : achat réel, DFS réel |
| 16 | Agency Reporting Packs | oui : packs persistés, PDF, portail, cron, quota/viewer | **RÉEL partiel** (§3) | 28 tests ciblés + 5 E2E (9/11), cron 10/11 ; signature invalide 400 | 17/11 : 1 timeout `selectOption` isolé non reproduit (3/3 témoin) | prod : coming_soon ; 49→12 ; reports.ts +557/-31. **non** | BLOCKED : webhook réel + cycle/renouvellement manquants, instabilité isolée à clore |
| 17 | GBP Performance & Leads | oui | AUCUN | 9 tests | navigateur 17/11 **validé** ; GBP réel absent | prod : **absent** (catalogue, route, UI, prix LIVE `""`). **non** | BLOCKED : achat réel |
| 18 | Local Presence Optimizer | oui | AUCUN | preuve historique | navigateur 17/11 **validé** | prod : **absent**. **non** | BLOCKED : achat réel ; preuve unitaire historique non rejouée |
| 19 | Local Landing Opportunities | oui | AUCUN | preuve historique | navigateur 17/11 **validé** | prod : **absent**. **non** | BLOCKED : achat réel ; idem |
| 20 | Conversion Opportunity Engine | oui, réponse vide plutôt qu'opportunités fabriquées | AUCUN | 4 tests, isolation tenant | 17/11 **instable** → #493 + test régression | prod : **absent**. **non** | BLOCKED : achat réel, rejeu après #493 |
| 21 | SEO Change Impact | oui | AUCUN | 7 tests | 17/11 **instable** → #493 + test régression | prod : **absent**. **non** | BLOCKED : achat réel, rejeu après #493 |
| 22 | Agency Portfolio Priorities | oui | AUCUN | 6 tests | parcours commun 17/11 **instable** → #493 | prod : **absent**. **non** | BLOCKED : achat réel, rejeu, variable Render |
| 23 | Technical SEO Fix Verification | oui | AUCUN | 6 tests | idem 22 | prod : **absent**. **non** | BLOCKED : idem |
| 24 | Organic Campaign Tracker | oui | AUCUN | 6 tests | idem 22 | prod : **absent**. **non** | BLOCKED : achat réel, rejeu |

Colonne « compatible Flowpoint sans changement backend » : **non pour les 24**. Motifs : 8 add-ons n'existent pas en production (routes, services, catalogue, UI) ; les 16 autres ont des fichiers backend propres qui diffèrent (deltas ci-dessus) et dépendent de `lib/plans.ts` (+456/-111), `lib/addon-guard`, `planGate` (+28/-6), `billing-service` (+99/-48), `public-billing` (+646/-717, où vit le panier add-ons de l'inscription), `routes/addons` (+51/-19). 810 fichiers diffèrent au total entre les deux branches (dont 295 de backend selon le cadrage de départ). Le pré-enregistrement passe de 8 champs (Flowpoint) à 3 (Test-Replit) : l'achat d'add-ons à l'inscription n'est pas transposable sans ce backend.

## 5. Production (lectures strictement agrégées, sans donnée personnelle)

- Projet « Flowpoint project » : requête agrégée sur `organizations.addons` : **aucune organisation n'a un add-on actif** (0 ligne par clé). Aucun client n'est donc impacté par un changement de catalogue.
- Code `Flowpoint` : vendables aujourd'hui (selon `getAddonAvailability`) : beta = behavioralAI, revenueLeak, aiCro, aiForecasting, marketIntelligence, aiGbpPosting, backlinkIntelligence ; available = keywordDomination, advancedSeoLab. coming_soon = slaMonitoring, globalMonitoring, aiContentStrategist, agencyPacks, aiExecutiveReport, crmIntegration, aiWorkspaceLaunch. Absents : les 8 add-ons de remplacement (prix LIVE codé `""`, « volontairement non assigné »).
- **Régression à éviter** : fusionner `plans.ts` de Test-Replit rendrait coming_soon des add-ons aujourd'hui vendables en production (behavioralAI, revenueLeak, aiCro, aiForecasting, marketIntelligence, aiGbpPosting) — comportement voulu par les audits d'honnêteté, mais c'est un retrait de vente à décider, pas un effet de bord.
- **Dérive de prix de catalogue Test-Replit vs production** (affichage ; les montants LIVE réellement encaissés ne sont pas lisibles sans accès LIVE) : aiGbpPosting 29→12, globalMonitoring 49→15, aiWorkspaceLaunch 49→15, aiContentStrategist 34→12 (produit renommé), agencyPacks 49→12. Règle : **aucun prix ne change dans un PR de publication** ; ces 5 écarts doivent être tranchés par le propriétaire (et alignés sur les prix LIVE réels) avant toute reprise de `ADDON_DEFINITIONS`.
- `retiredAddonKeys` : n'existe pas en production (`RETIRED_ADDONS` absent). Dans Test-Replit, aucun des 24 n'est retiré ; sont retirées gbpSlots10, reviewIntelligence, localDominationMaps, abTestingAI, aiWorkflows, enterprisePermissions, advancedWebhooks, zapierIntegration et les 4 packs de capacité.

## 6. Mécanisme de publication d'un add-on

Un add-on devient visible/vendable quand TOUT ceci est vrai (`artifacts/api-server/src/lib/plans.ts`) :
1. Entrée dans `ADDON_DEFINITIONS` (nom, catégorie, description, `priceEur` d'affichage) et dans `FLAG_ADDONS` ; le front lit le catalogue via `/api/plans` / `/api/addons` (`availability`, `status`, `comingSoon`, `retiredAddonKeys`).
2. Absent de `COMING_SOON_ADDONS`, de `VALIDATION_REQUIRED_ADDONS`, de `RETIRED_ADDONS`, `REMOVED_ADDONS` ; `BETA_ADDONS` = vendable mais étiqueté bêta.
3. Un prix **LIVE** non vide dans `ADDON_PRICE_IDS` (variable `STRIPE_PRICE_ID_*` ou id par défaut) — action Stripe LIVE hors portée de cette analyse. Sans prix, l'activation échoue.
4. `PLAN_ALLOWED_ADDONS` : calculé automatiquement pour tout add-on vendable (hors protégés/inclus seulement) ; `PLAN_INCLUDED_ADDONS` pour les inclus.
5. Routes montées derrière `requireAddon(<clé>)` et UI du dashboard (`dashboard.js`, 9 700 lignes ajoutées côté Test-Replit) : sans l'UI, l'add-on est vendu mais invisible.
6. En TEST seulement : `TEST_PURCHASABLE_ADDONS` ouvre un add-on dès qu'un prix TEST est configuré (jamais en LIVE).
7. Activation : `POST /addons/:key/activate` → `syncAddonWithStripe` (abonnement dédié `addonSub`) ; retrait : `deactivate` + webhooks.

### Contenu proposé d'un futur PR « publier uniquement les add-ons READY » (non préparé)
**Doit contenir** : pour chaque add-on READY uniquement, ses routes/services/tests propres ; son entrée catalogue **sans changer aucun prix existant** ; le retrait de sa clé de `COMING_SOON_ADDONS` ; son UI dashboard ; ses migrations (idempotentes, vérifiées sur base jetable) ; une analyse écrite de compatibilité (diff des fichiers partagés `plans.ts`, `planGate`, `billing-service`, `public-billing`).
**Ne doit PAS contenir** : changement de prix, de quota, d'abonnement existant ; reprise en bloc des 810 fichiers/du backend Test-Replit ; changement de disponibilité des add-ons non concernés (notamment les retraits de vente du §5) ; reprise du panier 3 champs ; clés/valeurs de secrets ; prix LIVE.
**Prérequis hors portée** : création des prix Stripe LIVE (un par add-on publié) ; variables Render production `STRIPE_PRICE_ID_*` ; vérification du webhook LIVE ; migrations appliquées sur la base de production après sauvegarde ; décision du propriétaire sur les 5 dérives de prix.

## 7. Procédure exacte des achats réels manquants (NON exécutée ; à lancer après accord, sans toucher les parcours en cours sur `flowpoint-test`)

Pré-requis : créneau convenu avec l'agent qui exécute des parcours Stripe TEST sur `flowpoint-test` ; organisation de test dédiée (e-mail `@flowpoint.test`, plan Pro ou Ultra de test) ; carte 4242 ; webhook TEST `…/api/webhooks/stripe` abonné.
A. **Prix manquants (12 add-ons)** — action Stripe TEST à autoriser : créer produit+prix mensuel EUR au montant du catalogue (§2), métadonnée `flowpoint_addon_key=<clé>`, `flowpoint_environment=render-test`, puis poser `STRIPE_TEST_PRICE_ID_ADDON_*` (nom en §2) sur Render. Confirmer aussi les variables SEOLA/KDE/BACKLINK/AGENCY_PORTFOLIO_PRIORITIES/TECHNICAL_SEO_FIX_VERIFICATION.
B. **Pour chaque add-on, un parcours** : (1) vérifier `/api/addons` : `availability` ≠ coming_soon, bon montant ; (2) `POST /addons/<clé>/activate` en propriétaire ; (3) Stripe : exactement 1 abonnement `addonSub`, bon prix, `livemode:false` ; (4) webhook : événement livré (`pending_webhooks:0`), `org_addons` actif, une seule fois après rejeu depuis le tableau de bord Stripe ; (5) navigateur : ouvrir la route de l'add-on, réaliser son parcours ; viewer refusé (403) ; (6) quota : dépasser puis constater le refus ; (7) `deactivate` : droits retirés, données conservées ; (8) `invoice.payment_failed` (carte 4000 0000 0000 0341) → retrait/état attendu ; (9) renouvellement : horloge de test Stripe, avancer d'un mois, facture payée ; (10) nettoyage : annuler seulement les abonnements créés par ce parcours.
C. **Ordre conseillé** (moindre risque d'abord) : agencyPacks (compléter webhook + renouvellement), organicCampaignTracker, technicalSeoFixVerification, agencyPortfolioPriorities, seoChangeImpact, conversionOpportunityEngine, localLandingOpportunities, localPresenceOptimizer, gbpPerformanceLeads, advancedSeoLab, keywordDomination, backlinkIntelligence ; puis les 12 add-ons après création de leur prix.
D. Avant B pour #10, #20–#24 : rejouer leurs parcours navigateur depuis `af43e406` (inclut #493) en base jetable, 10 fois consécutives, et consigner le résultat.

## 8. Estimation du travail restant
- 9 add-ons à prix TEST existant (hors CERT) : ~0,5 jour chacun d'achat réel + rejeu, soit ≈ 4–5 jours, plus 1 jour pour les 3 prix CERT.
- 12 add-ons sans prix TEST : création des prix (0,5 jour), puis ≈ 0,5–1 jour chacun, **plus** les certifications fournisseur déjà listées (DataForSEO, GA4/GSC, Better Stack, HubSpot, GBP, IA) qui conditionnent le sens commercial mais pas le classement READY tel que défini ici.
- CRM : travail de développement (autres fournisseurs, planificateur) avant toute certification.
- Publication : décisions de prix, prix LIVE, PR de compatibilité par groupe : 3–5 jours calendaires après les achats réels. Réaliste : 3 à 4 semaines pour un premier groupe de 8–9 add-ons.
