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

    // ── 3b. Jalon 2 — backfill user_id_v2 for active sessions ────────────────
    // Maps user_sessions.user_id (email) → users.id (UUID) for pre-migration sessions.
    // Only touches non-expired sessions where user_id_v2 is still NULL.
    // Idempotent: WHERE user_id_v2 IS NULL guard prevents double-writes.
    await run(client, `
      UPDATE user_sessions us
      SET user_id_v2 = u.id
      FROM users u
      WHERE us.user_id = u.email
        AND us.user_id_v2 IS NULL
        AND us.expires_at > NOW();
    `);

    // ── 3c. Jalon 3 — backfill organization_members from team_members + owners ──
    // Pass 1: invited members in team_members whose email resolves to a users.id UUID.
    // ON CONFLICT DO UPDATE preserves owner role and updates role/status for others.
    await run(client, `
      INSERT INTO organization_members
             (id, organization_id, user_id, role, status, joined_at, created_at, updated_at)
      SELECT gen_random_uuid(),
             tm.org_id,
             u.id,
             tm.role,
             CASE tm.status WHEN 'removed' THEN 'removed' ELSE 'active' END,
             COALESCE(tm.joined_at, tm.created_at, NOW()),
             COALESCE(tm.created_at, NOW()),
             NOW()
      FROM team_members tm
      JOIN users u ON lower(u.email) = lower(tm.email)
      WHERE tm.status IN ('active','removed')
      ON CONFLICT (organization_id, user_id) DO UPDATE
        SET role       = CASE WHEN organization_members.role = 'owner'
                              THEN organization_members.role
                              ELSE EXCLUDED.role END,
            status     = EXCLUDED.status,
            updated_at = NOW();
    `);
    // Pass 2: org owners — the email used as org_id is the owner; ensure role='owner'.
    await run(client, `
      INSERT INTO organization_members
             (id, organization_id, user_id, role, status, joined_at, created_at, updated_at)
      SELECT gen_random_uuid(),
             o.id,
             u.id,
             'owner',
             'active',
             COALESCE(o.created_at, NOW()),
             COALESCE(o.created_at, NOW()),
             NOW()
      FROM organizations o
      JOIN users u ON lower(u.email) = lower(o.id)
      ON CONFLICT (organization_id, user_id) DO UPDATE
        SET role       = 'owner',
            status     = 'active',
            updated_at = NOW();
    `);

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
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pending_plan              TEXT;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS pending_plan_date         TEXT;`);
    // Jalon 5: trial-cron notification tracking moved from org_settings to organizations
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ending_notified_at  TIMESTAMPTZ;`);
    await run(client, `CREATE INDEX IF NOT EXISTS organizations_sub_status_idx  ON organizations(subscription_status);`);
    await run(client, `CREATE INDEX IF NOT EXISTS organizations_stripe_cust_idx ON organizations(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;`);

    // ── 4b. Self-healing sync: copy billing fields from org_settings → organizations ──
    // Fills in subscription_status, stripe_customer_id, trial_*, pending_plan, owner_email
    // for any org whose organizations row has default/NULL values while org_settings has real data.
    // COALESCE(non-default current value, org_settings value, default) pattern ensures we
    // never overwrite newer organizations data with stale org_settings data.
    await run(client, `
      UPDATE organizations o
      SET
        subscription_status    = CASE
                                   WHEN o.subscription_status != 'none' THEN o.subscription_status
                                   ELSE COALESCE(os.subscription_status, 'none')
                                 END,
        stripe_customer_id     = COALESCE(o.stripe_customer_id, NULLIF(os.stripe_customer_id, '')),
        stripe_subscription_id = COALESCE(o.stripe_subscription_id, os.stripe_subscription_id),
        trial_ends_at          = COALESCE(o.trial_ends_at, os.trial_ends_at::TIMESTAMPTZ),
        trial_consumed_at      = COALESCE(o.trial_consumed_at, os.trial_consumed_at::TIMESTAMPTZ),
        plan                   = CASE
                                   WHEN o.plan != 'standard' THEN o.plan
                                   WHEN os.plan IS NOT NULL AND TRIM(os.plan) != '' THEN os.plan
                                   ELSE 'standard'
                                 END,
        pending_plan           = COALESCE(o.pending_plan, os.pending_plan),
        pending_plan_date      = COALESCE(o.pending_plan_date, os.pending_plan_date),
        owner_email            = COALESCE(o.owner_email, os.email),
        owner_first_name       = COALESCE(o.owner_first_name, os.first_name),
        updated_at             = NOW()
      FROM org_settings os
      WHERE o.id = os.org_id;
    `);

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
