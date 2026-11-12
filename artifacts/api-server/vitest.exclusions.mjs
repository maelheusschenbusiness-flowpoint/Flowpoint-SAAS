/**
 * Perimetre des tests de `artifacts/api-server` : motifs INCLUS et exclusions
 * DOCUMENTEES.
 *
 * Avant (jusqu'au 08/11/2026) `vitest.config.ts` etait une liste blanche de
 * ~130 fichiers. Un test ajoute sans etre liste ne tournait jamais et personne
 * ne s'en apercevait : 22 fichiers etaient dans ce cas (docs/TESTS-ORPHELINS.md).
 *
 * Desormais :
 *   - INCLUDE est un glob : tout nouveau `*.test.ts` sous `src/`, `tests/` ou
 *     `tools/` tourne automatiquement, sans toucher a ce fichier ;
 *   - EXCLUSIONS liste, avec sa RAISON, chaque fichier qui ne doit PAS tourner
 *     sous `vitest run` ;
 *   - `scripts/verifier-tests-orphelins.mjs` (CI) echoue si un fichier de test
 *     n'est ni couvert par INCLUDE ni declare dans EXCLUSIONS, ou si une
 *     exclusion n'a pas de raison ou ne designe plus aucun fichier.
 *
 * Regles pour ajouter une exclusion :
 *   - jamais pour obtenir un vert : un test qui echoue pour une bonne raison se
 *     CORRIGE (ou le code, s'il s'agit d'un vrai bug) ;
 *   - uniquement si le fichier ne PEUT pas s'executer sous vitest dans la CI
 *     (serveur vivant, autre lanceur, secrets), et la raison dit comment le
 *     lancer autrement.
 */

/** Fichiers executes par `vitest run` (globs relatifs a artifacts/api-server). */
export const INCLUDE = [
  "src/**/*.test.ts",
  "tests/**/*.test.ts",
  "tools/**/*.test.ts",
  // Paquet voisin teste avec la meme configuration (pool pg, SSL Supabase).
  "../../lib/db/src/**/*.test.ts",
];

/**
 * @typedef {{ fichier: string, raison: string }} Exclusion
 * @type {Exclusion[]}
 */
export const EXCLUSIONS = [
  // ── Smoke tests `node:test` contre un serveur vivant ─────────────────────
  // Ces sept fichiers sont ecrits avec `node:test` (pas vitest) et appellent
  // `fetch(TEST_BASE_URL)` (par defaut http://localhost:8080) : ils exigent un
  // serveur demarre et, pour la plupart, un TEST_AUTH_TOKEN. Beaucoup acceptent
  // plusieurs statuts (ex. `[200, 401]`) et ne prouvent donc presque rien
  // lorsqu'ils tournent sans jeton. Ils ne sont pas deterministes en CI
  // (dependent d'un serveur externe) : a lancer a la main contre un serveur
  // LOCAL de test (`node --import tsx/esm --test src/<fichier>.test.ts`).
  ...[
    "src/stripe.test.ts",
    "src/quotas.test.ts",
    "src/api-security.test.ts",
    "src/auth.test.ts",
    "src/health.test.ts",
    "src/monitoring.test.ts",
    "src/google.test.ts",
  ].map((fichier) => ({
    fichier,
    raison:
      "Smoke test node:test contre un serveur vivant (TEST_BASE_URL / TEST_AUTH_TOKEN) ; " +
      "pas deterministe en CI, accepte plusieurs statuts sans jeton. A lancer a la main " +
      "contre un serveur local de test.",
  })),

  // ── Scripts d'integration qui exigent un serveur FlowPoint vivant ────────
  {
    fichier: "src/tests/session_isolation.test.ts",
    raison:
      "Script (sans describe/it) qui appelle un serveur vivant sur http://127.0.0.1:${PORT:-8081} " +
      "pour les scenarios Bearer/Cookie ; l'isolation de session est couverte en CI par " +
      "src/tests/session_restore_precedence.test.ts et src/tests/cross_tenant_rbac_sso.test.ts. " +
      "A lancer a la main : PORT=8081 pnpm tsx src/tests/session_isolation.test.ts.",
  },

  // ── E2E avec dependances externes ─────────────────────────────────────────
  {
    fichier: "src/tests/e2e-ailab-transmission.test.ts",
    raison:
      "E2E manuel : exige un recepteur AI Lab vivant (AILAB_URL/AILAB_SECRET) et une base " +
      "`flowpoint_acquisition` jetable, que la CI n'a pas. Son propre vitest.e2e.config.ts " +
      "(npx vitest run --config vitest.e2e.config.ts) le lance ; voir l'en-tete du fichier. " +
      "Constat du 08/11/2026 : meme avec ses variables, son mock de stripe-factory.js est perime " +
      "(il n'exporte pas `isStripeTestMode`) ; a corriger avant sa prochaine execution manuelle.",
  },
  {
    fichier: "src/tests/e2e-growth-sync.test.ts",
    raison:
      "E2E manuel : lit SAAS_URL (base PostgreSQL jetable deja alimentee en faits Croissance / " +
      "vendeurs par e2e-growth-server.ts), absente en CI ; sans elle la route repond 500. " +
      "Son propre vitest.growth-e2e.config.ts le lance. Zone vendeurs : hors du perimetre de ce chantier.",
  },

  // ── Scripts de certification tsx (lanceur dedie : `pnpm run test:certification`) ──
  ...[
    "tests/certification/delete_defense_depth.test.ts",
    "tests/certification/monitor_cron_p1_fix.test.ts",
    "tests/certification/notification_robustness.test.ts",
    "tests/certification/settings_p1_fixes.test.ts",
    "tests/certification/store_me_elimination.test.ts",
  ].map((fichier) => ({
    fichier,
    raison:
      "Script de certification tsx autonome (sans describe/it : compteurs T1..Tn + process.exit). " +
      "Il demarre son propre serveur Express en processus sur la base de la CI ; il est lance " +
      "par l'etape CI « Scripts de certification » (pnpm run test:certification), pas par vitest.",
  })),
  {
    fichier: "tests/certification/lot_c_billing.test.ts",
    raison:
      "PERIME, a reecrire (dette connue, mesuree le 08/11/2026 : ~45 assertions sur ~110 echouent, " +
      "puis plantage a T22). Le script cree l'etat de facturation dans org_settings alors que les routes " +
      "billing lisent desormais `organizations` (T1/T2 : 200 au lieu de 409), n'attend plus le meme contrat " +
      "de reactivation (T12-T22), et la route webhook qu'il vise repond 404 (T20). Le comportement " +
      "est couvert par les suites vitest billing-upgrade-reactivation, reactivate-subscription, " +
      "billing-checkout-session-dedup et addon-only-checkout. Ne pas l'executer en l'etat : il echouerait " +
      "pour des raisons de test, pas de produit.",
  },
  {
    fichier: "tests/certification/github_p1_fix.test.ts",
    raison:
      "Script tsx qui appelle un serveur vivant en dur sur http://localhost:8081 (BASE). " +
      "A lancer a la main : PORT=8081 pnpm run dev puis pnpm tsx tests/certification/github_p1_fix.test.ts.",
  },

  // ── Autres lanceurs ────────────────────────────────────────────────────────
  {
    fichier: "tools/addon-cert-db-guard.test.mjs",
    raison:
      "Test node:test pur (sans base ni reseau) ; lance par l'etape CI « Scripts de certification » " +
      "via `node --test`, pas par vitest.",
  },
  {
    fichier: "src/tests/billing-portal.test.cjs",
    raison:
      "Script CommonJS (pg direct, compteurs + process.exit) ; lance par l'etape CI " +
      "« Scripts de certification » via `node`, pas par vitest.",
  },
  {
    fichier: "src/tests/billing-isolation.test.cjs",
    raison:
      "PERIME : ses identifiants d'organisation sont des e-mails (`test_billing_*@test.flowpoint.internal`) " +
      "que le schema actuel refuse (organizations/org_addons.org_id en UUID : 22P02), et la plupart de ses " +
      "assertions verifient du SQL brut sur org_settings, pas le code applicatif. L'isolation de facturation " +
      "est couverte par les suites vitest (billing-legacy-customer, p0-org-members-legacy, " +
      "billing-resubscription-same-customer). A reecrire avant de le relancer.",
  },
  {
    fichier: "tests/e2e/audit-confirm-ui.spec.cjs",
    raison:
      "Test Playwright de parcours navigateur (APP_URL + base de production dans son en-tete) : " +
      "exige un serveur deploye et un navigateur ; ne doit JAMAIS tourner en CI. Lancer a la main " +
      "contre un serveur local uniquement.",
  },
];
