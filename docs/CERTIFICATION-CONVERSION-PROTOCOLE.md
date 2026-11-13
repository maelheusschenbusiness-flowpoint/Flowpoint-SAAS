# Protocole de certification du parcours de conversion (Stripe TEST + AI Lab)

À exécuter **dès que les accès existent**. Il complète ce qui est déjà prouvé en local (voir la section « Déjà prouvé »). Rien ici ne touche à la production, à Stripe LIVE, aux prix ni aux quotas.

## Déjà prouvé en local (sans accès externe)
Commande : `BASE_URL=… ADMIN_KEY=… CHROMIUM_PATH=… node scripts/certify-conversion-local.mjs` — serveur réel, base jetable, navigateur mobile 390×844, trois visiteurs synthétiques (consentant Smartlead qui s'inscrit, consentant qui abandonne, non consentant), puis lecture des deux tableaux de bord. Résultat attendu : **32/32** sur le build réconcilié (#438). S'arrête à la frontière Stripe.

## Prérequis de l'exécution réelle
| Besoin | Détail |
|---|---|
| Environnement | base **jetable**, `NODE_ENV=test` ou préproduction, `STRIPE_TEST_MODE=true` ; jamais la production |
| Stripe TEST | clé `sk_test_…`, prix TEST existants (non modifiés), `STRIPE_TEST_WEBHOOK_SECRET` du point de terminaison TEST ; `stripe listen --forward-to <base>/api/webhooks/stripe` pour la réception réelle |
| AI Lab / acquisition | instance de **test** : `AI_LAB_CONVERSION_URL` + `CONVERSION_EVENT_SECRET` (≥ 32 caractères) ; un prospect de test dont le `fp_lid` (22 car.) existe dans `lead_tokens` |
| E-mails | capture (`TEST_MAIL_DIR`) : aucun envoi à un vrai destinataire |
| Navigateur | Playwright, viewport 390×844 mobile (et 360×800 Android) |
| Nettoyage | à la fin : annuler les abonnements TEST créés **par ce scénario**, supprimer ses clients TEST, ne rien toucher d'autre |

## Parcours 1 — Transparence de l'essai (14 jours, carte obligatoire)
1. Ouvrir `/pricing.html?lang=en` puis `?lang=fr` à 390 px. **Attendu :** FAQ « plan choisi avant, carte requise, rien débité pendant l'essai, débit automatique à J+14 sauf annulation » ; cartes « 14 days free · then €X/month ».
2. Aller jusqu'au paiement (parcours 2) avec une carte TEST `4242 4242 4242 4242`. **Attendu :** le Checkout n'affiche aucun montant à payer aujourd'hui ; l'abonnement Stripe est `trialing`, `trial_end` = J+14 ; **aucun** `invoice.payment_succeeded` > 0 pendant l'essai.
3. Avancer l'horloge de test Stripe de 14 jours (test clock) sur ce client uniquement. **Attendu :** facture du plan, statut `active`, e-mail de confirmation capturé.
4. Variante abandon : fermer avant la carte → aucun abonnement, aucune activation (« L'activation d'un essai n'intervient jamais avant une confirmation de paiement valide »).
5. **Site vitrine :** exécuter la checklist de `docs/conversion-marketing-site-patch.md` sur le site publié.

## Parcours 2 — Plan conservé jusqu'au checkout
Pour chacun de `standard`, `pro`, `ultra` : `signin.html?plan=<p>` (puis pricing → bouton) → inscription → checkout. **Attendu :** le plan du panier = plan de la session Stripe = plan en base après l'activation ; modifier le plan avant paiement fonctionne ; `?plan=enterprise` est ignoré ; aucun paramètre d'URL ne change le prix (comparer au devis serveur). Essais multiples : se réinscrire avec le même e-mail/carte → pas de second essai (garde d'éligibilité), aucune activation prématurée.

## Parcours 3 — Fiabilité des événements `fp_lid`
1. Visiter avec `?fp_lid=<test>&fp_src=smartlead&utm_*=…` en consentant, parcourir jusqu'à l'essai.
2. **Attendu côté SaaS :** jalons `visit`, `signup_page`, `signup`, `checkout`, `trial` dans `conversion_event_outbox` (`status='delivered'`, `fp_lid` effacé), une ligne par `event_id`, horodatage = date de l'événement source.
3. **Attendu côté acquisition :** chaque étape apparaît une fois pour ce prospect ; un rejeu (renvoyer le même corps) répond `duplicate` ; un `fp_lid` inconnu → 400 `invalid event`.
4. Panne simulée : couper AI Lab 5 minutes puis le remettre → les jalons en file partent, sans perte ni doublon. Un 400 persistant s'arrête après **5 essais** (15 min, 1 h, 3 h, 6 h) avec `rejected:400:exhausted` et un log `conversion_event_abandoned` sans `fp_lid`.
5. **Rapprochement** : le nombre de `trial`/`paid` reçus chez AI Lab = nombre d'événements Stripe `trialing`/`active` signés du scénario.

## Parcours 4 — Continuité linguistique
`?lang=fr` depuis le site vitrine → pricing, inscription, connexion, choix du plan, checkout, retour : tout reste en français ; `?lang=en` reste en anglais ; sans paramètre : anglais ; une préférence déjà enregistrée n'est jamais écrasée. **Attendu aussi :** la langue de Stripe Checkout = langue de l'interface (locale explicite) ; l'e-mail d'activation est dans la langue choisie (sinon pays sans ambiguïté, sinon anglais).

## Parcours 5 — Deux tableaux de bord
Après les parcours 1 à 3 : `GET /api/admin/conversion/global` et `/outbound` (clé `x-admin-key`) sur la fenêtre du test, ou la page `/admin-conversion.html`.
| Contrôle | Attendu |
|---|---|
| Vues des tarifs / CTA / inscription | égales aux visiteurs **consentants** simulés, 1 par jour et par visiteur malgré les rechargements |
| Visiteur sans consentement | n'apparaît dans aucune étape « consented » ; son essai/abonnement Stripe est compté (couverture « all », visiteur non identifié) |
| Essais / abonnements payants | = nombre d'événements Stripe `trialing` / `active` signés du scénario |
| Un clic n'est pas un paiement | `subscription_activated` = 0 tant qu'aucune facture n'est payée |
| Taux | aucun taux entre une étape « consented » et une étape « all » (`mixed_coverage`) |
| Outbound | uniquement les visiteurs de source `smartlead` ; santé de livraison (délivrés / en attente / abandonnés) cohérente avec la file |
| Confidentialité | aucune adresse e-mail, IP, `fp_lid` ni identifiant Stripe dans les réponses |

## Mesure des abandons (à relever)
Visiteurs qui s'arrêtent après : tarifs → CTA → formulaire affiché → formulaire rempli → checkout ouvert → carte saisie. Chaque étape est un compteur des tableaux de bord ; l'écart entre deux étapes de même couverture donne l'abandon.

## Critères de réussite
Les cinq parcours réussissent **avec preuves archivées** (captures réseau, sorties API/SQL, journaux, identifiants Stripe TEST du scénario) et **aucun** événement réel n'a été créé. Un seul critère manquant = parcours non validé.

## Ce que ce protocole ne couvre pas
Achats LIVE, e-mails réels à des clients, disponibilité commerciale.
