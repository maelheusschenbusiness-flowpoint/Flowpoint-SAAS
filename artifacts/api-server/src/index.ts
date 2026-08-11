import { env } from "./lib/env.js";
import { logger } from "./lib/logger.js";
import { getStripeKey } from "./services/stripe-factory.js";
import app from "./app.js";
import { pool, probeAppUserRole } from "@workspace/db";
import { initMissionsTables } from "./services/init-missions.js";
import { initAutomationTables } from "./services/init-automation.js";
import { initMonitorsTables } from "./services/init-monitors.js";
import { initDataTables } from "./services/init-data-tables.js";
import { initRlsSetup } from "./services/init-rls-setup.js";
import { runRlsMigrationIfNeeded } from "./services/init-rls-migration.js";
import { initAiMigration } from "./services/init-ai-migration.js";
import { initPhase1Users } from "./services/init-phase1-users.js";
import { initAgentTables } from "./services/init-agent-tables.js";
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
  // ── 0-pre. Google Maps server key aliasing ─────────────────────────────────
  //
  // FLOWPOINT_MAP_BACKEND is the canonical name for the new server-side Maps
  // key (API-restricted only, no referer restriction). All backend Maps code
  // reads GOOGLE_MAPS_API_KEY. Alias once here so neither the services nor the
  // routes need to be aware of the env-var rename.
  //
  // Rules:
  //  • FLOWPOINT_MAP_BACKEND takes precedence over whatever GOOGLE_MAPS_API_KEY
  //    happens to contain (the old key was referer-restricted and useless for
  //    server calls).
  //  • GOOGLE_MAPS_PUBLIC_KEY is the browser key; it must never be overwritten.
  //  • This block never logs key values — only presence.
  {
    const backendKey = process.env["FLOWPOINT_MAP_BACKEND"];
    if (backendKey) {
      process.env["GOOGLE_MAPS_API_KEY"] = backendKey;
      logger.info("[Maps] GOOGLE_MAPS_API_KEY aliased from FLOWPOINT_MAP_BACKEND (server key, no referer restriction)");
    } else if (process.env["GOOGLE_MAPS_API_KEY"]) {
      logger.warn("[Maps] FLOWPOINT_MAP_BACKEND not set — falling back to existing GOOGLE_MAPS_API_KEY (may be referer-restricted)");
    } else {
      logger.warn("[Maps] No Maps server key configured (FLOWPOINT_MAP_BACKEND / GOOGLE_MAPS_API_KEY) — Geocoding/Places/Distance Matrix disabled");
    }
    // Audit: ensure the browser key is distinct from the server key
    const browserKey = process.env["GOOGLE_MAPS_PUBLIC_KEY"] ?? "";
    if (backendKey && browserKey && backendKey === browserKey) {
      logger.warn("[Maps] FLOWPOINT_MAP_BACKEND and GOOGLE_MAPS_PUBLIC_KEY are identical — the server key should be a separate credential");
    }
  }

  // ── 0. Stripe configuration safety guard ──────────────────────────────────
  //
  // Refuse to start if NODE_ENV=production is active with test-mode Stripe
  // credentials.  This catches STRIPE_TEST_MODE=true accidentally left in the
  // shared environment — a misconfiguration that would silently reject every
  // real payment.
  //
  // Rules:
  //   • active secret key  starts with sk_test_ → fatal
  //   • publishable key    starts with pk_test_ → fatal
  //   • Log mode (LIVE/TEST) at startup — never log key values
  // ────────────────────────────────────────────────────────────────────────────
  {
    const activeKey  = getStripeKey();
    const pubKey     = process.env["STRIPE_PUBLISHABLE_KEY"] ?? "";
    const isTestKey  = activeKey.startsWith("sk_test_");
    const isTestPub  = pubKey.startsWith("pk_test_");
    const isProd     = env.NODE_ENV === "production";

    if (isProd && isTestKey) {
      logger.fatal(
        "[Stripe] FATAL: NODE_ENV=production but the active Stripe secret key " +
        "starts with sk_test_. Remove STRIPE_TEST_MODE from the shared " +
        "environment before deploying. Server will not start."
      );
      process.exit(1);
    }
    if (isProd && isTestPub) {
      logger.fatal(
        "[Stripe] FATAL: NODE_ENV=production but STRIPE_PUBLISHABLE_KEY " +
        "starts with pk_test_. Set STRIPE_PUBLISHABLE_KEY to a pk_live_ " +
        "value before deploying. Server will not start."
      );
      process.exit(1);
    }

    // Safe startup log — mode only, never the key value
    const stripeMode   = isTestKey ? "TEST" : "LIVE";
    const webhookSec   = process.env["STRIPE_WEBHOOK_SECRET"]
                      || process.env["STRIPE_WEBHOOK_SECRET_RENDER"]
                      || "";
    const webhookMode  = webhookSec
      ? (isTestKey ? "TEST (test-endpoint secret active)" : "LIVE")
      : "NOT CONFIGURED";
    const pubDisplay   = pubKey
      ? pubKey.slice(0, 7) + "…"   // e.g. "pk_live"  —  prefix only
      : "not set";

    logger.info(
      `[Stripe] mode: ${stripeMode} | webhook: ${webhookMode} | publishable: ${pubDisplay}`
    );
  }

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
        // user_sessions: ip_address + user_agent needed for login history feature
        await client.query(`ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS ip_address TEXT`);
        await client.query(`ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS user_agent TEXT`);
        logger.info("[startup] billing trial columns + user_sessions(ip+ua) ensured");
      } finally { client.release(); }
    }).catch((err: unknown) => {
      logger.warn({ err }, "[startup] billing-trial-columns step failed (non-fatal — columns may already exist)");
    });

    // New signup flow: pre-registration table + extended org_settings columns (idempotent)
    await runCriticalStartupStep("new-signup-schema", async () => {
      const client = await pool.connect();
      try {
        // Extended org_settings columns for full billing address
        await client.query(`ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS postal_code TEXT`);
        await client.query(`ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS vat         TEXT`);
        // Temporary pre-registration storage (expires after 2 hours, no account until payment)
        await client.query(`
          CREATE TABLE IF NOT EXISTS pending_signups (
            token        TEXT         PRIMARY KEY,
            email        TEXT         NOT NULL,
            first_name   TEXT         NOT NULL,
            last_name    TEXT         NOT NULL,
            company_name TEXT         NOT NULL,
            country      TEXT,
            address      TEXT,
            city         TEXT,
            postal_code  TEXT,
            phone        TEXT,
            vat          TEXT,
            created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            expires_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW() + INTERVAL '2 hours'
          )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS pending_signups_email_idx   ON pending_signups(email)`);
        await client.query(`CREATE INDEX IF NOT EXISTS pending_signups_expires_idx ON pending_signups(expires_at)`);
        // consumed_at: set when webhook/checkout-complete successfully created the account
        await client.query(`ALTER TABLE pending_signups ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ`);
        // stripe_customer_id: stored after first Stripe Customer creation so retries reuse the same customer
        await client.query(`ALTER TABLE pending_signups ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`);
        // SECURITY: RLS enabled with no public policies → deny-all for anon/authenticated.
        // Backend pool.query() uses BYPASSRLS superuser and is unaffected.
        // This prevents the `token` column from being exposed via PostgREST.
        await client.query(`ALTER TABLE pending_signups ENABLE ROW LEVEL SECURITY`);
        await client.query(`ALTER TABLE pending_signups FORCE ROW LEVEL SECURITY`);
        // checkout_post_tokens: single-use token created by webhook after org creation.
        // SECURITY: token_hash = SHA256(stripe_session_id) — raw session ID never stored in plaintext.
        // Expiry: 15 minutes (spec requirement). Row is DELETED on consumption (not merely flagged).
        // Migration: if old schema (stripe_session_id PK, no token_hash column) exists, drop + recreate.
        await client.query(`
          DO $$ BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_name = 'checkout_post_tokens' AND column_name = 'token_hash'
            ) THEN
              DROP TABLE IF EXISTS checkout_post_tokens;
            END IF;
          END $$
        `);
        await client.query(`
          CREATE TABLE IF NOT EXISTS checkout_post_tokens (
            token_hash         TEXT        PRIMARY KEY,           -- SHA256(stripe_session_id)
            stripe_session_id  TEXT        UNIQUE NOT NULL,       -- kept for Stripe event idempotency
            stripe_event_id    TEXT,
            org_id             TEXT        NOT NULL,
            email              TEXT        NOT NULL,
            pre_register_token TEXT,
            created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at         TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '15 minutes'
          )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS cpt_org_idx     ON checkout_post_tokens(org_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS cpt_expires_idx ON checkout_post_tokens(expires_at)`);
        // SECURITY: RLS enabled with no public policies → deny-all for anon/authenticated.
        // Backend pool.query() uses BYPASSRLS superuser and is unaffected.
        // token_hash (SHA256 of Stripe session ID) must never be accessible via PostgREST.
        await client.query(`ALTER TABLE checkout_post_tokens ENABLE ROW LEVEL SECURITY`);
        await client.query(`ALTER TABLE checkout_post_tokens FORCE ROW LEVEL SECURITY`);
        logger.info("[startup] new-signup-schema ensured (pending_signups, checkout_post_tokens, postal_code, vat)");
      } finally { client.release(); }
    }).catch((err: unknown) => {
      logger.warn({ err }, "[startup] new-signup-schema step failed (non-fatal)");
    });

    // Missions schema self-heal — runs on every boot so new columns added after initial
    // Pre-Deploy are applied to existing Render instances (all statements are idempotent).
    await runCriticalStartupStep("init-missions", initMissionsTables)
      .catch((err: unknown) => {
        logger.warn({ err }, "[startup] init-missions step failed (non-fatal)");
      });

    // Phase 1 — New user architecture (non-destructive, runs on every boot)
    await runCriticalStartupStep("phase1-users", initPhase1Users)
      .catch((err: unknown) => {
        logger.warn({ err }, "[startup] phase1-users step failed (non-fatal)");
      });

    // Automation schema self-heal — legacy Render DBs miss last_run_at/runs_count
    // on automation_workflows, which made every workflow run report failure.
    await runCriticalStartupStep("init-automation", initAutomationTables)
      .catch((err: unknown) => {
        logger.warn({ err }, "[startup] init-automation step failed (non-fatal)");
      });

    // AI Agents Phase 1 — tables agent (idempotent, doit tourner à chaque boot)
    await runCriticalStartupStep("init-agent-tables", initAgentTables)
      .catch((err: unknown) => {
        logger.warn({ err }, "[startup] init-agent-tables step failed (non-fatal)");
      });

    // P0-5 / P0-3 / P1-2 / P1-3 : run full initDataTables on fast path too.
    // All statements are IF NOT EXISTS / idempotent. The schema_migrations table
    // added inside initDataTables ensures expensive CREATE TABLE blocks are skipped
    // on subsequent boots once the tables exist.
    await runCriticalStartupStep("init-data-tables", initDataTables)
      .catch((err: unknown) => {
        logger.warn({ err }, "[startup] init-data-tables step failed (non-fatal)");
      });

    // P0-5 : initAiMigration was previously only run on the full path.
    // Add it here so ai_recommendations / ai_workspace_profiles etc. are always present.
    await runCriticalStartupStep("AI migration", initAiMigration)
      .catch((err: unknown) => {
        // Non-fatal for the rest of the app, but AI POST endpoints are gated on
        // isAiMigrationComplete() and will return 503 AI_SCHEMA_NOT_READY until
        // a successful run — quota/usage writes can never silently break.
        logger.error({ err }, "[startup] AI migration FAILED — AI endpoints disabled (503 AI_SCHEMA_NOT_READY) until schema is repaired");
      });

    // AI Agents Phase 3 — colonnes calendrier IA (idempotent: IF NOT EXISTS)
    await runCriticalStartupStep("calendar-phase3-columns", async () => {
      const client = await pool.connect();
      try {
        await client.query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
        await client.query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS priority         TEXT        NOT NULL DEFAULT 'normal'`);
        await client.query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS color            TEXT        NOT NULL DEFAULT ''`);
        await client.query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS reminder         INTEGER     NOT NULL DEFAULT 0`);
        await client.query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS linked_mission_id TEXT`);
        await client.query(`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS rrule TEXT`);
        await client.query(`CREATE INDEX IF NOT EXISTS calendar_events_date_org_idx ON calendar_events(org_id, date)`);
        logger.info("[startup] calendar_events Phase 3 columns ensured (updated_at, priority, color, reminder, linked_mission_id, rrule)");
      } finally { client.release(); }
    }).catch((err: unknown) => {
      logger.warn({ err }, "[startup] calendar-phase3-columns step failed (non-fatal)");
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

    // Phase 1 — New user architecture (non-destructive, runs after full init)
    await runCriticalStartupStep("phase1-users", initPhase1Users)
      .catch((err: unknown) => {
        logger.warn({ err }, "[startup] phase1-users step failed (non-fatal)");
      });

    // AI Agents Phase 1 — tables agent (idempotent)
    await runCriticalStartupStep("init-agent-tables", initAgentTables)
      .catch((err: unknown) => {
        logger.warn({ err }, "[startup] init-agent-tables step failed (non-fatal)");
      });
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

    // Durable recovery of AI usage writes that failed after provider consumption
    // (idempotent replays — survives restarts, unlike in-process timers).
    import("./services/ai-engine.js")
      .then(({ startAiUsageOutboxWorker }) => startAiUsageOutboxWorker())
      .catch((err) => logger.warn({ err }, "[AI] usage outbox worker not started"));

    // Cleanup cron: purge expired pending_signups and checkout_post_tokens every hour
    setInterval(async () => {
      const client = await pool.connect();
      try {
        const ps = await client.query(
          `DELETE FROM pending_signups WHERE expires_at < NOW() - INTERVAL '1 hour' RETURNING token`
        );
        const ct = await client.query(
          `DELETE FROM checkout_post_tokens WHERE expires_at < NOW() - INTERVAL '1 hour' RETURNING stripe_session_id`
        );
        if (ps.rowCount || ct.rowCount) {
          logger.info({ purgedPendingSignups: ps.rowCount, purgedPostTokens: ct.rowCount },
            "[signup-cleanup] Purged expired signup records");
        }
      } catch (e) {
        logger.warn({ e }, "[signup-cleanup] Cleanup failed (non-fatal)");
      } finally {
        client.release();
      }
    }, 60 * 60 * 1000); // every hour
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
