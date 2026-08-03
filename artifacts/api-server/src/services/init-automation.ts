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
    // Ensure all columns exist on workflow_runs (table may predate schema changes)
    await client.query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS org_id          TEXT      NOT NULL DEFAULT 'default'`);
    await client.query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS status          TEXT      NOT NULL DEFAULT 'pending'`);
    await client.query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS started_at      TIMESTAMP DEFAULT NOW()`);
    await client.query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS completed_at    TIMESTAMP`);
    await client.query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS ended_at        TIMESTAMP`);
    await client.query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS duration_ms     INTEGER   DEFAULT 0`);
    await client.query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS steps_completed INTEGER   DEFAULT 0`);
    await client.query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS steps_failed    INTEGER   DEFAULT 0`);
    await client.query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS error           TEXT`);
    await client.query(`ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS output          JSONB`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_org ON workflow_runs(org_id)`);

    // ── automation_integrations — columns added at runtime ────────────────────
    const aiCols: Array<[string, string]> = [
      ["type",          "TEXT NOT NULL DEFAULT 'outgoing'"],
      ["name",          "TEXT NOT NULL DEFAULT 'Integration'"],
      ["platform",      "TEXT NOT NULL DEFAULT 'custom'"],
      ["endpoint_url",  "TEXT NOT NULL DEFAULT ''"],
      ["secret_key",    "TEXT"],
      ["events",        "JSONB DEFAULT '[]'"],
      ["headers",       "JSONB DEFAULT '{}'"],
      ["timeout_ms",    "INTEGER DEFAULT 10000"],
      ["max_retries",   "INTEGER DEFAULT 3"],
      ["retry_enabled", "BOOLEAN DEFAULT true"],
      ["active",        "BOOLEAN NOT NULL DEFAULT true"],
      ["success_count", "INTEGER DEFAULT 0"],
      ["failure_count", "INTEGER DEFAULT 0"],
      ["last_triggered","TIMESTAMP"],
      ["metadata",      "JSONB DEFAULT '{}'"],
      ["updated_at",    "TIMESTAMP DEFAULT NOW()"],
    ];
    for (const [col, def] of aiCols) {
      await client.query(`ALTER TABLE automation_integrations ADD COLUMN IF NOT EXISTS ${col} ${def}`);
    }
    await client.query(`CREATE INDEX IF NOT EXISTS idx_auto_intg_org_active ON automation_integrations(org_id, active)`);

    // ── automation_runs — add integration/event columns ───────────────────────
    const arCols: Array<[string, string]> = [
      ["integration_id", "TEXT"],
      ["event_type",     "TEXT"],
      ["payload",        "JSONB DEFAULT '{}'"],
      ["attempt",        "INTEGER DEFAULT 1"],
      ["triggered_at",   "TIMESTAMP DEFAULT NOW()"],
      ["http_status",    "INTEGER"],
    ];
    for (const [col, def] of arCols) {
      await client.query(`ALTER TABLE automation_runs ADD COLUMN IF NOT EXISTS ${col} ${def}`);
    }
    await client.query(`CREATE INDEX IF NOT EXISTS idx_auto_runs_intg ON automation_runs(integration_id) WHERE integration_id IS NOT NULL`);

    // ── automation_logs — delivery log metadata ───────────────────────────────
    await client.query(`ALTER TABLE automation_logs ADD COLUMN IF NOT EXISTS run_id TEXT`);
    await client.query(`ALTER TABLE automation_logs ADD COLUMN IF NOT EXISTS integration_id TEXT`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_auto_logs_org_created ON automation_logs(org_id, created_at DESC)`);

    // ── incoming_webhooks — add token/action columns ──────────────────────────
    const iwCols: Array<[string, string]> = [
      ["token",         "TEXT"],
      ["source",        "TEXT DEFAULT 'custom'"],
      ["action",        "TEXT DEFAULT 'log'"],
      ["action_config", "JSONB DEFAULT '{}'"],
      ["active",        "BOOLEAN NOT NULL DEFAULT true"],
    ];
    for (const [col, def] of iwCols) {
      await client.query(`ALTER TABLE incoming_webhooks ADD COLUMN IF NOT EXISTS ${col} ${def}`);
    }
    await client.query(`CREATE INDEX IF NOT EXISTS idx_incoming_wh_token ON incoming_webhooks(token) WHERE token IS NOT NULL`);

    logger.info("Automation tables initialized");
  } catch (err) {
    logger.error({ err }, "Failed to init automation tables");
    throw err;
  } finally {
    client.release();
  }
}
