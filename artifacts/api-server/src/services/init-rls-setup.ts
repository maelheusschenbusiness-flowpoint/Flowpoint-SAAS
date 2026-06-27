/**
 * init-rls-setup.ts
 *
 * Provisions the `app_user` role on the LOCAL dev PostgreSQL database so that
 * `withOrgDb` (which runs SET LOCAL ROLE app_user) works without errors.
 *
 * On Supabase this is handled by migration 011_app_user.sql.
 * On local dev the role is missing until this init runs at server startup.
 *
 * Safe to run multiple times (fully idempotent).
 */

import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export async function initRlsSetup(): Promise<void> {
  const client = await pool.connect();
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

    logger.info("[init-rls-setup] app_user role ready");
  } catch (err) {
    logger.warn({ err }, "[init-rls-setup] Non-fatal: could not provision app_user role");
  } finally {
    client.release();
  }
}
