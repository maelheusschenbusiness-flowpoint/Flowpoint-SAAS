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
