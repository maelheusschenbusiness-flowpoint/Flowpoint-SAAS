# Plan de mise en production du lot 2 (prêt, NON exécuté) — 21 novembre 2026

Contenu : PR #517 (Flowpoint ← `claude/port-addons-lot2`), 11 commits, CI verte, 0 commit de retard sur Flowpoint. Elle reste en brouillon tant que le test Google réel (`docs/PLAN-TEST-GOOGLE-REEL-LOT2.md`) n'est pas concluant.

## Critères GO (tous requis)
1. Test Google réel concluant pour les add-ons à publier (sinon l'add-on est exclu du lot, voir « Lot réduit »).
2. CI verte sur le commit exact fusionné ; #517 à jour avec Flowpoint.
3. Décision écrite sur Local Presence Optimizer (« validation requise » dans Test-Replit) : ne poser sa variable LIVE qu'après validation.
4. Prix LIVE créés et vérifiés (procédure `PROCEDURE-VERIFICATION-STRIPE-LIVE-RENDER-LOT1.md`, même méthode).

## Ordre d'exécution
1. Instantané des tables de facturation (schéma `bak_YYYYMMDD`) — le portage ne modifie aucune table existante, le but est la traçabilité.
2. Sortir #517 du brouillon, vérifier la CI sur le commit exact, fusionner. Render redéploie (~4 min).
3. Vérifier : santé 200, 0 erreur dans les journaux, les 5 tables créées (`gsc_page_data`, `agency_portfolio_priority_settings`, `local_landing_opportunity_settings`, `local_presence_settings`, `gbp_performance_settings`), 0 organisation modifiée vs instantané, catalogue public **sans** les 4 add-ons (garde de prix).
4. Créer 4 prix LIVE mensuels EUR (19 / 15 / 9 / 15 €) avec métadonnées de la convention ; poser sur Render Main `STRIPE_PRICE_ID_AGENCY_PORTFOLIO_PRIORITIES`, `STRIPE_PRICE_ID_LOCAL_LANDING_OPPORTUNITIES`, `STRIPE_PRICE_ID_LOCAL_PRESENCE_OPTIMIZER`, `STRIPE_PRICE_ID_GBP_PERFORMANCE_LEADS` — **une variable par add-on certifié**, jamais plus.
5. Vérifier le catalogue : les add-ons posés passent `available` aux bons montants ; les autres restent absents.
6. Achat LIVE contrôlé puis annulation, sur un compte à vous (jamais un client).

## Retour arrière
- Masquer un add-on : supprimer sa variable `STRIPE_PRICE_ID_*` (redémarrage) → invisible, non achetable ; les droits existants restent mais ne sont plus renouvelables.
- Annuler le code : `git revert -m 1 <merge #517>` ; les 5 tables vides restent, inoffensives.
- Instantané : schéma `bak_YYYYMMDD`.

## Lot réduit
Si seuls certains add-ons passent le test Google : poser uniquement leurs variables. Le code des autres reste inerte (garde de prix) ; chaque add-on se revert séparément (un commit par add-on).
