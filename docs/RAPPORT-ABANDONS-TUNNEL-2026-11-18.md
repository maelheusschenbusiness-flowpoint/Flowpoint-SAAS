# Rapport d'abandons du tunnel — 2026-11-18

Phase 2 « mesure ». Lecture seule : aucun code produit, prix ni quota modifié ; aucune donnée personnelle (comptages, dates, motifs).
Bases lues : **production** (« Flowpoint project », agrégats uniquement) et **test** (« Flowpoint test »), séparément.
Code lu : `Test-Replit` (af43e406) et, pour comparaison, `origin/Flowpoint` (9062968d, déployé en production le 2026-11-17 21:58 UTC).
SQL reproductibles : `docs/sql/rapport-abandons-tunnel-lecture-seule.sql`.

Légende : **CODE** = émis par le code ; **BASE** = observé en base ; **NM** = non mesurable.

## 0. Constat préalable : production et Test-Replit ne mesurent pas avec le même code

| | Production (`Flowpoint`) | `Test-Replit` |
|---|---|---|
| Émission navigateur | `funnel-tracking.js` unique (cookie `fp_visitor_id` + clé `fp_funnel_visitor_id`, injecte `visiteurId` dans les `fetch` de `pre-register`, `checkout-session`, `payment-intent`) | code en ligne par page : `signin.html:871-892`, `pricing-funnel.js`, `checkout-payment.html:361-380,574-584` (clé `fp_vid`) |
| `signup_submitted` / `signup_failed` (par famille) | oui (PR #464, déployée 2026-11-14 21:27 UTC) | **non** (PR #461 ouverte, non fusionnée) |
| Comptage transactionnel sans consentement (`enregistrerEtapeTransactionnelle`, LIVE seulement, comptes synthétiques exclus) | oui (PR #465, 2026-11-14 19:25 UTC) | **non** : `stripe-webhook.ts:2285-2305` écrit toujours, y compris mode test |
| UTM (`utm_source/medium/campaign`), `payment_succeeded/failed`, contrainte `funnel_events_etape_check` | oui | **non** |
| Compteurs de rejets (`funnel_event_rejections`) | non | non (PR #481 ouverte) |

Conséquence : une certification passée sur Test-Replit ne valide pas la couche de mesure qui tourne en production, et une promotion de Test-Replit vers `Flowpoint` ferait **régresser** la mesure (voir D1).

## A. Audit de l'instrumentation

Règles communes (CODE) : étapes fermées `ETAPES_TUNNEL` (`funnel-events.ts:42-55`), étapes navigateur `ETAPES_PUBLIQUES` (`:63-66`) ; attribution acceptée seulement si `fp_analytics_consent=accepted` (cookie) **et** visiteur valide (UUID v4 ou `fp-…`) (`normaliserAttributionFunnel`, `:76-88`) ; sans consentement, `POST /api/public/funnel-event` répond 204 et n'écrit rien (`public-billing.ts:535-548`) ; clé d'idempotence unique partielle `funnel_events_idem_uniq` (`funnel-events.ts:127`) ; `enregistrerEtape` ne lève jamais (`:178-205`). Contenu stocké : étape, visiteur anonyme, org (étapes webhook), plan, source, clé. Aucune adresse e-mail, IP ni donnée bancaire (vérifié dans le code et en base : colonnes `id, etape, visiteur_id, org_ref, plan, source, cle_idempotence, created_at` (+ 3 colonnes UTM en production)). Exception : voir D2 (jeton d'inscription dans la clé).

| Besoin | Nom exact | Émis où (CODE) | Identifiants / dédup | Consentement | Statut |
|---|---|---|---|---|---|
| Visite des tarifs | `tarifs_vus` | Test-Replit `pricing-funnel.js:122-124` ; prod `funnel-tracking.js` (`pathname` `/pricing.html`) ; le site vitrine `flowpoint.pro` n'est pas dans le dépôt | `fp_vid`, source ; clé `tarifs_vus:visiteur:jour(UTC)` : 1 par visiteur et par jour (rechargement et retour arrière dédupliqués, mais ce sont des visiteur-jours, pas des vues) | requis (cookie) ; sans : rien | CODE + BASE (prod 5 lignes / 3 visiteurs ; test 2) |
| Clic sur un plan | `cta_clique` | Test-Replit `pricing-funnel.js:96-112` (bouton `.fp-card-btn[data-plan]`, panier, liens checkout/signup) ; prod `funnel-tracking.js` (liens `checkout|signup` ou `[data-funnel-cta]` seulement) | clé `cta_clique:visiteur:jour` : un 2ᵉ clic sur un autre plan le même jour est perdu ; plan envoyé par Test-Replit seulement, **non validé côté serveur** (`public-billing.ts:555`, texte libre ≤120 car.) ; prod : aucun plan | requis | CODE + BASE (prod 16 lignes / 11 visiteurs, plan nul 16/16 ; test 2) |
| Début d'inscription | `signup_started` (page affichée), `signup_form_engaged` (1ʳᵉ saisie) | Test-Replit `signin.html:892,897-904` ; prod `funnel-tracking.js` (+ `checkout.html` n'émet plus, PR #464) | clé visiteur+étape+jour ; jalon AI Lab si `fp_lid` valide | requis | CODE (prod : `funnel-tracking.js` sur `/signin.html` ; Test-Replit : `signin.html:897-904`) + BASE (prod `signup_started` 10 lignes / 5 visiteurs ; `signup_form_engaged` **0** en prod malgré le code : voir B.1, cause non établie) |
| Inscription envoyée | `signup_submitted` | prod seulement (`signin.html` `fpF('signup_submitted')` avant `POST /api/auth/pre-register`) ; **absent Test-Replit** | clé visiteur+jour | requis | CODE (prod) ; BASE : 0 ligne en prod (aucun visiteur consentant n'a soumis depuis le 14/11, `signup_started` = 1 depuis) ; NM sur Test-Replit |
| Inscription échouée | `signup_failed` + famille (15 valeurs fermées) | prod seulement ; famille portée par la clé `signup_failed:<famille>:visiteur:jour` | idem | requis | CODE (prod), BASE 0 ; NM sur Test-Replit |
| Inscription réussie | `signup_form_completed` | `auth.ts:1164-1176`, après acceptation du formulaire | `visiteurId` du corps + cookie ; clé `signup_form_completed:<jeton pre-register>` ; `org_ref` vide | requis | CODE + BASE (test 57 ; prod 0) |
| Ouverture du paiement Stripe | `checkout_started` | à la **création** du PaymentIntent / SetupIntent / Session (`public-billing.ts:1029-1034`, `:1481-1487`, `:1528-1534`), pas à l'affichage du Payment Element | visiteur via corps (`checkout-payment.html:442`) ; clé `checkout_started:<id Stripe>` ; l'intent est rejoué 10 min (`ATTEMPT_WINDOW_MS`) puis recréé | requis (métadonnée Stripe absente sans consentement) | CODE + BASE (test 55 lignes / 52 visiteurs ; prod 0) |
| Refus de carte | `checkout_payment_failed` | navigateur, `checkout-payment.html:574-584` (sans motif) | clé visiteur+jour | requis | CODE + BASE (test 1 ; prod 0) |
| Paiement / essai réussi | `checkout_completed` | webhooks `checkout.session.completed` (`stripe-webhook.ts:1553-1568`), `setup_intent.succeeded` / `payment_intent.succeeded` (`:1957-1970`) | clé `checkout_completed:<id Stripe>` ; visiteur via métadonnée | requis | CODE + BASE (test 37 ; prod 0) |
| Essai ouvert / abonnement actif | `trial_activated`, `subscription_activated` | `stripe-webhook.ts:2285-2305`, statut `trialing` / `active` | clé `<étape>:<abonnement Stripe>` ; visiteur seulement si la métadonnée d'abonnement le porte ; `org_ref` toujours | **non requis** (famille transactionnelle) ; Test-Replit stocke quand même `org_ref` sans consentement, la production le retire | CODE + BASE (test 76 + 66 ; prod 0 depuis le 14/11, aucune conversion depuis) |
| Annulation / abandon | `trial_expired` : déclaré, **aucun émetteur** (`grep` : seule la liste d'étapes) ; retour d'annulation Stripe `cancel.html`, `checkout-return.html?cancelled=1` : **aucun événement** ; sortie de page : aucun | — | — | — | **NM** (seul abandon déductible : « sans suite observée ») |

### Rejets et compteurs

- Navigateur → serveur : 400 (étape inconnue, `visiteurId` absent) ; 204 sans consentement ; 429 si > 60 requêtes/min/IP (`rateLimiter.ts:299`) ; erreur d'écriture : 204 quand même (`enregistrerEtape` rend `false`, la route ne distingue pas doublon et échec). **Aucun compteur sur Test-Replit ni en production** (la table `funnel_event_rejections` est dans la PR #481, non fusionnée). Un rejet est donc NM (D5).
- File AI Lab (`conversion_event_outbox`, `conversion-outbox.ts`) : échelle de reprise 15/60/180/360 min puis clôture `rejected:400:exhausted` (5 × 400). C'est le seul rejet chiffré (ci-dessous).

## B. Volumes, taux et abandons (données réelles)

### B.1 Production (agrégats, aucune donnée personnelle)

Fenêtre : **30 jours, du 2026-10-19 au 2026-11-18**. Justification : la première ligne de `funnel_events` date du 2026-10-21, la fenêtre contient donc tout l'historique des étapes navigateur ; pour les étapes serveur, la mise en place date du 2026-11-14 (transactionnel 19:25 UTC, formulaire 21:27 UTC) : fenêtre « depuis la mise en place » = 4 jours.

**MESURÉ (étapes navigateur, visiteurs ayant consenti)**

| Étape | Lignes | Visiteurs distincts |
|---|---|---|
| `landing_vue` | 25 | 8 |
| `tarifs_vus` | 5 | 3 |
| `cta_clique` | 16 | 11 |
| `signup_started` | 10 | 5 |
| `signup_form_engaged` (code présent, cause non établie), `signup_submitted`, `signup_failed`, `signup_form_completed`, `checkout_*`, `trial_*`, `subscription_*` | **0** | 0 |

Cohorte (Q2, 21 visiteurs distincts hors `fp-test-`/`fp-cert-`) : 5 ont vu la page d'inscription et **5 n'ont aucune saisie enregistrée** (`signup_form_engaged` : 0 ligne alors que le code l'émet ; hypothèses non vérifiées : visiteurs sans saisie, préchargement ou robots, remplissage automatique sans événement `input`) ; 2 visiteurs ont vu landing et tarifs ; 2 ont vu landing puis l'inscription ; 1 a cliqué après les tarifs ; **10 visiteurs sur 11 ayant cliqué n'ont aucun `tarifs_vus`** (incohérence, voir D8).

**CONVERSIONS RÉELLES (hors tunnel, table `organizations`)** : 4 organisations au total, **1 créée dans les 30 jours** (2026-10-24, essai LIVE, désormais annulée) ; 0 ligne dans `funnel_events` pour elle (`org_ref` n'a jamais été renseigné en production : 0 ligne sur 56). `pending_signups` : 0 ligne (purge horaire) : le nombre de formulaires commencés mais non terminés est donc détruit.

**Taux** : aucun taux n'est publiable. Dénominateurs de 3 à 21 visiteurs : très en dessous d'un seuil d'interprétation (même seuil `insufficient_sample` que la PR #481). Les rapports bruts ci-dessus sont des comptages, pas des taux de conversion.

**Abandons par étape (formulation « sans suite observée », jamais « abandon » certain)**

| Passage | Mesuré ? | Chiffre |
|---|---|---|
| tarifs → clic plan | oui, biaisé | 2 visiteurs « tarifs sans clic » sur 3 ; 10 visiteurs « clic sans tarifs » : incohérent |
| clic → page d'inscription | oui, biaisé | 10 visiteurs « clic sans page d'inscription » sur 11 (clic possible sur le site vitrine, non lié) |
| page d'inscription → saisie | mesuré, non interprétable | 5 pages vues, 0 saisie enregistrée ; cause non établie |
| saisie → envoi (`signup_submitted`) → réponse (`signup_failed`) | indisponible | 0 donnée depuis le déploiement du 14/11 |
| inscription → paiement ouvert → essai | indisponible | 0 ligne ; 1 conversion réelle (24/10) antérieure à la mise en place |
| Retour Stripe | NM | absence de retour = « sans suite observée », jamais une preuve d'abandon |

**Livraison AI Lab (file durable)** : 5 jalons, **1 livré** (2026-11-17), **4 rejetés `rejected:400`** (2026-10-21 `visit`, 2026-11-08 ×2 et 2026-11-09 `signup_page`) ; `rejets_400` = 0 car ces lignes précèdent l'échelle de reprise (clôture immédiate). Cause non établie en production (hypothèse documentée dans la PR #482 : `fp_lid` inconnu) ; aucun jalon `signup`, `checkout`, `trial` n'a jamais été mis en file en production.

**Biais déclarés** : (1) seuls les visiteurs ayant accepté le cookie sont comptés ; la part de visiteurs sans consentement est **inconnue** (aucune mesure de l'audience totale) ; (2) le site vitrine n'est pas dans le dépôt : ses émissions ne sont pas auditables ; (3) fenêtre de ~4 semaines et ~20 visiteurs : fréquences non généralisables ; (4) une personne qui change d'appareil ou de navigateur compte deux fois.

### B.2 Test (« Flowpoint test »), séparément

Fenêtre : 2026-10-19 à 2026-11-18 (table depuis 2026-10-18). **Ces données ne sont pas du trafic réel** : elles proviennent de parcours automatisés de certification/E2E. Preuves : rafales les 13/11 (33 `signup_started`), 14/11 (11), 18/11 (9) avec des comptes quasi identiques à chaque étape ; 35 des 67 organisations ont un e-mail ou un nom synthétique, et 101 des 171 lignes rattachées à une organisation pointent vers une organisation absente de la base (supprimée après essai) ; 54 visiteurs de format UUID (278 lignes) contre 8 visiteurs `fp-test-` (27 lignes).

Exclusion appliquée : préfixes `fp-test-` et `fp-cert-` (Q1/Q2). Elle est **insuffisante** (D6) : les parcours UUID ne sont pas exclusibles par identifiant. Chiffres bruts, cohorte de 59 visiteurs : `signup_started` 56 → `signup_form_engaged` 56 → `signup_form_completed` 54 → `checkout_started` 53 → `checkout_completed` 35 → essai/abonnement actif 34 ; 20 « paiement ouvert sans suite observée », 1 « payé sans activation » ; 2 « saisie sans envoi accepté ». Ces nombres décrivent le comportement des scripts de certification, pas des clients : **aucun taux de conversion réel ne peut être tiré de la base de test**.

Utilisable comme validation de la chaîne : chaque étape serveur écrit bien une ligne, aucun `checkout_completed` en double par visiteur (37 lignes / 37 visiteurs), aucun doublon de jour sur les étapes navigateur.

Livraison AI Lab (test) : 29 jalons ; 16 livrés (`sent`/`duplicate`), 13 rejetés dont 9 `rejected:400:exhausted` le 2026-11-13 (`signup` 5, `checkout`, `signup_page`, `signup_started`, `trial` 1 chacun : exactement le profil décrit dans la PR #482 pour les `fp_lid` de certification) et 4 clôturés par 400 le 2026-10-21 (avant l'échelle de reprise).

## C. Défauts démontrés, classés par impact

| # | Défaut | Preuve | Impact | Correction minimale proposée (non implémentée) |
|---|---|---|---|---|
| **D1** | **Divergence de code production / Test-Replit** : la production a `funnel-tracking.js`, `signup_submitted/failed`, le comptage transactionnel LIVE hors consentement, les UTM et la contrainte d'étapes ; Test-Replit n'a rien de cela. | `git ls-tree origin/Flowpoint` : `funnel-tracking.js` présent, absent de Test-Replit ; `ETAPES_TUNNEL` 16 vs 12 étapes ; tests `funnel-tracking-inscription.test.ts` présents seulement sur `Flowpoint` | Certification non représentative ; promotion de Test-Replit = perte de mesure | Reporter les PR #461/#464/#465 et `funnel-tracking.js` sur Test-Replit avant toute promotion ; puis vérifier en conditions réelles que `signup_form_engaged` s'écrit en production (0 ligne sur 5 vues d'inscription) |
| **D2** | **Jeton d'inscription stocké en clair et durablement** dans la clé d'idempotence : `signup_form_completed:<jeton pre-register>` (64 car.). Ce jeton autorise `POST /public/checkout-session` / `payment-intent` (`isValidPreRegisterToken`, `public-billing.ts:232-246`) tant que le pending signup est valide (jusqu'à 7 jours). La table n'est jamais purgée. | `auth.ts:1175` ; BASE test : 64 clés de 64 caractères, toutes distinctes ; identique en production (`Flowpoint` `auth.ts:1305`, 0 ligne à ce jour car aucun inscrit consentant) | Confidentialité et sécurité : dépôt durable d'un secret de session dans une table de mesure ; contredit « aucune donnée personnelle / aucun secret » | Remplacer par un condensé (`sha256(jeton)` tronqué) dans la clé, côté code, avant la première inscription consentante en production ; purger/chiffrer les lignes de test existantes |
| **D3** | **Double comptage à l'échelle de l'organisation** : `trial_activated` et `subscription_activated` ont pour clé l'abonnement Stripe ; l'abonnement des add-ons est un second abonnement (`signup-subscription.ts:350-371`, `source: checkout_payment_addons`) qui émet aussi une ligne | BASE test : 11 organisations sur 60 avec 2 `trial_activated` ; 5 sur 58 avec 2 ou 3 `subscription_activated` | Surestime les essais et abonnements payants ; fausse le taux essai → payant | Clé par organisation (`trial_activated:<orgId>`) ou ignorer les abonnements dont `metadata.source = checkout_payment_addons` |
| **D4** | **Identifiants non reliés** : `org_ref` n'est renseigné que sur les étapes webhook ; `signup_form_completed` et `checkout_started` n'ont pas d'organisation ; l'abonnement des add-ons ne porte pas la métadonnée visiteur (`signup-subscription.ts:363-368`) ; `trial_activated` / `subscription_activated` ne portent pas le plan | BASE test : 40 `trial_activated` et 65 `subscription_activated` sans visiteur (98 % pour ce dernier) ; production : `org_ref` nul sur 56 lignes alors que l'organisation du 24/10 existe | Impossible de rapprocher inscription, paiement et essai par visiteur ; la conversion réelle d'octobre est sans trace | Ajouter `metadataAttributionFunnel` à l'abonnement des add-ons ; passer `plan` dans l'appel webhook ; écrire `org_ref` aussi sur `checkout_*` quand l'organisation existe |
| **D5** | **Rejets silencieux** : 400, 204 sans consentement, 429 (60/min/IP, NAT partagé) et erreur d'écriture ne laissent aucune trace chiffrée ; la route renvoie 204 même quand l'écriture échoue | `public-billing.ts:521-583`, `rateLimiter.ts:299` ; aucune table de rejets en base (production et test) | Pertes non quantifiables ; le taux de perte au consentement est inconnu | Fusionner la PR #481 (compteurs agrégés par motif, migration 029) ; distinguer doublon et échec dans la réponse interne |
| **D6** | **Exclusion des tests insuffisante** : `TEST_FILTER` ne retire que `fp-test-%` (`conversion-dashboards.ts:66`) ; les parcours de certification utilisent des UUID | BASE test : 278 lignes / 54 visiteurs UUID, rafales automatisées | Tableaux de bord de test non lisibles ; risque de contamination si un parcours de certification tourne en production | Imposer un préfixe (`fp-cert-…`) aux visiteurs de certification et l'exclure partout, ou ajouter une colonne d'indicateur |
| **D7** | **Aucune mesure d'abandon** : `trial_expired` sans émetteur ; `cancel.html` et `?cancelled=1` muets ; `checkout_started` = création de l'intent, pas l'affichage du Payment Element ; `checkout_payment_failed` = refus de carte, pas abandon | `grep` du dépôt ; `cancel.html` sans script de mesure | Abandon observable seulement par déduction (« sans suite observée ») | Émettre `checkout_cancelled` depuis `cancel.html` et `checkout-return` (`cancelled=1`), sous consentement ; émettre `trial_expired` sur `customer.subscription.deleted` d'un essai ; ajouter `checkout_element_ready` après montage du Payment Element |
| **D8** | **Clic sur un plan non mesurable en production** : `funnel-tracking.js` n'envoie pas le plan (plan nul 16/16) et 10 visiteurs sur 11 « clic » n'ont aucun `tarifs_vus` | BASE production, Q2 ; `funnel-tracking.js` `send("cta_clique")` sans plan | Taux de clic par plan impossible ; tarifs → clic incohérent (cause non établie : clic émis par le site vitrine, ou vue non émise) | Lire `data-plan` du bouton cliqué et l'envoyer ; valider le plan côté serveur |
| **D9** | **Plan non validé et clé `cta_clique` sans plan** : texte libre ≤120 car. stocké dans `funnel_events.plan` ; le 2ᵉ plan cliqué le même jour est perdu | `public-billing.ts:555`, clé `cta_clique:visiteur:jour` | Pollution de la colonne ; sous-comptage des comparaisons de plans | Liste fermée `standard|pro|ultra` ; clé `cta_clique:plan:visiteur:jour` |
| **D10** | **File AI Lab : 4 jalons sur 5 rejetés en production, 13 sur 29 en test**, aucun jalon `signup/checkout/trial` en production ; le `fp_lid` est effacé à la clôture, la cause n'est plus vérifiable | BASE, requête Q6 ; PR #482 (cause inférée) | Attribution de la campagne perdue pour la majorité des visiteurs | Fusionner #461 (`fp_lid_sha8`) et #482 ; pointer `AI_LAB_CONVERSION_URL` de test vers l'AI Lab de test (autorisation requise) |
| **D11** | **Privacy** : Test-Replit stocke `org_ref` sans consentement pour les événements transactionnels, y compris mode test ; la production le retire | `stripe-webhook.ts:2294-2305` ; BASE test : 33 `trial_activated` et 64 `subscription_activated` sans visiteur mais avec `org_ref` | Écart avec la règle « sans consentement : ni visiteur, ni org » appliquée en production | Reprendre `enregistrerEtapeTransactionnelle` de #465 |

## D. Ce qui reste à décider (responsable)

Les corrections ci-dessus sont décrites, non implémentées. Priorité suggérée : D2 (avant la 1ʳᵉ inscription consentante en production), D1, D3/D4, D5, puis D7 pour obtenir un abandon observable.
