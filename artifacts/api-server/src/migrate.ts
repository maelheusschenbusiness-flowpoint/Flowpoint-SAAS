/**
 * migrate.ts — FlowPoint full database migration runner
 *
 * Standalone entrypoint. Never imported by the API server at runtime.
 * Runs ALL schema init steps so the web process can start and listen
 * immediately without waiting for migrations.
 *
 * Render usage:
 *   Pre-Deploy Command : node --enable-source-maps ./dist/migrate.mjs
 *   Start Command      : node --enable-source-maps ./dist/index.mjs
 *
 * Local dev:
 *   pnpm --filter @workspace/api-server run migrate
 *
 * Exit codes:
 *   0 — all migrations applied (or already up-to-date)
 *   1 — fatal error (DB unreachable, unrecoverable DDL failure, etc.)
 */

import { pool, probeAppUserRole } from "@workspace/db";
import { initRlsSetup }          from "./services/init-rls-setup.js";
import { runRlsMigrationIfNeeded } from "./services/init-rls-migration.js";
import { initMissionsTables }    from "./services/init-missions.js";
import { initAutomationTables }  from "./services/init-automation.js";
import { initMonitorsTables }    from "./services/init-monitors.js";
import { initDataTables }        from "./services/init-data-tables.js";
import { initPhase1Users } from "./services/init-phase1-users.js";
import { stampSchemaGate } from "./services/schema-gate-status.js";
import { findMisalignedOrgPolicies, TENANT_GUC } from "./services/rls-guc-repair.js";
import { reconcileSchema, reconcileDefaults } from "./services/init-schema-reconcile.js";
import { initAiMigration }       from "./services/init-ai-migration.js";
import { runCanonicalSystemSeeds } from "./services/canonical-system-seeds.js";

function section(label: string) {
  console.log("\n" + "─".repeat(60));
  console.log(label);
  console.log("─".repeat(60));
}

async function migrate() {
  console.log("=".repeat(60));
  console.log("FlowPoint — full migration runner");
  console.log("=".repeat(60));
  console.log(`  DATABASE_URL host : ${process.env["DATABASE_URL"]?.replace(/\/\/[^@]+@/, "//***@") ?? "(not set)"}`);
  console.log(`  Timestamp         : ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  // ── 1. Verify connectivity ──────────────────────────────────────────────────
  section("[1/14] Database connectivity");
  try {
    const res = await pool.query<{ version: string }>("SELECT version()");
    console.log(`  ✓ Connected — ${res.rows[0]?.version?.split(" ").slice(0, 2).join(" ")}`);
  } catch (err: any) {
    console.error(`  ✗ Cannot reach database: ${err.message}`);
    process.exit(1);
  }

  // Provenance du schema : une base vide au depart est une INSTALLATION, pas
  // une mise a jour. Les seuils du bilan final (calibres sur une base de
  // production historique, enrichie par migrations/*.sql) ne s'y appliquent
  // pas — sinon migrate.mjs sort en 1 alors que toutes les etapes ont reussi.
  let startedEmpty = false;
  try {
    const before = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`);
    startedEmpty = (before.rows[0]?.n ?? 0) === 0;
    if (startedEmpty) console.log("  Base vide au depart — installation initiale");
  } catch { /* non bloquant : on restera sur les seuils stricts */ }

  // ── 2. app_user role + grants ───────────────────────────────────────────────
  section("[2/14] app_user role (init-rls-setup)");
  try {
    await initRlsSetup();
    console.log("  ✓ Done");
  } catch (err: any) {
    console.error(`  ✗ initRlsSetup failed: ${err.message}`);
    process.exit(1);
  }

  // ── 3. Probe SET ROLE ───────────────────────────────────────────────────────
  section("[3/14] app_user role probe");
  try {
    await probeAppUserRole();
    console.log("  ✓ Done");
  } catch (err: any) {
    // Non-fatal: probe failure just means GUC-only mode
    console.warn(`  ⚠ probeAppUserRole warn: ${err.message}`);
  }

  // ── 4. RLS tenant-isolation policies ───────────────────────────────────────
  section("[4/14] RLS migration (tenant-isolation policies)");
  try {
    await runRlsMigrationIfNeeded();
    console.log("  ✓ Done");
  } catch (err: any) {
    console.error(`  ✗ RLS migration failed: ${err.message}`);
    process.exit(1);
  }

  // ── 5. Tables de base ───────────────────────────────────────────────────────
  // initDataTables cree `organizations`, dont dependent les initialiseurs de
  // domaine ci-dessous (init-missions lit organizations). L'ordre inverse
  // faisait sortir migrate.mjs en 1 sur une base vierge :
  //   [5/8] init-missions
  //     ✗ relation "organizations" does not exist
  // Sans effet sur une base existante, ou organizations est deja la ; mais un
  // environnement ne pouvait pas etre recree depuis zero.
  section("[5/14] init-data-tables (tables de base)");
  try { await initDataTables();  console.log("  ✓ init-data-tables done"); }
  catch (err: any) { console.error(`  ✗ initDataTables: ${err.message}`); process.exit(1); }

  // ── 6–8. Domain tables ──────────────────────────────────────────────────────
  // ── 6. Tables d'identite — users + organization_members ────────────────────
  // Elles n'etaient posees qu'au demarrage du serveur, par une etape marquee
  // non fatale. migrate.mjs, qui est la porte de deploiement, sortait donc en 0
  // sur une base ou les deux tables que l'application interroge n'existaient
  // pas : mesure sur base vierge, apres un migrate reussi,
  //   SELECT id FROM users …               → relation "users" does not exist
  //   SELECT role FROM organization_members → relation … does not exist
  // Une porte ne peut pas refuser un schema qu'elle ne pose pas.
  //
  // Placee APRES init-data-tables, dont elle depend : la reprise de l'existant
  // lit organizations, org_settings et team_members. Et AVANT le durcissement
  // RLS, pour que les deux tables y passent comme toutes les autres.
  section("[6/14] init-phase1-users (identite : users, organization_members)");
  try { await initPhase1Users(); }
  catch (err: any) { console.error(`  ✗ initPhase1Users: ${err.message}`); process.exit(1); }

  // init-phase1-users avale chaque erreur DDL en silence (son run() a un catch
  // vide, par choix : les instructions sont idempotentes et bruyantes). L'appel
  // ne peut donc presque jamais echouer, et une porte qui se contente de
  // l'appeler ne verifie rien. On verifie le resultat.
  // relkind = 'r' : une VUE nommee `users` satisferait to_regclass tout en
  // faisant echouer les INSERT de l'application — et elle suffirait a faire
  // sauter le CREATE TABLE IF NOT EXISTS en silence.
  const identite = await pool.query<{ users: boolean; membres: boolean }>(`
    SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relname = 'users'                AND c.relkind = 'r') AS users,
           EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public' AND c.relname = 'organization_members' AND c.relkind = 'r') AS membres
  `);
  const _idOk = identite.rows[0]?.users === true && identite.rows[0]?.membres === true;
  if (!_idOk) {
    console.error(`  ✗ users=${identite.rows[0]?.users} organization_members=${identite.rows[0]?.membres}`);
    console.error("\n✗ Les tables d'identite sont absentes — migration refusee");
    console.error("  L'application interroge ces deux tables ; laisser passer le deploiement");
    console.error("  ferait demarrer un serveur qui repond 500 sur l'authentification.");
    await pool.end();
    process.exit(1);
  }
  console.log("  ✓ users + organization_members presentes");

  section("[7/14] init-missions");
  try { await initMissionsTables();  console.log("  ✓ Done"); }
  catch (err: any) { console.error(`  ✗ ${err.message}`); process.exit(1); }

  section("[8/14] init-automation");
  try { await initAutomationTables(); console.log("  ✓ Done"); }
  catch (err: any) { console.error(`  ✗ ${err.message}`); process.exit(1); }

  section("[9/14] init-monitors");
  try { await initMonitorsTables();  console.log("  ✓ Done"); }
  catch (err: any) { console.error(`  ✗ ${err.message}`); process.exit(1); }

  // ── 10. AI migration — apres les tables de base qu'elle fait evoluer ─────────
  section("[10/14] init-ai-migration");
  try { await initAiMigration(); console.log("  ✓ init-ai-migration done"); }
  catch (err: any) { console.error(`  ✗ initAiMigration: ${err.message}`); process.exit(1); }

  // ── 11. Reconciliation du schema ───────────────────────────────────────────
  // Apres TOUS les initialiseurs de domaine : les colonnes ajoutees ici visent
  // des tables que init-missions, init-automation et init-monitors creent, et
  // qui n'existent donc pas plus tot sur une base vierge. Avant le durcissement
  // RLS, pour que les tables creees y passent comme les autres.
  section("[11/14] Reconciliation du schema (tables et colonnes manquantes)");
  try {
    const recClient = await pool.connect();
    try {
      const rec = await reconcileSchema(recClient);
      if (rec.failures.length > 0) {
        console.error(`  \u2717 ${rec.failures.length} echec(s) — marqueur NON pose, le bloc sera rejoue`);
        for (const f of rec.failures.slice(0, 8)) console.error(`    ${f}`);
        await pool.end();
        process.exit(1);
      }
      console.log(rec.applied
        ? `  \u2713 ${rec.created.length} table(s) creee(s), ${rec.columns} colonne(s) ajoutee(s)`
        : "  \u2713 deja applique");

      // Bloc 2, marqueur independant : le bloc 1 peut etre deja marque sur une
      // copie de production alors que les defaults, eux, manquent encore.
      const def = await reconcileDefaults(recClient);
      if (def.failures.length > 0) {
        console.error(`  \u2717 defaults : ${def.failures.length} echec(s) — marqueur NON pose`);
        for (const f of def.failures.slice(0, 8)) console.error(`    ${f}`);
        await pool.end();
        process.exit(1);
      }
      console.log(def.applied
        ? `  \u2713 ${def.defaults} default(s) restaure(s)`
        : "  \u2713 defaults deja appliques");
    } finally { recClient.release(); }
  } catch (err: any) {
    console.error(`  \u2717 reconciliation impossible : ${err.message}`);
    await pool.end();
    process.exit(1);
  }

  // ── 12. Canonical global system seed catalog ────────────────────────────────
  section("[12/14] Canonical global system seeds");
  try {
    const seeded = await runCanonicalSystemSeeds();
    console.log(`  ✓ org_settings default: ${seeded.orgSettings}`);
    console.log(`  ✓ user_prefs default  : ${seeded.userPrefs}`);
    console.log(`  ✓ global connectors   : ${seeded.connectors}`);
  } catch (err: any) {
    console.error(`  ✗ canonical system seeds failed: ${err.message}`);
    process.exit(1);
  }

  // ── 13. Durcissement RLS APRES creation des tables ──────────────────────────
  // L'etape 4 tourne avant que les tables n'existent : sur une installation
  // initiale elle ne protege rien. Mesure sur une base vierge : 37 tables
  // portant org_id (audits, monitors, reports, missions, team_members,
  // org_secrets, connectors…) restaient SANS RLS ni policy d'isolation. La
  // passe est donc rejouee ici, une fois le schema pose — elle est idempotente.
  // Placee APRES les seeds : FORCE ROW LEVEL SECURITY s'applique aussi au
  // proprietaire, et durcir avant les seeds les ferait echouer.
  section("[13/14] Durcissement RLS (apres creation des tables)");
  try { await runRlsMigrationIfNeeded(); console.log("  ✓ Done"); }
  catch (err: any) { console.error(`  ✗ RLS hardening failed: ${err.message}`); process.exit(1); }

  // ── 14. Audit d'isolation par table — PAS un seuil numerique ───────────────
  // Un compte de policies ne dit rien de ce qui est reellement protege. On
  // verifie, table par table, que toute table portant org_id a RLS active ET
  // au moins une policy qui isole sur org_id.
  section("[14/14] Audit d'isolation inter-organisations");
  const audit = await pool.query<{ table_name: string; rls: boolean; policies: number; isolated: boolean }>(`
    WITH sensibles AS (
      SELECT c.relname AS table_name, c.relrowsecurity AS rls
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN information_schema.columns col
        ON col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'org_id'
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    ), pol AS (
      SELECT tablename,
             COUNT(*)::int AS policies,
             BOOL_OR(COALESCE(qual,'') || COALESCE(with_check,'') ~ 'org_id') AS isolated
      FROM pg_policies WHERE schemaname = 'public' GROUP BY tablename
    )
    SELECT s.table_name, s.rls, COALESCE(p.policies,0) AS policies, COALESCE(p.isolated,false) AS isolated
    FROM sensibles s LEFT JOIN pol p ON p.tablename = s.table_name
    WHERE NOT s.rls OR COALESCE(p.policies,0) = 0 OR NOT COALESCE(p.isolated,false)
    ORDER BY s.table_name
  `);
  const sensitiveTotal = await pool.query<{ n: number }>(
    `SELECT COUNT(DISTINCT table_name)::int AS n FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'org_id'`);
  console.log(`  Tables portant org_id      : ${sensitiveTotal.rows[0]?.n ?? 0}`);
  console.log(`  Sans RLS ou sans isolation : ${audit.rowCount}`);
  if (audit.rowCount && audit.rowCount > 0) {
    for (const r of audit.rows) {
      console.error(`  ✗ ${r.table_name} — rls=${r.rls} policies=${r.policies} isolation_org_id=${r.isolated}`);
    }
    console.error("\n✗ Des tables sensibles ne sont pas isolees entre organisations — migration refusee");
    await pool.end();
    process.exit(1);
  }
  console.log("  ✓ Toute table portant org_id a RLS active et une policy d'isolation");

  // Une policy peut mentionner org_id et rester inerte : l'audit ci-dessus se
  // contente de voir `org_id` dans le predicat, sans verifier QUELLE variable
  // il lit. Trois policies lisaient current_setting('app.org_id'), que
  // l'application ne pose jamais — elle pose app.current_org_id. Mesure : la
  // table renvoyait 0 ligne sur 1 sous app_user. Une table dont la SEULE
  // isolation est branchee sur une variable morte n'est pas isolee.
  const divergentes = await findMisalignedOrgPolicies(pool);
  const cassees = divergentes.filter((d) => !d.alsoCorrectlyIsolated);
  for (const d of divergentes.filter((x) => x.alsoCorrectlyIsolated)) {
    console.warn(`  ! ${d.table}.${d.policy} lit une variable que l'application ne pose pas (table isolee par ailleurs)`);
  }
  if (cassees.length > 0) {
    for (const d of cassees) {
      console.error(`  ✗ ${d.table}.${d.policy} — seule isolation, branchee sur une variable morte : ${d.predicate}`);
    }
    console.error("\n✗ Des policies lisent une variable que l'application ne pose pas — migration refusee");
    console.error(`  Attendu : current_setting('${TENANT_GUC}', true)`);
    await pool.end();
    process.exit(1);
  }
  console.log("  ✓ Toutes les policies d'isolation lisent app.current_org_id");

  // Estampille : le demarrage pourra dire si la porte a tourne sur cette base,
  // au lieu d'affirmer « Pre-Deploy completed » sur la seule existence d'une
  // table. Posee ici, donc seulement quand tout ce qui precede a reussi.
  try {
    await stampSchemaGate(pool);
    console.log("  ✓ Porte estampillee (schema_migrations)");
  } catch (err: any) {
    // L'estampille est une trace, pas une garantie : son echec ne doit pas
    // refuser une migration par ailleurs complete.
    console.warn(`  ! Estampille de la porte impossible : ${err.message}`);
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  section("Post-migration summary");
  const after = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM pg_tables  WHERE schemaname='public' AND rowsecurity=true) AS rls_tables,
      (SELECT COUNT(*)::int FROM pg_policies WHERE schemaname='public')                     AS policies,
      (SELECT COUNT(*)::int FROM pg_tables  WHERE schemaname='public')                      AS total_tables
  `);
  const post = after.rows[0] as Record<string, number>;
  console.log(`  Tables total    : ${post.total_tables}`);
  console.log(`  Tables with RLS : ${post.rls_tables}`);
  console.log(`  Policies        : ${post.policies}`);

  // ── Code de sortie ──────────────────────────────────────────────────────────
  // Chaque etape ci-dessus sort en 1 des qu'elle echoue, et initAiMigration
  // verifie en plus son propre contrat de schema (tables, colonnes, policies)
  // avant de rendre la main. Arriver ici signifie donc que le schema a ete
  // pose sans erreur.
  //
  // Les seuils ci-dessous (>= 100 tables RLS, >= 400 policies) etaient
  // bloquants. Ils ne sont atteints que par une base enrichie par les
  // migrations SQL historiques : mesures reelles — installation initiale 55
  // RLS / 182 policies, base posee par initDataTables + migrate 59 / 379,
  // base avec migrations 001-009 118 / 445. Un seuil absolu ne distingue donc
  // pas « schema incomplet » de « schema d'installation », et faisait echouer
  // le Pre-Deploy de tout environnement qui n'a pas l'historique SQL — y
  // compris juste apres une installation reussie. Ils deviennent un
  // AVERTISSEMENT ; l'echec reste porte par les etapes elles-memes.
  // Les compteurs restent informatifs : l'invariant qui bloque est l'audit
  // d'isolation table par table ci-dessus, pas un seuil absolu. Mesures :
  // installation initiale ~95 tables / 390 policies, base avec l'historique
  // SQL 118 / 437 — un seuil unique ne distingue pas ces deux cas.
  if (post.rls_tables < 100 || post.policies < 400) {
    console.log("\n  (compteurs sous les valeurs d'une base de production historique —"
      + " normal sur une installation initiale ; l'isolation est verifiee table par table)");
  }
  console.log("\n✓ Migration successful"
    + (startedEmpty ? " (installation initiale)" : ""));

  await pool.end();
  process.exit(0);
}

migrate().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
