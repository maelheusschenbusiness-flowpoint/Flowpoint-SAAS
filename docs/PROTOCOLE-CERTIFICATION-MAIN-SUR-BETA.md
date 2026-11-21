# Certification du code exact de Flowpoint sur Flowpoint-Test — analyse et protocole (21 novembre 2026)

Objectif : certifier en Stripe TEST réel les 4 paquets de capacité, Local Domination Maps et Zapier/Make **avec le code de production** (branche `Flowpoint`, commit `797cd9f5` au moment de l'analyse), sans service payant supplémentaire. **Aucune branche Render n'est modifiée tant que la méthode n'est pas validée.**

## 1. Compatibilité Test-Replit → Flowpoint (vérifiée)
| Point | Constat | Preuve |
|---|---|---|
| Migrations | Les migrations de démarrage de Flowpoint s'exécutent sans erreur sur un schéma construit par Test-Replit (132 tables) | PostgreSQL 16 jetable : séquence complète Test-Replit, puis séquence de démarrage rapide de Flowpoint (7 étapes `OK`) |
| Instructions destructives | Aucune suppression de table, colonne ni donnée : uniquement `DROP POLICY/INDEX/CONSTRAINT IF EXISTS` suivis de leur recréation (mêmes instructions qu'en production) | lecture de `services/init-*.ts` |
| Contraintes recréées | `team_members` (rôle/statut) et `team_invitations` : les tables de la base de test sont **vides** | lecture seule sur la base de test |
| Marqueurs | `schema_migrations` de la base de test = marqueurs déjà présents localement (`missing-production-tables-v3`, `fix-org-uuid-relations-v1`) | lecture seule |
| Variables d'environnement | Flowpoint ne lit **aucune variable absente** de Test-Replit, hors `STRIPE_TEST_PRICE_ID_*` facultatives (déjà posées) et `ATTRIBUTION_EXPORT_KEY` (facultative) | comparaison des noms `process.env` des deux branches |
| Intégrations sortantes | Mêmes variables dans les deux branches (`RESEND_*`, `ENABLE_TEST_MAILER`, `AI_LAB_CONVERSION_*`, `GOOGLE_*`, `BETTERSTACK_*`, `DATAFORSEO_*`, `SLACK_*`, `HUBSPOT_*`) : le comportement sortant de la bêta ne change pas | idem |
| Tâches planifiées | Flowpoint démarre 3 tâches, Test-Replit 5 (en plus : rapports d'agence, publications GBP) : Flowpoint n'ajoute aucune tâche | `index.ts` |
| Build | Même dépôt et mêmes commandes de build ; plan 0,5 vCPU / 512 Mo | `get_service` |

### Écart de sécurité identifié (bloquant sans mitigation)
`getStripeKey()` : en mode test avec une clé de test absente ou invalide, **Test-Replit renvoie une clé vide** (jamais LIVE), alors que **Flowpoint retombe sur `STRIPE_LIVE_API_KEY` puis `STRIPE_SECRET_KEY`**. Si la bêta détient une variable de clé LIVE et que `STRIPE_TEST_MODE`/`STRIPE_TEST_KEY` ne sont pas exactement valides, le code de production y utiliserait une clé LIVE. Mitigation obligatoire avant la bascule : **vider sur la bêta uniquement** `STRIPE_LIVE_API_KEY` et `STRIPE_SECRET_KEY` (le service de production a ses propres variables, inchangées ; Test-Replit en mode test n'utilise pas ces variables).

## 2. Options sans service payant
| Option | Coût | Réalisme de la preuve | Risque | Verdict |
|---|---|---|---|---|
| **A. Bascule temporaire de la branche de Flowpoint-Test vers un commit figé de Flowpoint** | 0 € | webhooks Stripe **réellement livrés**, vraie base de test, vraies variables | maîtrisé par la mitigation ci-dessus ; réversible | **recommandée** |
| B. Nouveau service Render gratuit sur `Flowpoint` | 0 € (limites du plan gratuit) | nécessite de recopier tous les secrets à la main et de déclarer un nouveau point de webhook Stripe ; base à créer | secrets manipulés manuellement | plus long et plus risqué |
| C. Serveur local isolé | 0 € | aucun webhook livré par Stripe (rejeu d'événements) ; clé de test à fournir par formulaire sécurisé | aucun contact avec LIVE | preuve plus faible |

## 3. Protocole de l'option A
### État initial (relevé le 21/11, 21:44Z)
Service `flowpoint-test` (`srv-danup5egekts73a8og7g`) : branche `Test-Replit`, déploiement automatique sur commit, dernier déploiement `live` `dep-dc10uqp42hec73ff74j0` (commit `29b834f3`). Les valeurs des variables ne sont pas lisibles : noms et valeurs seront comparés avant/après par le comportement observé (catalogue, santé).

### Préparation (moi, avant toute bascule)
1. Créer la branche figée `cert/main-<sha>` = commit de Flowpoint (pas de dérive si Flowpoint évolue pendant la certification).
2. Instantané de la base de test : schéma `bak_YYYYMMDD` (organizations, org_addons, org_settings, schema_migrations) — ajout seulement.
3. Mitigation : vider `STRIPE_LIVE_API_KEY` et `STRIPE_SECRET_KEY` sur la bêta (mise à jour de variables, redéploiement de Test-Replit pour vérifier qu'il fonctionne toujours).
4. Vérifier que les 6 prix TEST sont lus (variables déjà posées) : paquets `[CERT]`, Local Domination Maps `price_1UeLpi…`, Zapier/Make `price_1UeLqd…`.

### Bascule (vous, ~2 min)
Render → `flowpoint-test` → Settings → Build & Deploy → **Branch** : `cert/main-<sha>`.

### Contrôles de bascule (moi, ≤10 min — arrêt immédiat et retour arrière au moindre échec)
- Déploiement `live`, santé 200, journaux sans `error`/`fatal`, aucune erreur de migration.
- Journaux de démarrage : mode Stripe TEST (préfixe `cs_test`, jamais `cs_live`).
- Catalogue public : les 6 add-ons visibles avec les bons montants ; connexion par jeton magique (`login-verify`).
- Arrêt si : démarrage en échec, santé ≠ 200 pendant 5 min, tout objet Stripe `livemode:true`, toute sortie inattendue.

### Certification (moi)
Pour chacun des 6 add-ons, organisations jetables en essai : prix = catalogue, achat réel, un seul abonnement même avec 3 activations simultanées, droits (402 puis 200), limites réellement appliquées (paquets : audits, rapports PDF, exports ; Local Domination Maps : routes ; Zapier/Make : route générique refusée sans l'add-on, acceptée avec), webhooks traités, plan principal inchangé (`trialing`, mêmes dates), annulation côté Stripe puis retrait des droits, nettoyage des abonnements TEST.

### Retour arrière (vous ~2 min, puis moi)
1. Render → Branch : `Test-Replit`.
2. Je vérifie : déploiement `live` sur le dernier commit de Test-Replit, santé 200, journaux propres, catalogue de la bêta (add-ons du lot 2 présents), connexion par jeton magique.
3. Je restaure si nécessaire `STRIPE_LIVE_API_KEY`/`STRIPE_SECRET_KEY` : **non**, elles restent vides sur la bêta (Test-Replit n'en a pas besoin en mode test).
4. Option de secours : Render « Rollback » vers `dep-dc10uqp42hec73ff74j0`.

## 4. Garanties
- **LIVE** : le service de production, ses variables, ses clés, ses prix et ses abonnements ne sont jamais modifiés ; la bêta est un service distinct avec sa base de test et ses clés `sk_test_`.
- **Clients** : aucune organisation de production n'est concernée ; les certifications n'utilisent que des organisations jetables `@flowpoint.test`.
- **Prix** : aucun prix LIVE créé ni modifié ; les 6 prix TEST existent déjà et ne sont pas dupliqués.
- **Commercial** : aucune campagne, aucun envoi réel (mêmes variables d'envoi qu'aujourd'hui sur la bêta ; mode d'envoi de test inchangé).
