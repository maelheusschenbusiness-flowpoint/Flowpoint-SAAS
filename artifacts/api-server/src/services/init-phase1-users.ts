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
  } catch {
    // Idempotent DDL: IF NOT EXISTS / IF EXISTS guards make these no-ops on
    // already-migrated schemas.  Silently continue — no warn in Render logs.
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
    // ── Self-healing: ensure every users column exists when the table predates this migration ──
    // CREATE TABLE IF NOT EXISTS is a no-op when the table already exists, so columns
    // added in later iterations of the schema definition (e.g. status, email_verified)
    // never appear in older production tables.  Without this block:
    //   CREATE INDEX ON users(status) → ERROR: column "status" does not exist → DDL warning.
    await run(client, `ALTER TABLE users ADD COLUMN IF NOT EXISTS status         TEXT    NOT NULL DEFAULT 'pending';`);
    await run(client, `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;`);
    await run(client, `ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider  TEXT    NOT NULL DEFAULT 'magic_link';`);
    await run(client, `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at  TIMESTAMPTZ;`);
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
    // Self-heal: ensure the unique constraint exists even if the table was created before
    // the CONSTRAINT clause was added to the CREATE TABLE statement above.
    // CREATE UNIQUE INDEX IF NOT EXISTS is idempotent and skips creation if the index
    // (or an equivalent unique constraint) already exists.
    await run(client, `CREATE UNIQUE INDEX IF NOT EXISTS organization_members_unique_idx ON organization_members(organization_id, user_id);`);

    // ── 2a. RLS for organization_members ─────────────────────────────────────
    // Uses organization_id (not org_id) as the tenant key.
    // FORCE ROW LEVEL SECURITY ensures policies apply even to the table owner.
    // The four tenant_* policies mirror the standard pattern in init-rls-migration.ts
    // but keyed on organization_id so Supabase Advisor stops flagging the table.
    await run(client, `ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY`);
    await run(client, `ALTER TABLE organization_members FORCE ROW LEVEL SECURITY`);
    // Drop stale policies before recreating (idempotent)
    for (const op of ["select", "insert", "update", "delete"]) {
      await run(client, `DROP POLICY IF EXISTS "tenant_${op}" ON organization_members`);
    }
    const GUC = `current_setting('app.current_org_id', true)`;
    await run(client, `CREATE POLICY "tenant_select" ON organization_members FOR SELECT USING     (organization_id::text = ${GUC})`);
    await run(client, `CREATE POLICY "tenant_insert" ON organization_members FOR INSERT WITH CHECK (organization_id::text = ${GUC})`);
    await run(client, `CREATE POLICY "tenant_update" ON organization_members FOR UPDATE USING     (organization_id::text = ${GUC})`);
    await run(client, `CREATE POLICY "tenant_delete" ON organization_members FOR DELETE USING     (organization_id::text = ${GUC})`);

    // ── 2b. (removed) UUID→TEXT downgrade ────────────────────────────────────
    // The UUID→TEXT downgrade block that previously lived here has been removed.
    // organizations.id is now UUID (canonical authoritative type).
    // The fix-org-uuid-relations-v1 migration in init-data-tables.ts handles
    // any legacy TEXT ids on existing databases (runs once, guarded by
    // schema_migrations).  All JOIN/WHERE queries below use ::text casts so they
    // work correctly regardless of the current id type.

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
      JOIN users u ON lower(u.email) = lower(o.id::text)
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
    // Lifecycle email claims persist independently from Stripe webhook event
    // idempotency so a temporary mail-provider failure can be retried safely.
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_started_email_sent_at TIMESTAMPTZ;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS welcome_email_eligible_at TIMESTAMPTZ;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_started_email_eligible_at TIMESTAMPTZ;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS welcome_email_claimed_at TIMESTAMPTZ;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_started_email_claimed_at TIMESTAMPTZ;`);
    // Existing organizations predate lifecycle tracking. Mark them delivered so
    // deployment never sends an unexpected onboarding email to old accounts.
    await run(client, `
      UPDATE organizations
      SET welcome_email_sent_at = COALESCE(welcome_email_sent_at, NOW()),
          trial_started_email_sent_at = CASE
            WHEN subscription_status = 'trialing' THEN COALESCE(trial_started_email_sent_at, NOW())
            ELSE trial_started_email_sent_at
          END
      WHERE welcome_email_eligible_at IS NULL
        AND trial_started_email_eligible_at IS NULL
    `);
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
      WHERE o.id::text = os.org_id;
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
