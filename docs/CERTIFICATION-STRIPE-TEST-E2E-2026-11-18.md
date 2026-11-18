# Certification Stripe TEST réelle — phase 1 (18 novembre 2026)

Cible : `https://flowpoint-test.onrender.com`, déploiement `dep-dbucdtjbc2fs73a5od5g` = commit `af43e406` = tête de `Test-Replit` au moment du test (statut `live`). Stripe : compte « Flowpoint » `acct_1StV…` **livemode:false** (tous les objets lus ou écrits ont `livemode:false`). Base : projet Supabase « Flowpoint test » `rrjl…` en **lecture seule** ; le projet « Flowpoint project » (production) n'a pas été interrogé. Aucun secret affiché. Navigateur : Chrome (Playwright, `workers:1`, `trace:off`), vrai Stripe.js, vrai Payment Element (iframes Stripe). Le paiement est un **SetupIntent confirmé dans le Payment Element de `checkout-payment.html`** (essai 14 j, 0 € à l'inscription), pas Stripe Checkout hébergé.

Méthode de preuve : suite Playwright en « mode contrat » (`CERT_STRIPE_REEL=1`, sans clé `sk_test` locale) pour piloter le navigateur et lire les réponses API de l'application ; preuves Stripe lues avec le connecteur Stripe TEST ; preuves base lues avec Supabase test ; journaux Render pour les webhooks.

## 1. Résultats chiffrés
| | Réussis | Échoués | Non exécutés |
|---|---|---|---|
| Parcours nominal plan × profil (3 plans × bureau-1440 / iphone-13 / pixel-7) | 9 | 0 | 0 |
| Cas limites (bureau-1440) | 6 | 0 | 2 (3-D Secure, voir §4) |
| Annulation pendant l'essai (réelle, webhook reçu) | 14 | 0 | — |

## 2. Matrice par plan (profils bureau / iphone / pixel, un abonnement chacun)
Exemples d'ids (masqués) : Standard `sub_1UdFbF…PBmib` (29 €), Pro `sub_1UdFpc…o5Qv` (79 €), Ultra `sub_1UdFq2…VGs6Cj` (149 €).

| Étape | Standard | Pro | Ultra |
|---|---|---|---|
| 1 Arrivée sur tarifs | non exécuté en réel (la suite entre par `signin.html?plan=`) | idem | idem |
| 2 Sélection du plan (panier `fp_cart.plan` conservé jusqu'au checkout) | 3/3 | 3/3 | 3/3 |
| 3 Création de compte (`pre-register` 200, e-mail `@flowpoint.test` neuf) | 3/3 | 3/3 | 3/3 |
| 4 Connexion / lien magique | **non exécutable** (§5) | idem | idem |
| 5 Payment Element Stripe TEST (SetupIntent `seti_…`, `mode:setup`, 0 € immédiat) | 3/3 | 3/3 | 3/3 |
| 6 Carte 4242 acceptée | 3/3 | 3/3 | 3/3 |
| 7 Essai : un seul abonnement `trialing`, bon prix (2900/7900/14900), `trial_end` ≈ +14 j, facture 0 € (`invoice.payment_succeeded` amount 0) | 3/3 | 3/3 | 3/3 |
| 8 Retour `checkout-return.html`, plan/abonnement en base corrects (`organizations.plan`, `trialing`, `trial_ends_at` +14 j) | 3/3 | 3/3 | 3/3 |
| 9 Webhooks réels reçus et traités par flowpoint-test : `setup_intent.succeeded`, `customer.subscription.created`, `invoice.payment_succeeded` (`billing_events`, statut `processed`) | oui | oui | oui |
| Accès au dashboard | **non exécuté** (§5) | idem | idem |

Funnel : `trial_activated` une seule fois par organisation (5 organisations vérifiées dans la deuxième série), aucun doublon.

## 3. Cas limites réels (bureau-1440)
| Cas | Résultat | Preuve |
|---|---|---|
| Carte refusée 4000 0000 0000 0002 | réussi | message d'erreur `#fp-alert`, on reste sur `checkout-payment`, 0 `finalize-checkout`, 0 abonnement, aucun client Stripe créé ; funnel `checkout_payment_failed` |
| Double clic sur « payer » | réussi | 1 abonnement Stripe, 1 organisation |
| Deux onglets sur le même paiement | réussi | 1 abonnement, 1 organisation |
| Actualisation pendant la finalisation + retour navigateur | réussi | 0 abonnement (le rechargement a interrompu la confirmation avant paiement : aucun client Stripe), jamais 2 |
| Onglet fermé juste après la confirmation Stripe (`finalize-checkout` bloqué) | réussi | le **webhook seul** crée l'abonnement `trialing` Pro et l'organisation (1 abonnement) |
| Retour arrière avant paiement puis nouveau passage | réussi | 1 abonnement Standard, 1 organisation |
| Retour arrière après paiement | réussi | l'historique revient sur `/signin.html` (pas sur la page de paiement) ; toujours 1 abonnement |
| Double soumission du formulaire d'inscription (double clic) | réussi (au moins un `pre-register` 200, un checkout) | non vérifié côté base : aucune organisation avant paiement |
| Annulation pendant l'essai | réussi (14/14) | annulation côté Stripe API (ce n'est pas le parcours client de l'interface) → `customer.subscription.deleted` traité, organisation `canceled`, plan ramené à `standard` ; aucune facture payée |

## 4. Non exécutés — ce qui manque exactement
* **3-D Secure réussi et échoué (4000 0027 6000 3184, et aussi 4000 0025 0000 3155)** : Stripe oppose un **hCaptcha** au navigateur automatisé (bureau et iphone) ; le test se saute explicitement (`sauterSiHCaptcha`). À exécuter à la main (humain) ; ce n'est ni contournable ni souhaitable. Aucun faux vert.
* **Webhooks retardés / rejoués / désordonnés réels** : le connecteur Stripe n'expose aucune opération de renvoi d'événement (`stripe events resend` / tableau de bord) et je n'ai ni Stripe CLI ni clé `sk_test`. Manque : Stripe CLI connectée au compte TEST, ou un humain au tableau de bord (Développeurs > Webhooks > renvoyer) sur `we_…` → `/api/webhooks/stripe`. Les 299 tests simulés du 13/11 ne remplacent pas cela.
* **Lien magique / connexion / dashboard (étapes 4 et 9-accès)** : le service de test journalise `[ML] step-4: FAIL — activation email not delivered` avec `error: TEST_MAILER_NOT_ENABLED` pour chaque inscription ; aucun e-mail n'est parti (Resend : dernier envoi le 11/11). Manque : `ENABLE_TEST_MAILER=true` + dossier de capture lisible, ou une boîte réelle capturable (`CERT_STRIPE_EMAIL_BASE`) pour lire le lien.
* **Arrivée sur la page tarifs → clic** : non couvert par la suite réelle (entrée directe `signin.html?plan=`).
* **Fin d'essai / premier prélèvement par l'application** : horloge de test Stripe non utilisée.

## 5. Défauts / anomalies observés (décrits, non corrigés)
1. **Moyen — e-mails de bienvenue/essai jamais envoyés sur la bêta** : pour les 14 inscriptions, `welcome_email_claimed_at` et `trial_started_email_claimed_at` restent nuls et l'e-mail d'activation échoue (`TEST_MAILER_NOT_ENABLED`). Si la même configuration existait en production, aucun client n'aurait son e-mail d'activation : à confirmer côté configuration, pas de preuve que la production soit concernée.
2. **Moyen — identifiant d'organisation sous forme d'e-mail dans Stripe et dans `billing_events`** : les métadonnées de l'abonnement portent `orgId`/`org_id` = l'adresse e-mail (`orgRef` de `signup-subscription.ts`), alors que le client porte l'UUID. Conséquence observée : `setup_intent.succeeded` et `invoice.payment_succeeded` sont enregistrés avec `org_id` = e-mail (28 + 14 lignes), journal `persistOrgData: non-UUID orgId — skipping organizations write` à chaque parcours ; seul `customer.subscription.created/deleted` porte l'UUID. L'état final (plan, `trialing`) est correct car l'écriture se fait par un autre chemin. Même famille que le défaut 22P02 du 13/11.
3. **Faible — deux `setup_intent.succeeded` par parcours** (un à la confirmation, un à la création d'abonnement) : bruit d'audit, aucun effet fonctionnel.
4. **Faible — plan remis à `standard` à l'annulation** (organisation `canceled` mais `plan=standard`) : à confirmer comme voulu ; vérifier que l'accès est bien coupé par le statut.
5. **Faible — avertissement `parseAddonsFromSubscription: SubscriptionItem not recognised`** pour chaque abonnement de plan (bruit).

## 6. Dérive de la suite corrigée (tests uniquement)
`playwright.certification-stripe.config.mjs` : ajout du profil `pixel-7`. `11-echecs-contrat` : la carte 3-D Secure est désormais 4000 0027 6000 3184 (`CARTES.authentification3dsToujours`). Nouveau `14-onglet-ferme-retour-contrat.stripe.ts` (onglet fermé, retours arrière, double soumission). Le formulaire n'ayant plus que prénom/nom/e-mail, `remplirFormulaireInscription` s'y adapte déjà (champs optionnels ignorés).

## 7. Nettoyage Stripe TEST
14 abonnements créés par cette campagne **annulés** (tous `canceled`, `customer.subscription.deleted` traité 14/14). Le connecteur ne propose aucune suppression de client : **14 clients restent** (e-mails `fp-cert-*@flowpoint.test`) : `cus_VeYiiMWPHlytlw`, `cus_VeYxRGqmFGINcj`, `cus_VeYxkW2DQbM0er`, `cus_VeYy6m2FqasaWM`, `cus_VeYy3W4RGanDHa`, `cus_VeYzdgh3frC83I`, `cus_VeYzGv4Tk8iTcu`, `cus_VeZ08cWztftruH`, `cus_VeZ0mMdDjX1mHn`, `cus_VeZ5TSzaZA6t3k`, `cus_VeZ6SWhCqBqqRG`, `cus_VeZ9TJMbhkGe41`, `cus_VeZ9ZIF4a3zlsi`, `cus_VeZ9fXPOpfrMj6`. Base de test : 14 organisations `fp-cert-*` (statut `canceled`) et leurs lignes `billing_events` / `funnel_events` conservées. Aucun achat d'add-on.
