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

const PORT = env.PORT;

async function main() {
  try {
    await pool.query("SELECT 1");
    logger.info("Database connection OK");
  } catch (err) {
    logger.warn({ err }, "Database connection check failed — continuing startup");
  }

  // Probe once (outside any transaction) whether SET ROLE app_user is allowed.
  // This sets the global flag that prevents withOrgDb() from attempting the role
  // switch when it would fail and abort the transaction (Supabase / managed DBs).
  try {
    await probeAppUserRole();
  } catch (err) {
    logger.warn({ err }, "app_user role probe failed — GUC-only RLS mode");
  }

  try {
    await initRlsSetup();
  } catch (err) {
    logger.warn({ err }, "RLS setup failed — non-fatal, continuing");
  }

  // Apply RLS tenant isolation to any tables still missing it.
  // Fast no-op (~2 ms) once all tables are secured.
  try {
    await runRlsMigrationIfNeeded();
  } catch (err) {
    logger.warn({ err }, "RLS migration failed — non-fatal, continuing");
  }

  try {
    await initMissionsTables();
  } catch (err) {
    logger.warn({ err }, "Missions table init failed — non-fatal, continuing");
  }

  try {
    await initAutomationTables();
  } catch (err) {
    logger.warn({ err }, "Automation table init failed — non-fatal, continuing");
  }

  try {
    await initMonitorsTables();
  } catch (err) {
    logger.warn({ err }, "Monitors table init failed — non-fatal, continuing");
  }

  try {
    await initDataTables();
  } catch (err) {
    logger.warn({ err }, "Data tables init failed — non-fatal, continuing");
  }

  try {
    await initAiMigration();
  } catch (err) {
    logger.warn({ err }, "AI migration failed — non-fatal, continuing");
  }

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
