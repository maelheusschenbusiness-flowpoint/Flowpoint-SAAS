# Matrice de suivi — add-ons bêta 2.0

Mise à jour : 7 novembre 2026. Cette matrice est la source de suivi unique des 24 modules.

Le total historique **8/24** est attribué aux huit remplacements explicitement nommés dans le rapport d’audit archivé du 3 novembre 2026 (`docs/flowpoint-audit-status-2026-11-03.md`, commit `6c78d7d`, consulté dans l’historique Git local). Le rapport indique qu’ils avaient été validés selon une décision antérieure de l’utilisateur; les parcours n’ont pas été rejoués et aucun artefact E2E individuel n’y est joint. La colonne historique conserve cette attribution sans la présenter comme une nouvelle certification de cette session.

**Légende**
- **Développé** indique qu'une implémentation existe, pas qu'elle est prête à vendre.
- **Parcours navigateur local** ne compte que les essais exécutés sur la base jetable attestée. Une UI testée avec une réponse synthétique n'est pas une certification réelle.
- **Attribution historique 8/24** reproduit uniquement les huit modules nommés dans le rapport archivé ci-dessus; elle ne signifie pas que leurs tests ont été rejoués.
- **Certification complète actuelle** exige une preuve vérifiable couvrant les contrôles fonctionnels, permissions, quotas et intégrations applicables. `—` signifie qu’aucune nouvelle preuve complète n’a été produite dans cette session.
- **Intégré à Test-Replit** indique que le catalogue et du code associé sont présents sur la branche de base. Cela ne signifie ni que le module est complet ni que les changements locaux non fusionnés y sont présents.
- **Prêt pour bêta 2.0** reste `À confirmer` tant que la certification complète et la disponibilité prévue ne sont pas établies.

| # | Module | Attribution historique 8/24 | Développé | Parcours navigateur local | Certification complète actuelle | Intégré à Test-Replit | Prêt pour bêta 2.0 | État / preuve à suivre |
|---:|---|---|---|---|---|---|---|---|
| 1 | AI GBP Posting | — | Partiel | Non exécuté | — | Oui | À confirmer | Campagne du 6 novembre : 17 tests ciblés réussis; la publication reste simulée, aucun appel Google réel. |
| 2 | Behavioral AI | — | Partiel | Non exécuté | — | Oui | À confirmer | Campagne du 6 novembre : 10 tests service/session réussis sur des événements synthétiques; snippet et données d’un site réel non certifiés. |
| 3 | Revenue Leak AI | — | Partiel | Non exécuté | — | Oui | À confirmer | Campagne du 6 novembre : 4 tests de propriété et d’erreur réussis; détection sur des revenus observés non certifiée. |
| 4 | AI Executive Reporting | — | Partiel | Non exécuté | — | Oui | À confirmer | Campagne du 6 novembre : 3 tests ciblés réussis; planification, personnalisation et données externes restent à vérifier. |
| 5 | AI Forecasting Engine | — | Partiel | Non exécuté | — | Oui | À confirmer | Campagne du 6 novembre : 12 tests ciblés réussis; aucune donnée GA4 réelle utilisée. |
| 6 | AI Market Intelligence | — | Partiel | Non exécuté | — | Oui | À confirmer | Campagne du 6 novembre : 4 tests réussis sur des observations fournies; aucun fournisseur réel interrogé. |
| 7 | CRM Integrations | — | Partiel | Non exécuté | — | Oui | À confirmer | Campagne du 6 novembre : 11 tests réussis; ils confirment qu’aucune connexion ou synchronisation CRM réelle n’est revendiquée. |
| 8 | Keyword Domination Engine | — | Partiel | Non exécuté | — | Oui | À confirmer | Campagne du 6 novembre : 5 tests réussis sur des données de test; intégration de données réelles non certifiée. |
| 9 | Advanced SEO Lab | — | Partiel | E2E local réussi sur base jetable — réponses fournisseur synthétiques | Non | Oui | À confirmer | 20 tests ciblés sur 3 suites et 1 E2E, tous raccordés au runner bêta; quotas, rôles et accès add-on vérifiés, mission DataForSEO persistée puis rechargée. Sans fournisseur, l’API répond 503 DATAFORSEO_NOT_CONFIGURED; les réponses UI sont simulées. PR #352 ouverte, non fusionnée; l’intégration DataForSEO réelle et les claims semantic/gap/topical authority restent non vérifiés. |
| 10 | Global Monitoring | — | Partiel | E2E local fail-closed réussi — Better Stack absent | Non | Oui | Non | 18 tests ciblés sur 3 suites et 1 E2E le 7 novembre; endpoint 503/configured=false, sans métrique inventée. Le test PostgreSQL utilise un monitor synthétique; aucun monitor réel ni appel Better Stack n’a été créé ou modifié. Aucun monitor QA autorisé identifié; certification fournisseur et achat `coming_soon` restent bloqués. |
| 11 | SLA Monitoring Avancé | — | Partiel | Non exécuté | — | Oui | À confirmer | Campagne du 6 novembre : 1 test ciblé réussi; les tests Better Stack précédents étaient simulés, données fournisseur réelles non vérifiées. |
| 12 | AI CRO Strategist | — | Partiel | Non exécuté | — | Oui | À confirmer | Campagne du 6 novembre : 19 tests ciblés réussis; aucune certification de fournisseur réel. |
| 13 | AI Workspace Launch | — | Partiel | E2E local réussi — stratégie persistée restaurée | — | Oui | À confirmer | Campagne du 6 novembre : 21 tests ciblés et un E2E réussis; données et IA de test, pas de service externe certifié. |
| 14 | SEO Content Decay Radar | — | Présent | Non exécuté | — | Oui | À confirmer | Campagne du 6 novembre : 13 tests, dont PostgreSQL avec fixtures GSC synthétiques; connexion GSC réelle non vérifiée. |
| 15 | Backlink Intelligence | — | Partiel | Non exécuté | — | Oui | À confirmer | Campagne du 6 novembre : 2 tests de normalisation réussis; aucun appel DataForSEO réel. |
| 16 | Agency Reporting Packs | — | Présent | E2E local réussi — création, persistance, quota et refus viewer vérifiés | Oui | Non | Non — PR #346 ouverte | Une certification complète locale sur base PostgreSQL jetable : 10 tests ciblés et un E2E réussis; le formulaire et l’audit restent sélectionnés après un GET `/api/reports` forcé, quota refusé sans insertion partielle, viewer refusé en 403. La PR #346 reste ouverte et non fusionnée; l’achat reste `coming_soon`. |
| 17 | GBP Performance & Leads | Oui | Présent | 9 tests API/service antérieurs; pas de navigateur ni compte Google réel | — | Oui | À confirmer | La PR #347 a fusionné la réparation idempotente du schéma vers Test-Replit; cela ne certifie ni une synchronisation Google réelle ni de nouvelles données GBP. |
| 18 | Local Presence Optimizer | Oui | Présent | Non relancé | — | Oui | À confirmer | Validation historique selon la source citée; certification non rejouée. |
| 19 | Local Landing Opportunities | Oui | Présent | Non relancé | — | Oui | À confirmer | Validation historique selon la source citée; certification non rejouée. |
| 20 | Conversion Opportunity Engine | Oui | Présent | Non relancé | — | Oui | À confirmer | Validation historique selon la source citée; certification non rejouée. |
| 21 | SEO Change Impact | Oui | Présent | Non relancé | — | Oui | À confirmer | Validation historique selon la source citée; certification non rejouée. |
| 22 | Agency Portfolio Priorities | Oui | Présent | Non relancé | — | Oui | À confirmer | Validation historique selon la source citée; certification non rejouée. |
| 23 | Technical SEO Fix Verification | Oui | Présent | Non relancé | — | Oui | À confirmer | Validation historique selon la source citée; certification non rejouée. |
| 24 | Organic Campaign Tracker | Oui | Présent | Non relancé | — | Oui | À confirmer | Validation historique selon la source citée; certification non rejouée. |

## Attribution historique des huit validations

Le rapport archivé du 3 novembre nomme exactement les huit remplacements marqués `Oui` dans la matrice : GBP Performance & Leads, Local Presence Optimizer, Local Landing Opportunities, Conversion Opportunity Engine, SEO Change Impact, Agency Portfolio Priorities, Technical SEO Fix Verification et Organic Campaign Tracker. Il précise que cette validation antérieure n’a pas été rejouée et que le catalogue/test de code ne la remplace pas. La nouvelle certification locale Agency Reporting Packs et les tests synthétiques Global Monitoring ne changent pas le total historique **8/24**.

## Résultat de cette mise à jour

- Total historique inchangé : **8/24**. Les essais Advanced SEO Lab et Global Monitoring ajoutent des preuves locales, mais pas de certification complète fournisseur; aucun scénario Playwright n’est compté comme un add-on à lui seul.
- Campagne `--pending` du 6 novembre : 150 tests ciblés unitaires/service/PostgreSQL réussis sur 15 modules et trois E2E locaux; elle reste une trace historique et non 150 certifications. Le 7 novembre, la certification locale Advanced SEO Lab a passé 20 tests ciblés sur 3 suites et 1 E2E; Global Monitoring a passé 18 tests ciblés sur 3 suites et 1 E2E. Ces 38 tests et deux E2E utilisent une base jetable et des réponses synthétiques, sans appel fournisseur réel.
- Agency Reporting Packs : base PostgreSQL locale jetable attestée; création et persistance des trois rapports, conservation du formulaire après rechargement forcé, quota sans insertion partielle et refus viewer en 403 vérifiés. Une seule certification complète est revendiquée. Achat `coming_soon` maintenu jusqu’à intégration; la PR #346 reste ouverte et non fusionnée.
- Global Monitoring : la reprise du 7 novembre confirme 18 tests ciblés et un E2E local avec Better Stack absent; l’API renvoie 503/configured=false et l’interface n’affiche aucune métrique inventée. Les données de monitor sont synthétiques dans le test PostgreSQL; aucun appel Better Stack ni changement de monitor réel. Aucun monitor QA autorisé identifié, donc la certification fournisseur et l’achat restent bloqués.
- Advanced SEO Lab : le 7 novembre, 20 tests ciblés et 1 E2E local sur PostgreSQL jetable ont vérifié les accès, quotas et la création/relecture d’une mission. La réponse de génération est synthétique; l’API réelle renvoie 503 DATAFORSEO_NOT_CONFIGURED quand le fournisseur est absent. Aucun appel DataForSEO réel; la certification fournisseur reste à faire. Les claims de couverture sémantique, gap analysis et topical authority ne sont pas démontrés par ces tests.
- AI Workspace Launch a aussi un E2E local de restauration de stratégie persistée. Les autres modules ont les nombres de tests ciblés indiqués dans leurs lignes; aucune certification n’est revendiquée pour eux.
- Aucune modification Production, Stripe LIVE, DNS, monitor Better Stack ou protection GitHub n’a été effectuée. Les PR #346, #351 et #352 restent ouvertes; aucune fusion n’a été effectuée.
- Étapes restantes : valider l’intégration Advanced SEO Lab avec un compte DataForSEO de test autorisé avant toute certification fournisseur; revoir les claims commerciaux non démontrés; obtenir un monitor QA préexistant et autorisé avant toute certification Global Monitoring. Rejouer le runner `--pending` après intégration de la suite Advanced SEO Lab à son registre; garder les huit validations historiques inchangées.
