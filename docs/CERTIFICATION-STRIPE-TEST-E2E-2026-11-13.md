# Certification Stripe TEST — parcours de bout en bout réel (13 novembre 2026)

**Niveau atteint : certification Stripe TEST PARTIELLE AVANCÉE** — le parcours *inscription → choix du plan → SetupIntent Stripe TEST → vrai Payment Element (carte 4242) → webhooks signés → activation de l'essai de 14 jours* a été exécuté **réellement** sur le service de test `flowpoint-test.onrender.com` (Stripe en mode test, base Supabase « Flowpoint test ») pour **Standard, Pro et Ultra**. Il reste des scénarios non exécutés en réel (voir §7) : ne pas présenter cela comme une certification complète. Aucune opération LIVE, aucun secret relevé ou reproduit, aucune donnée de production touchée.

## 1. Environnement utilisé (réel, sans création de service)
| Ressource | État |
|---|---|
| Service Render `flowpoint-test` (branche `Test-Replit`, déploiement automatique, plan 0,5 CPU / 512 Mo) | **réutilisé** ; journaux : `Stripe mode: TEST \| webhook: TEST \| publishable: TEST` |
| Base de données | projet Supabase **« Flowpoint test »**, distinct du projet « Flowpoint project » (production). Preuve : les événements de ce scénario (`billing_events`) et les organisations de certification y sont écrits. 31 organisations préexistantes, toutes de développement (domaines vides, `flowpoint.pro`, un `gmail`). Aucune requête n'a été faite sur le projet de production. |
| Stripe | compte « Flowpoint », **mode test** uniquement (connecteur) |
| Webhook TEST | `we_1UNJGx…` → `https://flowpoint-test.onrender.com/api/webhooks/stripe` |
| Clés `sk_test_` / `whsec_` | non accessibles depuis le développement ; non nécessaires pour ce parcours (le service les porte) |
| E-mails | le service envoie réellement les e-mails d'activation ; les adresses de test sont en `@flowpoint.test` (non livrables) |

## 2. Prix TEST (tranché par les faits)
Le backend lit en mode TEST `STRIPE_TEST_PRICE_ID_STANDARD|PRO|ULTRA` (valeurs non lisibles depuis Render). **Constaté sur les abonnements réellement créés par l'application déployée** : Standard `price_1UAt5K9eqtbj6iPBVm8v6LRy` (29 €), Pro `price_1UQ53c9eqtbj6iPB4FVBZqzX` (79 €), **Ultra `price_1UQ53s9eqtbj6iPBhEB7NsM9` (149 €)**.
Le second prix Ultra actif (`price_1U57sg9eqtbj6iPBVm8v6LRy`, nickname « Ultra Monthly Test ») dépend d'un **produit inactif** et est **inutilisable** : la création d'un abonnement répond `No such price`. Aucun prix modifié ni supprimé ; l'archiver est possible (facultatif, sans effet sur l'application).

## 3. Parcours réels exécutés (carte Stripe TEST 4242, e-mails synthétiques, mobile 390 px)
Entrée : `signin.html?plan=<plan>&lang=en&utm_source=cert&utm_medium=e2e&utm_campaign=stripe_test&fp_source=other_campaign&fp_vid=<uuid>` avec consentement analytique.
| Contrôle | Standard | Pro | Ultra |
|---|---|---|---|
| Plan conservé jusqu'au checkout (panier) | oui | oui | oui |
| Inscription (`pre-register` 200) puis `payment-intent` 200, SetupIntent `seti_…` | oui | oui | oui |
| Payment Element Stripe réel, carte 4242, retour « Your account is ready! » (`finalize-checkout` 200) | oui | oui | oui |
| Abonnement Stripe : exactement **un**, `trialing`, bon prix (29 / 79 / 149 €) | oui | oui | oui |
| Facture d'essai **0,00 €** (« Essai gratuit »), aucun prélèvement ; carte enregistrée par défaut | oui | oui | oui |
| Organisation en base : plan correct, `subscription_status = trialing`, fin d'essai = **14,000 jours** | oui | oui | oui |
Attribution portée jusque dans Stripe (métadonnées) : `fp_source`, `fp_visitor_id`, consentement, plan. Funnel (`funnel_events`) pour le parcours Pro : `signup_started`, `signup_form_engaged`, `signup_form_completed`, `checkout_started`, `checkout_completed`, `trial_activated` — **chacun une seule fois** ; aucun doublon d'étape pour les trois visiteurs.

## 4. Annulation et premier prélèvement
- **Annulation pendant l'essai (Ultra, événement réel)** : `customer.subscription.deleted` reçu et traité ; organisation `canceled`, plan repassé à `standard` ; aucune facture payée (une seule facture à 0 €). Les abonnements Standard et Pro de test ont ensuite été annulés (nettoyage).
- **Fin d'essai → premier prélèvement** (preuve Stripe, rapport précédent) : 79,00 € payés automatiquement sur la carte par défaut, abonnement `active`. Non rejoué via l'application (pas d'horloge de test accessible) : à compléter avec une horloge de test Stripe.

## 5. Webhooks : preuves
- **Événements sans organisation** (clients `FP-CERT` du premier scénario, livrés à `flowpoint-test` à partir de 18:00 UTC après réveil du service) : journaux `Could not resolve orgId — no DB writes performed`, `subscription event: orgId unresolved — state NOT persisted`, `invoice.payment_succeeded: orgId unresolved — status NOT persisted, email NOT sent`. Aucune organisation ni réglage ne porte ces clients ; **15 lignes d'audit `billing_events`** seulement. Aucune donnée de production modifiée.
- **Signatures** (réelles, contre `flowpoint-test`) : sans signature, signature invalide, horodatage périmé → **400** ; GET → 401.
- **Défaut réel trouvé et corrigé** : pour une organisation de test à identifiant e-mail (ancien format), `invoice.payment_succeeded` levait `22P02 invalid input syntax for type uuid` puis répondait **500** → Stripe re-livrait en boucle (observé 15:43, 16:44, 16:57 UTC). Correction : garde d'identifiant non canonique déjà présente sur `Flowpoint` (commit `b3326124`), reportée sur `Test-Replit` avec test (500 sans correctif, 200 avec) — PR #446.
- **Abonnements du point de terminaison TEST** : ajout de `charge.refunded`, `refund.created`, `refund.updated`, `customer.deleted` (traités par le backend : registre des commissions vendeur, remise à zéro du plan si un client est supprimé). `customer.updated` volontairement **non** ajouté : le gestionnaire ne fait que réécrire l'identifiant client. Configuration TEST uniquement ; les webhooks LIVE n'ont pas été touchés.

## 6. Contrôles par simulation (Stripe factice, jamais une certification réelle)
22 fichiers, **299 tests réussis, 0 échec** : doublons, désordre, rejeu, concurrence, verrou d'abonnement, essai unique (`stripe-trial-history`), refus d'un secret de webhook LIVE, mode TEST/LIVE, quotas.

## 7. Non exécuté en réel (à faire pour une certification complète)
3-D Secure et carte refusée dans le Payment Element ; double clic / deux onglets ; webhook retardé, rejeu et désordre **réels** (Stripe CLI / renvoi depuis le tableau de bord) ; premier prélèvement via l'application avec horloge de test ; remboursements ; rejet d'un événement LIVE par l'instance de test ; remontée `fp_lid` vers AI Lab (instance de test et `CONVERSION_EVENT_SECRET` requis) ; capture d'e-mails (le lien magique d'activation n'a pas été ouvert).
**Dérive constatée** : la suite Playwright `tests/browser/certification-stripe` remplit encore `#companyName`, `#country`, `#address`, `#city`, `#postalCode` ; le formulaire déployé n'a plus que `#firstName`, `#lastName`, `#email` → à mettre à jour avant de la relancer.
**Reste en base de test** : organisations de certification `fp-cert-…@flowpoint.test` (3 avec essai annulé, plusieurs pré-inscriptions) et 3 + 3 clients `FP-CERT` côté Stripe TEST ; le connecteur ne permet pas de supprimer un client.
