import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

const LOG = "[init-ai-migration]";

/**
 * Applies AI-specific DDL migrations at startup — idempotent, safe to run
 * on every boot. Any statement that fails (e.g. already exists) is swallowed
 * as a non-fatal warning so the server always continues.
 */
export async function initAiMigration(): Promise<void> {
  const client = await pool.connect();
  const run = async (label: string, sql: string) => {
    try {
      await client.query(sql);
    } catch (err: any) {
      logger.warn({ msg: err.message?.split("\n")[0] }, `${LOG} ${label} — non-fatal`);
    }
  };

  // Helper: create the 4 standard tenant-isolation policies for a table.
  // Idempotent — skips each policy if it already exists.
  const tenantPolicies = async (table: string) => {
    const policies: Array<{ name: string; cmd: string; clause: string }> = [
      {
        name: "tenant_select",
        cmd:  "FOR SELECT USING",
        clause: `(org_id = current_setting('app.current_org_id', true))`,
      },
      {
        name:   "tenant_insert",
        cmd:    "FOR INSERT WITH CHECK",
        clause: `(org_id = current_setting('app.current_org_id', true))`,
      },
      {
        name:   "tenant_update",
        cmd:    "FOR UPDATE USING",
        clause: `(org_id = current_setting('app.current_org_id', true))`,
      },
      {
        name:   "tenant_delete",
        cmd:    "FOR DELETE USING",
        clause: `(org_id = current_setting('app.current_org_id', true))`,
      },
    ];
    for (const p of policies) {
      await run(`${table} ${p.name}`, `
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename  = '${table}'
              AND policyname = '${p.name}'
          ) THEN
            CREATE POLICY ${p.name} ON ${table} ${p.cmd} ${p.clause};
          END IF;
        END $$
      `);
    }
  };

  try {
    // ── 016 : ai_recommendations table ─────────────────────────────────────────
    await run("ai_recommendations table", `
      CREATE TABLE IF NOT EXISTS ai_recommendations (
        id          TEXT PRIMARY KEY DEFAULT ('rec_' || gen_random_uuid()::TEXT),
        org_id      TEXT NOT NULL,
        type        TEXT NOT NULL DEFAULT 'general',
        title       TEXT NOT NULL,
        description TEXT,
        priority    INTEGER NOT NULL DEFAULT 5,
        status      TEXT NOT NULL DEFAULT 'active',
        source      TEXT DEFAULT 'ai',
        metadata    JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at  TIMESTAMPTZ
      )
    `);

    await run("ai_recommendations org index", `
      CREATE INDEX IF NOT EXISTS ai_recommendations_org_idx
        ON ai_recommendations (org_id, priority ASC, created_at DESC)
    `);

    await run("ai_recommendations status index", `
      CREATE INDEX IF NOT EXISTS ai_recommendations_status_idx
        ON ai_recommendations (org_id, status, expires_at)
    `);

    await run("ai_recommendations RLS", `
      ALTER TABLE ai_recommendations ENABLE ROW LEVEL SECURITY
    `);

    await run("ai_recommendations tenant policy", `
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname='public' AND tablename='ai_recommendations'
            AND policyname='ai_recommendations_org_isolation'
        ) THEN
          CREATE POLICY ai_recommendations_org_isolation
            ON ai_recommendations
            USING (org_id = current_setting('app.org_id', true));
        END IF;
      END $$
    `);

    // ── 016 : idempotency_key on ai_usage_logs ──────────────────────────────────
    await run("ai_usage_logs idempotency_key column", `
      ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS idempotency_key TEXT
    `);

    await run("ai_usage_logs idempotency_key unique index", `
      CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_logs_idempotency_key_idx
        ON ai_usage_logs (idempotency_key)
        WHERE idempotency_key IS NOT NULL
    `);

    // ── 017 : workspace-launch tables ───────────────────────────────────────────
    //
    // Schema derived from exact column inventory of the local DB (2026-07-15).
    // All 4 tables are required by POST /api/ai-workspace-launch and
    // GET /api/ai-workspace-launch/:sessionId.

    // ── onboarding_sessions ──────────────────────────────────────────────────────
    await run("onboarding_sessions table", `
      CREATE TABLE IF NOT EXISTS onboarding_sessions (
        id            TEXT PRIMARY KEY,
        org_id        TEXT NOT NULL DEFAULT 'default',
        user_id       TEXT NOT NULL DEFAULT 'demo',
        status        TEXT NOT NULL DEFAULT 'in_progress',
        site_url      TEXT,
        business_name TEXT,
        niche         TEXT,
        location      TEXT,
        company_size  TEXT,
        activity_type TEXT,
        started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at  TIMESTAMPTZ,
        metadata      JSONB
      )
    `);

    await run("onboarding_sessions org index", `
      CREATE INDEX IF NOT EXISTS onboarding_sessions_org_idx
        ON onboarding_sessions (org_id)
    `);

    await run("onboarding_sessions org_created index", `
      CREATE INDEX IF NOT EXISTS onboarding_sessions_org_started_idx
        ON onboarding_sessions (org_id, started_at DESC)
    `);

    await run("onboarding_sessions RLS", `
      ALTER TABLE onboarding_sessions ENABLE ROW LEVEL SECURITY
    `);

    await tenantPolicies("onboarding_sessions");

    // ── ai_workspace_profiles ────────────────────────────────────────────────────
    await run("ai_workspace_profiles table", `
      CREATE TABLE IF NOT EXISTS ai_workspace_profiles (
        id                 TEXT PRIMARY KEY,
        org_id             TEXT NOT NULL DEFAULT 'default',
        session_id         TEXT,
        business_name      TEXT,
        niche              TEXT,
        location           TEXT,
        goals              JSONB,
        competitors        JSONB,
        stack              JSONB,
        priorities         JSONB,
        generated_roadmap  JSONB,
        generated_strategy TEXT,
        seo_score          INTEGER,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await run("ai_workspace_profiles org index", `
      CREATE INDEX IF NOT EXISTS ai_workspace_profiles_org_idx
        ON ai_workspace_profiles (org_id)
    `);

    await run("ai_workspace_profiles session index", `
      CREATE INDEX IF NOT EXISTS ai_workspace_profiles_session_idx
        ON ai_workspace_profiles (session_id)
    `);

    await run("ai_workspace_profiles RLS", `
      ALTER TABLE ai_workspace_profiles ENABLE ROW LEVEL SECURITY
    `);

    await tenantPolicies("ai_workspace_profiles");

    // ── ai_generated_missions ─────────────────────────────────────────────────────
    await run("ai_generated_missions table", `
      CREATE TABLE IF NOT EXISTS ai_generated_missions (
        id               TEXT PRIMARY KEY,
        org_id           TEXT NOT NULL DEFAULT 'default',
        profile_id       TEXT,
        title            TEXT NOT NULL,
        description      TEXT,
        category         TEXT NOT NULL DEFAULT 'seo',
        priority         INTEGER NOT NULL DEFAULT 5,
        estimated_impact TEXT,
        estimated_effort TEXT,
        status           TEXT NOT NULL DEFAULT 'pending',
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at     TIMESTAMPTZ
      )
    `);

    await run("ai_generated_missions org index", `
      CREATE INDEX IF NOT EXISTS ai_generated_missions_org_idx
        ON ai_generated_missions (org_id)
    `);

    await run("ai_generated_missions profile index", `
      CREATE INDEX IF NOT EXISTS ai_generated_missions_profile_idx
        ON ai_generated_missions (profile_id)
    `);

    await run("ai_generated_missions RLS", `
      ALTER TABLE ai_generated_missions ENABLE ROW LEVEL SECURITY
    `);

    await tenantPolicies("ai_generated_missions");

    // ── ai_setup_logs ─────────────────────────────────────────────────────────────
    await run("ai_setup_logs table", `
      CREATE TABLE IF NOT EXISTS ai_setup_logs (
        id         TEXT PRIMARY KEY,
        org_id     TEXT NOT NULL DEFAULT 'default',
        session_id TEXT,
        step       TEXT NOT NULL,
        message    TEXT,
        level      TEXT NOT NULL DEFAULT 'info',
        metadata   JSONB,
        logged_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await run("ai_setup_logs org index", `
      CREATE INDEX IF NOT EXISTS ai_setup_logs_org_idx
        ON ai_setup_logs (org_id)
    `);

    await run("ai_setup_logs session index", `
      CREATE INDEX IF NOT EXISTS ai_setup_logs_session_idx
        ON ai_setup_logs (session_id)
    `);

    await run("ai_setup_logs RLS", `
      ALTER TABLE ai_setup_logs ENABLE ROW LEVEL SECURITY
    `);

    await tenantPolicies("ai_setup_logs");

    logger.info(`${LOG} AI DDL migrations applied`);
  } finally {
    client.release();
  }
}
