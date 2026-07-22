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

// ── Bootstrap classification ───────────────────────────────────────────────────
//
// CRITICAL — any failure after exhausted retries aborts startup, prevents
//            app.listen(), and exits with a non-zero code.
//
//   1. database connection   — no DB access means nothing works
//   2. init-rls-setup        — creates app_user role required by all RLS policies
//   3. app_user role probe   — sets the global RLS mode flag for withOrgDb()
//   4. rls-migration         — applies tenant-isolation policies to every table
//   5. init-missions         — mission routes write on every user action
//   6. init-automation       — automation routes require these tables
//   7. init-monitors         — monitor cron and routes require these tables
//   8. init-data-tables      — core tables (audits, notifications, competitors…)
//   9. AI migration          — AI routes require ai_recommendations et al.
//
// OPTIONAL — none currently.
//   A step may only be optional when its absence demonstrably does not break
//   any active route, any multi-tenant isolation boundary, or any write path.
//
// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Verify the DB is reachable before any init that assumes a connection.
  await runCriticalStartupStep("database connection", async () => {
    await pool.query("SELECT 1");
    logger.info("Database connection OK");
  });

  // 2. Create/verify app_user role + grant schema + sequence privileges.
  //    MUST run before probeAppUserRole: role must exist before being probed.
  await runCriticalStartupStep("init-rls-setup", initRlsSetup);

  // 3. Probe whether the connection user can SET ROLE app_user.
  //    Sets _appUserRoleUnavailable flag consumed by every withOrgDb() call.
  await runCriticalStartupStep("app_user role probe", probeAppUserRole);

  // 4. Apply tenant-isolation RLS policies to any tables still missing them.
  await runCriticalStartupStep("rls-migration", runRlsMigrationIfNeeded);

  // 5–7. Domain tables — routes assume these exist at every request.
  await runCriticalStartupStep("init-missions",   initMissionsTables);
  await runCriticalStartupStep("init-automation", initAutomationTables);
  await runCriticalStartupStep("init-monitors",   initMonitorsTables);

  // 8. Core data tables (audits, notifications, competitors, …).
  await runCriticalStartupStep("init-data-tables", initDataTables);

  // 9. AI tables — creates & validates ai_recommendations et al.
  //    Throws on any failure: missing tables = broken AI routes.
  await runCriticalStartupStep("AI migration", initAiMigration);

  // ── Optional: Resend email config check (non-blocking, log only) ─────────────
  // Helps diagnose DOMAIN_NOT_VERIFIED errors at startup rather than at send-time.
  (async () => {
    const resendKey  = process.env["RESEND_API_KEY"];
    const resendFrom = process.env["RESEND_FROM"] || "FlowPoint <noreply@flowpoint.pro>";
    if (!resendKey) {
      logger.warn("[Resend] RESEND_API_KEY is not set — magic-link emails will fail (503)");
      return;
    }
    // Extract raw domain from "Name <addr@domain>" or "addr@domain"
    const addrMatch = resendFrom.match(/<([^>]+)>/) ?? resendFrom.match(/(\S+@\S+)/);
    const fromAddr  = addrMatch?.[1] ?? resendFrom;
    const domain    = fromAddr.split("@")[1] ?? "";
    logger.info(`[Resend] Configured from="${resendFrom}" domain="${domain}" — verify SPF/DKIM in Resend dashboard if emails fail`);
    // Light check: list Resend domains via API (does not send any email)
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
        logger.warn(`[Resend] Domain "${domain}" is NOT in your Resend account. Add and verify it (SPF + DKIM records in DNS) or set RESEND_FROM to a verified domain.`);
      } else if (matched.status !== "verified") {
        logger.warn(`[Resend] Domain "${matched.name}" found but status="${matched.status}" (not verified). Complete DNS verification to enable email delivery.`);
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
  // Log only code + message — never log DATABASE_URL, passwords, or full
  // stack traces that may contain connection parameters.
  logger.error(
    {
      code:    getErrorCode(err),
      message: getSafeErrorMessage(err),
    },
    "Fatal startup error — process will exit",
  );
  process.exit(1);
});
