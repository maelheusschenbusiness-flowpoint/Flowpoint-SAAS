import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import app from "./app.js";
import { pool } from "@workspace/db";

const PORT = env.PORT;

async function main() {
  try {
    await pool.query("SELECT 1");
    logger.info("Database connection OK");
  } catch (err) {
    logger.warn({ err }, "Database connection check failed — continuing startup");
  }

  const server = app.listen(PORT, () => {
    logger.info(`FlowPoint API listening on port ${PORT} (${env.NODE_ENV})`);
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
