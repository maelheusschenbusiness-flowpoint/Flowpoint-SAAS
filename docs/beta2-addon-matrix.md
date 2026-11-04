# Matrice de suivi — add-ons bêta 2.0

Mise à jour : 4 novembre 2026. Cette matrice est la source de suivi unique des 24 modules.

Le total historique **8/24** est attribué aux huit remplacements explicitement nommés dans le [rapport d’audit du 3 novembre 2026, commit `6c78d7d`](https://github.com/maelheusschenbusiness-flowpoint/Flowpoint-SAAS/blob/6c78d7dd37a43f611a6ed85b6526a3c1b0db7682/docs/flowpoint-audit-status-2026-11-03.md). Ce rapport indique qu’ils avaient été validés selon une décision antérieure de l’utilisateur; les parcours n’ont pas été rejoués et aucun artefact E2E individuel n’y est joint. La colonne historique conserve cette attribution sans la présenter comme une nouvelle certification de cette session.

**Légende**
- **Développé** indique qu'une implémentation existe, pas qu'elle est prête à vendre.
- **Parcours navigateur local** ne compte que les essais exécutés sur la base jetable attestée. Une UI testée avec une réponse synthétique n'est pas une certification réelle.
- **Attribution historique 8/24** reproduit uniquement les huit modules nommés dans le rapport cité ci-dessus; elle ne signifie pas que leurs tests ont été rejoués.
- **Certification complète actuelle** exige une preuve vérifiable couvrant les contrôles fonctionnels, permissions, quotas et intégrations applicables. `—` signifie qu’aucune nouvelle preuve complète n’a été produite dans cette session.
- **Intégré à Test-Replit** indique que le catalogue et du code associé sont présents sur la branche de base. Cela ne signifie ni que le module est complet ni que les changements locaux non fusionnés y sont présents.
- **Prêt pour bêta 2.0** reste `À confirmer` tant que la certification complète et la disponibilité prévue ne sont pas établies.

| # | Module | Attribution historique 8/24 | Développé | Parcours navigateur local | Certification complète actuelle | Intégré à Test-Replit | Prêt pour bêta 2.0 | État / preuve à suivre |
|---:|---|---|---|---|---|---|---|---|
| 1 | AI GBP Posting | — | Partiel | Non relancé | — | Oui | À confirmer | Publication Google réelle non certifiée. |
| 2 | Behavioral AI | — | Partiel | Non relancé | — | Oui | À confirmer | Ne pas assimiler les données synthétiques à une validation sur données réelles. |
| 3 | Revenue Leak AI | — | Partiel | Non relancé | — | Oui | À confirmer | Les estimations doivent rester fondées sur des données observées. |
| 4 | AI Executive Reporting | — | Partiel | Non relancé | — | Oui | À confirmer | Personnalisation et planification à vérifier. |
| 5 | AI Forecasting Engine | — | Partiel | Non relancé | — | Oui | À confirmer | Parcours et données réelles à certifier. |
| 6 | AI Market Intelligence | — | Partiel | Non relancé | — | Oui | À confirmer | Source et actualité des données concurrentielles à certifier. |
| 7 | CRM Integrations | — | Partiel | Non relancé | — | Oui | À confirmer | Connexion et synchronisation CRM réelles à valider. |
| 8 | Keyword Domination Engine | — | Partiel | Non relancé | — | Oui | À confirmer | Différenciation et parcours complet à vérifier. |
| 9 | Advanced SEO Lab | — | Partiel | Non relancé | — | Oui | À confirmer | Fonctionnalités ciblées à certifier sans relancer les anciens add-ons hors périmètre. |
| 10 | Global Monitoring | — | Partiel | UI synthétique seulement — non compté | Non | Oui | Non | Inventaire Better Stack lu le 4 novembre : 1 monitor, aucun candidat explicitement QA/test/synthétique. Aucun propriétaire QA vérifiable; certification bloquée. |
| 11 | SLA Monitoring Avancé | — | Partiel | Non relancé | — | Oui | À confirmer | Contrôles SLA réels à rattacher à une preuve. |
| 12 | AI CRO Strategist | — | Partiel | Non relancé | — | Oui | À confirmer | Mesures et recommandations réelles à vérifier. |
| 13 | AI Workspace Launch | — | Partiel | Non relancé | — | Oui | À confirmer | Parcours complet et effets persistés à certifier. |
| 14 | SEO Content Decay Radar | — | Présent | Non relancé | — | Oui | À confirmer | Certification antérieure non répétée conformément à la consigne. |
| 15 | Backlink Intelligence | — | Partiel | Non relancé | — | Oui | À confirmer | Qualité et provenance des données à certifier. |
| 16 | Agency Reporting Packs | — | Partiel | Réussi — création, quota et refus viewer | Non | Oui — version de base; correctifs locaux en attente de PR | Non | API : audit appartenant à l'organisation obligatoire; pack atomique de trois rapports. Unit tests : 9 réussis. E2E local : 1 scénario réussi. CI #346 a révélé un fixture sans audit et deux assertions de traduction; corrections préparées, nouveau résultat CI requis. L'achat reste `coming_soon`. |
| 17 | GBP Performance & Leads | Oui | Présent | 9 tests API/service réussis; pas de navigateur ni compte Google réel | — | Oui | À confirmer | Le fallback GBP avec valeurs d’aperçu a été retiré; le panneau réel reste alimenté par l’API. Aucune nouvelle certification complète ni donnée Google réelle revendiquée. |
| 18 | Local Presence Optimizer | Oui | Présent | Non relancé | — | Oui | À confirmer | Validation historique selon la source citée; certification non rejouée. |
| 19 | Local Landing Opportunities | Oui | Présent | Non relancé | — | Oui | À confirmer | Validation historique selon la source citée; certification non rejouée. |
| 20 | Conversion Opportunity Engine | Oui | Présent | Non relancé | — | Oui | À confirmer | Validation historique selon la source citée; certification non rejouée. |
| 21 | SEO Change Impact | Oui | Présent | Non relancé | — | Oui | À confirmer | Validation historique selon la source citée; certification non rejouée. |
| 22 | Agency Portfolio Priorities | Oui | Présent | Non relancé | — | Oui | À confirmer | Validation historique selon la source citée; certification non rejouée. |
| 23 | Technical SEO Fix Verification | Oui | Présent | Non relancé | — | Oui | À confirmer | Validation historique selon la source citée; certification non rejouée. |
| 24 | Organic Campaign Tracker | Oui | Présent | Non relancé | — | Oui | À confirmer | Validation historique selon la source citée; certification non rejouée. |

## Attribution historique des huit validations

Le rapport archivé du 3 novembre nomme exactement les huit remplacements marqués `Oui` dans la matrice : GBP Performance & Leads, Local Presence Optimizer, Local Landing Opportunities, Conversion Opportunity Engine, SEO Change Impact, Agency Portfolio Priorities, Technical SEO Fix Verification et Organic Campaign Tracker. Il précise que cette validation antérieure n’a pas été rejouée et que le catalogue/test de code ne la remplace pas. Les nouveaux parcours Agency Reporting Packs et les tests synthétiques Global Monitoring ne sont pas ajoutés à ce total.

## Résultat de cette mise à jour

- Total conservé : **8/24 certifiés historiquement**, attribués aux huit lignes marquées `Oui`; aucune certification nouvelle ni double comptage.
- Agency Reporting Packs : parcours local réussi; pas encore certifié complètement et toujours indisponible à l'achat.
- GBP Performance & Leads : 9 tests API/service ciblés réussis; les valeurs d’aperçu inventées ne sont plus affichées en absence de données GBP réelles.
- Global Monitoring : aucune ressource QA autorisée identifiée; procédure de création en QA préparée séparément, sans création externe.
- La branche courante contient les correctifs Agency Packs et la mise à jour de cette matrice; rien n'est fusionné.
- Prochaine priorité après cette PR : **GBP Performance & Leads**, sur une branche/PR isolée.
