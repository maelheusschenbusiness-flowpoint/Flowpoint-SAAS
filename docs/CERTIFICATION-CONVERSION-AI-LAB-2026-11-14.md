# Certification du suivi des conversions SaaS -> AI Lab (TEST) — 2026-11-14

Statut : **PARTIEL.** Contrat, emetteur, file durable, confidentialite et reprise sur panne : prouves
par tests automatises reproductibles. Reception par l'instance AI Lab *deployee* : non prouvee de bout en
bout (voir "Intervention requise").

## 1. Cause exacte des erreurs de transmission observees

| Symptome (logs flowpoint-test / dashboard AI Lab) | Cause | Preuve |
|---|---|---|
| Refus `400` / `unknown_fp_lid` | Les `fp_lid` des tests synthetiques n'existent pas dans `lead_tokens` d'AI Lab : AI Lab refuse volontairement un jeton qu'il n'a pas emis. | La route repond, le secret est accepte (sinon 401), le corps est valide (sinon 400 sans `unknown_fp_lid`). URL, secret et route sont donc sains. |
| `TimeoutError` cote SaaS | Le dashboard AI Lab est sur un plan Render gratuit : il s'endort apres 15 min, reveil ~1 min, alors que l'emetteur coupe a 2 s (worker : 10 s). | Logs Render du service ; comportement non fatal deja couvert par la file durable (backoff, jusqu'a 60 min). |
| WireGuard / VPS | Non en cause : l'allowlist VPS protege le Postgres d'acquisition, pas l'endpoint HTTP du dashboard. | Lecture du code et des logs ; aucune erreur reseau de ce type. |

L'URL configuree sur `flowpoint-test` n'est pas lisible depuis le connecteur Render (valeurs masquees) : elle n'a pas
ete devinee ni modifiee. Aucune protection n'a ete desactivee. Aucun changement de code produit n'etait necessaire.

## 2. Ce qui est prouve (tests, sans secret ni reseau externe)

`src/tests/ai-lab-conversion-certification.test.ts` — 71 tests :
- **Contrat croise** : 59 cas (matrice complete etape x source, event_id, fp_lid, horodatage) generes par le
  validateur Python reel (`conversion_funnel.validate_event`, moteur commit 7c6c55e) et figes dans
  `src/tests/fixtures/ai-lab-validate-event.golden.json` ; le double TypeScript doit lui etre identique.
  14 combinaisons acceptees, 45 refusees.
- **Emetteur de production -> double AI Lab** : les 7 etapes emises par le SaaS (visit, signup_page,
  signup_started, signup, checkout, trial, paid) sont acceptees et persistees avec le bon `fp_lid` ; corps limite a
  5 champs, sans donnee personnelle ; doublon (retry) compte une fois ; `fp_lid` inconnu -> 400 ; mauvais secret -> 401 ;
  `fp_lid` invalide -> aucun appel reseau ; non configure -> aucun appel.
- **Panne puis reprise** : AI Lab arrete -> `unreachable` sans exception ; redemarre -> meme `event_id` accepte puis
  `duplicate`, une seule ligne.
- **Service endormi** : abandon au timeout configure, l'appelant n'est pas bloque.
- **Ordre** : jalons recus en desordre conserves avec leur horodatage d'origine (le funnel se calcule par `occurred_at`).
- **Logs** : ni `fp_lid`, ni secret, ni email.

Deja couverts avant cette phase (suites existantes) : file durable `conversion_event_outbox` (insert avant envoi,
reprises 15/60/180/360 min, 413/422 definitifs, `fp_lid` efface a la cloture, rattrapage Stripe), continuite
`fp_lid` -> `pending_signups` -> `organizations`, consentement analytique et GPC cote `funnel_events`
(`funnel-endpoint-db.test.ts`), isolation `fp-test-%` exclue des dashboards.

## 3. Mesurabilite du tunnel (rien d'invente)

| Etape demandee | Evenement | Mesure ? | Remarque |
|---|---|---|---|
| Visite vitrine | `landing_vue` | Oui, **visiteurs consentants seulement** | refus de consentement = aucun identifiant |
| Tarifs vus sans clic | `tarifs_vus` sans `cta_clique` | Oui (consentants) | calcul par difference de visiteurs |
| Clic abonnement sans inscription | `cta_clique` sans `signup_started` | Oui (consentants) | |
| Inscription commencee / non terminee | `signup_started`, `signup_form_engaged`, `signup_form_completed` | Oui (consentants) | `signup_form_engaged` = premiere saisie |
| Compte cree sans essai | `signup_form_completed` -> `trial_activated` | **Non en taux** | couvertures differentes (consentants vs tous) : le tableau de bord renvoie `mixed_coverage` plutot qu'un faux ratio |
| Paiement abandonne | `checkout_started` sans `checkout_completed` | Oui cote evenements serveur | l'ouverture du checkout est enregistree seulement avec consentement |
| Essai active / abonnement paye | `trial_activated`, `subscription_activated` (signes Stripe) | Oui, **tous les visiteurs** | |
| Paiement ou validation **refuse** (carte refusee, 3DS echoue) | aucun evenement tunnel dedie | **Non instrumente** | Stripe emet l'echec, mais il n'est pas projete dans `funnel_events` ni envoye a AI Lab. A ne pas presenter comme mesure. |
| Etape `checkout_completed` cote AI Lab | non emise a AI Lab | Non transmise | AI Lab recoit visit, signup_page, signup_started, signup, checkout, trial, paid |

Cote AI Lab, l'abandon se calcule par cohorte `fp_lid` entre etapes consecutives ; il ne concerne que les prospects portant
un `fp_lid` (trafic issu de la prospection), pas le trafic direct.

## 4. Intervention requise pour passer a "certification reelle"

Rien ne peut etre fait sans vous car cela touche des secrets et une instance AI Lab (aucun secret n'est a communiquer dans le chat) :
1. Dans AI Lab, creer un prospect **de test** dans un segment accepte (isolation : segment/jeu de donnees TEST, jamais une campagne) et noter son `fp_lid`
   uniquement dans le gestionnaire de secrets / variables de l'environnement de certification.
2. Sur Render `flowpoint-test`, verifier/poser `AI_LAB_CONVERSION_URL` (URL de `/events/conversion` de l'instance AI Lab TEST) et
   `CONVERSION_EVENT_SECRET` (meme valeur que l'AI Lab), via le tableau de bord Render. Aucun deploiement production.
3. Reveiller le dashboard AI Lab (plan gratuit) avant le run, ou accepter ~1 min de retards (la file durable les absorbe).
Ensuite le parcours Playwright "mode contrat" existant, lance avec ce `fp_lid` de test, produit des evenements reels a verifier dans AI Lab.

---

# Addendum — certification réelle sur instance AI Lab de TEST isolée, et mesure des abandons

## 5. Preuves réelles émetteur + récepteur

**Instance** : vrai code du moteur d'acquisition (`flowpoint-acquisition-engine`, commit 7c6c55e) lancé par gunicorn sur un Postgres local jetable,
nommé `flowpoint_acquisition` (la garde `Unexpected database` du moteur est conservée telle quelle). Aucun service payant, aucune donnée réelle,
aucun prospect réel, aucune campagne. Reproductible : `tools/certification-conversion/local-ailab.sh <chemin du moteur>`.

**Origine du `fp_lid`** : un prospect synthétique (`example.test`, segment `CLIENTS_FR_BE_SMB`) créé par `Store.upsert`, puis `Store.fp_lid_for` — le
mécanisme qu'AI Lab utilise pour un vrai prospect (`tools/certification-conversion/mint-synthetic-prospect.py`). Aucun jeton inséré à la main ; le validateur n'est pas contourné.
Le `fp_lid` n'apparaît jamais en clair (preuves : empreinte SHA-256 sur 8 caractères seulement).

**Script** : `tools/certification-conversion/real-ailab.ts` (vrai émetteur + vraie file durable sur la base SaaS de test, lecture de la base AI Lab pour la preuve côté récepteur).
Preuve archivée : `docs/proofs/conversion-ailab-isolated-2026-11-14.json`.

| Contrôle | Côté émetteur (SaaS) | Côté récepteur (AI Lab) |
|---|---|---|
| 7 étapes visit→paid | 7 lignes `delivered`, `last_status=sent:202`, `fp_lid` effacé à la clôture | 7 lignes `conversion_funnel_events` jointes au prospect du `fp_lid` (via `lead_tokens`), source correcte (saas / stripe) |
| Rejeu des mêmes `event_id` | 7 × `duplicate` (la file ne renvoie pas) | 7 lignes avant et après |
| Rejeu direct au récepteur (curl, même `event_id` ; puis autre `event_id`, même étape) | — | `202 {"duplicate":true,"recorded":false}` ×3, toujours 8 lignes : une jalon par prospect et par étape |
| AI Lab injoignable | `queued` en 8 ms (jamais bloquant), ligne `pending`, `unreachable` | rien reçu |
| 6 reprises échouées | `pending`, 7 tentatives, **pas `exhausted`** (seuls des 400 répétés épuisent) | — |
| AI Lab revient | `delivered` | 8 lignes, **0 doublon**, 8 après un nouveau rejeu |
| Journaux | aucun `fp_lid`, aucun secret | idem (le log AI Lab ne cite que stage/source) |

Réveil Render : l'émetteur coupe à 2 s (10 s pour le worker) ; une requête qui expire réveille quand même le service (~1 min). Après un échec réseau,
la reprise a lieu à +1 min, +2, +4… (plafond 60 min), et les erreurs réseau/timeout ne comptent jamais pour l'épuisement : la politique est compatible
avec un réveil d'environ une minute, sans augmenter le timeout ni créer de service.

**Limite restante** : la preuve porte sur l'instance isolée, pas sur `flowpoint-test` → dashboard AI Lab Render déployé (URL non lisible, secret non partagé).
Voir « Intervention requise » en section 4 : la même commande `real-ailab.ts` s'y applique avec `AI_LAB_CONVERSION_URL`, `CONVERSION_EVENT_SECRET`,
`CERT_FP_LID` d'un prospect de test réellement créé dans AI Lab, et `AI_LAB_VERIFY_DATABASE_URL` en lecture seule.

## 6. Décisions et corrections sur la mesure

**A. `checkout_completed`** — existe déjà côté SaaS (`setup_intent.succeeded`, `payment_intent.succeeded`, `checkout.session.completed`, sous consentement).
Décision : **ne pas l'ajouter au contrat AI Lab** (il dupliquerait `trial` : la même confirmation de carte aboutit à l'essai ; AI Lab ne compte qu'une jalon par étape et par prospect,
et sa liste d'étapes est fermée). Il est **exploité dans le tableau de bord SaaS** : nouvelle étape « Paiements confirmés » (couverture *consented*).
Conséquence : le taux `checkout_started → checkout_completed` est désormais calculé sur deux populations consentantes (abandon du paiement **mesurable**) ;
`checkout_completed → trial_activated` reste `mixed_coverage` (pas de taux). L'ancien taux direct `checkout_started → trial_activated`, qui mélangeait deux populations, est supprimé.

**B. Paiements refusés** — constat : le webhook Stripe TEST n'est abonné qu'à `invoice.payment_failed` (renouvellements), pas à `setup_intent.setup_failed` ni
`payment_intent.payment_failed` ; un refus lors de l'inscription n'atteint donc jamais le serveur. Plutôt que de modifier la configuration Stripe, la page de paiement
déclare désormais `checkout_payment_failed` quand `confirmSetup/confirmPayment` renvoie une erreur : **l'étape seule** (visiteur anonyme + source), jamais le motif, le code, le message Stripe ni une donnée bancaire ;
**sous consentement analytique** (sans consentement, rien n'est émis), au plus une fois par visiteur et par jour, sans jamais gêner l'affichage de l'erreur. Étape affichée au tableau de bord (*consented*),
**non transmise à AI Lab** (ce n'est pas un jalon de progression ; un événement commercial indispensable, lui, reste porté par Stripe : `invoice.payment_failed`).
Limite explicite : les refus de visiteurs non consentants ne sont pas comptés, le chiffre est un plancher.

Tests : `src/tests/checkout-payment-echec-mesure.test.ts` (corps sans donnée sensible, consentement, non-blocage), mise à jour de `conversion-dashboards-db.test.ts` et `funnel-events-db.test.ts`.

## 7. Indicateurs fiables (et limites)

| Indicateur | Population | Fiable ? |
|---|---|---|
| Visites vitrine, tarifs, clic CTA, inscription commencée, inscription validée, checkout ouvert, paiement confirmé | consentants uniquement | Oui, comme **taux entre étapes consentantes** ; jamais comme volume total de visiteurs |
| Échecs de confirmation de carte | consentants uniquement | Plancher, pas un total |
| Essais activés, abonnements payants | tous (signé Stripe) | Oui comme volumes ; **pas de taux depuis une étape consentante** (`mixed_coverage`) |
| Compte créé sans essai | — | Non mesurable en taux (populations différentes) ; volume « inscriptions validées » vs « essais » seulement indicatif |
| Refus de carte hors consentement, 3DS abandonné | — | Non instrumentés |
| Départ de la page d'accueil sans action | — | Non instrumenté (aucun événement de sortie) ; se déduit seulement de `landing_vue` − `tarifs_vus` sur les consentants |
