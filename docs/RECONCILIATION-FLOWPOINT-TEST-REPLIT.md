# Réconciliation Flowpoint ↔ Test-Replit

Branche isolée créée depuis le HEAD de `Flowpoint` (`8efe7916`). Historique réuni à Test-Replit (`a523a19b`) par un commit de fusion à deux parents, dont **l'arbre part de Test-Replit** ; les apports propres à `Flowpoint` y sont reportés un par un, dans des commits séparés et relisibles. Rien n'a été fusionné, déployé ni modifié sur `Flowpoint`.

## Méthode
1. Inventaire des 35 commits non-merge propres à `Flowpoint` (48 avec les merges) : pour chacun, part de ses lignes ajoutées déjà présente dans Test-Replit.
2. Un test de comportement plutôt qu'une comparaison de texte quand les deux côtés ont porté le même sujet (les « ports » de Conversion B sont réappliqués, pas identiques).
3. Une fusion mécanique (`-X theirs`) a été essayée puis **rejetée** : elle ne compilait pas (appels UTM sans la fonction correspondante). Le report se fait donc fichier par fichier.
4. Aucun correctif d'authentification n'est perdu : `requireAuth.ts`, `orgContext.ts`, `security.ts`, `admin.ts` n'ont aucune ligne `Flowpoint` absente du résultat.

## Transféré (absent de Test-Replit, repris)
| Sujet | Commits Flowpoint | Où |
|---|---|---|
| Attribution UTM (source/medium/campagne) jusqu'à l'abonnement | 41695214, 13c5bdb0, 286a90db | `funnel-events.ts` (version Flowpoint + création de table à la demande de Test-Replit), `public-billing.ts`, `stripe-webhook.ts`, `auth.ts`, `signup-subscription.ts`, `carry-params.ts` |
| Agrégats d'attribution pour AI Lab, clé restreinte `ATTRIBUTION_EXPORT_KEY` (lecture seule, 1 route) | db1823d1, 89af7f93 | `admin.ts`, test d'inventaire des gardes |
| Migration des colonnes UTM au démarrage (non fatale) | 286a90db | `index.ts` ; SQL de référence renumérotés `029_`/`030_` (les fichiers `migrations/*.sql` ne sont exécutés par rien) |
| Exemption des webhooks Stripe du limiteur global (429 = échec de livraison) | 897c6879 | `app.ts` |
| Garde d'identifiant d'organisation non canonique (500 en boucle chez Stripe) | b3326124 | `stripe-webhook.ts` |
| Tests de sécurité des clés API sur base réelle | c0f752ae | `security-api-keys-db.test.ts` |
| Capture UTM navigateur | d237dd7d / b3316503 (partie campagne) | nouveau `utm-capture.js`, **sans** second identifiant visiteur |
| `tarifs_vus` | funnel-tracking.js | émis par `pricing-funnel.js` de Test-Replit (même identité `fp_vid`) |

## Conservé tel quel côté Test-Replit (supplanté, plus strict ou équivalent)
| Sujet | Pourquoi |
|---|---|
| Séparation événements Stripe test/live (897c6879) | Test-Replit exige `STRIPE_TEST_MODE`, un mode de clé cohérent, un secret propre au mode : plus strict. Le test de Flowpoint a été aligné (503 sans mode déclaré). |
| Vérification de plan `GET /billing/verify` (5ca9f09e, 691d0c07, 00931d73) | Même garantie « aucune écriture de plan hors achat de plan » ; Test-Replit répond 202 tant que le webhook n'a pas appliqué l'achat. Les 8 écarts du test de Flowpoint sont uniquement 200 vs 202. |
| Éligibilité à l'essai (logique de `public-billing.ts`) | Test-Replit revalide l'éligibilité à la finalisation (#410) ; la version Flowpoint est l'ancienne. **Protection contre les essais multiples conservée.** |
| Correctifs de migration (6d4a1672, 2445f406, b56311c9) | Migration réécrite côté Test-Replit ; sur base neuve : 819 étapes OK, 0 échec, 0 table manquante, 140/140 tables avec RLS. |
| Ports de Conversion B (`fp_lid`, AI Lab, outbox) | Mêmes tests (mêmes titres) des deux côtés ; l'émetteur de Flowpoint passe 19/19 sur le code de Test-Replit. |
| Préférences, durcissement des clés (539981d4, 63bb1e45) | Déjà présents (92 % / 100 %). |

## Reporté ou non repris
| Sujet | Décision |
|---|---|
| `funnel-tracking.js` (tracker de Flowpoint) | **Non repris** : il utilise `fp_funnel_visitor_id`, Test-Replit utilise `fp_vid` ; les deux ensemble compteraient deux fois les visiteurs. Son test (`funnel-tracking-inscription`) est retiré. Les pages de production le chargent aujourd'hui : après promotion, elles passent au tracker de Test-Replit (`pricing-funnel.js`, `signin.html`), `landing_vue` n'est plus émis par les pages de l'application (le site vitrine en est propriétaire). |
| 3 lignes de `dashboard.js` (menu d'intensité IA, action « épingler ») | Divergence d'interface, non reprise. |

## Planificateurs et activations : rien ne démarre seul en production
Test-Replit démarrerait, en production, des tâches absentes de `Flowpoint`. Elles sont désormais derrière un interrupteur explicite (hors production, comportement inchangé ; en production : désactivé sauf valeur exacte `true`) — `lib/beta-activation.ts`, test dédié :
- `GBP_POST_SCHEDULER_ENABLED` : publication planifiée de posts Google Business Profile.
- `WORKFLOW_SCHEDULER_ENABLED` : workflows IA planifiés (dont rapports AI Workspace Launch, node-cron).
Inchangés : l'ordonnanceur d'audits (déjà en production), l'outbox de jalons AI Lab (déjà en production), le scheduler d'Agency Reporting (PR #428, déjà derrière `AGENCY_REPORT_SCHEDULER_ENABLED`). Les modules à acheter restent `coming_soon` en LIVE (`plans.ts`). Aucune variable n'est posée par cette PR.

## Ce qui reste bloquant ou à décider avant toute promotion
1. Les neuf PR (#427–#436) ne sont pas dans Test-Replit : cette réconciliation est faite contre `a523a19b`, sans elles.
2. Contrat des agrégats d'attribution avec AI Lab : identique à Flowpoint (route et clé inchangées) ; à vérifier côté acquisition avant bascule.
3. Variables d'environnement de production à poser **consciemment** : aucune des deux ci-dessus tant qu'on ne veut pas activer la bêta.
4. Certification connectée (Stripe TEST, navigateur, e-mails réels) non exécutée ici.

## Complément du 12 novembre 2026 (reprise sur l'audit des add-ons)
- Les corrections de la PR « audit des 9 add-ons et du tunnel » sont fusionnées dans cette branche (conflits limités à `pricing-funnel.js` et son test, le même `tarifs_vus` ayant été fait deux fois ; version la plus complète conservée, qui mémorise aussi la source de première touche).
- **Simulation de bout en bout (390 px, vrai serveur, base jetable) : 32/32 sur ce build** ; 30/32 sur Test-Replit seul (les 2 écarts sont l'attribution UTM, propre à cette branche).
- Les tableaux de bord de conversion utilisent la couverture « consentis » / « tous » alignée sur ce que le code écrit réellement ; l'attribution UTM n'est comptée que pour les visiteurs consentants.
- Audit du diff contre Test-Replit : aucun défaut dans le code de production (limiteur de webhook limité aux deux chemins en POST, garde d'identifiant non canonique, UTM validée par motif et sous consentement, planificateurs derrière interrupteur, migrations de colonnes avec `lock_timeout`, clés de lecture d'agrégats restreintes à une route).
- Limite connue : les agrégats d'attribution exportés vers AI Lab ne masquent pas les petits effectifs ; ils ne contiennent ni identifiant visiteur, ni e-mail, ni organisation.
