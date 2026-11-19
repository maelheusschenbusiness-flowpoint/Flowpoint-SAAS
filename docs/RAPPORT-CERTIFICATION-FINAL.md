# Rapport final de certification et plan d'intégration — 17 novembre 2026

Aucune fusion vers `Flowpoint`, aucun déploiement, aucun changement de connexion entre environnements n'a été fait. Tout ce qui suit est soit prouvé (preuve citée), soit marqué « non prouvé ».

## 1. Ce qui est prouvé
| Sujet | Preuve |
|---|---|
| 13 PR compatibles, fusion séquentielle simulée | 1 conflit trivial (catalogue ES de `dashboard.js`, garder les deux côtés) ; suite complète 5009 réussis / 0 échec sur l'arbre intégré |
| Tunnel plan × langue × méthode × profil | PR #488 : 54/54 cellules, suite locale 506 réussis / 0 échec / 37 `fixme` (défauts documentés), 3 profils ; typecheck et contrôle des tests orphelins OK |
| Option A (couche de langue sur les pages publiques de production, contrat backend inchangé) | Vérifiée en local contre le backend de production ; PR #476 reste brouillon |
| Rejets `unknown_fp_lid` | 38 rejets rattachés à l'instance de test (agrégats) ; diagnostic considéré établi par le propriétaire |
| Rejeu navigateur des add-ons | `docs/beta2-addon-matrix.md` : 10 validés, 4 instables (déjà instables sans l'intégration, témoin), 7 sans parcours navigateur |
| Panier | PR #487 : politique, 10 tests, risques ; **aucune page modifiée** |

## 2. Ce qui n'est PAS prouvé
- **Stripe TEST réel** : non exécuté (manquent clés `sk_test_`, secret webhook TEST, prix TEST, boîte de réception de test, clé d'administration de nettoyage). Seul le simulé local est certifié (carte obligatoire, essai 14 j, webhooks signés, idempotence).
- **Fournisseurs réels** : Better Stack, HubSpot, DataForSEO, GA4/GSC, e-mail : aucune certification réelle.
- **Désinscription du moteur d'acquisition** : preuve de clic réelle absente ; arrêt sur réponse des Clients reste bloqué ; hausses de plafonds de +15 non expliquées ; Sellers reste à l'arrêt.
- **4 parcours add-ons instables** (Global Monitoring, Conversion Opportunity Engine, SEO Change Impact et ses 3 modules associés, Agency Reporting Packs une fois) : hypothèse de défaut produit (saisie écrasée par un chargement tardif), non confirmée.

## 2 bis. Défauts ouverts du tunnel (PR #488, tests `defautConnu`)
D1 (P2) appui sur un plan avant fin de `/api/plans/catalog` : rien ne s'ouvre. D2 (P2) compte existant (409) : message générique en anglais. D3 (P2) `/checkout.html?plan=ultra` anonyme perd le plan. D4 (P2) appareil neuf : compte français ouvert en anglais. D5 (P3) débordement horizontal iPhone 13 sur `pricing.html`. D6 (P3) `finalize-checkout` plan inconnu : faux succès 200. D7 (P3) webhook `setup_intent.succeeded` sans moyen de paiement : 500. Pas de correction dans ce rapport.

## 3. Séquence d'intégration sur Test-Replit
Ordre, avec contrôle après chaque groupe (typecheck, vitest des fichiers touchés, ratchets `audit-langues` et orphelins) :
1. **Add-ons** : #470, #472, #473 (résoudre `dashboard.js` + `src/frontend/dashboard.js` en gardant les deux entrées de catalogue), puis #483, #484, #485. Après le groupe : suite complète + rejeu navigateur des modules concernés.
2. **Langue / tunnel** : #475, #478, #479, #480. Après : suite complète, spec `08-langue-par-defaut`, matrice #488 sur un profil.
3. **Instrumentation** : #481, #482. Après : tests de la boîte d'envoi (`conversion_event_outbox`), migration 029 sur base jetable.
4. **Docs/études** : #477, #487, #488, ce rapport.
Condition de fusion de chaque PR : contrôle requis « Types, build, tests » vert, branche à jour, aucun conflit. Ne jamais toucher la PR #438.

## 4. Prérequis de déploiement (flowpoint-test, autoDeploy depuis Test-Replit)
- Migration 029 appliquée (idempotente) ; vérifier sur la base de test avant déploiement.
- Variables : aucune nouvelle sans valeur ; secrets jamais dans le dépôt.
- Après déploiement : sondes en lecture seule sur `https://flowpoint-test.onrender.com` (pages publiques, `/api/plans/catalog`).

## 5. Plan de retour arrière
- Étiquette de repère proposée avant la première fusion : `f0033049` (tête actuelle de Test-Replit).
- Par fusion : `git revert -m 1 <merge>` dans l'ordre inverse ; la migration 029 est idempotente et additive, aucune suppression de données.
- Environnement : noter la valeur précédente de chaque variable avant modification et la restaurer à l'identique.
- Panier : aucune migration, revert du commit suffit.

## 6. Destination de flowpoint-test vers l'AI Lab TEST — préparée, NON appliquée
Variables côté flowpoint-test : `AI_LAB_CONVERSION_URL`, `CONVERSION_EVENT_SECRET`, `AI_LAB_CONVERSION_TIMEOUT_MS`.
1. Isolation vérifiée : service `flowpoint-ailab-test-1ib2` séparé de la production, base propre (expiration de la base 2026-12-14), secret propre. Re-vérifier le jour J que l'URL cible ne pointe pas la production.
2. Prérequis : service réveillé (démarrage à froid ≈ minute), délai d'attente réglé pour le démarrage à froid, secret identique des deux côtés sans l'écrire en clair dans un chat ou un commit.
3. Enregistrer l'ancienne valeur de `AI_LAB_CONVERSION_URL` ; modifier ; un déploiement de la bêta se déclenche.
4. Validation : spec `13-ailab-test.stripe.ts` (sans Stripe LIVE), puis compter les rejets `unknown_fp_lid` côté test (attendu : 0 nouveau sur les événements synthétiques).
5. Retour arrière : restaurer l'ancienne valeur, nouveau déploiement.
**Décision du propriétaire requise avant l'étape 3.** L'AI Lab de production n'est pas modifié.

## 7. Proposition de mise en production limitée (à valider, rien n'est lancé)
Contient uniquement ce qui est prouvé :
- **PR #476, option A** : couche de langue sur les 11 pages publiques (anglais par défaut), contrat backend inchangé. Prouvé en local contre le backend de production. Prérequis : confirmer par un contrôle visuel de ses pages après déploiement en bêta puis en production ; retour arrière = revert de la fusion (fichiers statiques uniquement, pas de migration).
Hors proposition (non prouvés ou bloqués) : politique du panier (spécification seulement), instrumentation conversion, add-ons instables, tout ce qui dépend de Stripe TEST réel, de la désinscription, du formulaire d'inscription à 3 champs et de `preferred_locales:["fr"]` côté backend de production.

## 8. Décisions à prendre par le propriétaire
1. Autoriser la fusion de #476 en bêta d'abord, puis la mise en production limitée ci-dessus.
2. Valider le changement de destination vers l'AI Lab TEST (section 6, étape 3).
3. Fournir les accès Stripe TEST (clés, secret webhook, prix, boîte de réception, clé de nettoyage) pour la certification réelle.
4. Décider du traitement des défauts D1 à D4 et de l'instabilité des 4 parcours add-ons (correction avant ou après mise en production limitée).
5. Moteur d'acquisition : autoriser un second test de désinscription sur boîte réelle, expliquer les hausses de plafonds de +15.
