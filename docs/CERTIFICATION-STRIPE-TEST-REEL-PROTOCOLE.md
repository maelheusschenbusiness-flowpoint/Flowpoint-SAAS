# Certification Stripe TEST réel — protocole préparé (NON exécuté)

Périmètre : compte Stripe en mode TEST uniquement (`livemode:false`, compte « Flowpoint »), jamais LIVE. Aucune clé n'est écrite dans un dépôt, un rapport, une commande ou un message.

## 1. Garde-fous
- Le runner refuse toute clé qui ne commence pas par `sk_test_` (`certify-addons.mjs`) et la base est un PostgreSQL jetable en boucle locale.
- Aucun changement de prix, de quota ou d'abonnement existant. Objets créés : clients/abonnements de test marqués `flowpoint_test_only`, à nettoyer ensuite (les événements, PaymentIntents et factures payées ne sont pas supprimables chez Stripe : ils sont listés en sortie).
- Aucune modification de Stripe LIVE, de Flowpoint-Main ni de protections de production.

## 2. Acheminement des secrets (sans clair)
| Besoin | Voie |
|---|---|
| `sk_test_…` (clé secrète TEST) | formulaire sécurisé `request_credential` pour l'hôte `api.stripe.com` : le proxy l'injecte dans les requêtes, la session ne voit jamais la valeur. Les outils locaux démarrent avec une valeur factice `sk_test_proxy` (le runner n'exige que le préfixe). |
| Clé publiable `pk_test_…` (non secrète) | variable `STRIPE_TEST_PUBLISHABLE_KEY` fournie par le propriétaire. |
| `whsec_…` | pour les webhooks signés **locaux**, un secret local généré à la volée suffit (Stripe ne peut pas joindre une boucle locale). Le vrai secret du point d'accès TEST n'est nécessaire que pour tester `flowpoint-test.onrender.com` : à saisir par le propriétaire directement dans les variables Render du service de test, jamais dans le chat. |
| Prix TEST | identifiants non secrets, voir §3. |
| Boîte de réception de test | adresse dédiée à la certification, fournie par le propriétaire ; pas `support@flowpoint.pro`. |

## 3. Prix TEST existants (lecture seule du compte TEST)
Abonnements mensuels sans essai Stripe : « Standard Monthly QA Test » 29 € `price_1UAt5K9eqtbj6iPBVm8v6LRy` ; « Ultra Monthly Test » 149 € `price_1U57sg9eqtbj6iPBVTNUBobB` ; deux prix sans surnom, 79 € `price_1UQ53c9eqtbj6iPB4FVBZqzX` et 149 € `price_1UQ53s9eqtbj6iPBhEB7NsM9`. Agency Reporting Packs : `price_1UZZau9eqtbj6iPBq1vN3EpE` (12 €, `lookup_key flowpoint_agency_packs_monthly_test_v1`).
**À confirmer par le propriétaire** : quel prix correspond à Standard / Pro / Ultra dans le catalogue de la bêta (le catalogue affiche 79 €) ; variables `STRIPE_TEST_PRICE_ID_STANDARD`, `_PRO`, `_ULTRA`.

## 4. Scénarios à exécuter (déjà codés)
Local, base jetable, vrai Stripe TEST : `01-nominal`, `02-3ds`, `03-refus`, `04-onglet-ferme` (`tests/browser/certification-stripe/`), `--checkout-abandonment`, `--checkout-3ds`, `--stripe-test` (Agency Packs), `--stripe-webhook-replay`, `--combined-checkout-agency`.
Cartes TEST : 4242… (succès), 4000 0027 6000 3184 (3DS), 4000 0000 0000 0002 (refus).
Critères : carte obligatoire, essai 14 j sur Standard, Pro et Ultra, 3DS réussi et échoué, retour falsifié sans compte créé, webhooks signés (`invoice.*`, `customer.subscription.*`, `setup_intent.*`) avec effet sur l'organisation, idempotence, absence de doublon d'organisation au rechargement.

## 5. Séquence
1. Propriétaire : fournir `sk_test_` via le formulaire, `pk_test_`, la correspondance des prix, l'adresse de test.
2. Vérifier `livemode:false` sur chaque objet créé.
3. Exécuter les scénarios un à un (une base jetable par scénario), consigner commande + résultat.
4. Nettoyage : suppression des clients de test créés (marqueur `flowpoint_test_only`), liste des objets non supprimables.
5. Rapport : réussi / échoué / bloqué, sans valeur secrète.

## 6. Hors périmètre
Stripe LIVE ; prix, quotas, abonnements préexistants ; pages hébergées Stripe en français (`preferred_locales:["fr"]` côté backend de production).
