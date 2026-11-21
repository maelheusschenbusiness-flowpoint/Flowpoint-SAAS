# Certification add-ons Stripe TEST, lot 2 (21 novembre 2026)

Cible : `https://flowpoint-test.onrender.com` (service `srv-danup5egekts73a8og7g`, commit `88aba252`, PR #514 deploye). Stripe : `acct_1StVIr9eqtbj6iPB`, `livemode:false` sur chaque objet. Base de test Supabase `rrjllaiodpvtsphrtdqd` en lecture seule (aucune insertion). Production, LIVE, Flowpoint et Render (variables) non touches. Aucun secret affiche. Lecture Stripe seule : aucune ecriture Stripe n'a ete faite depuis le connecteur (consigne du responsable) ; toute annulation est passee par `POST /api/addons/:key/deactivate` du produit.

Methode (identique a D5/rejeu) : 4 organisations jetables par l'inscription navigateur reelle (carte 4242, essai 14 j, `20-addons-a-comptes.stripe.ts`, `CERT_A_COMPTES=apo:pro,lla:pro,lpo:standard,gbp:pro`) ; session par jeton magic-link lu en base puis `POST /api/auth/login-verify` (Origin de la beta) ; achat par `POST /api/addons/:key/activate`.

## Verdict
| Add-on | Plan | Verdict |
|---|---|---|
| Agency Portfolio Priorities (19 EUR) | Pro | **REUSSI**, partie « clics GSC » non verifiee, integration reelle absente |
| Local Landing Opportunities (15 EUR) | Pro | **REUSSI** pour achat/droits ; resultats non verifies, integration GSC reelle absente |
| Local Presence Optimizer (9 EUR) | Standard | **REUSSI** pour achat/droits ; analyse non verifiee, integration Google Business Profile reelle absente |
| GBP Performance & Leads (15 EUR) | Pro | **REUSSI** pour achat/droits ; performances non verifiees, integration Google Business Profile reelle absente |

Le controle 8b (annulation cote Stripe d'un 2e abonnement) est **non execute : ecriture Stripe refusee** ; il n'est pas simule.

## Prerequis
`GET /api/plans/catalog` : les 4 add-ons `availability=available`, `purchaseStatus=purchasable`, `allowedPlans=[standard,pro,ultra]`, montants 1900/1500/900/1500. Aucune variable Render modifiee. Les 7 tables des add-ons (dont `gbp_performance_settings`) existent.

## Organisations et etat AVANT achat (inscription 14:02-14:03Z, 21 nov)
| Etiquette | Org | Client | Abonnement plan (Stripe `trialing`) | subscription_status | trial_ends_at = current_period_end | updated_at |
|---|---|---|---|---|---|---|
| apo (Pro) | `2eb6800d-3fa5-4102-a653-fa3478d435c1` | `cus_Vfa2czZ8mcknYv` | `sub_1UeEs99eqtbj6iPBCwAKAQ1H` | trialing | 2026-12-05 14:02:25+00 | 14:02:40.125827 |
| lla (Pro) | `a717f0f4-2ec1-41f8-b191-e14615c87919` | `cus_Vfa2KTIXiFSY7t` | `sub_1UeEsW9eqtbj6iPBx9rRHD1T` | trialing | 2026-12-05 14:02:49+00 | 14:03:03.407802 |
| lpo (Standard) | `150e95c0-ae73-4a77-8f20-9eceea1b4ee0` | `cus_Vfa2M9cy2HMg57` | `sub_1UeEst9eqtbj6iPByaMEltr1` | trialing | 2026-12-05 14:03:11+00 | 14:03:26.311757 |
| gbp (Pro) | `56b6c784-6ccb-4bb5-839d-73fd123339d3` | `cus_Vfa3LxPO4XGtE2` | `sub_1UeEtF9eqtbj6iPBxqZX0qFq` | trialing | 2026-12-05 14:03:34+00 | 14:03:48.626974 |

## Matrice (REEL : beta + Stripe TEST)
| # | Controle | apo | lla | lpo | gbp |
|---|---|---|---|---|---|
| 1 | Prix Stripe = catalogue (EUR, mensuel, livemode false) | `price_1UUTPd9eqtbj6iPBR5a5qz9E` 1900 (OK) | `price_1UUTPc9eqtbj6iPBKZ9Zlbay` 1500 (OK) | `price_1UUTPc9eqtbj6iPBb5PEFUk5` 900 (OK) | `price_1UTosB9eqtbj6iPBjQmWEC2T` 1500 (OK) ; le prix porte `flowpoint_environment:test` (les 3 autres `render-test`) |
| 2 | 402 `ADDON_REQUIRED` avant achat (GET et PUT settings, 14:09:01-14:09:11Z) | OK | OK | OK | OK |
| 3 | Achat : un seul abonnement add-on actif, facture payee | `sub_1UeEyj9eqtbj6iPBnVxzU0Nr` active ; `in_1UeEyj9eqtbj6iPBib7cpkEW` (25GAA0PF-0436) paid 1900 `subscription_create` | `sub_1UeEyr9eqtbj6iPBpws5W8ri` ; `in_1UeEyr9eqtbj6iPBaGJ6eTPN` (-0437) paid 1500 | `sub_1UeEyy9eqtbj6iPBIk542IOg` ; `in_1UeEyz9eqtbj6iPB4TzOYeb3` (-0438) paid 900 | `sub_1UeEzI9eqtbj6iPB4aab1CnK` ; `in_1UeEzI9eqtbj6iPBs5zDhlN9` (-0439) paid 1500 ; tous `metadata.addonSub=true`, 1 article, prix du controle 1 (OK) |
| 4 | Webhooks traites (`billing_events`) | subscription.created 14:09:23, payment_intent.succeeded, invoice.payment_succeeded 14:09:24 | 14:09:31 | 14:09:39-40 | 14:09:59 (OK) ; journaux Render : `Received Stripe event`, `orgId resolved`, `plan-sync customer.subscription event received`, `abonnement d'add-on : etat de l'abonnement principal inchange`, `Add-on/AI credit payment excluded from seller ledger`, `Event status persisted` |
| 5 | Abonnement principal inchange apres achat, apres desactivation et apres reactivation | `trialing`, trial_ends_at, current_period_end, stripe_subscription_id et updated_at identiques a l'etat AVANT (relus 14:47Z) ; Stripe : plan toujours `trialing` (OK) | OK | OK | OK |
| 6 | Droits : 200 avec add-on ; `org_addons` actif ; aucun 500 « relation does not exist » | GET 200 ; PUT settings 200 `{priorityWeights:{flowpoint-test.onrender.com:5}}` ; poids 9 -> 400 `INVALID_AGENCY_PORTFOLIO_SETTINGS` ; org_addons active 14:09:25 (OK) | GET 200 ; PUT 200 `{services:[plombier,chauffagiste],locations:[Lyon,Paris]}`, relu par GET ; listes vides -> 400 ; active 14:09:33 (OK) | GET 200 `connected:false` ; PUT 200 `{trackedFields:[phone]}` (la valeur `website` invalide est ecartee en silence) ; `locationId` inconnu -> 404 ; active 14:09:41 (OK) | GET 200 `configured:false` ; PUT 200 `{periodDays:7,goals:{CALL_CLICKS:50,WEBSITE_CLICKS:120},alertDropPercent:25}`, relu ; `periodDays:14` -> 400 ; `locationId` inconnu -> 404 ; active (OK) |
| 7 | 3 `POST /activate` simultanes => un seul abonnement | Cycle 1 (14:09:16-51Z) : les reponses ont ete perdues par un defaut de mon script (fichiers de sortie ecrases), preuve par Stripe : un seul abonnement add-on par client apres l'achat (liste `GetSubscriptions`) ; gbp : 3 appels 200 = 1 `item_added` + 2 `already_on_subscription` (14:09:51Z). Cycle 2 (reactivation, 14:19:25-49Z), reponses conservees : pour chacun 1 `item_added` + 2 `already_on_subscription`, et recherche Stripe : exactement 1 abonnement add-on actif par client (`sub_1UeF8Y9eqtbj6iPBKxGfTDHl`, `sub_1UeF8g9eqtbj6iPBgxEKbAew`, `sub_1UeF8o9eqtbj6iPBNYHuvDCW`, `sub_1UeF8w9eqtbj6iPBpsEVWyec`). Verdict : REUSSI sur les 4 (reponses du cycle 1 non conservees pour apo/lla/lpo, donc concurrence prouvee par le cycle 2) |
| 8a | `POST /deactivate` => 200, abonnement annule, droit retire, 402 | 200 `item_removed` 14:15:09Z ; Stripe `canceled`, `cancellation_requested` ; `customer.subscription.deleted` 14:15:12 ; org_addons false ; GET 402 | 200 14:15:16Z, deleted 14:15:19, 402 | 200 14:15:23Z, deleted 14:15:26, 402 | 200 14:15:29Z, deleted 14:15:32, 402 (OK) ; le cycle 2 est aussi desactive (14:47:28-45Z, deleted 14:47:31-48, 402, recherche Stripe : plus aucun abonnement add-on actif) |
| 8b | Annulation cote Stripe d'un 2e abonnement => `customer.subscription.deleted` => droit retire | NON EXECUTE : ecriture Stripe refusee | idem | idem | idem |
| 9 | Fonctionnalite | Audits reels crees par l'API (`POST /api/audits` puis `force:true` : `a17952703812427us`, `a1795270435586q68`, score 86, 14 problemes) ; `GET` -> 1 priorite `flowpoint-test.onrender.com`, `urgent`, score 86, poids 5 (REUSSI). `monthlyOrganicClicks:null` : clics GSC **non verifie, integration reelle absente** | PUT/GET reels (parametrage). `opportunities:[]` : necessite des donnees Google Search Console reelles (`gsc_keyword_data`) : **non verifie, integration reelle absente** (rien insere en base) | Parametrage reel. L'analyse exige des fiches `google_locations` synchronisees depuis Google Business Profile : **non verifie, integration reelle absente** | Parametrage reel. Les performances (API Business Profile Performance, jeton Google) et les alertes de baisse : **non verifie, integration reelle absente** |

## Defauts produit (non corriges)
Aucun defaut bloquant : le correctif D5 tient, `subscription_status` reste `trialing` sur les 4 organisations a chaque etape. Observations :
1. `artifacts/api-server/src/routes/agency-portfolio-priorities.ts` l.80 : `criticalIssues: Number(current["issues"])` prend le nombre TOTAL de problemes de l'audit, et la raison affichee est « 14 critical technical issues » alors que l'audit n'en distingue pas la gravite ici. Libelle trompeur.
2. `artifacts/api-server/src/routes/gbp-performance.ts` l.25, 39, 122 : les requetes passent par `pool.query` global avec filtre `org_id` manuel, a la difference des trois autres routes du lot qui utilisent `req.orgDb`. Pas de fuite constatee ; incoherence d'approche (le contexte tenant RLS n'est pas pose).
3. `artifacts/api-server/src/routes/local-presence-optimizer.ts` (PUT `/local-presence/settings`) : les champs inconnus sont ecartes en silence (`website` -> enregistre `[phone]` sans erreur).
4. Journal `[Webhook] invoice.payment_succeeded: €0 invoice — subscription status left to customer.subscription.* events` emis pour une facture d'add-on payee 900-1900 centimes, et `billing_events.amount = 0` pour ces factures (deja signales en D5, inchanges).
5. Le prix GBP Performance & Leads (`price_1UTosB...`) est etiquete `flowpoint_environment:test`, les trois autres `render-test` ; le comportement est correct.

## Etat Stripe TEST apres campagne et reste a annuler
Abonnements add-ons `canceled` (8, via `/deactivate` du produit) : cycle 1 `sub_1UeEyj9eqtbj6iPBnVxzU0Nr`, `sub_1UeEyr9eqtbj6iPBpws5W8ri`, `sub_1UeEyy9eqtbj6iPBIk542IOg`, `sub_1UeEzI9eqtbj6iPB4aab1CnK` ; cycle 2 `sub_1UeF8Y9eqtbj6iPBKxGfTDHl`, `sub_1UeF8g9eqtbj6iPBgxEKbAew`, `sub_1UeF8o9eqtbj6iPBNYHuvDCW`, `sub_1UeF8w9eqtbj6iPBpsEVWyec`.

**Reste a annuler (abonnements de plan, toujours `trialing`, non annules faute d'ecriture Stripe)** : `sub_1UeEs99eqtbj6iPBCwAKAQ1H`, `sub_1UeEsW9eqtbj6iPBx9rRHD1T`, `sub_1UeEst9eqtbj6iPByaMEltr1`, `sub_1UeEtF9eqtbj6iPBxqZX0qFq`. Clients TEST non supprimables : `cus_Vfa2czZ8mcknYv`, `cus_Vfa2KTIXiFSY7t`, `cus_Vfa2M9cy2HMg57`, `cus_Vfa3LxPO4XGtE2`. Factures payees TEST non remboursees : 2 x (19 + 15 + 9 + 15) EUR. Base de test : organisations, 2 audits et reglages jetables conserves.
