# Matrice d’audit i18n du dashboard privé

**Date de référence :** 27 octobre 2026
**Cible :** Test-Replit  
**PR :** #304 — `feature/dashboard-i18n-static-audit-20261026`  
**Portée :** textes d’interface écrits par l’application dans le dashboard privé. Les données client, les noms et valeurs métier, les messages d’équipe et les réponses ou contenus générés par les utilisateurs restent hors traduction.

## Statut et méthode

- L’inventaire ci-dessous provient de `PAGE_NAMES`, `SUB_NAVS` et du dispatch de `_doRender` dans le dashboard servi.
- Il recense 36 pages nommées, 34 structures de sous-navigation et 167 sous-routes (201 entrées de navigation en comptant les 34 entrées racines). Le dispatch comporte 47 cas : les pages nommées, trois routes d’add-on autonomes et huit alias/redirections.
- Les contrôles statiques ciblés vérifient les clés `fpT`/`t`, les libellés de statut, les toasts/dialogues natifs et le texte des templates HTML ainsi que les affectations DOM des sept scripts d’add-on suivis. Les audits statiques de Missions, Overview, Audits, Monitors, Reports, Local SEO, Growth, Competitors et Conversion sont terminés pour les surfaces recensées ci-dessous; l’inventaire exhaustif des autres pages du dashboard principal reste **EN COURS**. Les balayages heuristiques ne sont pas comptés comme des anomalies confirmées.
- La vérification navigateur des routes privées est **BLOCKED** : aucune session authentifiée n’est utilisée et aucun contournement d’authentification n’est autorisé.
- Cette matrice suit le statut de l’audit de l’interface en anglais. Elle ne certifie pas le rendu navigateur ni les autres langues.

## Bilan confirmé à cette étape

- Le décompte Missions est maintenant confirmé : **8 catégories, 73 cartes et 301 chaînes de champs distinctes** (titres, impacts, efforts, gains et étapes). **297** n’avaient pas encore de clé anglaise et sont maintenant couvertes; **4** étaient déjà dans le catalogue. La sous-page de recommandations IA contient **14 modèles** et son test vérifie **38 clés** de texte et de données dynamiques.
- Les tests ciblés rapportent **25 réussites sur 25**, dont **10 tests consacrés à Missions**, un test dédié à Growth et un à Conversion, un test couvrant Overview, Audits, Monitors, Reports et Competitors chacun, et trois tests couvrant les vues Local SEO. Aucune clé anglaise manquante dans les surfaces contrôlées. Les tests vérifient aussi que les valeurs de missions, d’audit, les catégories internes, les identifiants de statut et les événements restent inchangés.
- L’audit statique de Missions couvre maintenant la liste, le kanban, le calendrier, l’agenda, les vues filtrées, la bibliothèque, ses 301 valeurs, les recommandations IA, le formulaire manuel et le panneau de détail. Les contenus de bibliothèque et recommandations créés par l’application sont signalés comme templates; seuls les textes exacts reconnus sont traduits à l’affichage. Les données transmises et stockées restent brutes. Les missions manuelles ou anciennes sans provenance restent inchangées.
- Overview est audité sur la racine, Insights, Quick Wins et Checklist. Les libellés dynamiques des modules, filtres, catégories, gains, accomplissements, puces IA et éléments par défaut de checklist ont une couverture anglaise. Les assertions statiques confirment que les prompts IA, réponses IA, valeurs enregistrées des missions/checklists, messages d’activité et données client restent bruts; les navigateurs ne sont pas certifiés.
- Audits est audité sur la racine, Analysis, Compare, History et Opportunities, y compris les panneaux de détail et de nouvel audit, les états de chargement/vide/erreur, les filtres, l’historique et ses exports, les programmations, la sélection groupée, les actions groupées d’export/relance/archivage/suppression et leur confirmation, ainsi que la création de mission. Les labels sont traduits à l’affichage; les valeurs d’API, fréquences, URL, statuts et contenu fourni par l’IA restent inchangés.
- Monitors est audité sur la racine, Performance, Incidents, Configuration et SLA, avec les panneaux d’alerte email, de page de statut, d’endpoint et de maintenance, les canaux, les presets, les actions groupées, Better Stack et les états sans mesures. Les statuts, mesures, URL, noms de monitors, messages issus des événements et erreurs du serveur restent inchangés; la valeur email initiale et les endpoints de sauvegarde sont conservés.
- Reports est audité sur la racine et ses sept sous-pages, avec le formulaire de génération, les packs d’agence, les états sans données, les aperçus de rapports, les labels dynamiques et les menus d’action. Les noms et valeurs de rapport, champs de marque saisis, valeurs client, réponses IA réelles, statuts, formats, mesures et payloads d’API restent bruts; la navigation Reports est localisée sans modifier les identifiants de sous-route.
- Competitors est audité sur la racine et ses sept sous-pages dans la branche de production, avec la comparaison IA, les états sans données, les labels fournisseur et les actions de relance/suppression. Les métriques, domaines, noms, erreurs fournisseur, contenus d’analyses IA, opportunités et fonctionnalités restent inchangés; seul le marqueur « Non déterminé » app-authored est traduit. Le grand bloc de démonstration preview-only reste désactivé par `PREVIEW_MODE`.
- Local SEO est audité sur la racine, la grille géographique, la carte de concurrents, les zones, les opportunités GSC, les avis, GBP et la présence de fiche. Les formulaires, états de chargement/vide/erreur, filtres, modales et panneau de publication GBP sont couverts; les avis, noms, contenus générés, valeurs fournisseur et données synchronisées restent bruts.
- Growth est audité sur la racine, Projections, Objectifs et Mots-clés. Les branches conditionnelles et états asynchrones incluent l’absence de données de projection, les Quick Wins vides, les objectifs calculés et personnalisés, les états GSC de chargement/vide/erreur, les opportunités CTR et Content Decay, et la génération de recommandations IA. Les mots-clés, URL, métriques API, objectifs saisis, erreurs serveur et textes générés par l’IA restent inchangés; seuls les libellés et messages écrits par l’application sont localisés.
- Conversion est audité sur la racine, `funnel`, `ux-lab`, `cta`, `revenue-leak`, `cro`, le rendu Heatmap accessible et l’add-on autonome Conversion Opportunity Engine. Les états GA4 premium, chargement, découverte, déconnexion, absence de conversions, tableaux, erreurs/réessais, détection de fuites, expérimentations A/B, leurs invites/confirmations et les actions de création/résolution sont couverts statiquement. Les libellés du jeu de démonstration UX ne sont traduits qu’à l’affichage et uniquement dans la branche de repli preview. Les noms d’événements, chemins, sources, appareils, contenus CTA et variantes, réponses IA, erreurs serveur, valeurs numériques, identifiants de routes/statuts et données client restent inchangés; les catégories et libellés d’interface reconnus sont traduits. Les chiffres de démonstration existants n’ont pas été corrigés dans cet audit i18n.
- Le décompte global des anomalies restantes et des faux positifs est **non établi** : le balayage des templates du dashboard principal n’est pas encore exhaustif et ses candidats restent à classifier.

## Décomptes exacts par page à ce jalon

| Page | Comptage confirmé | Audit statique | Navigateur authentifié |
| --- | --- | --- | --- |
| `missions` | 8 catégories de bibliothèque · 73 cartes · 301 chaînes de champs distinctes (297 nouvelles clés anglaises, 4 déjà couvertes) · 14 modèles IA · 38 clés vérifiées sur la sous-page IA · 10 tests Missions | PASS — 0 clé manquante dans les surfaces contrôlées | BLOCKED |
| `overview` | Racine · `insights` · `quick-wins` · `checklist` · libellés statiques et dynamiques vérifiés | PASS — 0 clé manquante dans les surfaces contrôlées | BLOCKED |
| Toutes les autres pages recensées hors `overview`, `missions`, `audits`, `monitors`, `reports`, `local-seo`, `growth`, `competitor`, `conversion` et `conversion-opportunity-engine` | Non comptées à ce jalon; « non compté » ne signifie pas zéro anomalie. | EN COURS | BLOCKED |

## Inventaire des pages et sous-routes

`(racine)` désigne la vue principale de la page; les identifiants qui suivent correspondent aux sous-routes.

| Page / route | Sous-routes recensées | Audit statique des templates | Navigateur authentifié |
| --- | --- | --- | --- |
| `overview` | (racine), `insights`, `quick-wins`, `checklist` | PASS — détail ci-dessus | BLOCKED |
| `missions` | (racine), `todo`, `inprogress`, `done`, `ai` | PASS — comptage exact ci-dessus | BLOCKED |
| `audits` | (racine), `analysis`, `compare`, `history`, `opportunites` | PASS — vues, panneaux, états et interactions statiques vérifiés | BLOCKED |
| `monitors` | (racine), `performance`, `incidents`, `config`, `sla` | PASS — vues, panneaux, interactions et clés anglaises vérifiés | BLOCKED |
| `local-seo` | (racine), `map`, `competitors-map`, `zones`, `opportunities`, `reviews`, `gbp`, `presence` | PASS — vues routées, états, formulaires, modales et données dynamiques vérifiés | BLOCKED |
| `reports` | (racine), `exec`, `seo`, `monitoring`, `local`, `conversion`, `client`, `ai` | PASS — vues, formulaires, packs agence, valeurs dynamiques et actions vérifiés | BLOCKED |
| `team` | (racine), `chat`, `activity`, `files`, `performance` | EN COURS | BLOCKED |
| `growth` | (racine), `projections`, `objectives`, `keywords` | PASS — branches conditionnelles, états asynchrones, catalogue anglais et limites de données vérifiés statiquement | BLOCKED |
| `competitor` | (racine), `keywords`, `growth`, `backlinks`, `local`, `alerts`, `comparison` | PASS — branches de production, sous-navigation et données AI/fournisseur vérifiées | BLOCKED |
| `conversion` | (racine), `funnel`, `ux-lab`, `cta`, `revenue-leak`, `cro`, Heatmap accessible | PASS — vues, branches GA4, états vides/erreur, labels dynamiques, prompts/confirmations A/B, actions et limites des données client vérifiés statiquement | BLOCKED |
| `alerts-center` | (racine), `incidents`, `seo`, `performance`, `conversion`, `local`, `competitor`, `ai` | EN COURS | BLOCKED |
| `billing` | (racine), `plans`, `addons`, `usage`, `invoices`, `ai-strategist`, `enterprise` | PASS — catalogue des plans/add-ons, usage et crédits, factures, états de paiement, AI Strategist, Enterprise Lab, états dynamiques et limites des données client vérifiés statiquement | BLOCKED |
| `settings` | (racine), `workspace`, `team`, `security`, `alerts`, `automations`, `integrations`, `api`, `ai-config`, `data`, `localisation`, `sso` | EN COURS | BLOCKED |
| `ai` | (racine), `usage`, `intelligence`, `insights`, `actions`, `strategist` | EN COURS | BLOCKED |
| `activity-feed` | (racine), `team`, `seo`, `monitoring`, `ai`, `reports`, `competitor`, `ops` | EN COURS | BLOCKED |
| `analytics` | (racine), `realtime`, `pages`, `conversions`, `connect` | EN COURS | BLOCKED |
| `traffic` | (racine), `organic`, `paid`, `social`, `direct`, `anomalies` | EN COURS | BLOCKED |
| `funnels` | (racine), `goals`, `paths`, `dropoff` | EN COURS | BLOCKED |
| `audience` | (racine), `geo`, `devices`, `demographics` | EN COURS | BLOCKED |
| `campaigns` | (racine), `utm`, `roi`, `compare` | EN COURS | BLOCKED |
| `live` | (racine), `events`, `pages`, `geo` | EN COURS | BLOCKED |
| `data-explorer` | (racine), `traffic`, `behavior`, `dashboards`, `insights`, `forecast`, `export` | EN COURS | BLOCKED |
| `client-mode` | (racine), `dashboards`, `reporting`, `communication`, `onboarding`, `projects`, `analytics`, `agency` | EN COURS | BLOCKED |
| `performance` | (racine), `mobile`, `desktop`, `history`, `opportunities`, `ai` | EN COURS | BLOCKED |
| `core-web-vitals` | (racine), `lcp`, `cls`, `inp`, `ttfb`, `compare` | EN COURS | BLOCKED |
| `technical-audit` | (racine), `render-blocking`, `js-css`, `images`, `accessibility`, `seo`, `ai` | EN COURS | BLOCKED |
| `github-integration` | (racine), `repos`, `commits`, `ci-cd`, `security`, `config` | EN COURS | BLOCKED |
| `code-analysis` | (racine), `seo`, `performance`, `security`, `quality`, `ai` | EN COURS | BLOCKED |
| `deployments` | (racine), `releases`, `workflows`, `environments`, `history` | EN COURS | BLOCKED |
| `repository-health` | (racine), `seo`, `activity`, `collaboration`, `recommendations` | EN COURS | BLOCKED |
| `crm` | (racine), `connections`, `sync`, `logs`, `field-mapping` | EN COURS | BLOCKED |
| `market-intelligence` | (racine), `trends`, `opportunities`, `competitors`, `signals`, `reports` | EN COURS | BLOCKED |
| `permissions` | (racine), `matrix`, `audit` | EN COURS | BLOCKED |
| `search-console` | (racine), `keywords`, `pages`, `impressions`, `indexing`, `connect` | EN COURS | BLOCKED |
| `conversion-opportunity-engine` | Vue autonome, sans sous-navigation | PASS — labels, paramètres, états vides/erreur et valeurs GA4 vérifiés statiquement | BLOCKED |
| `seo-change-impact` | Vue autonome, sans sous-navigation | EN COURS | BLOCKED |

### Routes autonomes et alias du dispatch

| Cas de dispatch | Destination |
| --- | --- |
| `technical-seo-fix-verification` | Add-on autonome |
| `organic-campaign-tracker` | Add-on autonome |
| `agency-portfolio-priorities` | Add-on autonome |
| `automations` | `settings` / `automations` |
| `integrations` | `settings` / `integrations` |
| `addons` | `billing` / `addons` |
| `competitors` | `competitor` |
| `activity` | `activity-feed` |
| `alerts` | `alerts-center` |
| `keywords` | `growth` / `keywords` |
| `content` | `growth` |

## Matrice des états et surfaces

| Surface / état | Vérification statique | Vérification navigateur | Règle de protection |
| --- | --- | --- | --- |
| Navigation, titres, racines et sous-routes | EN COURS | BLOCKED | Les libellés d’interface sont traduisibles; les identifiants de route ne le sont pas. |
| Chargement, données absentes et intégrations non connectées | EN COURS | BLOCKED | Traduire les messages de l’application; ne pas inventer ni modifier de mesures client. |
| Données réelles, tableaux, filtres et pagination | EN COURS | BLOCKED | Traduire les libellés, pas les valeurs métier, noms, requêtes ou contenus fournis par les clients. |
| Erreurs, réessais, notifications, confirmations et dialogues | PARTIEL | BLOCKED | Les contrôles statiques couvrent actuellement les toasts/dialogues ciblés; le comportement navigateur reste à certifier. |
| Rôles, accès, droits, forfaits et abonnement annulé | EN COURS | BLOCKED | Ne changer aucun droit d’accès ni aucune règle de facturation. |
| Assistant IA : chargement, streaming, proposition, confirmation et erreur | EN COURS | BLOCKED | Traduire l’interface seulement; conserver les prompts, réponses et contenus générés. |
| Langue EN, restauration FR et changement de langue | EN COURS — revue du code source | BLOCKED | Toujours repartir de la source française canonique; ne pas transformer le contenu client. |
| Panneaux, modales, menus et DOM injecté hors de la page | EN COURS | BLOCKED | Vérifier les racines de traduction et le rétablissement de la source après changement de langue. |
| Bureau et mobile | NON TESTÉ | BLOCKED | Aucun état privé authentifié n’a été rendu dans un navigateur. |

## Suite de l’audit

La prochaine page à auditer est `billing`, puis `settings` et les autres pages encore marquées EN COURS. Pour chaque famille, confirmer les chaînes visibles et leurs branches conditionnelles à partir du code, classer les candidats heuristiques avant de les compter, ajouter les clés statiques exactes au catalogue et envelopper les fragments dynamiques avec `fpT()`. Aucun statut navigateur PASS ne sera attribué à une route privée sans contrôle authentifié autorisé; ces routes restent BLOCKED en attendant cette vérification.
