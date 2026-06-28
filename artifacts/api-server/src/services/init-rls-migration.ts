/**
 * init-rls-migration.ts
 *
 * Applies Row Level Security tenant isolation to every table that exists
 * in the public schema.  Runs automatically at server startup and is
 * fully idempotent — safe to re-execute on every boot.
 *
 * Sentinel check: if `audits.org_id` already exists the migration is
 * considered applied and the function returns immediately (~1 ms).
 *
 * Migration steps (only executed once):
 *  1. Add `org_id` (DEFAULT 'default') to tenant tables that are missing it
 *  2. Enable RLS on every public table
 *  3. Drop all existing policies (idempotent cleanup)
 *  4. Create 4 tenant isolation policies per table that has `org_id`
 *  5. Grant schema/table permissions to Supabase roles if they exist
 */

import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

const LOG = "[rls-migration]";

export async function runRlsMigrationIfNeeded(): Promise<void> {
  // ── Sentinel check ─────────────────────────────────────────────────────────
  // audits.org_id is added by this migration; its presence means we already ran.
  const sentinel = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'audits'
      AND column_name  = 'org_id'
    LIMIT 1
  `);
  if ((sentinel.rowCount ?? 0) > 0) {
    logger.info(`${LOG} Already applied — skipping`);
    return;
  }

  logger.info(`${LOG} Applying RLS tenant isolation to production database…`);

  const client = await pool.connect();
  let ok = 0;
  let fail = 0;

  const run = async (sql: string): Promise<void> => {
    try {
      await client.query(sql);
      ok++;
    } catch (e: any) {
      fail++;
      logger.warn({ err: e.message?.split("\n")[0] }, `${LOG} Non-fatal DDL error`);
    }
  };

  try {
    // ── 1. Discover existing tables ──────────────────────────────────────────
    const tablesRes = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    const exists = new Set(tablesRes.rows.map((r) => r.tablename));
    logger.info(`${LOG} Found ${exists.size} public tables`);

    // ── 2. Add org_id where missing ─────────────────────────────────────────
    const needsOrgId = [
      // ── Original tables ────────────────────────────────────────────────────
      "ai_credit_purchases", "ai_monthly_usage", "ai_usage_logs",
      "alert_events", "alert_rules", "audit_schedules", "audit_trail",
      "audits", "automation_integrations", "automation_logs", "automation_runs",
      "automation_templates", "automation_workflows",
      "calendar_events", "competitor_movements", "competitor_rankings",
      "competitors", "connectors", "cro_experiments", "cro_recommendations",
      "cro_scores", "crm_field_mappings", "gbp_locations", "google_tokens",
      "incoming_webhooks", "keyword_clusters", "keyword_history",
      "keyword_opportunities", "mission_ai_logs", "mission_history",
      "monitor_checks", "monitor_incidents", "monitor_logs", "monitors",
      "notifications", "oauth_connections", "org_addons", "org_settings",
      "ranking_alerts", "report_exports", "reports", "revenue_leaks",
      "seo_forecasts", "sla_reports", "subscriptions", "team_members",
      "team_messages", "tracked_keywords", "usage", "user_prefs",
      "user_sessions", "workflow_runs", "activity_logs",
      // ── Tables added after initial migration (migration 014 supplement) ───
      "ai_alerts", "ai_market_reports", "ai_setup_logs",
      "ai_workspace_profiles", "ai_chat_history", "ai_generated_missions",
      "billing_events",
      "bs_monitors", "bs_incidents", "bs_heartbeats", "bs_status_pages",
      "competitor_map_results",
      "crm_integrations", "crm_sync_logs", "crm_contacts", "crm_tokens", "crm_webhooks",
      "cron_history",
      "custom_domains",
      "dataforseo_quota",
      "ga4_properties",
      "gbp_posts", "gbp_post_queue", "gbp_media_assets",
      "github_connections", "github_analyses",
      "google_accounts", "google_locations", "google_oauth_states", "google_reviews",
      "gsc_sites", "gsc_keyword_data", "gsc_page_data", "gsc_sync_logs",
      "keywords",
      "local_heatmaps", "local_opportunities", "local_visibility_scores",
      "login_audits",
      "onboarding_sessions",
      "org_auth_config",
      "permission_logs",
      "psi_cache", "psi_history",
      "report_templates",
      "reputation_scores",
      "revenue_leaks",
      "review_alerts", "review_analysis",
      "roles",
      "seo_domain_metrics",
      "share_tokens",
      "sso_providers",
      "webhook_integrations",
      "worker_failures",
    ];
    for (const t of needsOrgId) {
      if (!exists.has(t)) continue;
      await run(
        `ALTER TABLE "${t}" ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default'`
      );
    }

    // ── 3. Enable RLS on every public table ──────────────────────────────────
    for (const t of exists) {
      await run(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
    }

    // ── 4. Drop all existing policies (idempotent cleanup) ───────────────────
    await run(`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN
          SELECT tablename, policyname
          FROM pg_policies
          WHERE schemaname = 'public'
        LOOP
          EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.policyname, r.tablename);
        END LOOP;
      END $$
    `);

    // ── 5. Discover tables that now have org_id ──────────────────────────────
    const orgIdRes = await client.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'org_id'
      ORDER BY table_name
    `);
    const tenantTables = orgIdRes.rows
      .map((r) => r.table_name)
      .filter((t) => exists.has(t));
    logger.info(`${LOG} Creating policies for ${tenantTables.length} tenant tables`);

    // ── 6. Create 4 tenant isolation policies per table ──────────────────────
    const GUC = `current_setting('app.current_org_id', true)`;
    for (const t of tenantTables) {
      await run(`CREATE POLICY "tenant_select" ON "${t}" FOR SELECT USING (org_id = ${GUC})`);
      await run(`CREATE POLICY "tenant_insert" ON "${t}" FOR INSERT WITH CHECK (org_id = ${GUC})`);
      await run(`CREATE POLICY "tenant_update" ON "${t}" FOR UPDATE USING (org_id = ${GUC})`);
      await run(`CREATE POLICY "tenant_delete" ON "${t}" FOR DELETE USING (org_id = ${GUC})`);
    }

    // ── 7. Grant Supabase role permissions if the roles exist ────────────────
    for (const role of ["anon", "authenticated", "service_role"]) {
      await run(`GRANT USAGE ON SCHEMA public TO "${role}"`);
    }
    await run(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon`);
    await run(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated`);
    await run(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role`);

    // ── Summary ──────────────────────────────────────────────────────────────
    const stateRes = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM pg_tables  WHERE schemaname='public' AND rowsecurity=true) AS rls_tables,
        (SELECT COUNT(*)::int FROM pg_policies WHERE schemaname='public')                     AS total_policies,
        (SELECT COUNT(*)::int FROM pg_tables  WHERE schemaname='public')                      AS total_tables
    `);
    const { rls_tables, total_policies, total_tables } = stateRes.rows[0] as Record<string, number>;
    logger.info(
      { rls_tables, total_policies, total_tables, ok_steps: ok, failed_steps: fail },
      `${LOG} Migration complete`
    );
  } finally {
    client.release();
  }
}
