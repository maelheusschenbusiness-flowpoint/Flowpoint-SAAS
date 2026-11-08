# A-09 — l'essai ne depend plus du navigateur

## Etat du flux (apres correctif)

| Etape | Qui | Ecrit |
|---|---|---|
| Paiement/confirmSetup | navigateur | SetupIntent/PaymentIntent `succeeded` (metadata : plan, addons, pre_register_token, trial_days_remaining) |
| `setup_intent.succeeded` / `payment_intent.succeeded` | webhook | **cree la souscription** (`provisionSubscriptionFromIntent`), puis `activateNewSignup` : organisation `trialing` + `stripe_subscription_id` + `trial_ends_at` (= `trial_end` Stripe) + `trial_consumed_at` + `current_period_end` |
| `finalize-checkout` | navigateur | meme creation via `ensureSignupSubscriptions` : reprend la souscription du webhook, persiste statut REEL de la souscription |
| `customer.subscription.*` | webhook | synchronisation de statut (inchange) |

Code commun : `services/signup-subscription.ts`. Cle d'idempotence unique par tentative :
`subscriptionAttemptKey({scope, intentId, plan, priceId})` (= `fp_sub_<sha256>`), identique cote webhook et finalize,
doublee du verrou PostgreSQL `checkout_subscription_claims`. Corps de requete identique (ancre `intent.created`,
`org_id` = e-mail du signup). Les prix viennent de `getPlanPriceId`/`getAddonPriceId`, la duree de `trial_days_remaining`
(TRIAL_DAYS = 14, inchange).

## Chronologies

| Cas | Souscriptions Stripe | organizations |
|---|---|---|
| Webhook seul (onglet ferme) | 1 | `trialing`, sub id, trial_ends_at = trial_end |
| Webhook puis finalize | 1 (finalize reutilise) | idem, finalize persiste le statut reel |
| Finalize puis webhook | 1 | jeton deja consomme : webhook sans effet |
| Finalize echoue apres le webhook | 1 (creee par le webhook) | `trialing` + sub id |
| Webhook rejoue / 2 onglets | 1 | 1 organisation |
| Echec Stripe dans le webhook | 0 | non creee ; evenement `failed`, HTTP 500, Stripe renvoie |
| Intent sans client/PM/plan resolu | 0 | `pending_billing` (non premium), log `SIGNUP_SUBSCRIPTION_UNRESOLVED` + raison |
| 3DS en attente | 0 | rien (pas d'evenement `succeeded` tant que non confirme) |

## Detection / rattrapage

- Lecture seule : `artifacts/api-server/migrations/diagnostics/a09_trialing_sans_souscription.sql` (jamais execute par migrate).
- `services/trial-subscription-reconcile.ts` : `findTrialingOrgsWithoutSubscription`, `reconcileOrphanTrials` (dry-run par defaut,
  borne, idempotent). Volontairement NON branche sur un cron/webhook : creer un abonnement pour un client existant decide
  d'un prelevement futur sur sa carte.

## A valider plus tard avec le vrai Stripe (mode test), sans l'avoir execute ici

- l'attache du PM par le webhook (`paymentMethods.attach` + `invoice_settings`) sur un vrai SetupIntent ;
- le rejeu d'idempotence Stripe avec un corps identique entre webhook et finalize (cle `fp_sub_*`) ;
- `trial_end` ancre sur `setup_intent.created` accepte par Stripe (doit etre dans le futur).
