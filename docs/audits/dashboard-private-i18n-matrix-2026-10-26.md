# Matrice d’audit i18n du dashboard privé

**Date de référence :** 27 octobre 2026
**Cible :** Test-Replit  
**PR :** #304 — `feature/dashboard-i18n-static-audit-20261026`  
**Portée :** textes d’interface écrits par l’application dans le dashboard privé. Les données client, les noms et valeurs métier, les messages d’équipe et les réponses ou contenus générés par les utilisateurs restent hors traduction.

## Statut et méthode

- L’inventaire ci-dessous provient de `PAGE_NAMES`, `SUB_NAVS` et du dispatch de `_doRender` dans le dashboard servi.
- Il recense 36 pages nommées, 34 structures de sous-navigation et 167 sous-routes (201 entrées de navigation en comptant les 34 entrées racines). Le dispatch comporte 47 cas : les pages nommées, trois routes d’add-on autonomes et huit alias/redirections.
- Les contrôles statiques vérifient les clés `fpT`/`t`, les libellés de statut, les toasts/dialogues natifs, les textes visibles et attributs des templates HTML, ainsi que les affectations DOM des sept scripts d’add-on suivis. L’inventaire des pages principales est couvert par un contrôle de routes; les textes visibles des routes ouvertes ont passé le scanner statique. `seo-change-impact` reste à auditer séparément. Les balayages heuristiques ne sont pas comptés comme des anomalies confirmées.
- La vérification navigateur des routes privées est **BLOCKED** : aucune session authentifiée n’est utilisée et aucun contournement d’authentification n’est autorisé.
- Cette matrice suit le statut de l’audit de l’interface en anglais. Elle ne certifie pas le rendu navigateur ni les autres langues.

## Bilan confirmé à cette étape

- Le décompte Missions est maintenant confirmé : **8 catégories, 73 cartes et 301 chaînes de champs distinctes** (titres, impacts, efforts, gains et étapes). **297** n’avaient pas encore de clé anglaise et sont maintenant couvertes; **4** étaient déjà dans le catalogue. La sous-page de recommandations IA contient **14 modèles** et son test vérifie **38 clés** de texte et de données dynamiques.
- Les tests i18n ciblés rapportent **31 réussites sur 31**. Le contrôle ajouté vérifie les 36 noms de pages, 34 structures de sous-navigation, 201 entrées de navigation et les textes visibles des routes principales encore ouvertes. Après injection de `fpT` dans deux bancs d’essai isolés, le contrôle TypeScript et les **51 tests ciblés sur trois fichiers** passent aussi.
- L’audit statique de Missions couvre maintenant la liste, le kanban, le calendrier, l’agenda, les vues filtrées, la bibliothèque, ses 301 valeurs, les recommandations IA, le formulaire manuel et le panneau de détail. Les contenus de bibliothèque et recommandations créés par l’application sont signalés comme templates; seuls les textes exacts reconnus sont traduits à l’affichage. Les données transmises et stockées restent brutes. Les missions manuelles ou anciennes sans provenance restent inchangées.
- Overview est audité sur la racine, Insights, Quick Wins et Checklist. Les libellés dynamiques des modules, filtres, catégories, gains, accomplissements, puces IA et éléments par défaut de checklist ont une couverture anglaise. Les assertions statiques confirment que les prompts IA, réponses IA, valeurs enregistrées des missions/checklists, messages d’activité et données client restent bruts; les navigateurs ne sont pas certifiés.
- Audits est audité sur la racine, Analysis, Compare, History et Opportunities, y compris les panneaux de détail et de nouvel audit, les états de chargement/vide/erreur, les filtres, l’historique et ses exports, les programmations, la sélection groupée, les actions groupées d’export/relance/archivage/suppression et leur confirmation, ainsi que la création de mission. Les labels sont traduits à l’affichage; les valeurs d’API, fréquences, URL, statuts et contenu fourni par l’IA restent inchangés.
- Monitors est audité sur la racine, Performance, Incidents, Configuration et SLA, avec les panneaux d’alerte email, de page de statut, d’endpoint et de maintenance, les canaux, les presets, les actions groupées, Better Stack et les états sans mesures. Les statuts, mesures, URL, noms de monitors, messages issus des événements et erreurs du serveur restent inchangés; la valeur email initiale et les endpoints de sauvegarde sont conservés.
- Reports est audité sur la racine et ses sept sous-pages, avec le formulaire de génération, les packs d’agence, les états sans données, les aperçus de rapports, les labels dynamiques et les menus d’action. Les noms et valeurs de rapport, champs de marque saisis, valeurs client, réponses IA réelles, statuts, formats, mesures et payloads d’API restent bruts; la navigation Reports est localisée sans modifier les identifiants de sous-route.
- Competitors est audité sur la racine et ses sept sous-pages dans la branche de production, avec la comparaison IA, les états sans données, les labels fournisseur et les actions de relance/suppression. Les métriques, domaines, noms, erreurs fournisseur, contenus d’analyses IA, opportunités et fonctionnalités restent inchangés; seul le marqueur « Non déterminé » app-authored est traduit. Le grand bloc de démonstration preview-only reste désactivé par `PREVIEW_MODE`.
- Local SEO est audité sur la racine, la grille géographique, la carte de concurrents, les zones, les opportunités GSC, les avis, GBP et la présence de fiche. Les formulaires, états de chargement/vide/erreur, filtres, modales et panneau de publication GBP sont couverts; les avis, noms, contenus générés, valeurs fournisseur et données synchronisées restent bruts.
- Growth est audité sur la racine, Projections, Objectifs et Mots-clés. Les branches conditionnelles et états asynchrones incluent l’absence de données de projection, les Quick Wins vides, les objectifs calculés et personnalisés, les états GSC de chargement/vide/erreur, les opportunités CTR et Content Decay, et la génération de recommandations IA. Les mots-clés, URL, métriques API, objectifs saisis, erreurs serveur et textes générés par l’IA restent inchangés; seuls les libellés et messages écrits par l’application sont localisés.
- Conversion est audité sur la racine, `funnel`, `ux-lab`, `cta`, `revenue-leak`, `cro`, le rendu Heatmap accessible et l’add-on autonome Conversion Opportunity Engine. Les états GA4 premium, chargement, découverte, déconnexion, absence de conversions, tableaux, erreurs/réessais, détection de fuites, expérimentations A/B, leurs invites/confirmations et les actions de création/résolution sont couverts statiquement. Les libellés du jeu de démonstration UX ne sont traduits qu’à l’affichage et uniquement dans la branche de repli preview. Les noms d’événements, chemins, sources, appareils, contenus CTA et variantes, réponses IA, erreurs serveur, valeurs numériques, identifiants de routes/statuts et données client restent inchangés; les catégories et libellés d’interface reconnus sont traduits. Les chiffres de démonstration existants n’ont pas été corrigés dans cet audit i18n.
- Le scanner de templates n’a relevé aucune chaîne visible non traduite dans les routes ouvertes couvertes. Les interactions navigateur privées restent non vérifiées. Le ruleset actif de `Test-Replit` exige le contrôle `Types, build, tests` et zéro approbation. Un ancien HEAD a échoué dans cinq tests isolés qui ne fournissaient pas `fpT`; les bancs d’essai ont été corrigés. Le contrôle requis a réussi sur le HEAD `af761b3`; toute modification ultérieure devra repasser le CI avant fusion.

## Décomptes exacts par page à ce jalon

| Page | Comptage confirmé | Audit statique | Navigateur authentifié |
| --- | --- | --- | --- |
| `missions` | 8 catégories de bibliothèque · 73 cartes · 301 chaînes de champs distinctes (297 nouvelles clés anglaises, 4 déjà couvertes) · 14 modèles IA · 38 clés vérifiées sur la sous-page IA · 10 tests Missions | PASS — 0 clé manquante dans les surfaces contrôlées | BLOCKED |
| `overview` | Racine · `insights` · `quick-wins` · `checklist` · libellés statiques et dynamiques vérifiés | PASS — 0 clé manquante dans les surfaces contrôlées | BLOCKED |
| Pages principales restantes, hors `seo-change-impact` | Textes visibles statiques contrôlés dans les renderers des routes ouvertes; chaînes dynamiques liées aux données restent intactes | PASS — 0 chaîne visible non traduite | BLOCKED |

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
| `team` | (racine), `chat`, `activity`, `files`, `performance` | PASS — texte visible et libellés dynamiques vérifiés statiquement | BLOCKED |
| `growth` | (racine), `projections`, `objectives`, `keywords` | PASS — branches conditionnelles, états asynchrones, catalogue anglais et limites de données vérifiés statiquement | BLOCKED |
| `competitor` | (racine), `keywords`, `growth`, `backlinks`, `local`, `alerts`, `comparison` | PASS — branches de production, sous-navigation et données AI/fournisseur vérifiées | BLOCKED |
| `conversion` | (racine), `funnel`, `ux-lab`, `cta`, `revenue-leak`, `cro`, Heatmap accessible | PASS — vues, branches GA4, états vides/erreur, labels dynamiques, prompts/confirmations A/B, actions et limites des données client vérifiés statiquement | BLOCKED |
| `alerts-center` | (racine), `incidents`, `seo`, `performance`, `conversion`, `local`, `competitor`, `ai` | PASS — texte visible et messages dynamiques vérifiés statiquement | BLOCKED |
| `billing` | (racine), `plans`, `addons`, `usage`, `invoices`, `ai-strategist`, `enterprise` | PASS — catalogue des plans/add-ons, usage et crédits, factures, états de paiement, AI Strategist, Enterprise Lab, états dynamiques et limites des données client vérifiés statiquement | BLOCKED |
| `settings` | (racine), `workspace`, `team`, `security`, `alerts`, `automations`, `integrations`, `api`, `ai-config`, `data`, `localisation`, `sso` | PASS — traduction déjà livrée et revalidée dans la suite statique | BLOCKED |
| `ai` | (racine), `usage`, `intelligence`, `insights`, `actions`, `strategist` | PASS — texte visible et messages dynamiques vérifiés statiquement | BLOCKED |
| `activity-feed` | (racine), `team`, `seo`, `monitoring`, `ai`, `reports`, `competitor`, `ops` | PASS — texte visible et messages dynamiques vérifiés statiquement | BLOCKED |
| `analytics` | (racine), `realtime`, `pages`, `conversions`, `connect` | PASS — texte visible vérifié statiquement | BLOCKED |
| `traffic` | (racine), `organic`, `paid`, `social`, `direct`, `anomalies` | PASS — texte visible et messages dynamiques vérifiés statiquement | BLOCKED |
| `funnels` | (racine), `goals`, `paths`, `dropoff` | PASS — texte visible vérifié statiquement | BLOCKED |
| `audience` | (racine), `geo`, `devices`, `demographics` | PASS — texte visible et messages dynamiques vérifiés statiquement | BLOCKED |
| `campaigns` | (racine), `utm`, `roi`, `compare` | PASS — texte visible et messages dynamiques vérifiés statiquement | BLOCKED |
| `live` | (racine), `events`, `pages`, `geo` | PASS — texte visible et messages dynamiques vérifiés statiquement | BLOCKED |
| `data-explorer` | (racine), `traffic`, `behavior`, `dashboards`, `insights`, `forecast`, `export` | PASS — texte visible et pagination vérifiés statiquement | BLOCKED |
| `client-mode` | (racine), `dashboards`, `reporting`, `communication`, `onboarding`, `projects`, `analytics`, `agency` | PASS — texte visible et labels dynamiques vérifiés statiquement | BLOCKED |
| `performance` | (racine), `mobile`, `desktop`, `history`, `opportunities`, `ai` | PASS — texte visible et messages dynamiques vérifiés statiquement | BLOCKED |
| `core-web-vitals` | (racine), `lcp`, `cls`, `inp`, `ttfb`, `compare` | PASS — texte visible vérifié statiquement | BLOCKED |
| `technical-audit` | (racine), `render-blocking`, `js-css`, `images`, `accessibility`, `seo`, `ai` | PASS — texte visible vérifié statiquement | BLOCKED |
| `github-integration` | (racine), `repos`, `commits`, `ci-cd`, `security`, `config` | PASS — texte visible vérifié statiquement | BLOCKED |
| `code-analysis` | (racine), `seo`, `performance`, `security`, `quality`, `ai` | PASS — texte visible vérifié statiquement | BLOCKED |
| `deployments` | (racine), `releases`, `workflows`, `environments`, `history` | PASS — texte visible vérifié statiquement | BLOCKED |
| `repository-health` | (racine), `seo`, `activity`, `collaboration`, `recommendations` | PASS — texte visible vérifié statiquement | BLOCKED |
| `crm` | (racine), `connections`, `sync`, `logs`, `field-mapping` | PASS — texte visible et sync dynamique vérifiés statiquement | BLOCKED |
| `market-intelligence` | (racine), `trends`, `opportunities`, `competitors`, `signals`, `reports` | PASS — texte visible et données dynamiques vérifiés statiquement | BLOCKED |
| `permissions` | (racine), `matrix`, `audit` | PASS — texte visible vérifié statiquement | BLOCKED |
| `search-console` | (racine), `keywords`, `pages`, `impressions`, `indexing`, `connect` | PASS — texte visible et attributs vérifiés statiquement | BLOCKED |
| `conversion-opportunity-engine` | Vue autonome, sans sous-navigation | PASS — labels, paramètres, états vides/erreur et valeurs GA4 vérifiés statiquement | BLOCKED |
| `seo-change-impact` | Vue autonome, sans sous-navigation | PASS — couverte par le scanner statique des add-ons | BLOCKED |

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
| Navigation, titres, racines et sous-routes | PASS statique | BLOCKED | Les libellés sont traduisibles; les identifiants de route ne le sont pas. |
| Chargement, données absentes et intégrations non connectées | PASS statique sur les routes principales scannées | BLOCKED | Traduire les messages de l’application; ne pas inventer ni modifier de mesures client. |
| Données réelles, tableaux, filtres et pagination | PASS statique sur les renderers scannés | BLOCKED | Traduire les libellés, pas les valeurs métier, noms, requêtes ou contenus fournis par les clients. |
| Erreurs, réessais, notifications, confirmations et dialogues | PARTIEL — contrôles ciblés | BLOCKED | Les actions et états qui ne sont visibles qu’après interaction restent à certifier. |
| Rôles, accès, droits, forfaits et abonnement annulé | EN COURS | BLOCKED | Ne changer aucun droit d’accès ni aucune règle de facturation. |
| Assistant IA : chargement, streaming, proposition, confirmation et erreur | EN COURS | BLOCKED | Traduire l’interface seulement; conserver les prompts, réponses et contenus générés. |
| Langue EN, restauration FR et changement de langue | EN COURS — revue du code source | BLOCKED | Toujours repartir de la source française canonique; ne pas transformer le contenu client. |
| Panneaux, modales, menus et DOM injecté hors de la page | EN COURS | BLOCKED | Vérifier les racines de traduction et le rétablissement de la source après changement de langue. |
| Bureau et mobile | NON TESTÉ | BLOCKED | Aucun état privé authentifié n’a été rendu dans un navigateur. |

## Suite de l’audit

Les prochaines étapes sont d’envoyer les corrections sur la branche de la PR pour relancer le contrôle requis, puis de vérifier les routes privées dans un navigateur authentifié autorisé. Aucun statut navigateur PASS ne sera attribué sans cette vérification; ces routes restent BLOCKED.
