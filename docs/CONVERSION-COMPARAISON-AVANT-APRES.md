# Comparer le tunnel AVANT / APRES un changement — méthode, outils, limites

Branche : `Test-Replit`. Lecture seule, aucune donnée personnelle (des comptes uniquement).

## 1. Ce qui existait, ce qui est ajouté

| Besoin | Existant | Ajouté |
|---|---|---|
| Vue agrégée admin | `GET /api/admin/conversion/global` et `/outbound` (clé `x-admin-key`, `ADMIN_KEY` ≥ 32 car.), page `admin-conversion.html` : événements et visiteurs distincts par étape, taux entre étapes de **même couverture**, visiteurs `fp-test-*` exclus, livraison outbox | relu : correct (doublons par clé d'idempotence, `mixed_coverage` plutôt qu'un faux taux, 403/503 testés) |
| Compteurs par jour / source / plan, familles séparées | rien | `GET /api/admin/conversion/counters?from=AAAA-MM-JJ&to=AAAA-MM-JJ` |
| Rejets 400 de `/api/public/funnel-event` par motif | rien (400 non comptés ; consentement absent = 204 muet) | table `funnel_event_rejections` (jour, motif, total) + lecture dans `counters` |
| Livraison AI Lab par étape (rejets 400 épuisés, reprises en cours) | `outbound` : totaux sans étape | `counters` : `rejections.aiLabDelivery.byStage` |
| Avant/après | rien | `GET /api/admin/conversion/before-after?change=AAAA-MM-JJ&days=7`, `scripts/conversion-avant-apres.mjs`, `artifacts/api-server/tools/conversion/avant-apres-lecture-seule.sql` |

Toutes les routes sont derrière la même garde que l'existant (`x-admin-key`, comparaison à temps constant, 403 sans clé, 503 si `ADMIN_KEY` absente ou trop courte), en `Cache-Control: no-store`, et n'exécutent que des `SELECT`.

## 2. Deux familles, jamais additionnées

| Famille | Étapes (branche `Test-Replit`) | Condition d'écriture | Couverture |
|---|---|---|---|
| `consent_gated` | `landing_vue`, `tarifs_vus`, `cta_clique`, `signup_started`, `signup_form_engaged`, `signup_form_completed`, `checkout_started`, `checkout_completed`, `checkout_payment_failed` | cookie `fp_analytics_consent=accepted` + `fp_vid` valide (source optionnelle) | **minimum** : un visiteur qui refuse ne laisse aucune trace |
| `transactional` | `trial_activated`, `trial_expired`, `subscription_activated` | webhook Stripe signé, sans consentement | tout le monde |

La table de familles vit dans `src/services/funnel-counters.ts` ; un test échoue si une étape de `ETAPES_TUNNEL` n'est pas classée. La branche de production ajoute `signup_submitted`, `signup_failed`, `payment_succeeded`, `payment_failed` (PR #464/#465, non encore sur `Test-Replit`) : elles sont déjà classées, la chaîne avant/après les déclare `notInstrumented` tant qu'elles sont absentes de `ETAPES_TUNNEL`.

Différence à connaître : sur `Test-Replit`, `enregistrerEtapeTransactionnelle` n'existe pas et les lignes `trial_activated` / `subscription_activated` gardent le `visiteur_id` quand le visiteur avait consenti. La réponse porte donc `consentCoverage` : part des événements transactionnels reliés à un visiteur consentant. Sur la branche de production (visiteur retiré) cette part lit 0 %, ce qui n'est pas une erreur.

## 3. Lire les compteurs

`counters` renvoie : `families.{consent_gated,transactional}.stages` (événements et visiteurs distincts sur la fenêtre), `daily` (par jour et étape), `bySource`, `byPlan` (valeurs libres ramenées à une liste fermée : `standard|pro|ultra|other|unknown`, source `smartlead|google|direct|social|other_campaign|other|unknown`), `consentCoverage`, `rejections.saasPublicEndpoint` et `rejections.aiLabDelivery`.

Motifs du compteur de rejets SaaS (liste fermée, choisie par le serveur) : `unknown_stage` et `missing_visitor_id` (HTTP 400), `consent_missing` (204 : pas de consentement `accepted`, ou identifiant de visiteur mal formé), `storage_error` (événement valide mais écriture impossible — contrainte, base — perdu, réponse 204). Le compteur ne démarre qu'au déploiement : une fenêtre antérieure n'a pas de rejets observés.

Non disponibles, dit explicitement dans la réponse (`dimensionsUnavailable`) : la **campagne** (colonnes UTM présentes sur la branche de production seulement) et la **langue** (stockée nulle part).

## 4. Méthode avant/après

1. **Fenêtres.** `days` jours (7 par défaut, 1 à 60) avant la date de mise en production `[change − days, change)` et `days` jours après `[change, change + days)`, bornes UTC. Même longueur, même répartition des jours de semaine si `days` est multiple de 7. La fenêtre « après » encore en cours est tronquée à l'instant de la lecture et marquée `complete: false` : jamais complétée par des zéros ; `days` y indique les jours observés.
2. **Étapes comparées** (famille consentement) : `tarifs_vus` → `cta_clique` → `signup_started` → `signup_submitted` (si instrumentée) → `signup_form_completed` → `checkout_started` → `checkout_completed`. Famille transactionnelle à part : `trial_activated`, `subscription_activated` (`payment_succeeded` si instrumentée).
3. **Déduplication.** Visiteurs distincts par étape sur la fenêtre, et visiteur-jours distincts (visiteur + étape + jour, la clé d'idempotence côté serveur). Un rechargement ou un retour n'ajoute pas un second visiteur. Événements Stripe : clé d'idempotence (identifiant de session / d'abonnement). Visiteurs `fp-test-*` exclus.
4. **Taux.** Cohorte dans la fenêtre : visiteurs ayant l'étape *k* **et** l'étape *k−1* ÷ visiteurs ayant l'étape *k−1*. Un visiteur arrivé directement sur l'étape *k* n'entre pas dans le numérateur. Intervalle de Wilson à 95 %.
5. **Consentement.** Les comptes `consent_gated` sont un minimum ; `consentCoverage` (parmi les essais/abonnements, quelle part est reliée à un visiteur consentant) dit combien du tunnel amont est vu. Si cette part change entre les deux fenêtres (nouveau bandeau, nouvelle page), la comparaison est faussée : le vérifier avant de conclure.
6. **Événements serveur.** Comptés séparément, pour tout le monde ; on lit leur variation en nombre absolu, jamais en taux de la famille consentement (couvertures différentes).
7. **Verdict par taux** : `no_data` (un dénominateur nul), `insufficient_sample` (< 30 visiteurs au dénominateur d'un côté ou de l'autre), `intervals_overlap` (différence indiscernable du hasard), `difference_outside_intervals`. On ne conclut à une amélioration qu'avec le dernier.

## 5. Produire le tableau

```bash
# API (clé en variable d'environnement, jamais en argument)
FLOWPOINT_API_URL=https://<hote> ADMIN_KEY=... node scripts/conversion-avant-apres.mjs --change 2026-12-01 --days 7

# SQL de lecture seule (transaction READ ONLY), mêmes comptes
psql "$DATABASE_URL" -v change="'2026-12-01'" -v days=7 -f artifacts/api-server/tools/conversion/avant-apres-lecture-seule.sql
```

Les deux sont validés l'un contre l'autre par `funnel-before-after-db.test.ts`.

## 6. Limites — à lire avant toute conclusion

- **Petits échantillons.** En production : de l'ordre de 20 visiteurs sur 30 jours, un seul abonnement LIVE (annulé). Sur 7 jours un dénominateur dépasse rarement quelques unités : presque tout taux sera `insufficient_sample`. La comparaison reste utile pour détecter une **panne de mesure** (une étape qui tombe à zéro), pas pour chiffrer un gain.
- **Pas de contrôle du mélange de trafic.** Campagne, saison, jour de semaine, volume d'e-mails sortants varient entre fenêtres et ne sont pas neutralisés ; la campagne n'est pas lisible sur cette branche.
- **Consentement non observé pour les refus.** On ne peut pas mesurer ce qu'un visiteur non consentant a fait ; les taux concernent les consentants, pas la population.
- **Cohorte tronquée aux bords.** Un visiteur qui entre dans le tunnel avant le début d'une fenêtre et le termine dedans est vu sans son étape de départ.
- **Compteur de rejets récent.** Aucun historique avant son déploiement.
- **Pas d'identité entre visiteur et compte** dans cette table : « inscriptions réelles » se lit côté `organizations`, pas ici.

## 7. Ce qui demande une autorisation

- Déploiement de ces routes et du compteur de rejets sur `flowpoint-test` puis production.
- Migration `029_funnel_event_rejections.sql` : idempotente et additive, mais le dépôt crée aussi la table à la première écriture (comme `funnel_events`) ; l'appliquer en production, ou laisser le service la créer, est une décision à valider.
- Toute lecture de la base de production (outbox, `funnel_events`) pour chiffrer l'état réel.
