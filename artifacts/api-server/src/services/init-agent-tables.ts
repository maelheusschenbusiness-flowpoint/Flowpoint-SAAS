/**
 * FlowPoint AI Agents — schéma Phase 1 (idempotent, auto-réparant).
 *
 * Tables :
 *  - org_member_permissions : overrides grant/revoke par membre (Ajustement 1)
 *  - ai_action_proposals    : propositions serveur, TTL 15 min (Ajustement 9)
 *  - ai_action_logs         : journal d'exécution + undo_snapshot (Phases 2+, créé dès la Phase 1)
 *  - ai_autopilot_grants    : autorisations d'autonomie par outil (Ajustement 11 — préparé, non activé)
 *  - organizations.ai_autonomy_level : niveau global (copilot par défaut)
 *  - ai_chat_history.conversation_id : liaison historique ↔ propositions (Ajustement 10)
 *
 * Pattern init-data-tables : IF NOT EXISTS partout, RLS org_id, exécuté au boot
 * (fast-path ET full init) — jamais de migration SQL brute (leçon prod Render).
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export async function initAgentTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
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

    await client.query(`
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
    await client.query(`CREATE INDEX IF NOT EXISTS aap_org_conv_idx ON ai_action_proposals(org_id, conversation_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS aap_expires_idx  ON ai_action_proposals(expires_at)`);

    await client.query(`
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
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS aal_org_conv_idx ON ai_action_logs(org_id, conversation_id)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ai_autopilot_grants (
        org_id     TEXT NOT NULL,
        tool_name  TEXT NOT NULL,
        granted_by TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (org_id, tool_name)
      )
    `);

    // Niveau d'autonomie global — préparé dès la Phase 1, valeur unique 'copilot'
    await client.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ai_autonomy_level TEXT NOT NULL DEFAULT 'copilot'`).catch(() => {});

    // Liaison historique chat ↔ conversations
    await client.query(`ALTER TABLE ai_chat_history ADD COLUMN IF NOT EXISTS conversation_id TEXT`);
    await client.query(`CREATE INDEX IF NOT EXISTS ach_conv_idx ON ai_chat_history(org_id, conversation_id)`);

    // ── RLS : isolation org sur toutes les tables agent ─────────────────────
    for (const t of ["org_member_permissions", "ai_action_proposals", "ai_action_logs", "ai_autopilot_grants"]) {
      await client.query(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`);
      await client.query(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`);
      await client.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = '${t}' AND policyname = '${t}_isolation') THEN
            CREATE POLICY ${t}_isolation ON ${t}
              USING (org_id = current_setting('app.current_org_id', true));
          END IF;
        END $$;
      `);
    }

    logger.info("[agent] init-agent-tables complete");
  } finally {
    client.release();
  }
}
