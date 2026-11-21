# Certification Stripe TEST des 4 add-ons de capacite sur le code Flowpoint (21 novembre 2026)

Cible : `https://flowpoint-test.onrender.com` (service `srv-danup5egekts73a8og7g`) executant temporairement la branche `cert/flowpoint-797cd9f5-stripe-safe`, commit `78dc73d6`. Stripe : `acct_1StVIr9eqtbj6iPB`, `livemode:false` sur chaque objet touche. Base de test Supabase `rrjllaiodpvtsphrtdqd` en lecture seule (aucune insertion ; seule ecriture : consommation d'un jeton magic-link par `login-verify`). Aucune variable Render modifiee, production, LIVE et Flowpoint-Main non touches. Aucun secret affiche.

## Verdict : campagne BLOQUEE, achats NON VERIFIES sur les 4 add-ons
Les 4 achats (`POST /api/addons/:key/activate`) ont echoue en **502 `stripe_error`** : l'environnement Flowpoint-Test n'a pas les identifiants de prix TEST des paquets, le code retombe sur les identifiants de prix LIVE et Stripe TEST les refuse (« No such price ... a similar object exists in live mode, but a test mode key was used »). Aucun objet LIVE n'a ete cree (refus cote Stripe), aucun droit n'a ete accorde (echec ferme), aucun abonnement d'add-on n'existe. Je n'ai pas contourne (variables Render et insertion en base interdites). Les controles 3 a 7 sont donc **NON VERIFIES** ; les prix TEST fournis n'ont pas pu etre exerces par l'application.

## Methode appliquee
Inscription navigateur reelle (Playwright, Chrome, `signin.html` -> `POST /api/auth/pre-register` -> choix du plan -> `checkout.html` -> `checkout-payment.html`, carte 4242, essai 14 j, `POST /api/public/finalize-checkout`), e-mails `@flowpoint.test`. Le formulaire de ce code exige prenom, nom, e-mail, societe, pays, adresse, ville, code postal puis un ecran de choix du plan. Session : jeton magic-link lu en base (lecture) puis `POST /api/auth/login-verify` avec `Origin` de la beta (jeton a usage unique : relance par `POST /api/auth/login-request` quand un jeton a ete consomme).

## Controle 1 : prix catalogue = prix Stripe TEST
`GET /api/plans/catalog` (21 nov, ~22:58Z, 200) : `auditsPack200` 1200, `auditsPack1000` 3900, `pdfPack200` 1200, `exportsPack1000` 1400 (EUR, `oneTime:false`, `quantity:true`, `availability:available`, plans standard/pro/ultra).

| Add-on | Prix Stripe TEST (livemode false, EUR, mensuel, licensed) | Montant | Catalogue | Resultat |
|---|---|---|---|---|
| auditsPack200 | `price_1U4p1Z9eqtbj6iPBMK549pDG` | 1200 | 1200 | Concordance des montants : OK |
| auditsPack1000 | `price_1U4p1Z9eqtbj6iPBiAru9aAj` | 3900 | 3900 | OK |
| pdfPack200 | `price_1U4p1a9eqtbj6iPB6sfEvQxC` | 1200 | 1200 | OK |
| exportsPack1000 | `price_1U4p1a9eqtbj6iPBw9O0eaJU` | 1400 | 1400 | OK |

Mais le catalogue affiche `priceEur` code en dur (`lib/plans.ts` l.319-322) : il ne prouve pas que l'achat utilise ces prix. L'achat utilise des identifiants differents (voir defaut 1). Controle 1 : **concordance montants/catalogue REUSSIE ; usage reel de ces prix par l'application ECHEC** (voir ci-dessous).

## Organisations jetables (Standard, essai 14 j, inscrites 23:03-23:04Z)
Le plan Pro est inutilisable sur cette beta (defaut 2). Une organisation Standard par add-on :

| Etiquette | Org | Client | Abonnement plan | Etat avant achat (23:09Z) |
|---|---|---|---|---|
| aud200 | `6891120c-dda1-49e9-b773-58661cf54b3e` | `cus_VfilAMxidXzZ8r` | `sub_1UeNJi9eqtbj6iPBYUciqjq3` | trialing, trial_ends_at 2026-12-05 23:03:34+00, current_period_end NULL, updated_at 23:03:36.479194 |
| aud1000 | `bdf1297f-fb17-4d4c-8cde-c1c2f10e9cbe` | `cus_VfildW3ObAMwTm` | `sub_1UeNK19eqtbj6iPBWyeCDCgn` | trialing, 2026-12-05 23:03:53+00, NULL, 23:03:55.229246 |
| pdf200 | `3b69c975-f517-4ce1-9060-7e1348348954` | `cus_Vfil7jL4rbzQST` | `sub_1UeNKI9eqtbj6iPBTmWv44Db` | trialing, 2026-12-05 23:04:09+00, NULL, 23:04:12.065096 |
| exp1000 | `a6264f9f-4b9a-44ef-b442-971ec7703cd5` | `cus_Vfil1WjfWT6sTh` | `sub_1UeNKY9eqtbj6iPBinThE8X3` | trialing, 2026-12-05 23:04:26+00, NULL, 23:04:28.459471 |

Plan Stripe : `price_1UAt5K9eqtbj6iPBVm8v6LRy` (Standard Monthly QA Test, 2900, TEST), `trialing`.

## Controle 2 : limites avant achat (API reelles `GET /api/addons`, `GET /api/me`, `GET /api/billing/usage`, 23:09:00-23:09:22Z)
Identique sur les 4 organisations : `quotas`/`limits` audits 30, reports 30, exports 30 (`/api/me` expose aussi `usage.pdf.limit` 30 et `/api/billing/usage` `pdfs` 30), monitors 10, seats 1. `orgAddons` ne contient que `whiteLabel` (inclus au plan) : aucun droit `auditsPack200`, `auditsPack1000`, `pdfPack200`, `exportsPack1000`. Resultat : **REUSSI** (limite de base et absence de droit relevees). Il n'existe pas de refus 402 `ADDON_REQUIRED` pour un paquet de capacite (le paquet ne protege pas une route, il augmente un quota).

## Controle 3 : achat quantite 1 : ECHEC (502), cause racine
`POST /api/addons/:key/activate {quantity:1}` avec une session authentifiee du proprietaire, pour chaque organisation :

| Add-on | Appel | Reponse | Journal Render (erreur) |
|---|---|---|---|
| auditsPack200 | 23:11:46Z | 502 `{"error":"La facturation Stripe de l'add-on a echoue - activation annulee","stripe":{"synced":false,"reason":"stripe_error"}}` | 23:11:50Z `[AddonSync] Stripe sync failed` : `No such price: 'price_1T6AMF9eqtbj6iPB03qrHCdP'; a similar object exists in live mode, but a test mode key was used` |
| auditsPack1000 | 23:11:57Z | 502 idem | 23:12:01Z `price_1T6AOu9eqtbj6iPBxmABnPUs` idem |
| pdfPack200 | 23:12:08Z | 502 idem | 23:12:12Z `price_1T6ARC9eqtbj6iPBHu7KoqLn` idem |
| exportsPack1000 | 23:12:19Z | 502 idem | 23:12:22Z `price_1T6ATb9eqtbj6iPBTc6dCm5q` idem |

Apres l'echec (snapshots 23:11:57-23:12:29Z) : `quotas` toujours 30/30/30, `orgAddons` sans le paquet, `subscriptionStatus` `trialing`. Le produit echoue donc de facon fermee (aucun droit gratuit, conforme au garde `billingSecured` de `routes/addons.ts`). Stripe (`GetSubscriptions` par client, statut all) : un seul abonnement par client, le plan ; **aucun abonnement d'add-on cree**, aucune facture d'add-on.

Controles 3 (abonnement `addonSub=true`, facture payee, webhooks, `org_addons`, +200/+1000), 4 (quantite 2), 6 (3 `activate` simultanes), 7 (deactivate puis annulation Stripe) : **NON VERIFIES** (preconditions impossibles). Controle 5 (abonnement principal inchange) : non exerce par un achat ; seule constatation : aucun changement de plan n'a eu lieu entre l'inscription et l'echec (`trialing`, memes valeurs avant/apres les appels, lues par `/api/me`).

Application reelle de la limite (402 a la quota) : **NON VERIFIE** (sans achat, 30 audits max a atteindre n'etait pas pertinent). Pour les paquets, l'expansion est calculee par `QTY_ADDON_GRANTS` (`lib/plans.ts` l.494-497) et `getQuotaLimits` ; « appliquee par checkQuota, prouvee par tests unitaires uniquement » (non verifie en reel ici).

## Defauts produit constates (non corriges)
1. **Prix TEST des paquets non cables dans l'environnement** (bloquant). `artifacts/api-server/src/lib/plans.ts` l.171-174 lit `STRIPE_TEST_PRICE_ID_ADDON_AUDITS200`, `..._AUDITS1000`, `..._PDF200`, `..._EXPORTS1000` ; absentes de Flowpoint-Test, la resolution retombe sur les identifiants LIVE par defaut (l.252-255 `price_1T6AMF...`, `price_1T6AOu...`, `price_1T6ARC...`, `price_1T6ATb...`) que Stripe TEST ne connait pas. Correction a apporter cote environnement : definir ces 4 variables avec les prix `price_1U4p1Z9eqtbj6iPBMK549pDG`, `price_1U4p1Z9eqtbj6iPBiAru9aAj`, `price_1U4p1a9eqtbj6iPB6sfEvQxC`, `price_1U4p1a9eqtbj6iPBw9O0eaJU` (non fait : variables Render interdites). Cote code : un environnement TEST ne devrait jamais retomber sur un identifiant LIVE (echec explicite `no_price_id` plutot que `stripe_error`).
2. **Prix TEST du plan Pro non cable** (bloquant pour Pro). `lib/plans.ts` l.132 (`pro` : `STRIPE_PRICE_ID_PRO` sinon `price_1StW0A9eqtbj6iPB8GcUCuwQ`) et l.143 (`STRIPE_TEST_PRICE_ID_PRO`). L'inscription Pro (23:00:22Z) : `POST /api/public/finalize-checkout` -> **500** `Erreur lors de la finalisation.` (journal : `No such price: 'price_1StW0A9eqtbj6iPB8GcUCuwQ'`). Standard fonctionne (`price_1UAt5K9eqtbj6iPBVm8v6LRy`). Consequence : l'organisation `60c6ad68-8125-4811-966b-beade0c4498d` (`cus_Vfih0HrEM3Pq8n`, plan `pro`, `trialing`, sans abonnement Stripe) est restee orpheline ; l'API a repondu 500 une seule fois (non systematique : Standard OK). A noter : `current_period_end` reste NULL en trialing sur ce code (vaut `trial_ends_at` sur Test-Replit, lot 2).
3. Meme erreur Stripe (« No such price ») remontee en 502 generique `stripe_error` sans indication de configuration ; le diagnostic exige les journaux Render.
4. Observation d'environnement : une autre campagne a tourne en parallele sur la meme beta (organisation `5d914133-6384-422a-ab9e-777ee0b086d2`, e-mail `fp-cert-ldm-ldm-mwr0kf94@flowpoint.test`, creee 23:03:17Z, plan Pro, `cus_Vfikn577NADmxK`) : non creee par cette campagne, non touchee.

## Nettoyage (Stripe TEST, livemode false)
Abonnements de plan annules (`DeleteSubscriptionsSubscriptionExposedId`, `canceled`, `cancellation_requested`, ~23:18-23:19Z) : `sub_1UeNJi9eqtbj6iPBYUciqjq3`, `sub_1UeNK19eqtbj6iPBWyeCDCgn`, `sub_1UeNKI9eqtbj6iPBTmWv44Db`, `sub_1UeNKY9eqtbj6iPBinThE8X3`. Aucun abonnement d'add-on n'a ete cree. Clients TEST non supprimables par le connecteur : `cus_VfilAMxidXzZ8r`, `cus_VfildW3ObAMwTm`, `cus_Vfil7jL4rbzQST`, `cus_Vfil1WjfWT6sTh`, et le client orphelin `cus_Vfih0HrEM3Pq8n` (sans abonnement). Aucune facture payee (essais gratuits, aucun debit). Base de test : 5 organisations jetables conservees (4 Standard + 1 Pro orpheline), jetons magic-link des 4 organisations consommes par login-verify (celui de aud200 re-emis par login-request apres consommation).

## Reprise
Apres definition des 4 variables `STRIPE_TEST_PRICE_ID_ADDON_*` (et `STRIPE_TEST_PRICE_ID_PRO` pour le plan Pro) sur Flowpoint-Test, rejouer les controles 3 a 7 avec des organisations Standard ; la methode, les scripts (inscription navigateur, login-verify, snapshots `/api/addons` `/api/me` `/api/billing/usage`) sont prets.
