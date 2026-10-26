# Matrice d’audit i18n du dashboard privé

**Date de référence :** 26 octobre 2026  
**Cible :** Test-Replit  
**PR :** #304 — `feature/dashboard-i18n-static-audit-20261026`  
**Portée :** textes d’interface écrits par l’application dans le dashboard privé. Les données client, les noms et valeurs métier, les messages d’équipe et les réponses ou contenus générés par les utilisateurs restent hors traduction.

## Statut et méthode

- L’inventaire ci-dessous provient de `PAGE_NAMES`, `SUB_NAVS` et du dispatch de `_doRender` dans le dashboard servi.
- Il recense 36 pages nommées, 34 structures de sous-navigation et 167 sous-routes (201 entrées de navigation en comptant les 34 entrées racines). Le dispatch comporte 47 cas : les pages nommées, trois routes d’add-on autonomes et huit alias/redirections.
- Les contrôles statiques ciblés vérifient les clés `fpT`/`t`, les libellés de statut, les toasts/dialogues natifs et le texte des templates HTML ainsi que les affectations DOM des sept scripts d’add-on suivis. L’inventaire exhaustif des templates du dashboard principal reste **EN COURS**. Les balayages heuristiques ne sont pas comptés comme des anomalies confirmées.
- La vérification navigateur des routes privées est **BLOCKED** : aucune session authentifiée n’est utilisée et aucun contournement d’authentification n’est autorisé.
- Cette matrice suit le statut de l’audit de l’interface en anglais. Elle ne certifie pas le rendu navigateur ni les autres langues.

## Bilan confirmé à cette étape

- **67 textes d’interface français confirmés traduits** : six dans les add-ons contrôlés, 25 dans la carte utilisateur et Local Presence, et 36 dans les contrôles Missions et l’en-tête de sa bibliothèque. Huit autres entrées du catalogue sont des clés d’identité déjà identiques en anglais.
- Les tests ciblés rapportent **15 réussites** et aucun manque de clé statique dans le périmètre contrôlé. Le contrôle des templates et affectations DOM des sept scripts d’add-on ne relève plus de texte français non enveloppé.
- La vue Missions vérifiée couvre les contrôles de liste/kanban, le formulaire d’ajout, les filtres, les statuts, les compteurs, les priorités et l’en-tête/actions/catégories de la bibliothèque. Les titres, étapes et gains des modèles, ainsi que le calendrier et les détails, restent à auditer; la route demeure donc **EN COURS**.
- Le décompte global des anomalies restantes et des faux positifs est **non établi** : le balayage des templates du dashboard principal n’est pas encore exhaustif et ses candidats restent à classifier.

## Inventaire des pages et sous-routes

`(racine)` désigne la vue principale de la page; les identifiants qui suivent correspondent aux sous-routes.

| Page / route | Sous-routes recensées | Audit statique des templates | Navigateur authentifié |
| --- | --- | --- | --- |
| `overview` | (racine), `insights`, `quick-wins`, `checklist` | EN COURS | BLOCKED |
| `missions` | (racine), `todo`, `inprogress`, `done`, `ai` | EN COURS | BLOCKED |
| `audits` | (racine), `analysis`, `compare`, `history`, `opportunites` | EN COURS | BLOCKED |
| `monitors` | (racine), `performance`, `incidents`, `config`, `sla` | EN COURS | BLOCKED |
| `local-seo` | (racine), `map`, `competitors-map`, `zones`, `opportunities`, `reviews`, `gbp`, `presence` | EN COURS | BLOCKED |
| `reports` | (racine), `exec`, `seo`, `monitoring`, `local`, `conversion`, `client`, `ai` | EN COURS | BLOCKED |
| `team` | (racine), `chat`, `activity`, `files`, `performance` | EN COURS | BLOCKED |
| `growth` | (racine), `projections`, `objectives`, `keywords` | EN COURS | BLOCKED |
| `competitor` | (racine), `keywords`, `growth`, `backlinks`, `local`, `alerts`, `comparison` | EN COURS | BLOCKED |
| `conversion` | (racine), `funnel`, `ux-lab`, `cta`, `revenue-leak`, `cro` | EN COURS | BLOCKED |
| `alerts-center` | (racine), `incidents`, `seo`, `performance`, `conversion`, `local`, `competitor`, `ai` | EN COURS | BLOCKED |
| `billing` | (racine), `plans`, `addons`, `usage`, `invoices`, `ai-strategist`, `enterprise` | EN COURS | BLOCKED |
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
| `conversion-opportunity-engine` | Vue autonome, sans sous-navigation | EN COURS | BLOCKED |
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

Pour chaque famille, confirmer les chaînes visibles et leurs branches conditionnelles à partir du code, classer les candidats heuristiques avant de les compter, ajouter les clés statiques exactes au catalogue et envelopper les fragments dynamiques avec `fpT()`. Aucun statut navigateur PASS ne sera attribué à une route privée sans contrôle authentifié autorisé; ces routes restent BLOCKED en attendant cette vérification.
