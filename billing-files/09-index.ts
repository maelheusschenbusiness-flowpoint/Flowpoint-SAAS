import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import app from "./app.js";
import { pool, probeAppUserRole } from "@workspace/db";
import { initMissionsTables } from "./services/init-missions.js";
import { initAutomationTables } from "./services/init-automation.js";
import { initMonitorsTables } from "./services/init-monitors.js";
import { initDataTables } from "./services/init-data-tables.js";
import { initRlsSetup } from "./services/init-rls-setup.js";
import { runRlsMigrationIfNeeded } from "./services/init-rls-migration.js";
import { initAiMigration } from "./services/init-ai-migration.js";
import { startMonitorCron } from "./services/monitor-cron.js";
import { runCriticalStartupStep, getErrorCode, getSafeErrorMessage } from "./lib/startup-retry.js";

const PORT = env.PORT;

// ── Schema health check ────────────────────────────────────────────────────────
//
// When the Render Pre-Deploy Command (`node dist/migrate.mjs`) has already run
// all migrations, the web process only needs a DB ping + app_user probe before
// it can open the port.  Full init (which can take 10-30 s) is skipped.
//
// Fallback: if core tables are absent (local dev, first deploy without
// Pre-Deploy command), the full init sequence runs as before.
//
// Sentinel: presence of the `audits` table indicates migrations have run.
// ──────────────────────────────────────────────────────────────────────────────
async function schemaAlreadyMigrated(): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ exists: boolean }>(
      `SELECT to_regclass('public.audits') IS NOT NULL AS exists`
    );
    return rows[0]?.exists === true;
  } catch {
    return false;
  }
}

async function main() {
  // 1. Verify the DB is reachable before any init that assumes a connection.
  await runCriticalStartupStep("database connection", async () => {
    await pool.query("SELECT 1");
    logger.info("Database connection OK");
  });

  // 2. Check if Pre-Deploy already ran all migrations (fast path for Render).
  const migrated = await schemaAlreadyMigrated();

  if (migrated) {
    // ── Fast path: Pre-Deploy has already run. ─────────────────────────────
    // Only probe the app_user role (cheap: 2 queries) so withOrgDb() knows
    // whether to use SET ROLE or GUC-only mode.
    logger.info("[startup] Schema already migrated — skipping full init (Pre-Deploy completed)");
    await runCriticalStartupStep("app_user role probe", probeAppUserRole);
    // Always add new billing columns even on fast-path (idempotent: IF NOT EXISTS)
    await runCriticalStartupStep("billing-trial-columns", async () => {
      const client = await pool.connect();
      try {
        await client.query(`ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS trial_consumed_at TIMESTAMPTZ`);
        await client.query(`ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS trial_started_at  TIMESTAMPTZ`);
        logger.info("[startup] billing trial columns ensured (trial_consumed_at, trial_started_at)");
      } finally { client.release(); }
    }).catch((err: unknown) => {
      logger.warn({ err }, "[startup] billing-trial-columns step failed (non-fatal — columns may already exist)");
    });
  } else {
    // ── Full init path: local dev or first deploy without Pre-Deploy. ──────
    logger.info("[startup] Core tables absent — running full init sequence");

    await runCriticalStartupStep("init-rls-setup", initRlsSetup);
    await runCriticalStartupStep("app_user role probe", probeAppUserRole);
    await runCriticalStartupStep("rls-migration", runRlsMigrationIfNeeded);
    await runCriticalStartupStep("init-missions",   initMissionsTables);
    await runCriticalStartupStep("init-automation", initAutomationTables);
    await runCriticalStartupStep("init-monitors",   initMonitorsTables);
    await runCriticalStartupStep("init-data-tables", initDataTables);
    await runCriticalStartupStep("AI migration", initAiMigration);
  }

  // ── Optional: Resend email config check (non-blocking, log only) ─────────────
  (async () => {
    const resendKey  = process.env["RESEND_API_KEY"];
    const resendFrom = process.env["RESEND_FROM"] || "FlowPoint <noreply@flowpoint.pro>";
    if (!resendKey) {
      logger.warn("[Resend] RESEND_API_KEY is not set — magic-link emails will fail (503)");
      return;
    }
    const addrMatch = resendFrom.match(/<([^>]+)>/) ?? resendFrom.match(/(\S+@\S+)/);
    const fromAddr  = addrMatch?.[1] ?? resendFrom;
    const domain    = fromAddr.split("@")[1] ?? "";
    logger.info(`[Resend] Configured from="${resendFrom}" domain="${domain}" — verify SPF/DKIM in Resend dashboard if emails fail`);
    try {
      const resp = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${resendKey}` },
      });
      if (!resp.ok) {
        logger.warn({ status: resp.status }, "[Resend] Could not list domains — check RESEND_API_KEY");
        return;
      }
      const body = (await resp.json()) as { data?: Array<{ name: string; status: string }> };
      const domains: Array<{ name: string; status: string }> = body.data ?? [];
      const matched = domains.find(d => domain.endsWith(d.name));
      if (!matched) {
        logger.warn(`[Resend] Domain "${domain}" is NOT in your Resend account.`);
      } else if (matched.status !== "verified") {
        logger.warn(`[Resend] Domain "${matched.name}" found but status="${matched.status}" (not verified).`);
      } else {
        logger.info(`[Resend] Domain "${matched.name}" is verified ✓ — email delivery should work.`);
      }
    } catch {
      logger.debug("[Resend] Domain check skipped (network error — non-critical)");
    }
  })();

  // ── All critical steps succeeded — safe to open port and start crons ────────
  const server = app.listen(PORT, () => {
    logger.info(`FlowPoint API listening on port ${PORT} (${env.NODE_ENV})`);
    startMonitorCron();
  });

  async function shutdown(signal: string) {
    logger.info({ signal }, "Shutdown signal received");
    server.close(async () => {
      try { await pool.end(); } catch {}
      logger.info("Server closed");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000);
  }

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT",  () => void shutdown("SIGINT"));
}

main().catch((err: unknown) => {
  logger.error(
    {
      code:    getErrorCode(err),
      message: getSafeErrorMessage(err),
    },
    "Fatal startup error — process will exit",
  );
  process.exit(1);
});
