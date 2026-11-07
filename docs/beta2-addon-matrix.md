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
| 9 | Advanced SEO Lab | — | Partiel | E2E local réussi — droits et mission persistée | — | Oui | À confirmer | PR #352 rapporte 20 tests ciblés et un E2E sur base jetable; accès, audit, persistance et rechargement vérifiés avec fournisseur simulé. DataForSEO non configuré; aucun appel réel ni certification fournisseur. Le runner de PR #351 référence déjà ces tests; intégrer #352 avant #351. |
| 10 | Global Monitoring | — | Partiel | E2E local fail-closed réussi — données fournisseur absentes | Non | Oui | Non | Campagne du 6 novembre : 18 tests ciblés et un E2E réussis; l’API renvoie 503/configured=false sans métrique fabriquée. Aucun monitor QA autorisé identifié; certification réelle bloquée et achat `coming_soon`. |
| 11 | SLA Monitoring Avancé | — | Partiel | Non exécuté | — | Oui | À confirmer | Campagne du 6 novembre : 1 test ciblé réussi; les tests Better Stack précédents étaient simulés, données fournisseur réelles non vérifiées. |
| 12 | AI CRO Strategist | — | Partiel | Non exécuté | — | Oui | À confirmer | Campagne du 6 novembre : 19 tests ciblés réussis; aucune certification de fournisseur réel. |
| 13 | AI Workspace Launch | — | Partiel | E2E local réussi — stratégie persistée restaurée | — | Oui | À confirmer | Campagne du 6 novembre : 21 tests ciblés et un E2E réussis; données et IA de test, pas de service externe certifié. |
| 14 | SEO Content Decay Radar | — | Présent | Non exécuté | — | Oui | À confirmer | Campagne du 6 novembre : 13 tests, dont PostgreSQL avec fixtures GSC synthétiques; connexion GSC réelle non vérifiée. |
| 15 | Backlink Intelligence | — | Partiel | E2E local réussi — accès direct et hydratation d’audit | — | Oui | À confirmer | 10 tests ciblés et un E2E réussis sur base jetable; la visite directe charge les audits sans ouvrir Audits, puis affiche l’absence de configuration DataForSEO sans métrique synthétique. PR #358 ouverte; aucun appel DataForSEO réel et aucune certification complète revendiquée. |
| 16 | Agency Reporting Packs | — | Présent | E2E local réussi — création, persistance, quota et refus viewer vérifiés | Oui | Non | Non — PR #346 / #350 ouvertes | Une certification complète locale sur base PostgreSQL jetable : 10 tests ciblés et un E2E réussis; le formulaire et l’audit restent sélectionnés après un GET `/api/reports` forcé, quota refusé sans insertion partielle, viewer refusé en 403. PR #346 est limitée à l’API et ses tests; l’UI et les changements dashboard sont isolés dans #350. Aucune fusion; achat `coming_soon`. |
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

- Total historique conservé : **8/24**. Une certification complète locale supplémentaire est produite pour Agency Reporting Packs, sans modifier ni recompter l’attribution historique. Aucun scénario Playwright n’est compté comme un add-on à lui seul.
- Campagne `--pending` du 6 novembre : 150 tests ciblés unitaires/service/PostgreSQL réussis sur 15 modules; trois E2E locaux réussis (Agency Reporting Packs, Global Monitoring en mode fail-closed, AI Workspace Launch). Les tests utilisent des données synthétiques et ne constituent pas 150 certifications. La commande termine avec le code 2 car Advanced SEO Lab n’a aucun test ciblé.
- Agency Reporting Packs : base PostgreSQL locale jetable attestée; création et persistance des trois rapports, conservation du formulaire après rechargement forcé, quota sans insertion partielle et refus viewer en 403 vérifiés. Une seule certification complète est revendiquée. L’API est isolée dans la PR #346; l’UI et les autres changements dashboard sont dans #350. Achat `coming_soon`; aucune fusion.
- Global Monitoring : 18 tests ciblés et un E2E local réussis avec les identifiants fournisseur absents de l’environnement de test; l’API renvoie 503/configured=false et l’interface n’affiche aucune métrique inventée. Aucun appel Better Stack ni changement de monitor; aucun monitor QA autorisé identifié, donc la certification fournisseur et l’achat restent bloqués.
- Backlink Intelligence : 10 tests ciblés et un E2E local réussis le 7 novembre sur base jetable; parcours direct et hydratation d’audit vérifiés. DataForSEO est absent et aucun appel réel n’a été lancé. PR dédiée #358 ouverte; cela ne constitue pas une certification DataForSEO.
- AI Workspace Launch a aussi un E2E local de restauration de stratégie persistée. Advanced SEO Lab : la PR #352 rapporte 20 tests ciblés et un E2E local réussi; le fournisseur était simulé ou non configuré, aucun appel DataForSEO réel n’a été fait. Le runner de la PR #351 référence déjà ces tests; son exécution combinée n’a pas été rejouée ici. Intégrer #352 avant #351 pour fournir tous les fichiers. Aucun certificat complet fournisseur supplémentaire n’est revendiqué.
- Aucune modification Production, Stripe LIVE, DNS, monitor Better Stack ou protection GitHub n’a été effectuée. Les PR #346, #350, #351, #352 et #358 restent ouvertes; aucune fusion n’a été effectuée.
- Étapes restantes : rejouer le runner combiné Advanced SEO Lab après intégration de #352 puis #351; obtenir un monitor QA préexistant et autorisé avant toute certification fournisseur Global Monitoring. Garder les huit validations historiques inchangées.
