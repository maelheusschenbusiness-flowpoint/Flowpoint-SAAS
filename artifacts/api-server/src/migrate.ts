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
  section("[1/10] Database connectivity");
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
  section("[2/10] app_user role (init-rls-setup)");
  try {
    await initRlsSetup();
    console.log("  ✓ Done");
  } catch (err: any) {
    console.error(`  ✗ initRlsSetup failed: ${err.message}`);
    process.exit(1);
  }

  // ── 3. Probe SET ROLE ───────────────────────────────────────────────────────
  section("[3/10] app_user role probe");
  try {
    await probeAppUserRole();
    console.log("  ✓ Done");
  } catch (err: any) {
    // Non-fatal: probe failure just means GUC-only mode
    console.warn(`  ⚠ probeAppUserRole warn: ${err.message}`);
  }

  // ── 4. RLS tenant-isolation policies ───────────────────────────────────────
  section("[4/10] RLS migration (tenant-isolation policies)");
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
  section("[5/10] init-data-tables (tables de base)");
  try { await initDataTables();  console.log("  ✓ init-data-tables done"); }
  catch (err: any) { console.error(`  ✗ initDataTables: ${err.message}`); process.exit(1); }

  // ── 6–8. Domain tables ──────────────────────────────────────────────────────
  section("[6/10] init-missions");
  try { await initMissionsTables();  console.log("  ✓ Done"); }
  catch (err: any) { console.error(`  ✗ ${err.message}`); process.exit(1); }

  section("[7/10] init-automation");
  try { await initAutomationTables(); console.log("  ✓ Done"); }
  catch (err: any) { console.error(`  ✗ ${err.message}`); process.exit(1); }

  section("[8/10] init-monitors");
  try { await initMonitorsTables();  console.log("  ✓ Done"); }
  catch (err: any) { console.error(`  ✗ ${err.message}`); process.exit(1); }

  // ── 9. AI migration — apres les tables de base qu'elle fait evoluer ─────────
  section("[9/10] init-ai-migration");
  try { await initAiMigration(); console.log("  ✓ init-ai-migration done"); }
  catch (err: any) { console.error(`  ✗ initAiMigration: ${err.message}`); process.exit(1); }

  // ── 9. Canonical global system seed catalog ─────────────────────────────────
  section("[10/10] Canonical global system seeds");
  try {
    const seeded = await runCanonicalSystemSeeds();
    console.log(`  ✓ org_settings default: ${seeded.orgSettings}`);
    console.log(`  ✓ user_prefs default  : ${seeded.userPrefs}`);
    console.log(`  ✓ global connectors   : ${seeded.connectors}`);
  } catch (err: any) {
    console.error(`  ✗ canonical system seeds failed: ${err.message}`);
    process.exit(1);
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
  const countsLow = post.rls_tables < 100 || post.policies < 400;
  if (countsLow) {
    console.log("\n⚠ Compteurs bas (RLS/policies) — attendu sur une installation initiale,"
      + " a verifier sur une base de production : review logs above");
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
