/**
 * init-rls-setup.ts
 *
 * Provisions the `app_user` role on the database and verifies whether the
 * current connection user can actually execute SET ROLE app_user.
 *
 * Exported result `appUserRoleUsable` is consumed by probeAppUserRole()
 * in @workspace/db so a second round-trip at startup is avoided.
 *
 * Safe to run multiple times (fully idempotent).
 */

import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export async function initRlsSetup(): Promise<void> {
  const client = await pool.connect();
  // Absorb any async 'error' events emitted on this client instance.
  // On managed DBs (Supabase, Render) a FATAL PostgreSQL error terminates the
  // connection at wire level: pg emits 'error' asynchronously AFTER the query
  // promise rejects. Without this listener Node.js would crash with
  // "Unhandled 'error' event". pool.on('error') only covers idle clients.
  client.on("error", (err) => {
    logger.warn({ err }, "[init-rls-setup] client error event absorbed (connection terminated by server)");
  });
  try {
    // 1. Create role if missing
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
          CREATE ROLE app_user
            NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
        END IF;
      END $$;
    `);

    // 2. Schema usage
    await client.query(`GRANT USAGE ON SCHEMA public TO app_user`);

    // 3. Privileges on all existing tables
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user`);

    // 4. Sequence privileges
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user`);

    // 5. Default privileges for tables/sequences created in the future
    await client.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user
    `);
    await client.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT USAGE, SELECT ON SEQUENCES TO app_user
    `);

    // 6. Attempt GRANT app_user TO CURRENT_USER so SET ROLE works.
    //    On managed DBs (Supabase, Render) this requires superuser and will fail
    //    with a synchronous error (caught below) or a FATAL that closes the wire
    //    (absorbed by the 'error' handler above).  Either way: non-fatal.
    let membershipGranted = false;
    try {
      await client.query(`GRANT app_user TO CURRENT_USER`);
      membershipGranted = true;
    } catch {
      // Expected on managed DBs — superuser privilege required.
    }

    // 7. Verify SET ROLE actually works (only meaningful if membership was granted).
    //    Uses a fresh pool connection so a FATAL error on a managed DB does not
    //    poison `client` (which we still need for the google_oauth_states patch).
    let roleUsable = false;
    if (membershipGranted) {
      let probeClient: import("pg").PoolClient | null = null;
      try {
        probeClient = await pool.connect();
        probeClient.on("error", () => { /* absorbed */ });
        await probeClient.query("SET ROLE app_user");
        await probeClient.query("RESET ROLE");
        roleUsable = true;
      } catch {
        // GRANT succeeded but SET ROLE still fails — uncommon, log below.
      } finally {
        probeClient?.release();
      }
    }

    if (roleUsable) {
      logger.info("[init-rls-setup] app_user role present and usable — full RLS enforcement via SET ROLE");
    } else if (membershipGranted) {
      logger.warn("[init-rls-setup] app_user GRANT succeeded but SET ROLE failed — GUC-only RLS mode");
    } else {
      logger.warn("[init-rls-setup] app_user role present but membership not grantable (managed DB) — GUC-only RLS mode (correct for Supabase/Render)");
    }

    // ── Patch: ensure google_oauth_states has RLS — only if the table already exists ──
    const { rows: gCheck } = await client.query(
      `SELECT to_regclass('public.google_oauth_states') IS NOT NULL AS "exists"`
    );
    if (gCheck[0]?.exists) {
      await client.query(`ALTER TABLE google_oauth_states ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default'`);
      await client.query(`ALTER TABLE google_oauth_states ENABLE ROW LEVEL SECURITY`);
      for (const cmd of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        const policyName = `tenant_${cmd.toLowerCase()}`;
        await client.query(`DROP POLICY IF EXISTS "${policyName}" ON google_oauth_states`);
        const clause = cmd === "INSERT"
          ? `WITH CHECK (org_id = current_setting('app.current_org_id', true))`
          : `USING (org_id = current_setting('app.current_org_id', true))`;
        await client.query(`CREATE POLICY "${policyName}" ON google_oauth_states FOR ${cmd} ${clause}`);
      }
      await client.query(`CREATE INDEX IF NOT EXISTS idx_google_oauth_states_org_id ON google_oauth_states (org_id)`);
      logger.info("[init-rls-setup] google_oauth_states RLS patched");
    } else {
      logger.info("[init-rls-setup] google_oauth_states not yet created — RLS patch skipped");
    }
  } catch (err) {
    logger.warn({ err }, "[init-rls-setup] Non-fatal: could not provision app_user role");
  } finally {
    client.release();
  }
}
