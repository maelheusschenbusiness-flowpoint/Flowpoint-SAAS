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
  section("[1/8] Database connectivity");
  try {
    const res = await pool.query<{ version: string }>("SELECT version()");
    console.log(`  ✓ Connected — ${res.rows[0]?.version?.split(" ").slice(0, 2).join(" ")}`);
  } catch (err: any) {
    console.error(`  ✗ Cannot reach database: ${err.message}`);
    process.exit(1);
  }

  // ── 2. app_user role + grants ───────────────────────────────────────────────
  section("[2/8] app_user role (init-rls-setup)");
  try {
    await initRlsSetup();
    console.log("  ✓ Done");
  } catch (err: any) {
    console.error(`  ✗ initRlsSetup failed: ${err.message}`);
    process.exit(1);
  }

  // ── 3. Probe SET ROLE ───────────────────────────────────────────────────────
  section("[3/8] app_user role probe");
  try {
    await probeAppUserRole();
    console.log("  ✓ Done");
  } catch (err: any) {
    // Non-fatal: probe failure just means GUC-only mode
    console.warn(`  ⚠ probeAppUserRole warn: ${err.message}`);
  }

  // ── 4. RLS tenant-isolation policies ───────────────────────────────────────
  section("[4/8] RLS migration (tenant-isolation policies)");
  try {
    await runRlsMigrationIfNeeded();
    console.log("  ✓ Done");
  } catch (err: any) {
    console.error(`  ✗ RLS migration failed: ${err.message}`);
    process.exit(1);
  }

  // ── 5–7. Domain tables ──────────────────────────────────────────────────────
  section("[5/8] init-missions");
  try { await initMissionsTables();  console.log("  ✓ Done"); }
  catch (err: any) { console.error(`  ✗ ${err.message}`); process.exit(1); }

  section("[6/8] init-automation");
  try { await initAutomationTables(); console.log("  ✓ Done"); }
  catch (err: any) { console.error(`  ✗ ${err.message}`); process.exit(1); }

  section("[7/8] init-monitors");
  try { await initMonitorsTables();  console.log("  ✓ Done"); }
  catch (err: any) { console.error(`  ✗ ${err.message}`); process.exit(1); }

  // ── 8. Core + AI tables ─────────────────────────────────────────────────────
  section("[8/8] init-data-tables + AI migration");
  try { await initDataTables();  console.log("  ✓ init-data-tables done"); }
  catch (err: any) { console.error(`  ✗ initDataTables: ${err.message}`); process.exit(1); }

  try { await initAiMigration(); console.log("  ✓ init-ai-migration done"); }
  catch (err: any) { console.error(`  ✗ initAiMigration: ${err.message}`); process.exit(1); }

  // ── 9. Canonical global system seed catalog ─────────────────────────────────
  section("[9/9] Canonical global system seeds");
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

  const ok = post.rls_tables >= 100 && post.policies >= 400;
  console.log("\n" + (ok ? "✓ Migration successful" : "⚠ Migration counts look low — review logs above"));

  await pool.end();
  process.exit(ok ? 0 : 1);
}

migrate().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
