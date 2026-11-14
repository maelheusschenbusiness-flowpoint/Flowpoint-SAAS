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
