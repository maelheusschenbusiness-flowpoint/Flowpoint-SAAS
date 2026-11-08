# Matrice de suivi — add-ons bêta 2.0

Mise à jour : 8 novembre 2026. Cette matrice est la source de suivi unique des 24 modules.

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
| 9 | Advanced SEO Lab | — | Partiel | E2E post-fusion réussi — rôles et mission persistée | — | Oui — PR #352 et runner #351 intégrés | À confirmer | Le runner post-fusion sur 994e598 réussit 20 tests ciblés et l’E2E. DataForSEO restait non configuré; aucun appel réel ni certification fournisseur. |
| 10 | Global Monitoring | — | Partiel | E2E local fail-closed réussi — fournisseur absent | Non | Oui — socle seulement | Non | 18 tests ciblés et l’E2E fail-closed passent dans le runner post-fusion. Aucun appel Better Stack ni changement de monitor; aucun monitor QA autorisé identifié; achat coming_soon. |
| 11 | SLA Monitoring Avancé | — | Partiel | Non exécuté | — | Oui | À confirmer | Campagne du 6 novembre : 1 test ciblé réussi; les tests Better Stack précédents étaient simulés, données fournisseur réelles non vérifiées. |
| 12 | AI CRO Strategist | — | Partiel | Non exécuté | — | Oui | À confirmer | Campagne du 6 novembre : 19 tests ciblés réussis; aucune certification de fournisseur réel. |
| 13 | AI Workspace Launch | — | Partiel | E2E local réussi — stratégie persistée restaurée | — | Oui | À confirmer | 21 tests ciblés et l’E2E de restauration passent dans le runner post-fusion; données et IA de test seulement, aucun service externe certifié. |
| 14 | SEO Content Decay Radar | — | Présent | Non exécuté | — | Oui | À confirmer | Campagne du 6 novembre : 13 tests, dont PostgreSQL avec fixtures GSC synthétiques; connexion GSC réelle non vérifiée. |
| 15 | Backlink Intelligence | — | Partiel | E2E repassé sur branche de suivi test-only; intégration en attente | — | Oui — PR #358 intégrée | À confirmer | Sur 994e598, le premier runner a passé 20 vérifications sur 21; le seul échec venait de la synchronisation d’initialisation du test navigateur, après validation de la réponse API sans métriques. Le correctif E2E sans changement produit repasse (2 tests ciblés et E2E) sur la branche de suivi, mais n’est pas intégré. Aucun appel DataForSEO réel. |
| 16 | Agency Reporting Packs | — | Présent | E2E local réussi — création, persistance, quota et refus viewer vérifiés | Oui | Oui | Non — achat coming_soon | Certification complète locale sur PostgreSQL jetable : 10 tests ciblés et un E2E réussis. Vérifiés : persistance, quota sans insertion partielle et refus viewer en 403. PR #346 et #350 sont fusionnées; le runner post-fusion repasse. Achat coming_soon. |
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

- Total historique conservé : **8/24**. La certification Agency Reporting Packs et les nouveaux tests ne modifient ni ne recompteront l’attribution historique; les huit parcours n’ont pas été rejoués.
- Campagne `--pending` du 6 novembre (avant les fusions) : 150 tests ciblés unitaires/service/PostgreSQL réussis sur 15 modules et trois E2E locaux réussis (Agency Reporting Packs, Global Monitoring fail-closed, AI Workspace Launch). Les données étaient synthétiques; le code 2 venait de l’absence de tests ciblés Advanced SEO Lab à cette date. Ce résultat est distinct de la campagne post-fusion.
- Agency Reporting Packs : certification complète locale sur base jetable; PR #346 et #350 fusionnées dans l’ordre prévu. Le runner post-fusion confirme à nouveau 10 tests ciblés et l’E2E. L’achat reste `coming_soon`.
- Global Monitoring : le runner post-fusion passe 18 tests ciblés et l’E2E fail-closed lorsque le fournisseur est absent. Aucun appel Better Stack, aucun monitor créé ou modifié; aucun monitor QA autorisé identifié. La certification fournisseur et l’achat restent bloqués.
- Backlink Intelligence : PR #358 est fusionnée. Le premier runner sur la tête Test-Replit `994e598` a passé 20 vérifications sur 21; le seul échec était le test navigateur pendant la restauration du compte, après validation de l’API et de l’absence de métriques. Le correctif E2E test-only sur `beta2-backlink-e2e-fix-20261108` (commit `1ba0237`) a passé le test ciblé puis le runner combiné. Il n’est pas encore intégré à Test-Replit. Aucun appel DataForSEO réel.
- Runner post-fusion `--pending` : 16 add-ons non historiques, 170 tests Vitest sur 16 résumés de suite et cinq E2E; les 21 lignes de résultat passent. Exécution sur la branche de suivi au commit `1ba0237`, basée sur Test-Replit `994e598`; le seul écart de code est le test Backlink corrigé, sans changement produit. PostgreSQL était jetable; aucun secret fournisseur n’a été transmis et aucun appel DataForSEO/Better Stack n’a été fait.
- Fusions demandées réalisées dans l’ordre : #346 `5fe54ef` → #350 `9135be9` → #352 `404a76d` → #351 `1b55904` → #358 `994e598`. Tête Test-Replit : `994e5983e7f2c1f355d11a7d4946b41abd613dfb`. La CI finale #42473368436 (Types, build, tests) a réussi. Aucun déploiement ni changement Production, Stripe LIVE, DNS, abonnement client, monitor Better Stack ou protection GitHub.
- Étapes restantes : faire examiner le correctif E2E test-only, sans le fusionner sans autorisation; exécuter la procédure externe DataForSEO seulement avec organisation QA, domaine et budget explicitement autorisés; obtenir un monitor QA Better Stack préexistant et autorisé avant toute certification fournisseur. Aucun appel externe n’est lancé ici.

- Évaluation de mise en vente : aucun module n’est confirmé prêt à vendre sur les preuves actuelles. Agency Reporting Packs est certifié localement mais reste `coming_soon`; Global Monitoring n’a pas de monitor QA réel; Advanced SEO Lab et Backlink Intelligence n’ont pas de certification DataForSEO; les autres modules n’ont que des tests partiels/synthétiques. Les huit validations historiques ne sont pas une nouvelle preuve.