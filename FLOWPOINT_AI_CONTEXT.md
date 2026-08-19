# FlowPoint — Document de contexte complet pour agent IA

> **Destinataire :** agent Replit chargé d'améliorer le support IA du site.
> Ce document est la source d'autorité unique sur la logique produit FlowPoint.
> Toutes les valeurs proviennent directement du code source (plans.ts, config.ts, routes/).

---

## 1. Qu'est-ce que FlowPoint ?

FlowPoint est une **plateforme SaaS tout-en-un de croissance digitale** destinée aux agences SEO, PME et freelances. Elle regroupe :

- **Audits SEO automatiques** (scores, problèmes critiques, recommandations priorisées)
- **Monitoring de sites** (uptime, performance, incidents)
- **Local SEO** (Google Business Profile, avis, cartes de visibilité)
- **Analyse concurrentielle** (métriques domaine, mots-clés, trafic — données réelles via service interne)
- **Rapports PDF White-Label** (pour les agences à partager avec leurs clients)
- **Calendrier d'équipe** (événements, rappels, récurrences, lien missions)
- **Missions d'équipe** (tâches collaboratives, assignation, priorités, étapes)
- **Assistant IA** (chat, outils actifs, suggestions, exécutions confirmées)
- **Mode Client** (synthèse livrable, rapports partageables, score SEO)

La langue principale de l'interface est le **français**. L'application est multilingue (FR, EN, DE, ES, PT, IT, NL, PL, RO, UA).

---

## 2. Plans et tarifs

| Plan | Prix/mois | Badge |
|------|-----------|-------|
| **Standard** | 29 €/mois | Démarrage |
| **Pro** | 79 €/mois | Recommandé |
| **Ultra** | 149 €/mois | Ultra |

> Il n'existe **pas** de plan "Pro+". La hiérarchie est : Standard < Pro < Ultra.
> L'"Agency" est un alias interne d'Ultra, jamais affiché au client.

### Quotas mensuels par plan

| Ressource | Standard | Pro | Ultra |
|-----------|----------|-----|-------|
| Audits SEO | 30 | 300 | 1 000 |
| Monitors actifs | 10 | 50 | 300 |
| Rapports PDF | 30 | 300 | 1 000 |
| Exports CSV | 30 | 300 | 1 000 |
| Membres d'équipe (hors propriétaire) | 1 | 5 | 10 |
| Workspaces | 1 | 5 | 10 |
| Mots-clés suivis | 50 | 500 | 5 000 |
| Concurrents suivis | 10 | 30 | 100 |
| Heatmaps | 2 | 10 | 50 |
| Automatisations | 3 | 20 | 100 |
| Missions | 20 | 200 | 999 |
| Posts Google Business Profile | 10 | 100 | 999 |
| Intégrations CRM | 1 | 3 | 10 |
| Rétention des données | 30 j | 90 j | 365 j |

### Crédits IA mensuels inclus

| Plan | Crédits IA | Modèle IA |
|------|-----------|-----------|
| Standard | 100 000 | gpt-5-mini |
| Pro | 500 000 | gpt-5-mini |
| Ultra | 10 000 000 | gpt-5 |

> Les crédits IA ne se cumulent pas d'un mois à l'autre. Le compteur se réinitialise le 1er du mois.

### Fonctionnalités verrouillées par plan

**Standard — verrouillé :**
IA Insights avancés, API Access, Analytics concurrents poussés, Multi-workspace, SSO SAML, Onboarding dédié, Facturation client

**Pro — verrouillé :**
Multi-workspace, SSO SAML, Onboarding dédié, SLA garanti 99,9 %

**Ultra — tout déverrouillé.**

---

## 3. Add-ons achetables (abonnements mensuels)

Les add-ons s'ajoutent à n'importe quel plan actif. Certains sont déjà **inclus** selon le plan (voir §4).

### Monitoring

| Clé | Nom affiché | Prix | Quantité |
|-----|-------------|------|---------|
| `monitorsPack10` | +10 Monitors | 9 €/mois | ✓ (cumulable) |
| `monitorsPack50` | +50 Monitors | 19 €/mois | ✓ (cumulable) |
| `globalMonitoring` | Global Monitoring | 49 €/mois | — |
| `slaMonitoring` | SLA Monitoring Avancé | 19 €/mois | — |

### SEO

| Clé | Nom affiché | Prix |
|-----|-------------|------|
| `advancedSeoLab` | Advanced SEO Lab | 29 €/mois |
| `keywordDomination` | Keyword Domination Engine | 39 €/mois |
| `backlinkIntelligence` | Backlink Intelligence | 24 €/mois |
| `aiContentStrategist` | AI Content Strategist | 34 €/mois |

### Local SEO

| Clé | Nom affiché | Prix | Quantité |
|-----|-------------|------|---------|
| `gbpSlots10` | +10 Emplacements GBP | 19 €/mois | ✓ (cumulable) |
| `aiGbpPosting` | AI GBP Posting | 29 €/mois | — |
| `reviewIntelligence` | Review Intelligence | 19 €/mois | — |
| `localDominationMaps` | Local Domination Maps | 24 €/mois | — |

### Conversion / IA

| Clé | Nom affiché | Prix |
|-----|-------------|------|
| `aiCro` | AI CRO Strategist | 34 €/mois |
| `behavioralAI` | Behavioral AI | 44 €/mois |
| `revenueLeak` | Revenue Leak AI | 29 €/mois |
| `abTestingAI` | AB Testing IA | 24 €/mois |

### Reporting

| Clé | Nom affiché | Prix |
|-----|-------------|------|
| `whiteLabel` | White-Label Exports | 17 €/mois |
| `agencyPacks` | Agency Reporting Packs | 49 €/mois |
| `aiExecutiveReport` | AI Executive Reporting | 24 €/mois |

### IA / Prévisions

| Clé | Nom affiché | Prix |
|-----|-------------|------|
| `aiForecasting` | AI Forecasting Engine | 39 €/mois |
| `marketIntelligence` | AI Market Intelligence | 49 €/mois |

### Infrastructure & Accès

| Clé | Nom affiché | Prix |
|-----|-------------|------|
| `customDomain` | Custom Domain | — |
| `advancedWebhooks` | Advanced Webhooks | — |
| `retention90d` | Rétention 90 jours | — |
| `retention365d` | Rétention 365 jours | — |
| `prioritySupport` | Support Prioritaire | — |
| `extraSeats` | +5 Sièges d'équipe | — |

### Packs unitaires (augmentent les quotas, cumulables)

| Clé | Ressource ajoutée | Par pack |
|-----|-------------------|----------|
| `monitorsPack10` | Monitors | +10 |
| `monitorsPack50` | Monitors | +50 |
| `auditsPack200` | Audits/mois | +200 |
| `auditsPack1000` | Audits/mois | +1 000 |
| `pdfPack200` | Rapports PDF/mois | +200 |
| `exportsPack1000` | Exports/mois | +1 000 |
| `extraSeats` | Membres d'équipe | +5 |
| `gbpSlots10` | Emplacements GBP | +10 |

### Packs de crédits IA à l'achat unique

Des packs de crédits supplémentaires peuvent être achetés ponctuellement (hors abonnement) pour les organisations qui dépassent leur quota mensuel. L'achat se fait directement depuis le dashboard section Facturation.

---

## 4. Add-ons inclus par plan (sans coût supplémentaire)

**Standard** inclut :
- `whiteLabel` (White-Label Exports)

**Pro** inclut (en plus de Standard) :
- `advancedWebhooks`
- `retention90d`
- `advancedSeoLab`
- `backlinkIntelligence`
- `prioritySupport`

**Ultra** inclut (en plus de Pro) :
- `customDomain`
- `retention365d`
- `keywordDomination`
- `behavioralAI`
- `aiForecasting`

> Règle : Ultra ⊇ Pro ⊇ Standard (ensembles cumulatifs).

---

## 5. Règles de facturation

### Abonnement
- Facturation mensuelle via **Stripe**.
- Un seul abonnement actif par organisation.
- Upgrade : changement immédiat, différentiel facturé au prorata.
- Downgrade : prise d'effet en fin de période.

### Essai gratuit
- 14 jours d'essai disponibles **une seule fois** par organisation.
- Pas d'essai si l'organisation a déjà eu un abonnement payant.
- L'essai est sur le plan Standard ou Pro selon le choix initial.

### États d'abonnement

| État | Accès |
|------|-------|
| `trialing` | Accès complet au plan d'essai |
| `active` | Accès complet |
| `past_due` | Accès maintenu temporairement (paiement en retard) |
| `canceled` | Accès coupé en fin de période |
| `incomplete` | En attente de paiement |

### Sièges d'équipe
- Le **propriétaire compte toujours comme 1 siège** (même sans ligne membres).
- La limite indiquée dans le plan est le total de membres (propriétaire inclus).
- Ex. Standard : 1 → propriétaire seul. Pro : 5 → propriétaire + 4 membres max.

---

## 6. Outils actifs de l'assistant IA

L'assistant IA FlowPoint peut **exécuter des actions réelles** dans le workspace de l'utilisateur. Chaque action destructive ou modificatrice demande une **confirmation explicite** avant exécution.

### 6.1 Missions (gestion de tâches équipe)

| Outil | Description |
|-------|-------------|
| `list_missions` | Lister les missions avec filtres (statut, catégorie, priorité) |
| `search_mission` | Rechercher une mission par mots-clés ou critères |
| `create_mission` | Créer une nouvelle mission (titre, desc, priorité, assignation, étapes) |
| `update_mission` | Modifier une mission existante (titre, statut, priorité, assigné, date) |
| `complete_mission` | Marquer une mission comme terminée |
| `assign_mission` | Réassigner une mission à un membre de l'équipe |
| `delete_mission` | Supprimer une mission (nécessite confirmation) |
| `navigate_to` | Naviguer vers une section du dashboard |

### 6.2 Calendrier

| Outil | Description |
|-------|-------------|
| `search_calendar_event` | Rechercher des événements (par date, type, client, mots-clés) |
| `create_calendar_event` | Créer un événement (date, heure, durée, client, lien mission, récurrence) |
| `update_calendar_event` | Modifier un événement existant |
| `move_calendar_event` | Déplacer un événement vers une autre date/heure |
| `delete_calendar_event` | Supprimer un événement (avec garde propriétaire) |
| `update_recurring_event` | Modifier une occurrence d'un événement récurrent |
| `delete_recurring_series` | Supprimer toute une série récurrente |

Récurrences supportées : `daily`, `weekly`, `biweekly`, `monthly`, `yearly` (RRULE enrichi avec BYDAY, UNTIL, COUNT).

### 6.3 Audits SEO

| Outil | Description |
|-------|-------------|
| `search_audits` | Lister et filtrer les audits (URL, statut, période) |
| `run_audit` | Lancer un audit sur une URL (délai ~30–120 s, résultat asynchrone) |
| `rerun_audit` | Relancer un audit existant |
| `compare_audits` | Comparer deux audits côte-à-côte |
| `summarize_audit` | Résumer un audit en langage naturel |
| `explain_audit_issue` | Expliquer un problème technique identifié dans un audit |
| `create_missions_from_audit` | Créer des missions directement depuis les issues d'un audit |
| `delete_audit` | Supprimer un audit (confirmation requise) |
| `export_audit` | Exporter un audit en PDF |

Score audit : `≥ 70` = ✅ OK, `50–69` = ⚠️ Avertissement, `< 50` = ❌ Critique.

### 6.4 Recommandations SEO

| Outil | Description |
|-------|-------------|
| `search_recommendations` | Filtrer les recommandations actives (catégorie, priorité, statut) |
| `generate_recommendations` | Générer de nouvelles recommandations IA basées sur les audits |
| `prioritize_recommendations` | Prioriser automatiquement les recommandations |
| `explain_recommendation` | Expliquer pourquoi une recommandation est prioritaire |
| `create_action_plan` | Créer un plan d'action sur N semaines |
| `generate_seo_strategy` | Générer une stratégie SEO sur 3, 6 ou 12 mois |
| `compare_strategy` | Comparer deux approches stratégiques |
| `create_missions_from_strategy` | Convertir une stratégie en missions concrètes |
| `dismiss_recommendation` | Ignorer une recommandation (avec motif) |
| `restore_recommendation` | Restaurer une recommandation ignorée |

Catégories de recommandations : `technique`, `contenu`, `local`, `backlinks`, `conversion`, `performance`.

### 6.5 Monitors et Incidents

| Outil | Description |
|-------|-------------|
| `search_monitors` | Lister les monitors (filtre statut, critique, actif) |
| `search_incidents` | Rechercher des incidents (par monitor, statut, période) |
| `explain_incident` | Analyser un incident en détail |
| `compare_incidents` | Comparer plusieurs incidents |
| `acknowledge_incident` | Acquitter un incident (avec note) |
| `resolve_incident` | Marquer un incident comme résolu |
| `create_missions_from_incident` | Créer des missions correctives depuis un incident |
| `optimize_monitors` | Suggérer des optimisations de configuration de monitors |
| `configure_monitor` | Créer ou modifier un monitor |
| `delete_monitor` | Supprimer un monitor (confirmation requise, avec protections) |

Statuts monitor : `up`, `down`, `paused`, `unknown`.

### 6.6 Analyse d'URL

| Outil | Description |
|-------|-------------|
| `analyze_url` | Analyser une URL spécifique (contenu, méta, liens, performance) |
| `analyze_site` | Analyse complète d'un domaine |

---

## 7. Règles de l'assistant IA — Comportements attendus

### Règles fondamentales (STRICT_AI_RULE)
1. **Ne jamais inventer de données** : pas de chiffres fictifs, scores imaginaires ou tendances fabriquées.
2. **Toujours confirmer avant une action irréversible** : création de mission, suppression d'audit, configuration de monitor.
3. **Ne pas révéler les fournisseurs internes** : le nom "DataForSEO", "OpenAI", "GPT" ou tout fournisseur tiers ne doit jamais apparaître dans les réponses client.
4. **Ne pas annoncer une action comme réussie avant le retour positif de l'outil.**
5. **Répondre dans la langue de l'utilisateur** (détection automatique FR/EN/DE/ES/PT/IT/NL/PL/RO/UA).
6. **Respecter les permissions** : lecture seule si l'utilisateur n'a pas le droit d'écriture sur la ressource concernée.

### Comportement face aux limites de quota
- Si le quota mensuel est atteint (ex. audits, crédits IA), l'IA doit l'indiquer clairement et proposer soit d'attendre la réinitialisation, soit d'acheter un pack supplémentaire.
- Ne jamais contourner silencieusement une limite.

### Comportement face aux données non disponibles
- Si les métriques d'un concurrent sont temporairement indisponibles, l'IA doit le dire honnêtement et proposer de réessayer plus tard.
- Les pages Performance Web, Core Web Vitals, Audit Technique : ne pas afficher de spinner factice ; afficher un état vide ou erreur explicite.

### Confirmation (carte UI)
- Les actions qui modifient des données (création, suppression, mise à jour) génèrent une carte de confirmation dans le chat.
- L'utilisateur doit cliquer "Confirmer" dans la carte pour que l'action s'exécute réellement.
- Si l'utilisateur recharge la page, la carte reste valide via `sessionStorage`.

### Stop / annulation
- L'utilisateur peut interrompre l'IA à tout moment avec le bouton "Stop".
- Après un Stop, la conversation peut reprendre normalement.

---

## 8. Contexte enrichi pour l'IA

Avant chaque conversation, l'IA reçoit automatiquement :
- Les **mots-clés suivis** de l'organisation (domaine, position, volume)
- La liste des **concurrents** suivis
- Les données de la **fiche Google Business Profile** si connectée
- Le **score SEO moyen** des derniers audits
- Le **plan actif** et les **crédits IA restants**
- La **date du jour** (dynamique, jamais hardcodée)

---

## 9. Sections principales du dashboard (destinations IA)

| Destination ID | Libellé |
|---------------|---------|
| `overview` | Vue d'ensemble / Command Center |
| `audits-list` | Liste des audits SEO |
| `missions-list` | Missions d'équipe |
| `calendar` | Calendrier |
| `monitors-list` | Monitors & uptime |
| `reports-list` | Rapports PDF |
| `competitors` | Analyse concurrentielle |
| `recommendations` | Recommandations SEO |
| `alerts-center` | Centre d'alertes |
| `activity-feed` | Fil d'activité équipe |
| `team` | Gestion d'équipe |
| `client-mode` | Mode Client (vue livrables) |
| `settings` | Paramètres et profil |
| `billing` | Facturation et plans |
| `ai-workspace` | Espace IA (chat principal) |

---

## 10. Mode Client

Le **Mode Client** (`sub=dashboards`) est une vue dédiée pour les agences. Elle présente :
- Le **dernier score SEO** du site
- Le nombre de **rapports PDF partagés** avec le client
- Le **dernier rapport** disponible et un lien direct
- La **prochaine étape** recommandée (générer, partager ou présenter)
- Un espace de synthèse distinct du Command Center (pas une copie)

Cette vue est distincte de la vue interne agence. Elle est conçue pour être présentée directement au client final.

---

## 11. Connexions Google (GSC, GA4, GBP)

FlowPoint peut se connecter à :
- **Google Search Console (GSC)** : positions, impressions, CTR par mots-clés
- **Google Analytics 4 (GA4)** : trafic, conversions, comportement
- **Google Business Profile (GBP)** : fiche locale, avis, posts automatiques

L'état de connexion est géré côté serveur. La présence de données dans l'interface ne prouve pas la connexion — c'est toujours le statut serveur qui fait foi.

---

## 12. Alertes et règles

FlowPoint gère des **règles d'alerte automatiques** :
- `monitor_down` : déclenchée sur transition d'état (up→down), sans seuil.
- `keyword_ranking_drop` : déclenchée quand un mot-clé chute de plus de N positions.
- Alertes email automatiques configurables.
- Centre d'alertes avec historique et acquittement.

---

## 13. Équipe et invitations

- Le **propriétaire** est protégé : ne peut jamais être supprimé ni rétrogradé.
- Les **membres** peuvent être : `admin`, `member`, `viewer`.
- Les **invitations** expirent et peuvent être renvoyées.
- Comptage des sièges : propriétaire + membres actifs (les lignes legacy du propriétaire ne comptent pas deux fois).

---

## 14. Rapports PDF

- Créés depuis "Nouveau" ou depuis un **template** (résultat identique dans les deux cas).
- Peuvent être **partagés** avec le client via un lien public.
- Apparaissent dans : Rapports récents, Mode Client, Fil d'activité.
- Formats : résumé exécutif, audit complet, rapport de performance, rapport concurrentiel.
- White-label : le logo et la marque de l'agence remplacent FlowPoint sur le PDF.

---

## 15. Contraintes techniques clés pour l'IA

- **Rate limit IA** : Standard 10 req/min, Pro 30 req/min, Ultra 120 req/min.
- **Prompt max** : Standard 2 000 tokens, Pro 8 000 tokens, Ultra 32 000 tokens.
- **Timeout outil** : 30 s par outil.
- **Timeout conversation** : 120 s max par round.
- **Max rounds** : 6 appels d'outils maximum par conversation avant finalisation.
- Un seul thread de conversation actif par organisation (le deuxième attend ou remplace).

---

## 16. Ce que l'IA NE doit PAS faire

- Mentionner des fournisseurs tiers (DataForSEO, OpenAI, Anthropic, Google AI…)
- Inventer des données SEO ou des scores
- Ignorer les erreurs d'outils (les rapporter proprement)
- Contourner les permissions (fail-closed : en doute, refuser)
- Affirmer qu'une action est faite sans confirmation positive de l'outil
- Proposer des plans ou tarifs incorrects (se référer uniquement aux valeurs de ce document)
- Laisser un spinner factice à la place d'un état réel

---

*Document généré automatiquement depuis le code source FlowPoint — `artifacts/api-server/src/lib/plans.ts`, `config.ts`, `routes/ai.ts`, `agent/*.ts`. Valide au 19/08/2026.*
