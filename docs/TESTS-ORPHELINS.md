# Tests orphelins, perimetre vitest et « 63 echecs preexistants »

Etat au 08/11/2026 (chantier B-11 / B-12 / F-06).

## 1. Le probleme : une liste blanche silencieuse

`artifacts/api-server/vitest.config.ts` listait ~260 fichiers dans `include`. Un fichier
de test non liste **ne tournait jamais**, sans aucun signal : ni echec, ni avertissement.
Au 08/11/2026, 26 fichiers `*.test.ts` etaient dans ce cas (22 signales par l'audit + 4
trouves en cherchant : `dataforseo-backlinks`, `google-service-gbp-performance`,
`e2e-growth-sync`, `addon-test-price-mappings`), plus `tools/custom-domain-cert-preflight.test.ts`
et quatre scripts `.cjs` / `.mjs` / `.spec.cjs` que vitest ne peut pas lancer.
La liste blanche produisait en outre des conflits de fusion d'une ligne entre PR
paralleles (chaque PR y ajoutait la sienne).

## 2. La regle maintenant

* `vitest.config.ts` utilise un **glob** : `src/**/*.test.ts`, `tests/**/*.test.ts`,
  `tools/**/*.test.ts`, `../../lib/db/src/**/*.test.ts`. Un nouveau test tourne seul,
  sans toucher a la configuration.
* Les fichiers qui ne doivent **pas** tourner sous vitest sont listes dans
  `artifacts/api-server/vitest.exclusions.mjs`, **chacun avec sa raison**.
* La CI (`scripts/verifier-tests-orphelins.mjs`, premiere etape) echoue si :
  un fichier `*.test.*` / `*.spec.*` n'est ni inclus ni exclu ; une exclusion n'a pas de
  raison (>= 20 caracteres) ; une exclusion ne designe plus aucun fichier.
  Localement : `pnpm --filter ./artifacts/api-server run test:orphans`.
* Un test ne devient **jamais** vert parce qu'on l'exclut : un test qui echoue pour une
  bonne raison est corrige (ou le code, si c'est un vrai bug).

## 3. Bilan des fichiers orphelins (executes sur PostgreSQL 16 local jetable, schema de la migration du depot)

| Fichier | Verdict | Action |
|---|---|---|
| `src/{stripe,quotas,api-security,auth,health,monitoring,google}.test.ts` | `node:test` contre un serveur vivant (`TEST_BASE_URL`), plusieurs acceptent `[200, 401]` sans jeton : ne prouvent rien et non deterministes | **Exclus** (raison dans `vitest.exclusions.mjs`) |
| `src/tests/session_isolation.test.ts` | script, serveur vivant `127.0.0.1:8081` | **Exclu** (isolation couverte par `session_restore_precedence`, `cross_tenant_rbac_sso`) |
| `src/tests/e2e-ailab-transmission.test.ts` | exige un recepteur AI Lab vivant ; son mock `stripe-factory` est de plus perime | **Exclu** (config `vitest.e2e.config.ts`) |
| `src/tests/e2e-growth-sync.test.ts` | exige `SAAS_URL` (base alimentee) ; config dediee | **Exclu** (zone vendeurs) |
| `tests/certification/github_p1_fix.test.ts` | serveur vivant `localhost:8081` | **Exclu** |
| `tests/certification/lot_c_billing.test.ts` | **perime** : ~45/110 assertions echouent (facturation lue dans `organizations`, contrat de reactivation change, route webhook 404) | **Exclu, dette connue** a reecrire ; comportement couvert par les suites billing vitest |
| `src/tests/billing-isolation.test.cjs` | **perime** : identifiants d'organisation e-mail refuses par le schema UUID ; SQL brut | **Exclu, dette connue** |
| `tests/e2e/audit-confirm-ui.spec.cjs` | Playwright contre un serveur deploye | **Exclu** (ne jamais lancer en CI) |
| `delete_defense_depth`, `monitor_cron_p1_fix`, `notification_robustness`, `settings_p1_fixes`, `store_me_elimination` (`tests/certification/`) | scripts tsx autonomes (serveur Express en processus + DB) ; **echouaient** (org id texte vs UUID, `owner_email` NOT NULL, colonnes `timestamp`) | **Repares** (tests corriges) et lances par `pnpm run test:certification` (etape CI) |
| `tools/addon-cert-db-guard.test.mjs`, `src/tests/billing-portal.test.cjs` | `node:test` / script pur ou DB, passaient | Ajoutes a `test:certification` |
| `src/tests/session_revocation.test.ts` | **perime** : imposait `await invalidateAllSessions` dans `team.ts`, remplace par une suppression transactionnelle de `user_sessions` | **Reecrit** sur le contrat actuel, converti en vitest |
| `src/tests/billing_store_me.test.ts` | script + org id texte vs UUID + pool mocke par `vitest.setup.ts` | **Converti** en vitest, vrai `@workspace/db`, `randomUUID()` |
| `src/tests/activity_logs_isolation.test.ts` | script ; revele un **vrai bug** (voir §4) | **Converti** en vitest, vrai `@workspace/db` |
| `src/tests/payment-intent-authenticated-customer-anchor.test.ts` | **perime** : ancre de recherche = ancienne condition du code | **Corrige** (nouvelle condition) |
| `src/lib/addon-test-price-mappings.test.ts` | **perime** : les identifiants TEST verifies (`VERIFIED_TEST_ADDON_PRICE_IDS`) priment sur les variables d'environnement | **Corrige** |
| `onboarding-replay-button`, `stale-team-members-org-503`, `dataforseo-backlinks`, `google-service-gbp-performance`, `tools/custom-domain-cert-preflight` | passaient tels quels | **Reintegres** par le glob |

## 4. Vrai bug decouvert : `store.getFilteredActivity` laisse une transaction ouverte

`artifacts/api-server/src/services/store.ts` : `getFilteredActivity` ouvre
`BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY` mais ne fait **ni COMMIT ni
ROLLBACK** avant `client.release()`. La connexion revient au pool « idle in transaction »,
en lecture seule : la prochaine ecriture qui la recoit echoue avec
`cannot execute INSERT in a read-only transaction` (`logActivity` l'avale silencieusement :
des evenements d'activite sont perdus). Le test `activity_logs_isolation` le revele
(`Event must be persisted to DB`, 0 !== 1) et passe apres le correctif (COMMIT / ROLLBACK).
La methode n'a aujourd'hui aucun appelant de production hors `getRecentActivity`
(deprecie) : bug latent, mais pernicieux pour tout futur appelant.

## 5. Origine des « 63 echecs preexistants » (PR #353-#357 d'AI Lab)

Mesures sur `Test-Replit` (commit 994e598), `vitest run --no-file-parallelism`, variables de
la CI, PostgreSQL 16 local jetable (la CI utilise 17) :

| Scenario | Resultat |
|---|---|
| Liste blanche, **avec** PostgreSQL | 3205 tests, **2 echecs** (assertions de duree `< 1000 ms` de `stripe-webhook-pending-activation`, ~1010 ms dans ce bac a sable, voir §6), 6 ignores |
| Liste blanche, **sans** PostgreSQL (`DATABASE_URL` inaccessible) | 3205 tests : **39 echecs**, 266 ignores, 28 fichiers en erreur — tous les `*-db.test.ts` / `*-postgres.test.ts` (`ECONNREFUSED`) |
| **Tous** les fichiers `*.test.ts` (glob) avec PostgreSQL, avant corrections | 3228 tests, **12 echecs** + 15 fichiers en erreur sans suite (node:test, scripts tsx) |

Le chiffre **63 n'a pas pu etre reproduit exactement** ; il est de l'ordre de grandeur du
scenario « sans PostgreSQL » (39 echecs + des fichiers entiers en erreur) et du scenario
« tous les fichiers sans corrections » (12 echecs + 15 fichiers en erreur). Hypothese la
plus probable : un bac a sable d'agent AI Lab **sans PostgreSQL local**, ou la suite
`vitest run` sans la liste blanche etait lancee avec les orphelins : les tests de base de
donnees echouent (`ECONNREFUSED`) et les scripts sans `describe` plantent. Ces echecs ne
sont **pas** des regressions de code : ils disparaissent avec un PostgreSQL accessible et les
orphelins traites comme ci-dessus. Les lancer sans base doit se lire comme « DB indisponible »,
non comme « 63 bugs preexistants ».

## 6. Remarque : assertions de duree dans `stripe-webhook-pending-activation`

Deux tests affirment `Date.now() - started < 1000`. Dans le bac a sable de cette analyse
(proxy HTTP sortant), ces deux livraisons de webhook coutent de facon reproductible
~1010-1025 ms (les memes tests de la famille `invoice.*` / `plan-changed email` montrent aussi
~1010 ms) ; la cause exacte n'a pas ete isolee (un delai fixe de ~1 s sur un chemin qui sort du
processus est le suspect), et la CI GitHub n'a pas ete observee a ce sujet ici. Ce n'est pas un
bug produit demontre ; c'est une assertion de duree absolue sensible a l'environnement. Non
modifiee ici (hors perimetre) : a durcir ou a expliquer separement.

## 7. Audit des dependances

`pnpm audit --prod --audit-level=high` (08/11/2026) : 4 failles, dont 2 `high` — `zod < 4.6.6`
(GHSA-mrhx-c7xc-m3w5, chemin `api-server > zod`) et `body-parser >= 2.0.0 < 2.4.0`
(GHSA-27r3-jxmh-p828, chemin `api-server > express > body-parser`). L'arbre n'etant pas propre,
l'etape CI est **informative (non bloquante)** ; la rendre bloquante apres mise a jour.
