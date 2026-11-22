# Certification Stripe TEST des 4 add-ons de capacite sur le code Flowpoint (21 novembre 2026)

Cible : `https://flowpoint-test.onrender.com` (service `srv-danup5egekts73a8og7g`) executant temporairement la branche `cert/flowpoint-797cd9f5-stripe-safe`, commit `78dc73d6`. Stripe : `acct_1StVIr9eqtbj6iPB`, `livemode:false` sur chaque objet touche. Base de test Supabase `rrjllaiodpvtsphrtdqd` en lecture seule (aucune insertion ; seule ecriture : consommation d'un jeton magic-link par `login-verify`). Aucune variable Render modifiee, production, LIVE et Flowpoint-Main non touches. Aucun secret affiche.

## Verdict final (22 novembre, commit 24a3c386) : controles 1 bis et 3 a 7 REUSSIS sur les 4 paquets ; historique des blocages ci-dessous
Les sections suivantes conservent l'historique des campagnes bloquees (21 nov puis 22 nov, correctifs 6885efbd et 24a3c386) ; la section « Troisieme rejeu » fait foi.

### Verdict de la premiere campagne (bloquee)
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

## Rejeu du 22 novembre (12:44-12:55Z) apres pose des variables de prix TEST
Contexte : variables `STRIPE_TEST_PRICE_ID_ADDON_AUDITS200/AUDITS1000/PDF200/EXPORTS1000` et `STRIPE_TEST_PRICE_ID_PRO/_ULTRA` annoncees posees, deploiement `dep-dc12fg43eqjs73fljpp0` (meme commit `78dc73d6`, live 21 nov 23:29Z, instance `r4lsn`). 4 nouvelles organisations Standard (inscription navigateur 12:44-12:45Z, `finalize-checkout` 200 : le plan Standard fonctionne toujours) :

| Etiquette | Org | Client | Abonnement plan | Etat avant achat |
|---|---|---|---|---|
| a200 | `971dc1ae-64e9-4e83-80d0-acf0efaba47b` | `cus_Vfw0W8IZcOB2Tv` | `sub_1Uea8B9eqtbj6iPBsP8ucPVj` | trialing, trial_ends_at 2026-12-06 12:44:31+00, current_period_end NULL, updated_at 12:44:34.813794 |
| a1000 | `6d6b5c0a-4673-4d74-9c21-d7e288ed024c` | `cus_Vfw0Dw5aFtZQGk` | `sub_1Uea8S9eqtbj6iPBXa4fCAJA` | trialing, 12:44:48+00, NULL, 12:44:50.838779 |
| p200 | `7d7c49e5-cc3b-4a59-98fc-141da1bc5aea` | `cus_Vfw0joiFNN72jE` | `sub_1Uea8j9eqtbj6iPBEjqFS3iU` | trialing, 12:45:05+00, NULL, 12:45:07.665532 |
| e1000 | `cbdc118a-afed-435f-a48e-c89ee0804e60` | `cus_Vfw0Dz8D6R9lhY` | `sub_1Uea909eqtbj6iPBdqrXtiYx` | trialing, 12:45:22+00, NULL, 12:45:24.985104 |

Limites avant achat (12:51-12:52Z) identiques a la premiere campagne : audits/reports/exports 30. Achat quantite 1 (`POST /api/addons/:key/activate`) : **502 `stripe_error` sur les 4** (a200 12:51:18Z, a1000 12:51:38Z, p200 12:51:57Z, e1000 12:52:16Z), limites inchangees (30/30/30), `trialing`. Journal Render a200 (12:51:22Z) : `[AddonSync] Stripe sync failed` : `No such price: 'price_1T6AMF9eqtbj6iPB03qrHCdP'` (prix LIVE) avec cle d'idempotence `addon-sub:971dc1ae-...:price_1T6AMF9eqtbj6iPB03qrHCdP:...`. Les variables TEST n'ont donc **pas** ete utilisees pour l'achat, que le deploiement les ait vues ou non.

**Cause racine code (defaut 5, bloquant)** : `artifacts/api-server/src/services/addon-stripe-sync.ts` l.164 (commit `78dc73d6`) : `const priceId = ADDON_PRICE_IDS[addonKey];` lit directement la table LIVE, sans passer par `getAddonPriceId(addonKey, stripeKey)` (`lib/plans.ts` l.188-192, qui applique la surcharge `ADDON_PRICE_IDS_TEST` avec une cle `sk_test_`). La version de Test-Replit (`origin/Test-Replit`, meme fichier l.163) utilise `getAddonPriceId(addonKey, stripeKey)` et n'a pas ce defaut. Le correctif Stripe de la branche `cert/flowpoint-797cd9f5-stripe-safe` n'a donc pas couvert ce chemin : avec ce code, aucun paquet (ni aucun add-on) ne peut etre achete sur une beta TEST, quelles que soient les variables. Pas de correction appliquee (consigne). Verification Stripe : aucun abonnement d'add-on cree (la requete est refusee par Stripe avant creation).

Resultat du rejeu : controle 1 bis (prix TEST porte par l'abonnement d'add-on) ECHEC ; controles 3, 4, 6, 7 **NON VERIFIES** (precondition impossible : aucun abonnement d'add-on ne peut etre cree) ; controle 5 non exerce par un achat (plan inchange, `trialing`). Arret de la campagne : pas de contournement possible sans modifier le code ou la branche (interdit).

Nettoyage du rejeu : abonnements de plan annules (`canceled`, `cancellation_requested`, 12:56Z) `sub_1Uea8B9eqtbj6iPBsP8ucPVj`, `sub_1Uea8S9eqtbj6iPBXa4fCAJA`, `sub_1Uea8j9eqtbj6iPBEjqFS3iU`, `sub_1Uea909eqtbj6iPBdqrXtiYx`. Clients TEST non supprimables : `cus_Vfw0W8IZcOB2Tv`, `cus_Vfw0Dw5aFtZQGk`, `cus_Vfw0joiFNN72jE`, `cus_Vfw0Dz8D6R9lhY`. Aucun abonnement d'add-on, aucune facture payee, aucun objet LIVE.

## Deuxieme rejeu du 22 novembre (13:19-13:25Z) apres le correctif `6885efbd` (`dep-dc1edvs3eqjs73ft3jd0`, live 13:05Z)
4 nouvelles organisations Standard (inscription navigateur 13:19-13:20Z, `finalize-checkout` 200), etat avant achat : `trialing`, current_period_end NULL, limites 30/30/30.

| Etiquette | Org | Client | Abonnement plan | trial_ends_at / updated_at |
|---|---|---|---|---|
| b200 | `f31d5ec9-8d69-416e-93ec-f828d616f145` | `cus_VfwZUCxM1QSG0r` | `sub_1UeagF9eqtbj6iPBSWeWoR7o` | 2026-12-06 13:19:43+00 / 13:19:45.369382 |
| b1000 | `40da2f00-4e9b-41ae-bfca-4c4079f87d52` | `cus_VfwZvbJhkfBq8X` | `sub_1UeagW9eqtbj6iPBkqsRKmmh` | 13:19:59+00 / 13:20:02.103115 |
| q200 | `db2cd6cb-ee11-4c99-8461-ae1bc676c74e` | `cus_VfwZPW0vvvAczg` | `sub_1Ueagn9eqtbj6iPB5tRtJgDY` | 13:20:17+00 / 13:20:19.415381 |
| f1000 | `06d20a46-82c3-4de4-83db-f63aad73ba59` | `cus_Vfwa0XcWx7avQK` | `sub_1Ueah49eqtbj6iPB1fdAtOZ9` | 13:20:34+00 / 13:20:36.795918 |

Achat quantite 1 : **502 `stripe_error` sur les 4** (b200 13:21:10Z, b1000 13:21:30Z, q200 13:21:50Z, f1000 13:22:09Z), limites restees a 30/30/30, `trialing`.

Progres : le prix TEST est desormais utilise. Journal Render b200 (13:21:14Z) : cle d'idempotence `addon-sub:f31d5ec9-...:price_1U4p1Z9eqtbj6iPBMK549pDG:...` (prix TEST d'auditsPack200). Controle 1 bis : le **prix TEST est bien transmis a Stripe** ; faute d'abonnement cree, la presence du prix sur un abonnement reel reste NON VERIFIEE.

**Nouvelle cause racine (defaut 6, bloquant)** : `artifacts/api-server/src/services/addon-stripe-sync.ts` l.116-124 (commit `6885efbd`), `stripe.subscriptions.create({... billing_cycle_anchor: "now", payment_behavior: "default_incomplete" ...})`. Stripe refuse : « The parameter `billing_cycle_anchor` expects a unix timestamp representing a date and time in the future. You specified the value `now` which is in the past. » (`"now"` n'est valide que pour une mise a jour, pas pour une creation.) La version de Test-Replit omet `billing_cycle_anchor` et utilise `payment_behavior: "error_if_incomplete"` (l.17-18, 116-123), ce qui est aussi plus sur : `default_incomplete` laisserait un abonnement impaye en attente de paiement sans refuser l'activation. Aucun abonnement d'add-on n'est cree : la requete est rejetee avant creation.

Resultat : controles 3, 4, 6, 7 **NON VERIFIES** (precondition impossible), controle 5 non exerce par un achat (plan `trialing` inchange). Arret.

Nettoyage : abonnements de plan annules (13:24-13:25Z, `canceled`, `cancellation_requested`) `sub_1UeagF9eqtbj6iPBSWeWoR7o`, `sub_1UeagW9eqtbj6iPBkqsRKmmh`, `sub_1Ueagn9eqtbj6iPB5tRtJgDY`, `sub_1Ueah49eqtbj6iPB1fdAtOZ9`. Clients TEST non supprimables : `cus_VfwZUCxM1QSG0r`, `cus_VfwZvbJhkfBq8X`, `cus_VfwZPW0vvvAczg`, `cus_Vfwa0XcWx7avQK`. Aucun abonnement d'add-on, aucune facture payee, aucun objet LIVE.

## Troisieme rejeu du 22 novembre apres le correctif `24a3c386` (`dep-dc1eqku0tbcc73akepa0`, live 13:29Z) : REUSSI sur les 4 paquets
Plus de blocage : creation d'abonnement d'add-on sans ancre, `error_if_incomplete`, prix TEST. 4 organisations Standard fraiches (inscription navigateur 13:31-13:32Z), etat avant achat : `trialing`, current_period_end NULL, limites 30/30/30, aucun droit de paquet.

| Etiquette | Org | Client | Abonnement plan | trial_ends_at / updated_at (avant et apres) |
|---|---|---|---|---|
| c200 (auditsPack200) | `e2e5db3c-c6f0-4641-a2b5-7b18d7e1de67` | `cus_Vfwke5rzT7e3dg` | `sub_1UearN9eqtbj6iPBjYeAuXvQ` | 2026-12-06 13:31:13+00 / 13:31:16.261077 |
| c1000 (auditsPack1000) | `a98b99dc-9abc-418f-b0c3-c6fe4ed2553f` | `cus_VfwlpDu72x6QfQ` | `sub_1Uearf9eqtbj6iPBoMVZRi0c` | 13:31:31+00 / 13:31:32.9871 |
| r200 (pdfPack200) | `4601e22b-181f-464f-aa53-ad0fe6fc5d6a` | `cus_Vfwls04iKblnrj` | `sub_1Uearv9eqtbj6iPBTJyRqgmt` | 13:31:47+00 / 13:31:49.647245 |
| g1000 (exportsPack1000) | `2c827679-dff3-44e4-965f-443c34b978a6` | `cus_Vfwl3tb9MijhCo` | `sub_1UeasD9eqtbj6iPBY3p1wloH` | 13:32:04+00 / 13:32:07.022078 |

### Controles 1 bis et 3 : achat quantite 1 (`POST /api/addons/:key/activate {quantity:1}`)
| | c200 | c1000 | r200 | g1000 |
|---|---|---|---|---|
| Appel | 13:32:23Z 200 `item_added` | 13:32:46Z 200 `item_added` | 13:33:07Z 200 `item_added` | 13:33:29Z 200 `item_added` |
| Abonnement d'add-on (`metadata.addonSub=true`, `orgId`) | `sub_1UeasZ9eqtbj6iPBDJownclP` active | `sub_1Ueasv9eqtbj6iPBfn9a2rrG` | `sub_1UeatH9eqtbj6iPBHximNIMK` | `sub_1Ueatd9eqtbj6iPBCb9Gf8VX` |
| Item (prix TEST reel, EUR, mensuel, livemode false) | `si_VfwmVyMDLDR6rO` `price_1U4p1Z9eqtbj6iPBMK549pDG` 1200 | `si_VfwmU0cuZueL2K` `price_1U4p1Z9eqtbj6iPBiAru9aAj` 3900 | `si_VfwmgyzaKYAK8b` `price_1U4p1a9eqtbj6iPB6sfEvQxC` 1200 | `si_VfwnAbTQ5AcLu5` `price_1U4p1a9eqtbj6iPBw9O0eaJU` 1400 |
| Facture | `in_1UeasZ9eqtbj6iPBbEhW2cya` | `in_1Ueasv9eqtbj6iPBI6UU9o6O` | `in_1UeatH9eqtbj6iPBHx1vs3fV` | `in_1Ueatd9eqtbj6iPB59L6D4TE` |
| Webhooks `billing_events` (`processed`) | subscription.created 13:32:30, payment_intent.succeeded, invoice.payment_succeeded 13:32:30 montant 1200 | 13:32:52, montant 3900 | 13:33:14, montant 1200 | 13:33:36, montant 1400 |
| `org_addons` | active, quantite 1 | idem | idem | idem |
| Limite apres (API `/api/addons`, `/api/me`) | audits 30 -> **230** (+200) | audits 30 -> **1030** (+1000) | reports 30 -> **230** (+200), `/api/me` `usage.pdf.limit` 230 | exports 30 -> **1030** (+1000) |
Les autres limites restent 30. Le controle 1 bis (prix TEST sur l'item d'un abonnement REEL) est **REUSSI** pour les 4. Le prix TEST de l'add-on est bien celui du catalogue.

### Controle 4 : quantite 2 (`activate {quantity:2}`)
13:33:46Z c200, 13:33:58Z c1000, 13:34:09Z r200, 13:34:21Z g1000 : 200 `quantity_updated` sur les 4. Stripe : UN seul abonnement d'add-on par client (le meme `sub_...` ; l'item garde son id, `quantity` 2), `customer.subscription.updated` traite (13:33:51, 13:34:02, 13:34:14, 13:34:25). `org_addons` quantite 2. Limites : audits 430 (30+2x200), audits 2030 (30+2x1000), reports 430 (`usage.pdf.limit` 430), exports 2030. **REUSSI** x4.

### Controle 5 : abonnement principal inchange
Apres achat, quantite 2, desactivation, reactivation et annulation Stripe, lecture base : `subscription_status` `trialing`, `stripe_subscription_id`, `trial_ends_at` et `updated_at` identiques a l'etat avant (voir tableau). Stripe : les 4 abonnements de plan restent `trialing` (trial_end inchange) jusqu'a leur annulation de nettoyage. **REUSSI** x4.

### Controle 6 : 3 `POST /activate` simultanes (`Promise.all`, org fraiche d'add-on apres desactivation)
c200 13:40:33Z, c1000 13:40:47Z, r200 13:41:01Z, g1000 13:41:15Z : pour chacun 3 reponses 200 = 1 `item_added` + 2 `already_on_subscription`. Stripe (`GetSubscriptions`) : exactement 1 abonnement d'add-on actif par client (`sub_1Ueb0T9eqtbj6iPBrgktURI4`, `sub_1Ueb0h9eqtbj6iPBFBVDXlXu`, `sub_1Ueb0v9eqtbj6iPBqhxBpANc`, `sub_1Ueb199eqtbj6iPBDED1DT95`), quantite 1, prix TEST, facture creee une seule fois (`in_1Ueb0T9eqtbj6iPBH2zoQVc7`, `in_1Ueb0h9eqtbj6iPBwD7A1e8b`, `in_1Ueb0v9eqtbj6iPBwpngxbEE`, `in_1Ueb199eqtbj6iPB8UB7z9HE`). Aucun doublon facture. **REUSSI** x4.

### Controle 7a : desactivation par le produit (`POST /api/addons/:key/deactivate`)
13:39:49Z c200, 13:39:59Z c1000, 13:40:09Z r200, 13:40:18Z g1000 : 200 `item_removed`. L'abonnement d'add-on du cycle 1 passe `canceled` (`sub_1UeasZ...` vu `canceled`, `cancellation_requested`), `customer.subscription.deleted` traite (13:39:52, 13:40:02, 13:40:12, 13:40:21), `org_addons.active=false`, limites revenues a 30 (audits/reports/exports). **REUSSI** x4.

### Controle 7b : annulation directe dans Stripe (`DeleteSubscriptionsSubscriptionExposedId`) de l'abonnement d'add-on issu du controle 6
Annulations : c200 `sub_1Ueb0T...` ~13:48:55Z, c1000 `sub_1Ueb0h...` ~17:25:15Z, r200 `sub_1Ueb0v...` ~17:26:27Z, g1000 `sub_1Ueb199...` ~17:26:29Z (l'horloge de la session a saute entre les appels). `customer.subscription.deleted` recu et traite (`billing_events` processed 13:48:56, 17:25:16, 17:26:28, 17:26:30), `org_addons.active=false`, limites 30/30/30 relues par l'API, plan inchange (`trialing`, memes valeurs). **REUSSI** x4.

Application reelle de la limite (402 a la quota) : **NON VERIFIE** (atteindre 30 audits/rapports/exports ou plus depasserait 20 objets) ; « appliquee par checkQuota, prouvee par tests unitaires uniquement ».

### Nettoyage final
Abonnements d'add-on (8, tous `canceled`) : cycle 1 (annules par `/deactivate`) `sub_1UeasZ9eqtbj6iPBDJownclP`, `sub_1Ueasv9eqtbj6iPBfn9a2rrG`, `sub_1UeatH9eqtbj6iPBHximNIMK`, `sub_1Ueatd9eqtbj6iPBCb9Gf8VX` ; cycle 2 (annules dans Stripe) `sub_1Ueb0T9eqtbj6iPBrgktURI4`, `sub_1Ueb0h9eqtbj6iPBFBVDXlXu`, `sub_1Ueb0v9eqtbj6iPBqhxBpANc`, `sub_1Ueb199eqtbj6iPBDED1DT95`. Abonnements de plan annules (`canceled`) : `sub_1UearN9eqtbj6iPBjYeAuXvQ`, `sub_1Uearf9eqtbj6iPBoMVZRi0c`, `sub_1Uearv9eqtbj6iPBTJyRqgmt`, `sub_1UeasD9eqtbj6iPBY3p1wloH`. Verification : plus aucun abonnement actif sur les 4 clients. Clients TEST non supprimables : `cus_Vfwke5rzT7e3dg`, `cus_VfwlpDu72x6QfQ`, `cus_Vfwls04iKblnrj`, `cus_Vfwl3tb9MijhCo`. Factures d'add-on payees TEST non remboursees : 2 x (12 + 39 + 12 + 14) EUR plus la quantite 2 (+12 +39 +12 +14 en proration eventuelle non verifiee). Aucun objet LIVE. Base de test : 4 organisations jetables conservees (4 jetons magic-link consommes).

### Observations (non bloquantes)
- `GET /api/addons` expose `orgAddons.<cle>: false` apres desactivation (cle presente a `false`) ; sans effet sur les limites.
- Le premier achat de chaque paquet a mis ~13 s a repondre (creation Stripe + synchronisation), les suivants ~11 s.

## Reprise
Defaut 5 corrige par `6885efbd` ; defaut 6 restant (`billing_cycle_anchor: "now"` a la creation, l.122). Apres correction (reprendre la creation de Test-Replit : pas d'ancre, `error_if_incomplete`) et redeploiement, rejouer les controles 3 a 7 avec des organisations Standard ; la methode, les scripts (inscription navigateur, login-verify, snapshots `/api/addons` `/api/me` `/api/billing/usage`) sont prets.
