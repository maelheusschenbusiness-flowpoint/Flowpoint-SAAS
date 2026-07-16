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
import { withStartupRetry } from "./lib/startup-retry.js";

const PORT = env.PORT;

async function main() {
  try {
    await withStartupRetry("database connection", () => pool.query("SELECT 1"));
    logger.info("Database connection OK");
  } catch (err) {
    logger.warn({ err }, "Database connection check failed — continuing startup");
  }

  // initRlsSetup BEFORE probeAppUserRole: the role must exist before we probe
  // whether the connection user is allowed to SET ROLE app_user.
  // On the very first boot the role is absent; running setup first means the
  // probe on the same boot already sees the role and can enable role-based RLS
  // instead of falling back to GUC-only mode.
  try {
    await withStartupRetry("init-rls-setup", initRlsSetup);
  } catch (err) {
    logger.warn({ err }, "RLS setup failed — non-fatal, continuing");
  }

  // Probe once (outside any transaction) whether SET ROLE app_user is allowed.
  // This sets the global flag that prevents withOrgDb() from attempting the role
  // switch when it would fail and abort the transaction (Supabase / managed DBs).
  try {
    await withStartupRetry("app_user role probe", probeAppUserRole);
  } catch (err) {
    logger.warn({ err }, "app_user role probe failed — GUC-only RLS mode");
  }

  // Apply RLS tenant isolation to any tables still missing it.
  // Fast no-op (~2 ms) once all tables are secured.
  try {
    await withStartupRetry("rls-migration", runRlsMigrationIfNeeded);
  } catch (err) {
    logger.warn({ err }, "RLS migration failed — non-fatal, continuing");
  }

  try {
    await withStartupRetry("init-missions", initMissionsTables);
  } catch (err) {
    logger.warn({ err }, "Missions table init failed — non-fatal, continuing");
  }

  try {
    await withStartupRetry("init-automation", initAutomationTables);
  } catch (err) {
    logger.warn({ err }, "Automation table init failed — non-fatal, continuing");
  }

  try {
    await withStartupRetry("init-monitors", initMonitorsTables);
  } catch (err) {
    logger.warn({ err }, "Monitors table init failed — non-fatal, continuing");
  }

  try {
    await withStartupRetry("init-data-tables", initDataTables);
  } catch (err) {
    logger.warn({ err }, "Data tables init failed — non-fatal, continuing");
  }

  // AI migration is FATAL — the server must not start if required tables
  // cannot be created (e.g. permission denied, schema missing, DB unreachable).
  // withStartupRetry retries transient errors (ECONNABORTED, ECONNRESET, etc.);
  // permanent failures propagate to main().catch() which logs + exits non-zero.
  await withStartupRetry("AI migration", initAiMigration);

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

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
