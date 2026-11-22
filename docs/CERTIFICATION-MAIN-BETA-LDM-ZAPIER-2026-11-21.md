# Certification beta Local Domination Maps et Zapier/Make (21 novembre 2026)

Cible : `https://flowpoint-test.onrender.com` (service `srv-danup5egekts73a8og7g`), code de production temporaire (branche `cert/flowpoint-797cd9f5-stripe-safe`, commit `78dc73d6`). Stripe : `acct_1StVIr9eqtbj6iPB`, `livemode:false` partout. Base de test Supabase `rrjllaiodpvtsphrtdqd` en lecture seule (aucune insertion). Production, LIVE, Flowpoint-Main et variables Render non touches. Aucun secret affiche.

## Verdict : campagne ARRETEE, 5xx systematique a l'inscription (aucun controle 2 a 7 possible)

Aucune organisation Pro/Ultra jetable ne peut etre creee sur ce deploiement : `POST /api/public/finalize-checkout` repond 500 pour les plans Pro et Ultra. Sans organisation Pro/Ultra, ni l'achat, ni les droits, ni les 402 ne peuvent etre prouves sur objet reel. Pas de contournement par insertion en base (interdit).

### Cause (journaux Render, sans secret)
- Pro, 22:57-23:03Z puis 23:03:17Z : `[PublicBilling] finalize-checkout failed ... No such price: 'price_1StW0A9eqtbj6iPB8GcUCuwQ'; a similar object exists in live mode, but a test mode key was used`.
- Ultra, 23:19:12Z : meme erreur avec `price_1StW109eqtbj6iPBgiD1uRtP`.
- Ces ids sont les valeurs LIVE par defaut de `artifacts/api-server/src/lib/plans.ts` l.130-134 (`PLAN_PRICE_IDS`, repli sur l'id LIVE quand `STRIPE_PRICE_ID_PRO` / `STRIPE_PRICE_ID_ULTRA` ne sont pas definies). Le service tourne avec une cle TEST : le prix LIVE est introuvable. `PLAN_PRICE_IDS_TEST` (l.139-146) n'est qu'un filet de resolution de plan, pas utilise a la creation de l'abonnement. Cote Render, `STRIPE_PRICE_ID_PRO` et `_ULTRA` semblent absentes ou LIVE (je n'ai pas le droit de lire/modifier les variables). Des organisations Standard creees par d'autres campagnes a 23:03-23:04Z ont, elles, un abonnement `trialing` (le prix Standard se resout) ; une autre campagne (`fp-cert-aud200`, org `60c6ad68-...`, Pro) a le meme symptome (`stripe_subscription_id` null a 23:00Z).
- Les deux add-ons exigent Pro/Ultra : la certification est bloquee. Il faut poser les variables de prix TEST Pro/Ultra sur Flowpoint-Test (decision hors de ma mission), puis relancer.

### Adaptation tentee
La page d'inscription du code de production enchaine formulaire puis choix du plan (`signin.html`, `choosePlan()` l.570) : le script D5/lot 2 (`20-addons-a-comptes.stripe.ts`) restait donc bloque sur le choix du plan. J'ai ajoute un script temporaire (non committe, supprime) qui clique la carte du plan ; il atteint le Payment Element, la carte 4242 est acceptee (SetupIntent), puis `finalize-checkout` echoue en 500 comme ci-dessus.

## Controle 1 (prix catalogue = prix Stripe TEST) : REUSSI
`GET /api/plans/catalog` (21 nov, 22:5xZ) :
| Add-on | Catalogue | Stripe TEST (livemode false, mensuel, EUR, actif) |
|---|---|---|
| localDominationMaps | 2400 (24 EUR), allowedPlans `[pro,ultra]`, available | `price_1UeLpi9eqtbj6iPB8Oqf7jj5` unit_amount 2400, `prod_VfhCn1J22TPluN` |
| zapierIntegration | 1900 (19 EUR), allowedPlans `[pro,ultra]`, beta | `price_1UeLqd9eqtbj6iPBY74dnZAe` unit_amount 1900, `prod_VfhCuvmgJkeo92` |

## Controles 2 a 7 : NON VERIFIE (inscription Pro/Ultra impossible)
Controles 2 (402 avant achat), 3 (achat, facture, webhooks), 4 (droits), 5 (plan inchange), 6 (3 activations simultanees), 7 (desactivation, annulation Stripe) et le 403 Standard de Local Domination Maps : non executes. Aucun objet d'add-on cree.
Revue de code seule (non une preuve) : `local-maps.ts` l.15 garde `requireAddon("localDominationMaps")` sur `/local-maps` ; `integrations.ts` l.131, l.158 gardent `zapier/connect` et `make/connect` ; l.179-181 la route generique refuse zapier/make sans add-on.

## Defauts produit (non corriges)
1. `artifacts/api-server/src/lib/plans.ts` l.130-134 : repli silencieux sur des ids de prix LIVE quand la variable d'environnement est absente ; en mode TEST, l'abonnement Pro/Ultra echoue en 500 (`finalize-checkout`, journal `[PublicBilling] finalize-checkout failed`). Un echec apres 4242 accepte laisse une organisation Pro `trialing` sans abonnement Stripe (`stripe_subscription_id` null) et un client TEST orphelin.
2. `artifacts/api-server/src/routes/local-maps.ts` l.14 : le commentaire « purchasable add-on (any plan) » contredit le catalogue (Pro/Ultra).

## Nettoyage (Stripe TEST)
Aucun abonnement cree par cette campagne (0 abonnement a annuler). Clients TEST crees, non supprimables par le connecteur, sans abonnement : `cus_Vfikn577NADmxK` (org `5d914133-6384-422a-ab9e-777ee0b086d2`, Pro, 23:03Z), `cus_Vfj027SloxS4Qj` (org `457c9158-bb73-4795-813b-9c1ae436f87e`, Ultra, 23:19Z). Trois utilisateurs jetables `fp-cert-a-{ldm,zap,std}-*` (22:57-22:59Z, formulaire envoye, plan non finalise) existent en base de test. Les organisations d'autres campagnes n'ont pas ete touchees.

## Relance du 22 nov (apres pose de `STRIPE_TEST_PRICE_ID_PRO/ULTRA`, deploiement `dep-dc12fg43eqjs73fljpp0`, 23:29Z le 21)

Resultat : **l'inscription Pro echoue toujours, campagne arretee** (meme regle d'arret).
- Inscriptions navigateur (carte 4242) a 12:44Z : `ldm` (Pro) 500, `zap` (Pro) 500 ; `std` (Standard) reussi (`sub_1UeaAX9eqtbj6iPByfNCToAb`, essai, prix `price_1UAt5K9eqtbj6iPBVm8v6LRy` « Standard Monthly QA Test »).
- Journaux Render (12:44:34Z, 12:45:45Z, service `srv-danup5egekts73a8og7g-r4lsn`) : `[PublicBilling] finalize-checkout failed ... No such price: 'price_1StW0A9eqtbj6iPB8GcUCuwQ'` : toujours le prix Pro LIVE par defaut.
- Cause : `routes/public-billing.ts` l.524 et l.2429 lisent `PLAN_PRICE_IDS[plan]` (`lib/plans.ts` l.130-134, variables `STRIPE_PRICE_ID_STANDARD|PRO|ULTRA`). Les variables `STRIPE_TEST_PRICE_ID_*` posees alimentent seulement `PLAN_PRICE_IDS_TEST` (l.140-146, resolution inverse prix -> plan, l.623) et ne sont pas utilisees a la creation de l'abonnement. Il faut poser `STRIPE_PRICE_ID_PRO` et `STRIPE_PRICE_ID_ULTRA` avec les prix TEST (le Standard fonctionne, donc `STRIPE_PRICE_ID_STANDARD` est deja un prix TEST).

### Ce qui a pu etre prouve sur l'organisation Standard `fp-cert-m-std-mwrtzo3w@flowpoint.test` (`cus_Vfw2aOPUJLgBy8`, session magic-link + `login-verify`, 12:54Z)
| Requete | Reponse |
|---|---|
| `POST /api/addons/localDominationMaps/activate` | **403** `ADDON_PLAN_GATE`, `currentPlan:standard` (12:54:31Z) |
| `POST /api/addons/zapierIntegration/activate` | **403** `ADDON_PLAN_GATE` (12:54:33Z) |
| `GET /api/local-maps` (sans add-on) | 402 `ADDON_REQUIRED` (12:54:30Z) |
| `POST /api/integrations/zapier/connect` | 402 `ADDON_REQUIRED` (12:54:38Z) |
| `POST /api/integrations/make/connect` | 402 (12:54:40Z) |
| `POST /api/integrations/connections` platform `zapier` / `make` | 402 / 402 (12:54:42-43Z) |
| `POST /api/integrations/connections` platform `slack` | **500** `null value in column "provider" of relation "automation_integrations" violates not-null constraint` (12:54:45Z) |

Le controle 2 est ainsi observe sur une organisation Standard (pas Pro, donc partiel). Le controle « Standard ne peut pas acheter Local Domination Maps (403) » est **REUSSI**.

### Defaut supplementaire
3. `artifacts/api-server/src/routes/integrations.ts` (`POST /integrations/connections`, l.~184-195, insertion `automation_integrations`) : une plateforme autre (`slack`) repond 500 car la colonne `provider` (NOT NULL en base de test) n'est pas renseignee : la plateforme autorisee « comme avant » est en echec ; a confirmer sur le schema de production.
4. Metadonnees Stripe de l'organisation Standard : `orgId`/`org_id` valent l'e-mail (`fp-cert-m-std-...@flowpoint.test`) et non l'UUID d'organisation (client et abonnement) ; a verifier cote rapprochement webhook.

### Nettoyage du 22 nov
Abonnement annule (`canceled`, `cancellation_requested`, 12:56Z) : `sub_1UeaAX9eqtbj6iPByfNCToAb` (plan Standard, org jetable). Aucun abonnement d'add-on cree. Clients TEST non supprimables : `cus_Vfw2aOPUJLgBy8` (Standard), `cus_Vfw12nHi3A1rBA` (Pro, org `7176f9ed-77dc-45bf-a82c-f0b60d8fbd7d`, sans abonnement), `cus_Vfw0nKJAHYhBMG` (Pro, org `f0f6f1ba-4294-45e9-9893-f3336e387682`, sans abonnement), plus ceux du 21 nov.

## Relance du 22 nov, 13:19-13:25Z (commit `6885efbd`, `dep-dc1edvs3eqjs73ft3jd0`, 13:05Z) : inscription Pro REUSSIE, achat d'add-on en ECHEC (campagne arretee)

Inscription Pro corrigee (carte 4242, essai) :
| Etiquette | Org | Client | Abonnement plan (Stripe `trialing`, prix `price_1UQ53c9eqtbj6iPB4FVBZqzX` 7900) | DB avant achat |
|---|---|---|---|---|
| ldm (Pro) | `c72d7854-a4d1-4dff-9531-2664b0f3b7da` | `cus_VfwZ4VVEB4Txdg` | `sub_1UeagL9eqtbj6iPBILDrqI2y` | trialing, trial_ends_at 2026-12-06 13:19:49+00, current_period_end null, updated_at 13:19:51 |
| zap (Pro) | `912f8c57-0a88-4702-b2cc-be4cf3ad3a49` | `cus_VfwZiSCrVkK8JL` | `sub_1Ueagb9eqtbj6iPBr6n0SBbY` | trialing, trial_ends_at 2026-12-06 13:20:05+00, current_period_end null, updated_at 13:20:07 |

Controle 2 (402 avant achat), session magic-link + `login-verify`, 13:21:50-13:22:02Z : **REUSSI** pour les deux.
- LDM : `GET /api/local-maps`, `/heatmaps`, `/competitors`, `/opportunities`, `/visibility-scores` : 402 `ADDON_REQUIRED` chacun.
- Zapier/Make : `POST /integrations/zapier/connect`, `/make/connect`, `/integrations/connections` avec `zapier` puis `make` : 402 `ADDON_REQUIRED`.
- Plateforme `slack` sur `/integrations/connections` (org Pro, 13:22:02Z) : **500** `null value in column "provider" of relation "automation_integrations" violates not-null constraint`. Confirme sur Pro ; observation (defaut possible de schema de la base de test, non bloquant).

Controle 3 : **ECHEC**. 3 `POST /api/addons/localDominationMaps/activate` et 3 `POST /api/addons/zapierIntegration/activate` simultanes (13:22:05Z) : 6 reponses 502 `{"error":"La facturation Stripe de l'add-on a echoue - activation annulee","stripe":{"synced":false,"reason":"stripe_error"}}`. Journaux Render (13:22:10Z) : `[AddonSync] Stripe sync failed` -> `StripeInvalidRequestError`, `param: billing_cycle_anchor`, « The parameter `billing_cycle_anchor` expects a unix timestamp representing a date and time in the future. You specified the value `now` which is in the past. », pile `findOrCreateAddonSubscription (services/addon-stripe-sync.ts:118)` <- `syncAddonWithStripeUnlocked (:282)` ; cles d'idempotence `addon-sub:<org>:price_1UeLpi9eqtbj6iPB8Oqf7jj5` et `...:price_1UeLqd9eqtbj6iPBY74dnZAe`. Puis `[Addons] activation blocked - Stripe billing not secured`. Aucun abonnement d'add-on cree dans Stripe (liste des abonnements des deux clients : un seul, le plan) ; `org_addons` n'a aucune ligne `localDominationMaps` / `zapierIntegration` pour les deux orgs (activation correctement annulee, pas de droit accorde sans facturation).

Controles 4 a 7 (droits avec add-on, plan inchange apres achat, concurrence a 3 appels avec un seul abonnement, deactivate puis annulation Stripe) : **NON VERIFIE** (aucun achat possible). Je n'ai pas cree l'abonnement d'add-on a la main dans Stripe : ce ne serait pas la preuve du produit.

Defaut produit : `artifacts/api-server/src/services/addon-stripe-sync.ts` l.118-125 (`findOrCreateAddonSubscription`) passe `billing_cycle_anchor: "now"` a `stripe.subscriptions.create` ; l'API Stripe du compte TEST (abonnements en `billing_mode.type=flexible`) le refuse (la valeur `now` n'est acceptee qu'a la mise a jour, pas a la creation). Provoque le 502 sur tout achat d'add-on. Pistes : omettre le parametre (l'ancre par defaut est deja la creation) ou passer un timestamp.

Nettoyage : abonnements de plan annules (`canceled`, `cancellation_requested`, 13:25Z) : `sub_1UeagL9eqtbj6iPBILDrqI2y`, `sub_1Ueagb9eqtbj6iPBr6n0SBbY`. Clients TEST non supprimables : `cus_VfwZ4VVEB4Txdg`, `cus_VfwZiSCrVkK8JL` (plus ceux des relances precedentes). Aucun abonnement d'add-on a annuler.

## Rejeu final du 22 nov (commit `24a3c386`, `dep-dc1eqku0tbcc73akepa0`, 13:29Z) : achat d'add-on corrige, controles 3 a 7 REUSSIS, deux reserves de schema de la base de test

Organisations Pro jetables fraiches (inscription navigateur 13:31Z, carte 4242, essai) :
| Etiquette | Org | Client | Plan (Stripe `trialing`, `price_1UQ53c9eqtbj6iPB4FVBZqzX`) | DB avant (identique apres chaque etape, relue 17:29Z) |
|---|---|---|---|---|
| ldm | `168f4544-67ba-4a6b-b77d-b5a384f62f9f` | `cus_VfwkLWV7ijywmk` | `sub_1UearQ9eqtbj6iPBKpsKrPGI`, trial_end 1796563876 | trialing, trial_ends_at 2026-12-06 13:31:16+00, current_period_end null, updated_at 13:31:18.615158 |
| zap | `1b91dad7-a377-47fb-87a6-b6ab348c2cbc` | `cus_VfwlMIGKN8CQ7d` | `sub_1Uearg9eqtbj6iPBPFJ5mldt`, trial_end 1796563891 | trialing, trial_ends_at 2026-12-06 13:31:31+00, current_period_end null, updated_at 13:31:34.140162 |

| # | Controle | localDominationMaps | zapierIntegration |
|---|---|---|---|
| 3 | Achat : un seul abonnement d'add-on actif (`addonSub=true`), facture payee, webhooks, org_addons | **REUSSI** : 3 `POST /activate` simultanes 13:32:13Z = 1 `item_added` + 2 `already_on_subscription` (200). Un seul abonnement `sub_1UeasQ9eqtbj6iPBCyMmFtKB` `active`, metadata `{addonSub:true,orgId}`, prix 2400 ; facture `in_1UeasQ9eqtbj6iPBxKUHQQid` (25GAA0PF-0470) `paid` 2400 `subscription_create`. billing_events `processed` : subscription.created 1099, payment_intent.succeeded 1100, invoice.payment_succeeded 1102 (montant 2400, plus de 0). org_addons active 13:32:22.64Z | **REUSSI** : meme concurrence = 1 `item_added` + 2 `already_on_subscription`. `sub_1UeasQ9eqtbj6iPB1gofTVad` `active` `addonSub=true`, prix 1900 ; facture `in_1UeasQ9eqtbj6iPBXnYKdPQg` (-0469) `paid` 1900. billing_events 1097, 1098, 1101 (1900) `processed`. org_addons active 13:32:22.64Z |
| 4 | Droits avec l'add-on | **REUSSI (reserve)** : `GET /api/local-maps` 200 (`heatmaps:[]`, `summary` a null, etat vide honnete), `/heatmaps` 200 `count:0`, `/competitors` 200 `count:0`. Rien de fabrique : la creation de heatmaps/concurrents exige Google/DataForSEO reels, non testee. `/opportunities` et `/visibility-scores` : **500** `relation "local_opportunities"` / `"local_visibility_scores" does not exist` (ces 2 tables n'existent pas dans la base de test ; `local_heatmaps` et `competitor_map_results` oui) | **ECHEC pour le 201, garde levee prouvee** : avec l'add-on, `zapier/connect` et `make/connect` (avec `webhookUrl`) puis `connections` `zapier`/`make`/`slack` repondent **500** `null value in column "provider" of relation "automation_integrations" violates not-null constraint` (colonne `provider` NOT NULL sans defaut dans la base de test ; aucun INSERT du produit ne la renseigne : `routes/integrations.ts`, `services/integrations-service.ts` l.57). Plus aucun 402 (sans `webhookUrl` : 400 `webhookUrl requis`), donc la garde est levee ; aucune connexion creee. 201 NON obtenu |
| 5 | Abonnement principal inchange | **REUSSI** : DB identique avant/apres achat, desactivation, reactivation, annulation Stripe (trialing, trial_ends_at, current_period_end null, stripe_subscription_id, updated_at 13:31:18) ; Stripe plan `trialing` trial_end 1796563876 jusqu'a l'annulation de nettoyage | **REUSSI** (idem, updated_at 13:31:34, trial_end 1796563891) |
| 6 | 3 `POST /activate` simultanes | **REUSSI** (voir 3) | **REUSSI** (voir 3) |
| 7a | `POST /deactivate` : 200, abonnement annule, droit retire | **REUSSI** : 200 `item_removed` 17:26:46Z ; `sub_1UeasQ...CyMmFtKB` `canceled` (`cancellation_requested`) ; webhook `customer.subscription.deleted` 1139 `processed` ; org_addons false ; `GET /api/local-maps` 402 17:26:58Z | **REUSSI** : 200 `item_removed` 17:26:49Z ; `sub_1UeasQ...1gofTVad` `canceled` ; deleted 1140 ; `zapier/connect` et `connections` 402 17:26:59-17:27:01Z |
| 7b | Reactivation puis annulation directe Stripe (`DeleteSubscriptionsSubscriptionExposedId`) | **REUSSI** : reactivation 17:27:07Z (`item_added`, nouvel abonnement `sub_1UeeXj9eqtbj6iPBCaGpvKR2`, `GET /heatmaps` 200) ; annule dans Stripe 17:28:30Z ; `customer.subscription.deleted` `evt_1UeeZ19eqtbj6iPBZp9EKNK9` (id 1147) `processed` 17:28:32Z ; org_addons false ; `GET /api/local-maps` 402 17:29:06Z ; plan inchange | **REUSSI** : reactivation 17:27:13Z (`sub_1UeeXp9eqtbj6iPBwCBhfALT`) ; annule dans Stripe 17:28:52Z ; deleted `evt_1UeeZM9eqtbj6iPBxiZcoK4y` (id 1148) `processed` ; org_addons false ; `zapier/connect` 402 17:29:07Z ; plan inchange |

Note : l'horloge de la machine de test a saute entre l'achat (13:3xZ) et la suite (17:2xZ) ; les horodatages sont ceux des journaux et de la base.

Observations/defauts (non corriges) :
5. `automation_integrations.provider` NOT NULL sans defaut dans la base de test (la colonne n'est pas renseignee par le code) : bloque le 201 de Zapier/Make et de `slack`. A confirmer sur le schema de production : si la production a aussi cette colonne, c'est un defaut produit bloquant pour l'add-on Zapier/Make (le produit vendu ne fonctionne pas apres achat).
6. Tables `local_opportunities` et `local_visibility_scores` absentes de la base de test (`routes/local-maps.ts` l.145 et l.153 : 500 `relation does not exist` pour deux routes de lecture).
7. Les abonnements de plan portent `orgId`/`org_id` = e-mail dans leurs metadonnees Stripe (observation deja notee).

Nettoyage final : abonnements d'add-on `canceled` : `sub_1UeasQ9eqtbj6iPBCyMmFtKB`, `sub_1UeasQ9eqtbj6iPB1gofTVad` (via `/deactivate`), `sub_1UeeXj9eqtbj6iPBCaGpvKR2`, `sub_1UeeXp9eqtbj6iPBwCBhfALT` (annules dans Stripe). Abonnements de plan `canceled` (`cancellation_requested`, 17:32-17:33Z) : `sub_1UearQ9eqtbj6iPBKpsKrPGI`, `sub_1Uearg9eqtbj6iPBPFJ5mldt`. Clients TEST non supprimables : `cus_VfwkLWV7ijywmk`, `cus_VfwlMIGKN8CQ7d` (plus ceux des relances precedentes). Factures payees TEST non remboursees : 24 + 24 + 19 + 19 EUR (add-ons, deux cycles chacun).
