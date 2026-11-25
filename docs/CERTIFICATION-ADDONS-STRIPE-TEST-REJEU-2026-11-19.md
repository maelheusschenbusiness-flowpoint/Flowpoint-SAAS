# Rejeu certification add-ons Stripe TEST apres correctif #511 (19 novembre 2026)

Cible : `https://flowpoint-test.onrender.com`, deploiement `dep-dbvkqhe7bikc739r15n0` (commit `155c8802`, PR #511), live a 19:30:43Z. Stripe : compte Flowpoint `acct_1StVIr9eqtbj6iPB`, `livemode:false` sur chaque objet. Base de test Supabase `rrjllaiodpvtsphrtdqd` en lecture seule. Aucun secret affiche. Production, LIVE et Flowpoint non touches.

Pre-requis : les 6 tables (`organic_campaign_goals`, `technical_seo_fix_verifications`, `seo_change_impact_settings`, `local_presence_settings`, `local_landing_opportunity_settings`, `agency_portfolio_priority_settings`) existent dans `information_schema` apres le deploiement.

Methode : 4 organisations jetables fraiches creees par le vrai parcours d'inscription navigateur (carte 4242, essai) via `20-addons-a-comptes.stripe.ts` (CERT_A_COMPTES=oct:pro,tsf:standard,sci:pro,coe:pro) ; session par jeton magic-link lu en base puis `POST /api/auth/login-verify` (en-tete Origin de la beta) ; achat par `POST /api/addons/:key/activate`.

| Etiquette | Add-on | Plan | Org | Client Stripe | Abonnement plan |
|---|---|---|---|---|---|
| oct | organicCampaignTracker | Pro | `774e1e78-13bc-4bc9-8f7f-0754aca5ca67` | `cus_VeuzqPUZjfbGh8` | `sub_1Udb9D9eqtbj6iPBr8hoNQAo` |
| tsf | technicalSeoFixVerification | Standard | `f4d5b5a4-91d1-448c-822d-5e3551645a29` | `cus_VeuzUc1CUZxcni` | `sub_1Udb9X9eqtbj6iPBrnqWFzVf` |
| sci | seoChangeImpact | Pro | `ac460483-491d-4472-8909-317ec27f02f9` | `cus_VeuzLa8WIcLpn2` | `sub_1Udb9t9eqtbj6iPBrSwXVqLP` |
| coe | conversionOpportunityEngine | Pro | `d302febb-eeff-487e-820f-bc0a18ab1470` | `cus_Vev05DrLwglrIi` | `sub_1UdbAH9eqtbj6iPBCve7H2hh` |

## Verdict
| Add-on | Verdict | Raison |
|---|---|---|
| Organic Campaign Tracker | **BLOCKED** | Controle 5 en echec : `subscription_status` de l'organisation passe de `trialing` a `active` apres l'achat (defaut D5 ci-dessous). Controles 1-4, 6, 7 reussis. |
| Technical SEO Fix Verification | **BLOCKED** | Idem (controle 5). |
| SEO Change Impact | **BLOCKED** | Idem (controle 5). |
| Conversion Opportunity Engine | **BLOCKED** | Idem (controle 5). |

Les defauts D1 (tables), D2 partiel (identifiant d'abonnement et periode preserves), D3 (droit retire apres annulation Stripe en TEST) et D4 (triple facturation) sont corriges en reel. Reste un seul defaut : le statut.

## Matrice (tout REEL : bêta + Stripe TEST)
| # | Controle | oct | tsf | sci | coe |
|---|---|---|---|---|---|
| 1 | Prix Stripe = catalogue | `price_1UUTPd9eqtbj6iPB6fNR5kLx` 1200 EUR/mois = 12 EUR (OK) | `price_1UUTPd9eqtbj6iPBe2g6bpJF` 1900 = 19 EUR (OK) | `price_1UUTPd9eqtbj6iPB18duKFQq` 1500 = 15 EUR (OK) | `price_1UUTPc9eqtbj6iPBcsDZykLW` 1200 = 12 EUR (OK) |
| 2 | Achat reel : abonnement add-on actif, facture payee | `sub_1UdbJp9eqtbj6iPBPgLgY0Fc` active ; `in_1UdbJp9eqtbj6iPB14ZY86e4` (25GAA0PF-0415) paid 1200 ; 19:48:23-31Z (OK) | `sub_1UdbJx9eqtbj6iPB4lWGcFTm` active ; `in_1UdbJx9eqtbj6iPBitS0Sfme` (-0416) paid 1900 (OK) | `sub_1UdbK59eqtbj6iPBwLKeWgOU` active ; `in_1UdbK59eqtbj6iPBXh66T0Kw` (-0417) paid 1500 (OK) | `sub_1UdbKD9eqtbj6iPBjRZvks2o` active ; `in_1UdbKD9eqtbj6iPBvoCbfAbg` (-0418) paid 1200 (OK) |
| 3 | Webhooks recus/traites | `billing_events` : customer.subscription.created 19:48:31, invoice.payment_succeeded 19:48:32, payment_intent.succeeded 19:48:32 ; journaux Render `[Webhook] Received Stripe event`, `orgId resolved` (OK) | 3 evenements 19:48:39-40 (OK) | 3 evenements 19:48:47-48 (OK) | 3 evenements 19:48:55-56 (OK) |
| 4 | Droits : 402 sans, 200 avec | 402 `ADDON_REQUIRED` GET et POST ; avec add-on GET 200, POST 200 (campagne creee `e98c25c2-b37c-4212-94c1-03e19c7e0b4d`, relue) ; `org_addons.active=true` (OK) | 402 GET et POST verify ; avec add-on GET 200 ; POST verify 404 `AUDIT_NOT_FOUND` (porte franchie, pas d'audit jetable pour un succes complet) ; org_addons actif (OK, partiel POST) | 402 GET et PUT ; avec add-on GET 200, PUT settings 200 `{lookbackDays:45,minimumScoreChange:5}` relu (OK) | 402 GET et PUT ; GET 200, PUT 200 `{minimumSessions:300,maximumConversionRate:0.03}` relu (OK) |
| 5 | Abonnement principal inchange | **ECHEC** : `stripe_subscription_id` et `current_period_end` (2026-12-03 19:37:23Z) inchanges, mais `subscription_status` `trialing` -> `active` alors que Stripe garde le plan `trialing` | **ECHEC** (meme constat, periode 19:37:44Z) | **ECHEC** (periode 19:38:06Z) | **ECHEC** (periode 19:38:29Z) |
| 6 | Anti double facturation | 3 `POST /activate` simultanes (19:48:23Z) : 1 `item_added` + 2 `already_on_subscription` ; un seul abonnement add-on ; rejeu sequentiel `already_on_subscription` (OK) | idem : 1 `item_added`, 2 `already_on_subscription`, rejeu OK (OK) | idem (OK) | idem (OK) |
| 7a | `POST /deactivate` | 200 `item_removed` (20:12:01Z, plus de 502) ; `sub_1UdbJp...` `canceled` (`cancellation_requested`) ; `org_addons.active=false` ; GET -> 402 (OK) | 200 `item_removed` ; abonnement annule (plus aucun actif) ; active=false ; 402 (OK) | idem (OK) | idem (OK) |
| 7b | Annulation Stripe d'un 2e abonnement | reactivation `item_added` -> `sub_1UdbhW9eqtbj6iPBcX8xDP8N` annule cote Stripe ; `customer.subscription.deleted` traite (20:16:45) ; `org_addons.active=false` ; 402 ; `stripe_subscription_id` plan inchange (OK) | `sub_1Udbhe9eqtbj6iPBAXZesdgj`, deleted 20:16:52, active=false, 402 (OK) | `sub_1Udbhl9eqtbj6iPBCRbVaGvt`, deleted 20:17:26 (OK) | `sub_1Udbht9eqtbj6iPBY6YzK7q2`, deleted 20:18:19 (OK) |

## Defaut restant
**D5 - le webhook `invoice.payment_succeeded` d'un abonnement d'add-on ecrase `organizations.subscription_status` (trialing -> active).** Fichier `artifacts/api-server/src/routes/stripe-webhook.ts`, l.2619-2624 : si `amount_paid > 0`, `persistSubscriptionMeta({ orgId, subscriptionStatus: "active" })` est appele sans verifier que la facture appartient a un abonnement `metadata.addonSub === "true"`. Le correctif #511 protege la branche `customer.subscription.*` (journal `[Webhook] abonnement d'add-on : etat de l'abonnement principal inchange`), mais l'add-on est facture immediatement (abonnement separe sans essai, `billing_reason subscription_create`, 12-19 EUR), donc `amount_paid>0` et la branche facture fait passer l'organisation en `active` pendant que Stripe garde le plan `trialing` (verifie : `sub_1Udb9D...` `trialing`, `trial_end` 2026-12-03). Preuve : etat de l'org lue en base avant/apres, identique sur les 4 organisations. Piste (non appliquee) : lire `invoiceSubscriptionDetails(obj).metadata["addonSub"]` (deja utilise plus bas pour le ledger vendeur, l.2640) et sauter `persistSubscriptionMeta` pour les factures d'add-on.

Observations : (a) e-mail d'activation non livre sur la beta (mailer de test bloque, inchange) ; (b) `billing_events.amount` vaut 0 pour `invoice.payment_succeeded` d'add-on alors que 1200-1900 centimes sont payes (non bloquant) ; (c) un succes complet de `POST /technical-seo-fix-verification/verify` n'a pas ete exerce (aucun audit disponible sur l'org jetable).

## Nettoyage (Stripe TEST, livemode false)
Abonnements annules (tous `canceled`) : plans `sub_1Udb9D9eqtbj6iPBr8hoNQAo`, `sub_1Udb9X9eqtbj6iPBrnqWFzVf`, `sub_1Udb9t9eqtbj6iPBrSwXVqLP`, `sub_1UdbAH9eqtbj6iPBCve7H2hh` ; add-ons cycle 1 `sub_1UdbJp9eqtbj6iPBPgLgY0Fc`, `sub_1UdbJx9eqtbj6iPB4lWGcFTm`, `sub_1UdbK59eqtbj6iPBwLKeWgOU`, `sub_1UdbKD9eqtbj6iPBjRZvks2o` ; add-ons cycle 2 `sub_1UdbhW9eqtbj6iPBcX8xDP8N`, `sub_1Udbhe9eqtbj6iPBAXZesdgj`, `sub_1Udbhl9eqtbj6iPBCRbVaGvt`, `sub_1Udbht9eqtbj6iPBY6YzK7q2`. Soit 12 abonnements, aucun abonnement d'autres clients touche. Clients TEST non supprimables par le connecteur : `cus_VeuzqPUZjfbGh8`, `cus_VeuzUc1CUZxcni`, `cus_VeuzLa8WIcLpn2`, `cus_Vev05DrLwglrIi`. Factures payees TEST (non remboursees) : 4 x premier achat (12+19+15+12) et 4 x reachat (12+19+15+12). Base de test : organisations et lignes jetables conservees.
