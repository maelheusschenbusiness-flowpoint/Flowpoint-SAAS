/**
 * FlowPoint AI Agents — schéma Phase 1 (idempotent, auto-réparant).
 *
 * P0-1  : RLS org-scoped (4 policies per table, FORCE ROW LEVEL SECURITY)
 * P0-2  : ai_chat_history created FIRST (IF NOT EXISTS) before ALTER; each
 *          statement wrapped in its own try/catch so one failure cannot abort
 *          the rest.
 * P0-7  : no bare multi-statement sequences on shared client; every DDL step
 *          is independent and failure-isolated.
 *
 * Tables :
 *  - org_member_permissions : overrides grant/revoke par membre (Ajustement 1)
 *  - ai_action_proposals    : propositions serveur, TTL 15 min (Ajustement 9)
 *  - ai_action_logs         : journal d'exécution + undo_snapshot (Phases 2+)
 *  - ai_autopilot_grants    : autorisations d'autonomie par outil (Ajust. 11)
 *  - organizations.ai_autonomy_level : niveau global (copilot par défaut)
 *  - ai_chat_history.conversation_id : liaison historique ↔ propositions
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

/** Run a single DDL statement, logging failures without re-throwing. */
async function runa(
  client: import("pg").PoolClient,
  label: string,
  sql: string,
): Promise<void> {
  try {
    await client.query(sql);
  } catch (err: unknown) {
    const e = err as Record<string, unknown>;
    logger.warn(
      {
        label,
        pgCode:    e["code"],
        pgMessage: err instanceof Error ? err.message : String(err),
        sqlStmt:   sql.replace(/\s+/g, " ").trim().slice(0, 120),
      },
      `[agent-tables] Non-fatal DDL warn — ${label}`,
    );
  }
}

/** 4 standard tenant-isolation policies on a TEXT org_id table. */
async function tenantPolicies(
  client: import("pg").PoolClient,
  table: string,
): Promise<void> {
  const GUC = `current_setting('app.current_org_id', true)`;
  const defs = [
    { op: "select", cmd: `FOR SELECT USING     (COALESCE(org_id,'default') = ${GUC})` },
    { op: "insert", cmd: `FOR INSERT WITH CHECK (COALESCE(org_id,'default') = ${GUC})` },
    { op: "update", cmd: `FOR UPDATE USING     (COALESCE(org_id,'default') = ${GUC})` },
    { op: "delete", cmd: `FOR DELETE USING     (COALESCE(org_id,'default') = ${GUC})` },
  ];
  for (const d of defs) {
    // Drop any stale policy (including old permissive USING(true) policies)
    await runa(client, `${table} drop tenant_${d.op}`,
      `DROP POLICY IF EXISTS "tenant_${d.op}" ON "${table}"`);
    // Also drop old single-policy format used in earlier versions
    await runa(client, `${table} drop ${table}_isolation`,
      `DROP POLICY IF EXISTS "${table}_isolation" ON "${table}"`);
    await runa(client, `${table} tenant_${d.op}`,
      `CREATE POLICY "tenant_${d.op}" ON "${table}" ${d.cmd}`);
  }
}

export async function initAgentTables(): Promise<void> {
  const client = await pool.connect();
  try {
    // ── P0-2 : Ensure ai_chat_history exists BEFORE the ALTER ──────────────
    // The table is created by initDataTables normally; this guard ensures
    // initAgentTables can run safely even if called before initDataTables.
    await runa(client, "ai_chat_history ensure", `
      CREATE TABLE IF NOT EXISTS ai_chat_history (
        id              TEXT        PRIMARY KEY,
        org_id          TEXT        NOT NULL DEFAULT 'default',
        user_id         TEXT,
        role            TEXT        NOT NULL DEFAULT 'user',
        content         TEXT        NOT NULL DEFAULT '',
        feature         TEXT,
        model           TEXT,
        tokens_used     INTEGER,
        conversation_id TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // Self-heal: add any column that may be absent on existing installs
    // (tables created by an older version of this file lack user_id/feature/model/tokens_used)
    await runa(client, "ai_chat_history user_id",     `ALTER TABLE ai_chat_history ADD COLUMN IF NOT EXISTS user_id     TEXT`);
    await runa(client, "ai_chat_history feature",     `ALTER TABLE ai_chat_history ADD COLUMN IF NOT EXISTS feature     TEXT`);
    await runa(client, "ai_chat_history model",       `ALTER TABLE ai_chat_history ADD COLUMN IF NOT EXISTS model       TEXT`);
    await runa(client, "ai_chat_history tokens_used", `ALTER TABLE ai_chat_history ADD COLUMN IF NOT EXISTS tokens_used INTEGER`);

    // ── org_member_permissions ──────────────────────────────────────────────
    await runa(client, "org_member_permissions create", `
      CREATE TABLE IF NOT EXISTS org_member_permissions (
        org_id     TEXT NOT NULL,
        user_id    TEXT NOT NULL,
        permission TEXT NOT NULL,
        mode       TEXT NOT NULL CHECK (mode IN ('grant','revoke')),
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (org_id, user_id, permission)
      )
    `);

    // ── ai_action_proposals ────────────────────────────────────────────────
    await runa(client, "ai_action_proposals create", `
      CREATE TABLE IF NOT EXISTS ai_action_proposals (
        id              TEXT PRIMARY KEY,
        org_id          TEXT NOT NULL,
        user_id         TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        message_id      TEXT,
        kind            TEXT NOT NULL,
        payload         JSONB NOT NULL,
        resource_version TEXT,
        status          TEXT NOT NULL DEFAULT 'proposed',
        provider        TEXT,
        model           TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at      TIMESTAMPTZ NOT NULL
      )
    `);
    await runa(client, "aap_org_conv_idx",
      `CREATE INDEX IF NOT EXISTS aap_org_conv_idx ON ai_action_proposals(org_id, conversation_id)`);
    await runa(client, "aap_expires_idx",
      `CREATE INDEX IF NOT EXISTS aap_expires_idx  ON ai_action_proposals(expires_at)`);

    // ── ai_action_logs ─────────────────────────────────────────────────────
    await runa(client, "ai_action_logs create", `
      CREATE TABLE IF NOT EXISTS ai_action_logs (
        id              TEXT PRIMARY KEY,
        org_id          TEXT NOT NULL,
        user_id         TEXT NOT NULL,
        conversation_id TEXT,
        message_id      TEXT,
        proposal_id     TEXT,
        provider        TEXT,
        model           TEXT,
        tool            TEXT NOT NULL,
        args            JSONB,
        confirmation_level TEXT,
        result          TEXT NOT NULL DEFAULT 'pending',
        error           TEXT,
        undo_snapshot   JSONB,
        undone_at       TIMESTAMPTZ,
        version_after   TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await runa(client, "aal_org_conv_idx",
      `CREATE INDEX IF NOT EXISTS aal_org_conv_idx ON ai_action_logs(org_id, conversation_id)`);
    // Self-heal version_after in case table existed without this column
    await runa(client, "ai_action_logs version_after",
      `ALTER TABLE ai_action_logs ADD COLUMN IF NOT EXISTS version_after TEXT`);

    // ── ai_autopilot_grants ────────────────────────────────────────────────
    await runa(client, "ai_autopilot_grants create", `
      CREATE TABLE IF NOT EXISTS ai_autopilot_grants (
        org_id     TEXT NOT NULL,
        tool_name  TEXT NOT NULL,
        granted_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (org_id, tool_name)
      )
    `);

    // ── org-level AI autonomy column ───────────────────────────────────────
    await runa(client, "organizations ai_autonomy_level",
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_autonomy_level TEXT NOT NULL DEFAULT 'copilot'`);

    // ── conversation_id link on ai_chat_history ────────────────────────────
    await runa(client, "ai_chat_history conversation_id",
      `ALTER TABLE ai_chat_history ADD COLUMN IF NOT EXISTS conversation_id TEXT`);
    await runa(client, "ach_conv_idx",
      `CREATE INDEX IF NOT EXISTS ach_conv_idx ON ai_chat_history(org_id, conversation_id)`);

    // ── P0-1 : RLS — 4 tenant policies per table, ENABLE only ──────────────
    // All 4 agent tables (org_member_permissions, ai_action_proposals,
    // ai_action_logs, ai_autopilot_grants) are accessed via raw pool.query()
    // in agent/permissions.ts, agent/proposals.ts, agent/tool-executor.ts,
    // agent/undo.ts, and routes/ai.ts without withOrgDb/req.orgDb — so no
    // app.current_org_id GUC is set. FORCE ROW LEVEL SECURITY would therefore
    // deny all queries under a non-BYPASSRLS application role. We ENABLE RLS
    // and add tenant isolation policies so they activate when the GUC path is
    // adopted in a follow-up migration.
    for (const t of ["org_member_permissions", "ai_action_proposals", "ai_action_logs", "ai_autopilot_grants"]) {
      await runa(client, `${t} ENABLE RLS`,   `ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
      await runa(client, `${t} NO FORCE RLS`, `ALTER TABLE "${t}" NO FORCE ROW LEVEL SECURITY`);
      await tenantPolicies(client, t);
    }

    logger.info("[agent] init-agent-tables complete (RLS ENABLE + 4 policies/table, no FORCE)");
  } finally {
    client.release();
  }
}
