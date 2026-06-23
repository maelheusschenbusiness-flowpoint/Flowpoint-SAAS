import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export async function initAutomationTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS automation_workflows (
        id              TEXT PRIMARY KEY,
        org_id          TEXT NOT NULL DEFAULT 'default',
        name            TEXT NOT NULL,
        icon            TEXT DEFAULT '⚡',
        description     TEXT,
        trigger_type    TEXT NOT NULL,
        trigger_config  JSONB DEFAULT '{}',
        actions         JSONB DEFAULT '[]',
        enabled         BOOLEAN NOT NULL DEFAULT true,
        runs_count      INTEGER NOT NULL DEFAULT 0,
        category        TEXT DEFAULT 'general',
        updated_at      TIMESTAMP DEFAULT NOW(),
        created_at      TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS workflow_runs (
        id            TEXT PRIMARY KEY,
        workflow_id   TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        started_at    TIMESTAMP DEFAULT NOW(),
        completed_at  TIMESTAMP,
        error         TEXT,
        output        JSONB
      );

      CREATE TABLE IF NOT EXISTS automation_runs (
        id           TEXT PRIMARY KEY,
        workflow_id  TEXT,
        org_id       TEXT NOT NULL DEFAULT 'default',
        trigger      TEXT,
        status       TEXT NOT NULL DEFAULT 'success',
        duration_ms  INTEGER DEFAULT 0,
        error        TEXT,
        output       JSONB DEFAULT '{}',
        created_at   TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS automation_logs (
        id           TEXT PRIMARY KEY,
        run_id       TEXT,
        workflow_id  TEXT,
        org_id       TEXT NOT NULL DEFAULT 'default',
        level        TEXT NOT NULL DEFAULT 'info',
        message      TEXT NOT NULL,
        metadata     JSONB DEFAULT '{}',
        created_at   TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS automation_integrations (
        id           TEXT PRIMARY KEY,
        org_id       TEXT NOT NULL DEFAULT 'default',
        provider     TEXT NOT NULL,
        label        TEXT,
        config       JSONB DEFAULT '{}',
        enabled      BOOLEAN NOT NULL DEFAULT true,
        created_at   TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS incoming_webhooks (
        id          TEXT PRIMARY KEY,
        org_id      TEXT NOT NULL DEFAULT 'default',
        name        TEXT NOT NULL,
        secret      TEXT NOT NULL,
        workflow_id TEXT,
        hits        INTEGER DEFAULT 0,
        last_hit    TIMESTAMP,
        created_at  TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_automation_workflows_org ON automation_workflows(org_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id ON workflow_runs(workflow_id);
      CREATE INDEX IF NOT EXISTS idx_automation_runs_org ON automation_runs(org_id);
    `);
    logger.info("Automation tables initialized");
  } catch (err) {
    logger.error("Failed to init automation tables", { err });
    throw err;
  } finally {
    client.release();
  }
}
