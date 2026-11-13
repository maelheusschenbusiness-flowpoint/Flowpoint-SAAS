# Certification Stripe TEST — état au 13 novembre 2026 (PARTIELLE)

**Statut exact : certification PARTIELLE.** La mécanique d'essai et de facturation a été prouvée contre le **vrai Stripe (mode test)**. Le parcours **applicatif** (inscription → Stripe Checkout/Payment Element → webhooks signés → activation du compte) n'a **pas** été exécuté contre Stripe : aucune clé `sk_test_` / `pk_test_` / `whsec_` n'est disponible dans l'environnement de développement. Les contrôles applicatifs ci-dessous sont des **simulations** (Stripe factice), jamais présentées comme une certification réelle.

Aucun secret n'est reproduit ici. Aucune opération LIVE. Aucune modification des prix, abonnements clients, ou variables de production.

## 1. Accès Stripe TEST
| Élément | État |
|---|---|
| Compte Stripe `Flowpoint` en **mode test** (`livemode:false`), via le connecteur de la session | **Disponible** (lecture et écriture TEST) |
| Clé secrète `sk_test_`, clé publiable `pk_test_`, secret de webhook `whsec_` | **Absents** de l'environnement (le connecteur ne les fournit pas) |
| Prix TEST Standard 29 € / Pro 79 € / Ultra 149 € | **Présents et corrects** (voir 2) |
| Point de terminaison webhook TEST | **Présent** : `https://flowpoint-test.onrender.com/api/webhooks/stripe` |
| Environnement applicatif isolé en Stripe TEST (`STRIPE_TEST_MODE=true`, base jetable, boîte de capture) | **Non fourni** |
| Instance AI Lab de test + `CONVERSION_EVENT_SECRET` | **Absentes** |

## 2. Prix TEST vérifiés (lecture seule)
| Offre | Prix | Montant | Remarque |
|---|---|---|---|
| Standard | `price_1UAt5K9eqtbj6iPBVm8v6LRy` | 29,00 €/mois | `metadata.plan=standard` |
| Pro | `price_1UQ53c9eqtbj6iPB4FVBZqzX` | 79,00 €/mois | sans `metadata.plan` |
| Ultra | `price_1UQ53s9eqtbj6iPBhEB7NsM9` | 149,00 €/mois | **un second prix Ultra actif** existe (`price_1U57sg9eqtbj6iPBVm8v6LRy`, 149 €, produit inactif) : confirmer lequel porte la variable d'environnement de l'application de test |

## 3. Preuves RÉELLES côté Stripe TEST (objets créés par ce scénario, carte de test Visa 4242)
Reprend les paramètres du backend (`signup-subscription.ts`) : carte par défaut + `trial_end` = ancre + 14 jours.
| Plan | Résultat réel |
|---|---|
| **Standard** | abonnement `trialing` ; **facture d'essai de 0,00 € (« Free trial »)**, aucun prélèvement ; `trial_end` = ancre + 14 jours ; carte enregistrée par défaut. **Annulé pendant l'essai** → `canceled`, **aucune autre facture** (la seule facture du client reste celle de 0 €). |
| **Pro** | `trialing`, facture de 0 € ; fin d'essai forcée (`trial_end: now`, équivalent Stripe du passage à J+14) → **facture de 79,00 € payée automatiquement** sur la carte par défaut, abonnement `active`, période +1 mois. |
| **Ultra** | `trialing`, facture de 0 € ; `trial_end` = ancre + 14 jours. |
Les trois abonnements ont ensuite été **annulés**. Les 3 clients `FP-CERT …` (métadonnée `fp_cert=trial-2026-11-13`) subsistent en mode test : le connecteur ne permet pas de supprimer un client ; ils peuvent être supprimés depuis le tableau de bord Stripe TEST.
**Limites** : pas d'horloge de test disponible via le connecteur, donc le passage réel à J+14 n'a pas été attendu (simulé par `trial_end: now`) ; la création passe par l'API, non par Checkout / Payment Element ; aucun 3-D Secure.

## 4. Webhooks : ce que Stripe TEST envoie (réel) et ce que l'application traite
Stripe a émis (livrés, `pending_webhooks: 0`) pour ce scénario : `customer.subscription.created`, `…updated`, `…deleted`, `invoice.created/finalized/paid/payment_succeeded`, `payment_intent.created/succeeded`, `charge.succeeded`, `customer.subscription.trial_will_end`.
Le point de terminaison TEST est abonné à : `checkout.session.completed`, `payment_intent.succeeded`, `setup_intent.succeeded`, `customer.subscription.created|updated|deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`.
**Écart constaté** : le backend traite aussi `charge.refunded`, `refund.created|updated`, `customer.deleted`, `customer.updated`, **non abonnés** sur ce point de terminaison TEST → à ajouter pour certifier les remboursements (registre vendeur) et la suppression de client. (Changement de configuration Stripe TEST non effectué ici.)
**Effet de bord à connaître** : les événements de ce scénario ont été livrés à `flowpoint-test.onrender.com` ; ils ne portent aucun identifiant d'organisation (`fp_cert` seulement) et doivent être ignorés par l'application — à confirmer dans les journaux de cette instance.

## 5. Contrôles applicatifs — SIMULATION (Stripe factice)
22 fichiers, **299 tests réussis, 0 échec** (base PostgreSQL réelle, signatures calculées localement) : signature valide/invalide/absente, doublons, événements dans le désordre, `customer.subscription.created` avant création de l'organisation, facture d'essai à 0 € sans commission, première facture après essai, rejeu d'une facture déjà traitée, concurrence (20 appels simultanés → 1 client Stripe), verrou de création d'abonnement (aucun doublon), historique d'essai (pas de second essai), secret de webhook TEST seul (refus d'un secret LIVE), mode TEST/LIVE du login, quotas par plan.
Migrations base neuve : 822 étapes, 0 échec ; RLS : 0 table sans isolation.

## 6. Ce qui reste pour une certification Stripe TEST COMPLÈTE
1. Fournir `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_PUBLISHABLE_KEY`, `STRIPE_TEST_WEBHOOK_SECRET` (ou `stripe listen`), un environnement applicatif isolé (`STRIPE_TEST_MODE=true`, base jetable, `TEST_MAIL_DIR`) — `node scripts/certify-preflight.mjs conversion` doit afficher « prêt ».
2. Exécuter la suite `docs/CERTIFICATION-STRIPE-REEL.md` (vrai Payment Element, 3-D Secure, SetupIntent, webhook signé, souscription unique) pour Standard, Pro et Ultra, avec horloge de test Stripe pour le vrai passage à J+14.
3. Ajouter au point de terminaison TEST les événements `charge.refunded`, `refund.created`, `refund.updated`, `customer.deleted`, `customer.updated` (ou confirmer qu'ils ne sont pas requis).
4. Lever l'ambiguïté du double prix Ultra actif.
5. Instance AI Lab de test + `CONVERSION_EVENT_SECRET` pour la remontée des événements `fp_lid` (Parcours 3 du protocole de conversion).
