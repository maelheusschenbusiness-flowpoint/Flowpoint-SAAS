import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

const LOG = "[AI migration]";

/**
 * Applies AI-specific DDL migrations at startup.
 *
 * Design contract:
 *  - Every CREATE TABLE / CREATE INDEX / ALTER TABLE uses IF NOT EXISTS — safe to
 *    re-run on every boot.
 *  - DDL errors are NOT swallowed. Any failure throws so the caller can decide
 *    whether to abort startup.
 *  - After all DDL, each required table is verified with to_regclass(). If any
 *    table is still missing, we throw so the caller sees an explicit error.
 *  - Only logs "[AI migration] complete" when all tables actually exist.
 */
export async function initAiMigration(): Promise<void> {
  const client = await pool.connect();

  try {
    // ── Context: log which database/schema/user this connection is using ────────
    const ctx = await client.query<{
      current_database: string;
      current_schema:   string;
      current_user:     string;
      search_path:      string;
    }>(
      `SELECT
         current_database(),
         current_schema(),
         current_user,
         current_setting('search_path')`
    );
    const { current_database, current_schema, current_user, search_path } = ctx.rows[0]!;
    logger.info(
      { database: current_database, schema: current_schema, user: current_user, search_path },
      `${LOG} start`
    );

    // ── Strict DDL runner — throws on error, full pg error logged ───────────────
    const run = async (label: string, sql: string): Promise<void> => {
      try {
        await client.query(sql);
        logger.info(`${LOG} ${label} OK`);
      } catch (err: any) {
        logger.error({
          label,
          pgCode:       err?.code,
          message:      err?.message,
          detail:       err?.detail,
          table:        err?.table,
          schema:       err?.schema,
          routine:      err?.routine,
        }, `${LOG} FATAL — ${label}`);
        throw err;
      }
    };

    // Policies are already guarded by DO $$ IF NOT EXISTS $$ — safe to retry.
    // We still throw on unexpected errors (permissions, syntax, etc.).
    const runPolicy = run;

    // ── Helper: 4 standard tenant-isolation policies per table ──────────────────
    const tenantPolicies = async (table: string) => {
      const defs = [
        { name: "tenant_select", cmd: "FOR SELECT USING",    clause: `(org_id = current_setting('app.current_org_id', true))` },
        { name: "tenant_insert", cmd: "FOR INSERT WITH CHECK", clause: `(org_id = current_setting('app.current_org_id', true))` },
        { name: "tenant_update", cmd: "FOR UPDATE USING",    clause: `(org_id = current_setting('app.current_org_id', true))` },
        { name: "tenant_delete", cmd: "FOR DELETE USING",    clause: `(org_id = current_setting('app.current_org_id', true))` },
      ];
      for (const p of defs) {
        await runPolicy(`${table} ${p.name}`, `
          DO $$ BEGIN
            IF NOT EXISTS (
              SELECT 1 FROM pg_policies
              WHERE schemaname = 'public'
                AND tablename  = '${table}'
                AND policyname = '${p.name}'
            ) THEN
              CREATE POLICY ${p.name} ON public.${table} ${p.cmd} ${p.clause};
            END IF;
          END $$
        `);
      }
    };

    // ── 016 : ai_recommendations ─────────────────────────────────────────────────
    await run("ai_recommendations table", `
      CREATE TABLE IF NOT EXISTS public.ai_recommendations (
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
        ON public.ai_recommendations (org_id, priority ASC, created_at DESC)
    `);
    await run("ai_recommendations status index", `
      CREATE INDEX IF NOT EXISTS ai_recommendations_status_idx
        ON public.ai_recommendations (org_id, status, expires_at)
    `);
    await run("ai_recommendations RLS", `ALTER TABLE public.ai_recommendations ENABLE ROW LEVEL SECURITY`);
    await runPolicy("ai_recommendations org_isolation", `
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname='public' AND tablename='ai_recommendations'
            AND policyname='ai_recommendations_org_isolation'
        ) THEN
          CREATE POLICY ai_recommendations_org_isolation
            ON public.ai_recommendations
            USING (org_id = current_setting('app.org_id', true));
        END IF;
      END $$
    `);

    // ── 016 : idempotency_key on ai_usage_logs ───────────────────────────────────
    await run("ai_usage_logs idempotency_key column", `
      ALTER TABLE public.ai_usage_logs ADD COLUMN IF NOT EXISTS idempotency_key TEXT
    `);
    await run("ai_usage_logs idempotency_key unique index", `
      CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_logs_idempotency_key_idx
        ON public.ai_usage_logs (idempotency_key)
        WHERE idempotency_key IS NOT NULL
    `);

    // ── 017 : onboarding_sessions ────────────────────────────────────────────────
    // Columns: exactly what POST /api/ai-workspace-launch writes and
    //          GET /api/ai-workspace-launch/:sessionId reads.
    await run("onboarding_sessions table", `
      CREATE TABLE IF NOT EXISTS public.onboarding_sessions (
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
        ON public.onboarding_sessions (org_id)
    `);
    await run("onboarding_sessions org+started index", `
      CREATE INDEX IF NOT EXISTS onboarding_sessions_org_started_idx
        ON public.onboarding_sessions (org_id, started_at DESC)
    `);
    await run("onboarding_sessions RLS", `ALTER TABLE public.onboarding_sessions ENABLE ROW LEVEL SECURITY`);
    await tenantPolicies("onboarding_sessions");

    // ── 017 : ai_workspace_profiles ──────────────────────────────────────────────
    await run("ai_workspace_profiles table", `
      CREATE TABLE IF NOT EXISTS public.ai_workspace_profiles (
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
        ON public.ai_workspace_profiles (org_id)
    `);
    await run("ai_workspace_profiles session index", `
      CREATE INDEX IF NOT EXISTS ai_workspace_profiles_session_idx
        ON public.ai_workspace_profiles (session_id)
    `);
    await run("ai_workspace_profiles RLS", `ALTER TABLE public.ai_workspace_profiles ENABLE ROW LEVEL SECURITY`);
    await tenantPolicies("ai_workspace_profiles");

    // ── 017 : ai_generated_missions ──────────────────────────────────────────────
    await run("ai_generated_missions table", `
      CREATE TABLE IF NOT EXISTS public.ai_generated_missions (
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
        ON public.ai_generated_missions (org_id)
    `);
    await run("ai_generated_missions profile index", `
      CREATE INDEX IF NOT EXISTS ai_generated_missions_profile_idx
        ON public.ai_generated_missions (profile_id)
    `);
    await run("ai_generated_missions RLS", `ALTER TABLE public.ai_generated_missions ENABLE ROW LEVEL SECURITY`);
    await tenantPolicies("ai_generated_missions");

    // ── 017 : ai_setup_logs ───────────────────────────────────────────────────────
    await run("ai_setup_logs table", `
      CREATE TABLE IF NOT EXISTS public.ai_setup_logs (
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
        ON public.ai_setup_logs (org_id)
    `);
    await run("ai_setup_logs session index", `
      CREATE INDEX IF NOT EXISTS ai_setup_logs_session_idx
        ON public.ai_setup_logs (session_id)
    `);
    await run("ai_setup_logs RLS", `ALTER TABLE public.ai_setup_logs ENABLE ROW LEVEL SECURITY`);
    await tenantPolicies("ai_setup_logs");

    // ── Post-migration verification ──────────────────────────────────────────────
    // Confirm every required table actually exists in this database before
    // declaring migration complete. Throws if any table is still missing.
    const required = [
      "public.onboarding_sessions",
      "public.ai_workspace_profiles",
      "public.ai_generated_missions",
      "public.ai_setup_logs",
      "public.ai_recommendations",
    ];

    const checkRes = await client.query<{ tbl: string; exists: boolean }>(
      `SELECT
         unnest AS tbl,
         to_regclass(unnest) IS NOT NULL AS exists
       FROM unnest($1::text[])`,
      [required]
    );

    let allExist = true;
    for (const row of checkRes.rows) {
      logger.info(`${LOG} ${row.tbl} exists: ${row.exists}`);
      if (!row.exists) allExist = false;
    }

    if (!allExist) {
      const missing = checkRes.rows.filter(r => !r.exists).map(r => r.tbl);
      throw new Error(
        `${LOG} Post-migration check failed — tables still missing: ${missing.join(", ")}`
      );
    }

    logger.info(`${LOG} complete`);
  } finally {
    client.release();
  }
}
