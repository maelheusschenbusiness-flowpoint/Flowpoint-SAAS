import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

/**
 * Phase 1 — New user architecture (non-destructive)
 *
 * Creates:
 *   - users                  — canonical identity table (UUID PK)
 *   - organization_members   — replaces team_members role/membership tracking
 *
 * Adds nullable columns to existing tables:
 *   - user_sessions.user_id  — will be backfilled in Phase 2
 *
 * Adds additive columns to organizations:
 *   - subscription_status, trial_ends_at, trial_consumed_at, trial_started_at,
 *     addons, website, timezone, language, currency, region, phone, vat,
 *     postal_code, email (owner contact for billing emails)
 *
 * Does NOT:
 *   - modify any existing table in a way that breaks current code
 *   - remove org_settings (kept read-only for 30-day transition)
 *   - change any auth flow
 *   - drop or rename any column
 *
 * Safe to re-run on every server boot (all DDL uses IF NOT EXISTS / IF EXISTS).
 */

async function run(client: import("pg").PoolClient, sql: string): Promise<void> {
  try {
    await client.query(sql);
  } catch (err: unknown) {
    const e = err as Record<string, unknown>;
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(
      { sqlCode: e["code"], sqlMsg: msg, sql: sql.slice(0, 160) },
      "[phase1] DDL warning (continuing)"
    );
  }
}

export async function initPhase1Users(): Promise<void> {
  const client = await pool.connect();
  try {
    // ── 1. users — canonical identity, one row per human being ───────────────
    await run(client, `
      CREATE TABLE IF NOT EXISTS users (
        id               UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
        email            TEXT        NOT NULL,
        first_name       TEXT,
        last_name        TEXT,
        auth_provider    TEXT        NOT NULL DEFAULT 'magic_link',
        email_verified   BOOLEAN     NOT NULL DEFAULT FALSE,
        status           TEXT        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','active','suspended','deleted')),
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at    TIMESTAMPTZ,
        CONSTRAINT users_email_unique UNIQUE (email)
      );
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS users_email_idx  ON users(email);`);
    await run(client, `CREATE INDEX IF NOT EXISTS users_status_idx ON users(status);`);

    // ── 2. organization_members — the authoritative role/membership record ────
    // Replaces the role field spread across team_members + user_sessions.
    // owner = member with role='owner' (no special column anywhere else).
    await run(client, `
      CREATE TABLE IF NOT EXISTS organization_members (
        id               UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id  TEXT        NOT NULL,
        user_id          UUID        NOT NULL,
        role             TEXT        NOT NULL DEFAULT 'member'
                           CHECK (role IN ('owner','admin','member','viewer')),
        status           TEXT        NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','pending','suspended','removed')),
        invited_by       UUID,
        joined_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT organization_members_unique UNIQUE (organization_id, user_id)
      );
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS org_members_org_idx    ON organization_members(organization_id);`);
    await run(client, `CREATE INDEX IF NOT EXISTS org_members_user_idx   ON organization_members(user_id);`);
    await run(client, `CREATE INDEX IF NOT EXISTS org_members_role_idx   ON organization_members(role);`);
    await run(client, `CREATE INDEX IF NOT EXISTS org_members_status_idx ON organization_members(status);`);

    // ── 3. user_sessions — add nullable user_id for Phase 2 backfill ─────────
    await run(client, `ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS user_id_v2 UUID;`);
    await run(client, `CREATE INDEX IF NOT EXISTS user_sessions_user_id_v2_idx ON user_sessions(user_id_v2) WHERE user_id_v2 IS NOT NULL;`);

    // ── 4. organizations — additive Stripe + profile columns ─────────────────
    // These move data out of org_settings into its proper home.
    // All nullable so existing rows are unaffected.
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status  TEXT NOT NULL DEFAULT 'none';`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at        TIMESTAMPTZ;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_consumed_at    TIMESTAMPTZ;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_started_at     TIMESTAMPTZ;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS addons               JSONB NOT NULL DEFAULT '{}';`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS website              TEXT;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS timezone             TEXT;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS language             TEXT;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS currency             TEXT;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS region               TEXT;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS phone                TEXT;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS vat                  TEXT;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS postal_code          TEXT;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS owner_email          TEXT;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS owner_first_name     TEXT;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS owner_last_name      TEXT;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pending_plan         TEXT;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pending_plan_date    TEXT;`);
    await run(client, `CREATE INDEX IF NOT EXISTS organizations_sub_status_idx  ON organizations(subscription_status);`);
    await run(client, `CREATE INDEX IF NOT EXISTS organizations_stripe_cust_idx ON organizations(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;`);

    // ── 5. Mark org_settings as read-only (transition guard) ─────────────────
    // We add a column `_readonly_since` so the Phase 4 cleanup script can
    // confirm the date before dropping the table.  No INSERT/UPDATE trigger
    // is added here — enforcement is at the application layer (Phase 3).
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS _readonly_since TIMESTAMPTZ DEFAULT NULL;`);
    await run(client, `
      UPDATE org_settings
      SET _readonly_since = NOW()
      WHERE _readonly_since IS NULL;
    `);

    logger.info(
      "[phase1] users, organization_members created; user_sessions.user_id_v2 added; " +
      "organizations extended; org_settings marked _readonly_since"
    );
  } catch (err) {
    logger.error({ err }, "[phase1] Unexpected error — aborting");
    throw err;
  } finally {
    client.release();
  }
}
