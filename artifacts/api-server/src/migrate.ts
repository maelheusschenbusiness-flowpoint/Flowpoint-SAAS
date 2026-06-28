/**
 * migrate.ts — FlowPoint database migration runner
 *
 * Standalone entrypoint. Never imported by the API server at runtime.
 * Run explicitly with:
 *
 *   pnpm --filter @workspace/api-server run migrate
 *
 * Or on a Render one-off job / pre-deploy hook:
 *
 *   node --enable-source-maps ./dist/migrate.mjs
 *
 * Exit codes:
 *   0 — all migrations applied (or already up-to-date)
 *   1 — fatal error (DB unreachable, unrecoverable DDL failure, etc.)
 */

import { pool } from "@workspace/db";
import { runRlsMigrationIfNeeded } from "./services/init-rls-migration.js";

async function migrate() {
  console.log("=".repeat(60));
  console.log("FlowPoint — database migration runner");
  console.log("=".repeat(60));
  console.log(`  DATABASE_URL host : ${process.env["DATABASE_URL"]?.replace(/\/\/[^@]+@/, "//***@") ?? "(not set)"}`);
  console.log(`  Timestamp         : ${new Date().toISOString()}`);
  console.log("=".repeat(60));

  // ── 1. Verify connectivity ──────────────────────────────────────────────────
  console.log("\n[1/3] Checking database connectivity…");
  try {
    const res = await pool.query<{ version: string }>("SELECT version()");
    console.log(`      ✓ Connected — ${res.rows[0]?.version?.split(" ").slice(0, 2).join(" ")}`);
  } catch (err: any) {
    console.error(`      ✗ Cannot reach database: ${err.message}`);
    process.exit(1);
  }

  // ── 2. Pre-migration state ──────────────────────────────────────────────────
  console.log("\n[2/3] Pre-migration state…");
  const before = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM pg_tables  WHERE schemaname='public' AND rowsecurity=true) AS rls_tables,
      (SELECT COUNT(*)::int FROM pg_policies WHERE schemaname='public')                     AS policies,
      (SELECT COUNT(*)::int FROM pg_tables  WHERE schemaname='public')                      AS total_tables,
      (SELECT COUNT(*)::int FROM information_schema.columns
       WHERE table_schema='public' AND column_name='org_id')                                AS org_id_cols
  `);
  const pre = before.rows[0] as Record<string, number>;
  console.log(`      Tables total      : ${pre.total_tables}`);
  console.log(`      Tables with RLS   : ${pre.rls_tables}`);
  console.log(`      Policies          : ${pre.policies}`);
  console.log(`      Columns w/ org_id : ${pre.org_id_cols}`);

  // ── 3. Run migrations ───────────────────────────────────────────────────────
  console.log("\n[3/3] Running migrations…");
  try {
    await runRlsMigrationIfNeeded();
  } catch (err: any) {
    console.error(`\n✗ Migration failed: ${err.message}`);
    await pool.end();
    process.exit(1);
  }

  // ── Post-migration state ────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("Post-migration state");
  console.log("=".repeat(60));
  const after = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM pg_tables  WHERE schemaname='public' AND rowsecurity=true) AS rls_tables,
      (SELECT COUNT(*)::int FROM pg_policies WHERE schemaname='public')                     AS policies,
      (SELECT COUNT(*)::int FROM pg_tables  WHERE schemaname='public')                      AS total_tables,
      (SELECT COUNT(*)::int FROM information_schema.columns
       WHERE table_schema='public' AND column_name='org_id')                                AS org_id_cols
  `);
  const post = after.rows[0] as Record<string, number>;
  console.log(`  Tables total      : ${post.total_tables}`);
  console.log(`  Tables with RLS   : ${post.rls_tables}  (target: 145)`);
  console.log(`  Policies          : ${post.policies}  (target: 508)`);
  console.log(`  Columns w/ org_id : ${post.org_id_cols}`);

  const ok = post.rls_tables >= 100 && post.policies >= 400;
  console.log("\n" + (ok ? "✓ Migration successful" : "⚠ Migration ended but counts look low — review logs above"));

  await pool.end();
  process.exit(ok ? 0 : 1);
}

migrate().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
