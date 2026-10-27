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

import { readFile } from "node:fs/promises";
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
  section("[1/11] Database connectivity");
  try {
    const res = await pool.query<{ version: string }>("SELECT version()");
    console.log(`  ✓ Connected — ${res.rows[0]?.version?.split(" ").slice(0, 2).join(" ")}`);
  } catch (err: any) {
    console.error(`  ✗ Cannot reach database: ${err.message}`);
    process.exit(1);
  }

  // ── 2. app_user role + grants ───────────────────────────────────────────────
  section("[2/11] app_user role (init-rls-setup)");
  try {
    await initRlsSetup();
    console.log("  ✓ Done");
  } catch (err: any) {
    console.error(`  ✗ initRlsSetup failed: ${err.message}`);
    process.exit(1);
  }

  // ── 3. Probe SET ROLE ───────────────────────────────────────────────────────
  section("[3/11] app_user role probe");
  try {
    await probeAppUserRole();
    console.log("  ✓ Done");
  } catch (err: any) {
    // Non-fatal: probe failure just means GUC-only mode
    console.warn(`  ⚠ probeAppUserRole warn: ${err.message}`);
  }

  // ── 4. RLS tenant-isolation policies ───────────────────────────────────────
  section("[4/11] RLS migration (tenant-isolation policies)");
  try {
    await runRlsMigrationIfNeeded();
    console.log("  ✓ Done");
  } catch (err: any) {
    console.error(`  ✗ RLS migration failed: ${err.message}`);
    process.exit(1);
  }

  // ── 5. Core tables must exist before domain-table backfills ─────────────────
  section("[5/11] Core data tables");
  try { await initDataTables();  console.log("  ✓ init-data-tables done"); }
  catch (err: any) { console.error(`  ✗ initDataTables: ${err.message}`); process.exit(1); }

  // ── 6–8. Domain tables ──────────────────────────────────────────────────────
  section("[6/11] init-missions");
  try { await initMissionsTables();  console.log("  ✓ Done"); }
  catch (err: any) { console.error(`  ✗ ${err.message}`); process.exit(1); }

  section("[7/11] init-automation");
  try { await initAutomationTables(); console.log("  ✓ Done"); }
  catch (err: any) { console.error(`  ✗ ${err.message}`); process.exit(1); }

  section("[8/11] init-monitors");
  try { await initMonitorsTables();  console.log("  ✓ Done"); }
  catch (err: any) { console.error(`  ✗ ${err.message}`); process.exit(1); }

  section("[9/11] Funnel events");
  try {
    const sql = await readFile(
      new URL("../migrations/019_funnel_events.sql", import.meta.url),
      "utf8",
    );
    await pool.query(sql);
    console.log("  ✓ funnel_events migration applied");
    // 020 : etape serveur `email_clic` (clic Smartlead), apres 019 qui cree la table.
    const sqlClic = await readFile(
      new URL("../migrations/020_funnel_email_click.sql", import.meta.url),
      "utf8",
    );
    await pool.query(sqlClic);
    console.log("  ✓ funnel_events email_clic migration applied");
  } catch (err: any) {
    console.error(`  ✗ funnel_events migration failed: ${err.message}`);
    process.exit(1);
  }

  section("[10/11] AI migration");
  try { await initAiMigration(); console.log("  ✓ init-ai-migration done"); }
  catch (err: any) { console.error(`  ✗ initAiMigration: ${err.message}`); process.exit(1); }

  // ── 11. Missing-tables migration (includes the canonical connectors schema) ─
  section("[11/12] Missing-tables migration");
  try {
    const connectorState = await pool.query<{
      table_exists: boolean;
      has_provider: boolean;
    }>(`
      SELECT
        to_regclass('public.connectors') IS NOT NULL AS table_exists,
        EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'connectors'
            AND column_name = 'provider'
        ) AS has_provider
    `);
    const { table_exists, has_provider } = connectorState.rows[0]!;
    if (table_exists && !has_provider) {
      throw new Error(
        "connectors exists with a legacy schema; refusing migration 005 because it would drop that table",
      );
    }
    const sql = await readFile(
      new URL("../migrations/005_missing_tables.sql", import.meta.url),
      "utf8",
    );
    await pool.query(sql);
    console.log("  ✓ migration 005 applied");
  } catch (err: any) {
    console.error(`  ✗ missing-tables migration failed: ${err.message}`);
    process.exit(1);
  }

  // Tables created by migration 005 must exist before the RLS pass can see them.
  section("[12/13] RLS policies for initialized tables");
  try {
    await runRlsMigrationIfNeeded();
    console.log("  ✓ RLS checked after table creation");
  } catch (err: any) {
    console.error(`  ✗ post-initialization RLS migration failed: ${err.message}`);
    process.exit(1);
  }

  // ── 13. Canonical global system seed catalog ─────────────────────────────────
  section("[13/13] Canonical global system seeds");
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
