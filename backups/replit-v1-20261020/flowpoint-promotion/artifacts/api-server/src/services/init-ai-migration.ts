import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

const LOG = "[AI migration]";

/**
 * True only after initAiMigration() has fully completed, including the
 * post-migration contract verification. AI endpoints that write quota/usage
 * state MUST check this and refuse service (503) while false — otherwise a
 * failed schema repair silently breaks billing writes while the server
 * accepts traffic.
 */
let aiMigrationComplete = false;
export function isAiMigrationComplete(): boolean {
  return aiMigrationComplete;
}

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

    // Cross-instance fixed-window counters for provider-backed AI operations.
    await run("ai_rate_limit_windows table", `
      CREATE TABLE IF NOT EXISTS public.ai_rate_limit_windows (
        org_id        TEXT NOT NULL,
        bucket        TEXT NOT NULL,
        window_start  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        request_count INTEGER NOT NULL DEFAULT 0,
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (org_id, bucket)
      )
    `);
    await run("ai_rate_limit_windows RLS", `ALTER TABLE public.ai_rate_limit_windows ENABLE ROW LEVEL SECURITY`);
    await tenantPolicies("ai_rate_limit_windows");

    // ── 016 : idempotency_key on ai_usage_logs ───────────────────────────────────
    await run("ai_usage_logs idempotency_key column", `
      ALTER TABLE public.ai_usage_logs ADD COLUMN IF NOT EXISTS idempotency_key TEXT
    `);
    await run("ai_usage_logs idempotency_key unique index", `
      CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_logs_idempotency_key_idx
        ON public.ai_usage_logs (idempotency_key)
        WHERE idempotency_key IS NOT NULL
    `);

    // ── 018 : align AI billing tables with the code contract ────────────────────
    // Production (Supabase) predates the current schema: ai_credit_purchases was
    // created with (credits_added, uuid id), ai_monthly_usage lacks request_count/
    // credits_limit/credits_extra, ai_usage_logs has uuid id/user_id, and ai_alerts
    // never existed. The AI engine inserts deterministic TEXT ids (amu_…, aul_…,
    // acp_…) and selects these columns — any gap throws in the quota preflight and
    // every chat request returns 503 QUOTA_STATE_UNAVAILABLE.
    // All statements are guarded/idempotent: no-ops on an already-correct schema.

    // ── Helper: uuid→TEXT column conversion with full dependency dance ──────────
    // PostgreSQL rejects ALTER COLUMN TYPE when ANY of these depend on the column:
    //  - a policy on the table (SQLSTATE 0A000) — legacy Supabase policies often
    //    reference user_id/org_id/id;
    //  - a FOREIGN KEY on this table using the column, or a FK from another table
    //    referencing it (type mismatch after conversion) — e.g. a legacy
    //    ai_usage_logs.user_id → auth.users(id) FK;
    //  - a view selecting the column.
    // The whole DO block is one transaction: either the column ends up TEXT with
    // all blockers removed, or nothing changed. Canonical tenant policies are
    // recreated unconditionally further below (outside this helper).
    // Dropped legacy FKs/views are NOT recreated: the code contract writes
    // synthetic TEXT ids ('aul_…'/'amu_…'/'acp_…') that can never satisfy a FK to
    // a uuid column, and no view over these tables is part of the app contract.
    const convertUuidColsToText = async (table: string, columns: string[]) => {
      const colList = columns.map((c) => `'${c}'`).join(", ");
      await run(`${table} uuid→TEXT (${columns.join(", ")})`, `
        DO $$
        DECLARE
          pol RECORD;
          col RECORD;
          dep RECORD;
          needs_convert BOOLEAN := FALSE;
        BEGIN
          IF to_regclass('public.${table}') IS NULL THEN RETURN; END IF;

          SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='${table}'
              AND column_name IN (${colList}) AND data_type='uuid'
          ) INTO needs_convert;
          IF NOT needs_convert THEN RETURN; END IF;

          -- 1) Policies referencing any column block ALTER COLUMN TYPE: drop all.
          --    Canonical tenant policies are recreated after conversion.
          FOR pol IN
            SELECT policyname FROM pg_policies
            WHERE schemaname='public' AND tablename='${table}'
          LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.${table}', pol.policyname);
          END LOOP;

          FOR col IN
            SELECT c.column_name, a.attnum
            FROM information_schema.columns c
            JOIN pg_attribute a
              ON a.attrelid = 'public.${table}'::regclass
             AND a.attname  = c.column_name
            WHERE c.table_schema='public' AND c.table_name='${table}'
              AND c.column_name IN (${colList}) AND c.data_type='uuid'
          LOOP
            -- 2a) FKs ON this table that use the column
            FOR dep IN
              SELECT conname FROM pg_constraint
              WHERE conrelid = 'public.${table}'::regclass
                AND contype = 'f'
                AND col.attnum = ANY (conkey)
            LOOP
              RAISE NOTICE '[AI migration] dropping FK % on ${table} (blocks % type change)', dep.conname, col.column_name;
              EXECUTE format('ALTER TABLE public.${table} DROP CONSTRAINT %I', dep.conname);
            END LOOP;
            -- 2b) FKs FROM other tables referencing this column
            FOR dep IN
              SELECT conname, conrelid::regclass::text AS reftable
              FROM pg_constraint
              WHERE confrelid = 'public.${table}'::regclass
                AND contype = 'f'
                AND col.attnum = ANY (confkey)
            LOOP
              RAISE NOTICE '[AI migration] dropping inbound FK % from % (references ${table}.%)', dep.conname, dep.reftable, col.column_name;
              EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', dep.reftable, dep.conname);
            END LOOP;
            -- 2c) Views selecting the column
            FOR dep IN
              SELECT DISTINCT view_schema, view_name
              FROM information_schema.view_column_usage
              WHERE table_schema='public' AND table_name='${table}'
                AND column_name = col.column_name
            LOOP
              RAISE NOTICE '[AI migration] dropping view %.% (blocks ${table}.% type change)', dep.view_schema, dep.view_name, col.column_name;
              EXECUTE format('DROP VIEW IF EXISTS %I.%I CASCADE', dep.view_schema, dep.view_name);
            END LOOP;
            -- 3) Convert
            EXECUTE format('ALTER TABLE public.${table} ALTER COLUMN %I DROP DEFAULT', col.column_name);
            EXECUTE format('ALTER TABLE public.${table} ALTER COLUMN %I TYPE TEXT USING %I::text', col.column_name, col.column_name);
          END LOOP;
        END $$
      `);
    };

    // ai_credit_purchases — id uuid→TEXT (code inserts 'acp_<sessionId>')
    await convertUuidColsToText("ai_credit_purchases", ["id"]);
    await run("ai_credit_purchases pack column", `
      ALTER TABLE public.ai_credit_purchases ADD COLUMN IF NOT EXISTS pack TEXT NOT NULL DEFAULT ''
    `);
    await run("ai_credit_purchases credits column", `
      ALTER TABLE public.ai_credit_purchases ADD COLUMN IF NOT EXISTS credits INTEGER NOT NULL DEFAULT 0
    `);
    await run("ai_credit_purchases amount_eur_cents column", `
      ALTER TABLE public.ai_credit_purchases ADD COLUMN IF NOT EXISTS amount_eur_cents INTEGER NOT NULL DEFAULT 0
    `);
    await run("ai_credit_purchases stripe_payment_intent column", `
      ALTER TABLE public.ai_credit_purchases ADD COLUMN IF NOT EXISTS stripe_payment_intent TEXT
    `);
    // One-time backfill: legacy credits_added → credits (only where credits is still 0)
    await run("ai_credit_purchases credits backfill", `
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='public' AND table_name='ai_credit_purchases'
            AND column_name='credits_added'
        ) THEN
          UPDATE public.ai_credit_purchases
             SET credits = credits_added
           WHERE credits = 0 AND credits_added IS NOT NULL AND credits_added <> 0;
        END IF;
      END $$
    `);

    // ai_monthly_usage — id uuid→TEXT (code inserts 'amu_<org>_<month>')
    await convertUuidColsToText("ai_monthly_usage", ["id"]);
    await run("ai_monthly_usage request_count column", `
      ALTER TABLE public.ai_monthly_usage ADD COLUMN IF NOT EXISTS request_count INTEGER NOT NULL DEFAULT 0
    `);
    await run("ai_monthly_usage credits_limit column", `
      ALTER TABLE public.ai_monthly_usage ADD COLUMN IF NOT EXISTS credits_limit INTEGER NOT NULL DEFAULT 100000
    `);
    await run("ai_monthly_usage credits_extra column", `
      ALTER TABLE public.ai_monthly_usage ADD COLUMN IF NOT EXISTS credits_extra INTEGER NOT NULL DEFAULT 0
    `);
    // ON CONFLICT (org_id, month) requires this unique index. Dedupe first so the
    // index build can never fail on legacy duplicate rows (keep the newest row).
    await run("ai_monthly_usage dedupe org+month", `
      DELETE FROM public.ai_monthly_usage a
      USING public.ai_monthly_usage b
      WHERE a.org_id = b.org_id AND a.month = b.month
        AND a.ctid < b.ctid
    `);
    await run("ai_monthly_usage org+month unique index", `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_monthly_usage_org_month
        ON public.ai_monthly_usage (org_id, month)
    `);

    // ai_usage_logs — id/user_id uuid→TEXT (code inserts 'aul_…' and session user ids)
    await convertUuidColsToText("ai_usage_logs", ["id", "user_id"]);

    // ai_alerts — read by getAIUsageStats, written by quota alerting; missing in prod
    await run("ai_alerts table", `
      CREATE TABLE IF NOT EXISTS public.ai_alerts (
        id            TEXT PRIMARY KEY,
        org_id        TEXT NOT NULL DEFAULT 'default',
        alert_type    TEXT NOT NULL,
        message       TEXT NOT NULL,
        threshold     INTEGER,
        current_value INTEGER,
        triggered_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at   TIMESTAMPTZ,
        metadata      JSONB
      )
    `);
    await run("ai_alerts org index", `
      CREATE INDEX IF NOT EXISTS ai_alerts_org_idx
        ON public.ai_alerts (org_id, triggered_at DESC)
    `);
    await run("ai_alerts RLS", `ALTER TABLE public.ai_alerts ENABLE ROW LEVEL SECURITY`);
    await tenantPolicies("ai_alerts");

    // Tenant policies for the three AI billing tables — uuid-safe (org_id::text).
    // Drop + recreate unconditionally: this corrects pre-existing policies with
    // incompatible predicates (legacy Supabase policies) AND restores the policies
    // dropped by convertUuidColsToText above. Idempotent — same end state on rerun.
    for (const tbl of ["ai_credit_purchases", "ai_monthly_usage", "ai_usage_logs"]) {
      await run(`${tbl} RLS enable`, `ALTER TABLE public.${tbl} ENABLE ROW LEVEL SECURITY`);
      const defs = [
        { name: "tenant_select", cmd: "FOR SELECT USING" },
        { name: "tenant_insert", cmd: "FOR INSERT WITH CHECK" },
        { name: "tenant_update", cmd: "FOR UPDATE USING" },
        { name: "tenant_delete", cmd: "FOR DELETE USING" },
      ];
      for (const p of defs) {
        await runPolicy(`${tbl} ${p.name} (uuid-safe, canonical)`, `
          DO $$ BEGIN
            EXECUTE 'DROP POLICY IF EXISTS ${p.name} ON public.${tbl}';
            EXECUTE 'CREATE POLICY ${p.name} ON public.${tbl} ${p.cmd}
              (org_id::text = current_setting(''app.current_org_id'', true))';
          END $$
        `);
      }
    }

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
      "public.ai_rate_limit_windows",
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

    // ── Billing-tables contract verification ────────────────────────────────────
    // The AI engine writes TEXT ids ('aul_…', 'amu_…', 'acp_…') and the quota
    // preflight selects these columns. Verify the FULL contract — every required
    // column exists with the required type, RLS is enabled, and each tenant
    // policy's actual predicate matches the canonical org_id::text form — and
    // throw otherwise so the caller can fail startup / gate AI endpoints.
    const problems: string[] = [];

    // 1) Required columns exist with the required type.
    const requiredCols: Array<{ table: string; column: string; types: string[] }> = [
      { table: "ai_credit_purchases", column: "id",                    types: ["text"] },
      { table: "ai_credit_purchases", column: "org_id",                types: ["text", "character varying", "uuid"] },
      { table: "ai_credit_purchases", column: "pack",                  types: ["text"] },
      { table: "ai_credit_purchases", column: "credits",               types: ["integer"] },
      { table: "ai_credit_purchases", column: "amount_eur_cents",      types: ["integer"] },
      { table: "ai_credit_purchases", column: "stripe_payment_intent", types: ["text"] },
      { table: "ai_monthly_usage",    column: "id",                    types: ["text"] },
      { table: "ai_monthly_usage",    column: "org_id",                types: ["text", "character varying", "uuid"] },
      { table: "ai_monthly_usage",    column: "month",                 types: ["text", "character varying"] },
      { table: "ai_monthly_usage",    column: "request_count",         types: ["integer"] },
      { table: "ai_monthly_usage",    column: "credits_limit",         types: ["integer"] },
      { table: "ai_monthly_usage",    column: "credits_extra",         types: ["integer"] },
      { table: "ai_usage_logs",       column: "id",                    types: ["text"] },
      { table: "ai_usage_logs",       column: "user_id",               types: ["text"] },
      { table: "ai_usage_logs",       column: "org_id",                types: ["text", "character varying", "uuid"] },
      { table: "ai_usage_logs",       column: "idempotency_key",       types: ["text"] },
    ];
    const colRes = await client.query<{ table_name: string; column_name: string; data_type: string }>(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name IN ('ai_credit_purchases','ai_monthly_usage','ai_usage_logs')
    `);
    const colType = new Map(colRes.rows.map(r => [`${r.table_name}.${r.column_name}`, r.data_type]));
    for (const rc of requiredCols) {
      const actual = colType.get(`${rc.table}.${rc.column}`);
      if (actual === undefined) {
        problems.push(`${rc.table}.${rc.column} missing`);
      } else if (!rc.types.includes(actual)) {
        problems.push(`${rc.table}.${rc.column} is ${actual}, expected ${rc.types.join("|")}`);
      }
    }

    // 2) RLS enabled on all three tables.
    const rlsRes = await client.query<{ relname: string; relrowsecurity: boolean }>(`
      SELECT c.relname, c.relrowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname='public'
        AND c.relname IN ('ai_credit_purchases','ai_monthly_usage','ai_usage_logs')
    `);
    for (const r of rlsRes.rows) {
      if (!r.relrowsecurity) problems.push(`${r.relname}: RLS not enabled`);
    }
    if (rlsRes.rows.length < 3) problems.push("one or more AI billing tables missing from pg_class");

    // 3) Each tenant policy exists AND its actual qual/with_check is canonical.
    //    Normalize whitespace; accept pg's ::text decoration on the GUC name.
    // pg deparses the stored predicate: TEXT org_id columns yield
    //   (org_id = current_setting('app.current_org_id'::text, true))
    // while uuid/varchar columns yield a parenthesized cast:
    //   ((org_id)::text = current_setting('app.current_org_id'::text, true))
    const canonical = /\(?\s*\(?org_id\)?\s*(::text)?\s*=\s*current_setting\('app\.current_org_id'(::text)?,\s*true\)/;
    const polRes = await client.query<{ tablename: string; policyname: string; qual: string | null; with_check: string | null }>(`
      SELECT tablename, policyname, qual, with_check
      FROM pg_policies
      WHERE schemaname='public'
        AND tablename IN ('ai_credit_purchases','ai_monthly_usage','ai_usage_logs')
        AND policyname IN ('tenant_select','tenant_insert','tenant_update','tenant_delete')
    `);
    const polMap = new Map(polRes.rows.map(r => [`${r.tablename}.${r.policyname}`, r]));
    for (const tbl of ["ai_credit_purchases", "ai_monthly_usage", "ai_usage_logs"]) {
      for (const pol of ["tenant_select", "tenant_insert", "tenant_update", "tenant_delete"]) {
        const row = polMap.get(`${tbl}.${pol}`);
        if (!row) { problems.push(`${tbl}.${pol} policy missing`); continue; }
        // INSERT policies carry the predicate in with_check; others in qual.
        const predicate = (pol === "tenant_insert" ? row.with_check : row.qual) ?? "";
        if (!canonical.test(predicate.replace(/\s+/g, " "))) {
          problems.push(`${tbl}.${pol} predicate non-canonical: ${predicate.slice(0, 120)}`);
        }
      }
    }

    if (problems.length > 0) {
      throw new Error(
        `${LOG} Post-migration contract check failed — ${problems.join("; ")}`
      );
    }

    aiMigrationComplete = true;
    logger.info(`${LOG} complete`);
  } finally {
    client.release();
  }
}
