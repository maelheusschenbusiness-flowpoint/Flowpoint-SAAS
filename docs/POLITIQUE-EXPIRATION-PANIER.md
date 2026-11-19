# Politique d'expiration du panier (`fp_cart`) — proposition, NON appliquée

Statut : spécification + tests. Aucune page n'est modifiée. `artifacts/flowpoint-export/fp-cart-policy.js` n'est chargé par aucune page.
Tests : `artifacts/api-server/src/tests/cart-expiration-policy.test.ts` (10 cas).

## Comportement actuel (inventaire)
| Lieu | Contrôle d'ancienneté | Écart |
|---|---|---|
| signin / pricing | 1 h sur `_updatedAt` | — |
| checkout.html | 1 h, **seulement si `_v === 1`** | un panier sans version n'expire jamais |
| checkout-payment.html | **aucun** | un onglet resté ouvert ou un panier ancien reste utilisable |
| dashboard.js (relais add-ons/crédits) | écrit `{plan:null, addons, fromDashboard:true}` sans `_v` ni date | contourne le contrôle de checkout |
| reprise `flowpoint_pending_checkout` (TTL 30 min) | `exp` respecté, mais le panier restauré garde son ancien `_updatedAt` | expire aussitôt à la reprise légitime |
| `pricing.js` | fichier mort | à supprimer séparément |

## Politique proposée (règle unique `fpCartPolicy.evaluate`)
1. Panier versionné : valable 1 h après `_updatedAt` ; refus si horodatage absent, futur (> 5 min) ou organisation différente.
2. Panier sans version : abandonné, **sauf** relais tableau de bord (`fromDashboard`, add-ons, sans plan) qui est conservé et ré-horodaté à la première lecture.
3. Plan inconnu, add-ons invalides ou panier vide : abandonné.
4. Reprise d'intention : valable jusqu'à `exp` (30 min), panier ré-horodaté à la restauration.
5. checkout-payment applique la même règle et redirige vers `/checkout.html` si le panier est refusé.
6. Le serveur reste seul décisionnaire (`/api/billing/quote`, `/api/public/payment-intent`) : prix, essai, éligibilité, quotas. La règle ne règle que la réutilisation côté navigateur.

## Risques de la modification
- **R1** Retirer les paniers sans version casserait l'achat d'add-ons/crédits depuis le tableau de bord si l'exception `fromDashboard` n'est pas livrée avec. Mitigation : cas testé.
- **R2** Sans ré-horodatage à la reprise, le panier restauré après connexion expirerait aussitôt. Mitigation : `restoreFromPending`, testé.
- **R3** Un utilisateur qui laisse checkout-payment ouvert > 1 h est renvoyé au panier : comportement voulu, perte de saisie Stripe possible (le PaymentIntent côté serveur reste inchangé).
- **R4** Décalage d'horloge client : tolérance 5 min ; au-delà le panier est refusé (l'utilisateur recompose son choix).
- **R5** Cache navigateur : le script doit être chargé avant la lecture de `fp_cart` sur chaque page, sinon une page garde l'ancienne règle.
- **R6** Quatre pages à modifier dans le même déploiement pour éviter une règle à deux vitesses (signin, pricing, checkout, checkout-payment) + dashboard.js pour l'horodatage.

## Plan de mise en œuvre (à valider avant toute modification)
1. Charger `fp-cart-policy.js` sur les 4 pages, remplacer les contrôles locaux par `evaluate` (+ `restamp`).
2. Horodater les écritures de `dashboard.js` (`_v:1`, `_updatedAt`).
3. Ajouter le contrôle dans checkout-payment ; rejouer le parcours navigateur (plan, add-on, tableau de bord, reprise après connexion, expiration simulée par horloge).
4. Retour arrière : revert du commit ; aucune migration, aucun état serveur.
