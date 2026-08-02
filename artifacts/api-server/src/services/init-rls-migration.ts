/**
 * init-rls-migration.ts  (v2 — per-table sentinel)
 *
 * Applies Row Level Security tenant isolation to every public table.
 * Called at server startup and by the standalone migrate.ts script.
 *
 * ── Sentinel fix (v2) ──────────────────────────────────────────────────────
 * v1 checked only `audits.rowsecurity = true`.  If audits already had RLS
 * from a previous partial run, the migration would silently exit and leave
 * all other tables unprotected — the root cause of 13 "RLS Disabled" alerts
 * in Supabase Advisor.
 *
 * v2 counts ALL public tables with rowsecurity = false.
 *   • 0 tables missing + all tenant policies present → exit in ~2 ms (no-op)
 *   • Any table missing RLS or policies → run only the affected steps
 *
 * ── How tenant isolation works ─────────────────────────────────────────────
 * dbContext → withOrgDb():
 *   1. BEGIN
 *   2. SET LOCAL ROLE app_user            (drops BYPASSRLS for this tx)
 *   3. SET LOCAL "app.current_org_id"     (GUC read by every policy below)
 *   4. run the query
 *   5. COMMIT
 *
 * Routes using pool.query() directly (share.ts, audit.ts PSI, google.ts)
 * run as the postgres superuser which bypasses RLS — those tables are always
 * accessible from the backend regardless of policy coverage.
 *
 * ── share_tokens — "Sensitive Columns Exposed" fix ─────────────────────────
 * Supabase Advisor flags `token` as a sensitive column on a table with no RLS.
 * Enabling the standard tenant_select policy means anon/authenticated can never
 * match the GUC (which is unset for direct client connections) so they see zero
 * rows.  The backend uses pool.query() (BYPASSRLS) and is unaffected.
 *
 * ── Fully idempotent ───────────────────────────────────────────────────────
 * Safe to run on every server boot — the sentinel makes subsequent runs a
 * ~2 ms no-op once every table is secured.
 */

import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

const LOG = "[rls-migration]";

/** GUC set by withOrgDb() inside every authenticated transaction. */
const GUC = `current_setting('app.current_org_id', true)`;

/**
 * Tables that must carry an org_id column for tenant isolation.
 * The migration adds the column (NOT NULL DEFAULT 'default') if missing.
 * Tables not listed here still get RLS enabled; no tenant policy is created
 * for them (deny-all for non-superuser roles — safe since they are only
 * accessed via pool.query which has BYPASSRLS).
 */
const NEEDS_ORG_ID: readonly string[] = [
  // ── Core SaaS tables ──────────────────────────────────────────────────────
  "ai_credit_purchases", "ai_monthly_usage", "ai_usage_logs",
  "alert_events", "alert_rules", "audit_schedules", "audit_trail",
  "audits", "automation_integrations", "automation_logs", "automation_runs",
  "automation_templates", "automation_workflows",
  "calendar_events", "competitor_movements", "competitor_rankings",
  "competitors", "connectors", "cro_experiments", "cro_recommendations",
  "cro_scores", "crm_field_mappings", "gbp_locations", "google_tokens",
  "growth_objectives",
  "incoming_webhooks", "keyword_clusters", "keyword_history",
  "keyword_opportunities", "mission_ai_logs", "mission_history", "missions",
  "monitor_checks", "monitor_incidents", "monitor_logs", "monitors",
  "notifications", "oauth_connections", "org_addons", "org_settings",
  "ranking_alerts", "report_exports", "reports", "revenue_leaks",
  "seo_forecasts", "sla_reports", "subscriptions", "team_members",
  "team_messages", "tracked_keywords", "usage", "user_prefs",
  "user_sessions", "workflow_runs", "activity_logs",
  // ── Extended / later-added tables ────────────────────────────────────────
  "ai_alerts", "ai_market_reports", "ai_setup_logs",
  "ai_workspace_profiles", "ai_chat_history", "ai_generated_missions",
  "billing_events",
  "bs_monitors", "bs_incidents", "bs_heartbeats", "bs_status_pages",
  "competitor_map_results",
  "crm_integrations", "crm_sync_logs", "crm_contacts", "crm_tokens", "crm_webhooks",
  "cron_history", "custom_domains", "dataforseo_quota",
  "ga4_properties",
  "gbp_posts", "gbp_post_queue", "gbp_media_assets",
  "github_connections", "github_analyses",
  "google_accounts", "google_locations", "google_oauth_states", "google_reviews",
  "gsc_sites", "gsc_keyword_data", "gsc_page_data", "gsc_sync_logs",
  "keywords",
  "local_heatmaps", "local_opportunities", "local_visibility_scores",
  "login_audits", "onboarding_sessions", "org_auth_config", "permission_logs",
  "psi_cache", "psi_history", "report_templates", "reputation_scores",
  "review_alerts", "review_analysis", "roles", "seo_domain_metrics",
  "share_tokens",
  "sso_providers", "webhook_integrations", "worker_failures",
  // api_keys — sensitive table; included here so org_id is ensured + tenant policies applied
  "api_keys",
];

const NEEDS_ORG_ID_SET = new Set(NEEDS_ORG_ID);

/**
 * Tables that are backend-only (no PostgREST/client access).
 * RLS is ENABLED + FORCED with NO public policies → implicit deny-all for
 * anon/authenticated roles.  The superuser pool (BYPASSRLS) is unaffected.
 *
 * These tables either contain sensitive tokens (pending_signups.token,
 * checkout_post_tokens.token_hash) or use a non-standard tenant key
 * (organization_members uses organization_id, not org_id) and are handled
 * separately by their own init files.
 *
 * Adding them here ensures the catch-all loop in runRlsMigrationIfNeeded()
 * also applies FORCE RLS on every boot, making the deny-all explicit and
 * visible in Supabase Advisor as "protected, no client policies".
 */
const BACKEND_ONLY_TABLES: readonly string[] = [
  "pending_signups",
  "checkout_post_tokens",
  // schema_migrations is infrastructure — never accessible to anon/authenticated.
  // ENABLE RLS with no public policies = implicit deny-all for client roles.
  // init-data-tables.ts also enables RLS inline so it activates on first boot.
  "schema_migrations",
];

export async function runRlsMigrationIfNeeded(): Promise<void> {
  // ── Fast sentinel (v2) ──────────────────────────────────────────────────────
  // Step 1: count tables with rowsecurity = false
  const sentinelRes = await pool.query<{ missing: number }>(`
    SELECT COUNT(*)::int AS missing
    FROM pg_tables
    WHERE schemaname = 'public' AND rowsecurity = false
  `);
  const missingRls = Number(sentinelRes.rows[0]?.missing ?? 0);

  // Step 2: even if all have RLS, check that tenant tables have 4 policies each
  //          AND have FORCE ROW LEVEL SECURITY (required for BYPASSRLS connections).
  let policyGaps = 0;
  let forceGaps  = 0;
  if (missingRls === 0) {
    const gapRes = await pool.query<{ gaps: number; force_gaps: number }>(`
      SELECT
        (SELECT COUNT(*)::int
         FROM (
           SELECT t.tablename
           FROM pg_tables t
           WHERE t.schemaname = 'public'
             AND t.rowsecurity = true
             AND EXISTS (
               SELECT 1 FROM information_schema.columns c
               WHERE c.table_schema = 'public'
                 AND c.table_name   = t.tablename
                 AND c.column_name  = 'org_id'
             )
             AND (
               SELECT COUNT(*) FROM pg_policies p
               WHERE p.schemaname = 'public'
                 AND p.tablename  = t.tablename
                 AND p.policyname LIKE 'tenant_%'
             ) < 4
         ) g
        ) AS gaps,
        (SELECT COUNT(*)::int
         FROM pg_tables t
         JOIN pg_class  c ON c.relname = t.tablename
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE t.schemaname = 'public'
           AND n.nspname    = 'public'
           AND c.relkind    = 'r'
           AND t.rowsecurity = true
           AND c.relforcerowsecurity = false
           AND EXISTS (
             SELECT 1 FROM information_schema.columns ic
             WHERE ic.table_schema = 'public'
               AND ic.table_name   = t.tablename
               AND ic.column_name  = 'org_id'
           )
        ) AS force_gaps
    `);
    policyGaps = Number(gapRes.rows[0]?.gaps ?? 0);
    forceGaps  = Number(gapRes.rows[0]?.force_gaps ?? 0);
  }

  if (missingRls === 0 && policyGaps === 0 && forceGaps === 0) {
    logger.info(`${LOG} All public tables have RLS + FORCE + tenant policies — no migration needed`);
    return;
  }

  if (missingRls > 0) {
    logger.info(`${LOG} ${missingRls} public table(s) with RLS disabled — applying migration…`);
  } else {
    logger.info(`${LOG} RLS enabled everywhere but ${policyGaps} tenant table(s) lack full policies — patching`);
  }

  const client = await pool.connect();
  let ok = 0;
  let fail = 0;

  const run = async (sql: string): Promise<void> => {
    try {
      await client.query(sql);
      ok++;
    } catch (e: any) {
      fail++;
      logger.warn({ err: e.message?.split("\n")[0] }, `${LOG} Non-fatal DDL`);
    }
  };

  try {
    // ── 1. Snapshot: all existing tables + their current RLS state ───────────
    const tablesRes = await client.query<{ tablename: string; rowsecurity: boolean }>(`
      SELECT tablename, rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    const allTables = new Map<string, boolean>(
      tablesRes.rows.map((r) => [r.tablename, r.rowsecurity])
    );
    logger.info(`${LOG} Found ${allTables.size} public tables (${missingRls} without RLS)`);

    // ── 2. Snapshot: tables that already have the org_id column ─────────────
    const orgIdRes = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'org_id'
      ORDER BY table_name
    `);
    const tablesWithOrgId = new Set<string>(orgIdRes.rows.map((r) => r.table_name));

    // ── 3. Add org_id where missing ──────────────────────────────────────────
    let orgIdAdded = 0;
    for (const t of NEEDS_ORG_ID) {
      if (!allTables.has(t)) continue;       // table not yet created → skip
      if (tablesWithOrgId.has(t)) continue;  // already has org_id → skip
      await run(
        `ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default'`
      );
      tablesWithOrgId.add(t);
      orgIdAdded++;
    }
    if (orgIdAdded > 0) {
      logger.info(`${LOG} Added org_id to ${orgIdAdded} table(s)`);
    }

    // ── 4. Enable RLS on every table still missing it ────────────────────────
    // ── 4b. FORCE RLS on every tenant-isolated table ─────────────────────────
    //
    // FORCE ROW LEVEL SECURITY forces policies to apply to the TABLE OWNER even
    // when the owner is not a superuser (defense-in-depth for non-Render setups).
    // NOTE: PostgreSQL superusers (rolsuper=t) and BYPASSRLS roles ALWAYS bypass
    // RLS regardless of FORCE — FORCE has no effect on them.  The real isolation
    // for the postgres/Render connection is withOrgDb → SET LOCAL ROLE app_user,
    // which drops superuser privileges for the duration of each transaction.
    //
    // Idempotent: ALTER TABLE … FORCE ROW LEVEL SECURITY is a no-op if already set.
    const forcedRes = await client.query<{ tablename: string }>(`
      SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relforcerowsecurity = true
    `);
    const alreadyForced = new Set<string>(forcedRes.rows.map(r => r.tablename));

    const backendOnlySet = new Set(BACKEND_ONLY_TABLES);

    let rlsEnabled = 0;
    let rlsForced  = 0;
    for (const [t, hasRls] of allTables) {
      if (!hasRls) {
        await run(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
        rlsEnabled++;
      }
      // Apply FORCE to every tenant-isolated table (has org_id).
      if (tablesWithOrgId.has(t) && !alreadyForced.has(t)) {
        await run(`ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY`);
        rlsForced++;
      }
      // Apply FORCE to backend-only tables (deny-all for anon/authenticated).
      // These have no org_id but still need FORCE so no future policy can slip through.
      if (backendOnlySet.has(t) && !alreadyForced.has(t)) {
        await run(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
        await run(`ALTER TABLE "${t}" FORCE ROW LEVEL SECURITY`);
        rlsForced++;
      }
    }
    if (rlsEnabled > 0) {
      logger.info(`${LOG} Enabled RLS on ${rlsEnabled} table(s)`);
    }
    if (rlsForced > 0) {
      logger.info(`${LOG} Applied FORCE ROW LEVEL SECURITY to ${rlsForced} tenant/backend-only table(s)`);
    }

    // ── 5. Snapshot: existing tenant_* policy counts per table ───────────────
    const policyRes = await client.query<{ tablename: string; cnt: number }>(`
      SELECT tablename, COUNT(*)::int AS cnt
      FROM pg_policies
      WHERE schemaname = 'public' AND policyname LIKE 'tenant_%'
      GROUP BY tablename
    `);
    const policyCount = new Map<string, number>(
      policyRes.rows.map((r) => [r.tablename, r.cnt])
    );

    // ── 6. (Re)create tenant isolation policies where needed ─────────────────
    // A table needs policy work when it:
    //   a) just had RLS enabled (was rowsecurity=false), or
    //   b) has fewer than 4 tenant_* policies
    let policiesFixed = 0;
    for (const t of allTables.keys()) {
      if (!tablesWithOrgId.has(t)) continue;                // no org_id → skip
      const wasRlsMissing  = !(allTables.get(t) ?? true);   // true if was disabled
      const existingPols   = policyCount.get(t) ?? 0;
      if (!wasRlsMissing && existingPols >= 4) continue;    // already correct → skip

      // Drop any stale tenant_* policies before recreating
      for (const op of ["select", "insert", "update", "delete"]) {
        await run(`DROP POLICY IF EXISTS "tenant_${op}" ON "${t}"`);
      }

      // COALESCE handles nullable org_id columns (share_tokens, report_exports, etc.)
      // org_id::text cast is defensive for any non-text org_id variants.
      const ORG = `COALESCE(org_id::text, 'default')`;
      await run(`CREATE POLICY "tenant_select" ON "${t}" FOR SELECT USING     (${ORG} = ${GUC})`);
      await run(`CREATE POLICY "tenant_insert" ON "${t}" FOR INSERT WITH CHECK (${ORG} = ${GUC})`);
      await run(`CREATE POLICY "tenant_update" ON "${t}" FOR UPDATE USING     (${ORG} = ${GUC})`);
      await run(`CREATE POLICY "tenant_delete" ON "${t}" FOR DELETE USING     (${ORG} = ${GUC})`);
      policiesFixed++;
    }
    if (policiesFixed > 0) {
      logger.info(`${LOG} (Re)created 4 tenant policies for ${policiesFixed} table(s)`);
    }

    // ── 7. Grant Supabase role permissions ───────────────────────────────────
    // service_role has BYPASSRLS in Supabase but still needs table-level grants
    // for PostgREST to proxy requests.
    // authenticated is subject to RLS tenant policies.
    // anon gets SELECT-only; all rows denied by unset GUC (no matching org_id).
    for (const role of ["anon", "authenticated", "service_role"]) {
      await run(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    }
    await run(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role`);
    await run(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated`);
    await run(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon`);
    await run(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated`);
    await run(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role`);

    // ── 8. Security audit — 13 sensitive tables ──────────────────────────────
    // Log [SECURITY] warnings for any sensitive table that:
    //   (a) does not have RLS enabled
    //   (b) has a policy with USING (true) — open anonymous access
    //   (c) is a tenant table with fewer than 4 tenant_* policies
    //   (d) is a backend-only table with any client-facing policies
    // Does NOT crash the server; gaps are visible in logs and fixed next boot.
    const SENSITIVE_TABLES = [
      // Core identity & billing (tenant-keyed via org_id)
      "users", "organizations", "subscriptions", "billing",
      "reports", "monitors", "audits", "notifications", "activity_logs",
      // Uses organization_id key — handled by init-phase1-users.ts
      "organization_members",
      // Backend-only (no client policies)
      "pending_signups", "checkout_post_tokens",
      // api_keys — verified below; added to NEEDS_ORG_ID if org_id present
      "api_keys",
    ];

    const auditRes = await client.query<{
      tablename: string;
      rowsecurity: boolean;
      open_policies: number;
      tenant_policies: number;
    }>(`
      SELECT
        t.tablename,
        t.rowsecurity,
        COALESCE((
          SELECT COUNT(*)::int FROM pg_policies p
          WHERE p.schemaname = 'public'
            AND p.tablename  = t.tablename
            AND p.qual       = 'true'
        ), 0) AS open_policies,
        COALESCE((
          SELECT COUNT(*)::int FROM pg_policies p
          WHERE p.schemaname = 'public'
            AND p.tablename  = t.tablename
            AND p.policyname LIKE 'tenant_%'
        ), 0) AS tenant_policies
      FROM pg_tables t
      WHERE t.schemaname = 'public'
        AND t.tablename  = ANY($1)
    `, [SENSITIVE_TABLES]);

    for (const row of auditRes.rows) {
      const isBackendOnly = backendOnlySet.has(row.tablename);
      if (!row.rowsecurity) {
        logger.warn(`[SECURITY] ${row.tablename}: RLS NOT ENABLED — table is unprotected`);
      }
      if (row.open_policies > 0) {
        logger.warn(`[SECURITY] ${row.tablename}: has ${row.open_policies} open policy(ies) with USING(true) — anon access possible`);
      }
      if (!isBackendOnly && row.tablename !== "organization_members"
          && allTables.has(row.tablename) && tablesWithOrgId.has(row.tablename)
          && row.tenant_policies < 4) {
        logger.warn(`[SECURITY] ${row.tablename}: only ${row.tenant_policies}/4 tenant policies present`);
      }
      if (isBackendOnly && row.tenant_policies > 0) {
        logger.warn(`[SECURITY] ${row.tablename}: backend-only table has ${row.tenant_policies} client-facing policy(ies) — unexpected`);
      }
    }
    // Log any sensitive table not yet created (expected on fresh DBs)
    const auditFound = new Set(auditRes.rows.map(r => r.tablename));
    for (const t of SENSITIVE_TABLES) {
      if (!allTables.has(t) && !auditFound.has(t)) {
        logger.info(`${LOG} [SECURITY-INFO] ${t}: not yet created — will be audited after first creation`);
      }
    }

    // ── Summary ──────────────────────────────────────────────────────────────
    const stateRes = await client.query<Record<string, number>>(`
      SELECT
        (SELECT COUNT(*)::int FROM pg_tables   WHERE schemaname='public' AND rowsecurity=true)  AS rls_tables,
        (SELECT COUNT(*)::int FROM pg_tables   WHERE schemaname='public' AND rowsecurity=false) AS still_missing,
        (SELECT COUNT(*)::int FROM pg_policies  WHERE schemaname='public')                      AS total_policies,
        (SELECT COUNT(*)::int FROM pg_tables   WHERE schemaname='public')                       AS total_tables
    `);
    const s = stateRes.rows[0]!;
    logger.info(
      {
        rls_tables:    s.rls_tables,
        total_tables:  s.total_tables,
        still_missing: s.still_missing,
        policies:      s.total_policies,
        ok_steps:      ok,
        failed_steps:  fail,
      },
      `${LOG} Migration complete — ${s.rls_tables}/${s.total_tables} tables secured, ` +
      `${s.total_policies} policies active` +
      (s.still_missing > 0
        ? ` ⚠ ${s.still_missing} table(s) still unprotected (see DDL errors above)`
        : " ✓ all tables secured")
    );
  } finally {
    client.release();
  }
}
