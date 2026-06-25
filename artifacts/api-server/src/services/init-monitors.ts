import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export async function initMonitorsTables(): Promise<void> {
  const client = await pool.connect();
  try {
    // ── monitors ──────────────────────────────────────────────────────────────
    // Creates the table for new installs; for existing installs, ALTER TABLE
    // adds only the missing columns without touching existing data.
    await client.query(`
      CREATE TABLE IF NOT EXISTS monitors (
        id              TEXT PRIMARY KEY,
        org_id          TEXT NOT NULL DEFAULT 'default',
        name            TEXT NOT NULL,
        url             TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'up',
        uptime          REAL NOT NULL DEFAULT 100,
        latency         INTEGER NOT NULL DEFAULT 0,
        last_check      TEXT,
        alert_email     TEXT NOT NULL DEFAULT '',
        alert_phone     TEXT NOT NULL DEFAULT '',
        is_critical     BOOLEAN NOT NULL DEFAULT false,
        frequency       TEXT NOT NULL DEFAULT '5min',
        last_alert_sent BIGINT,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    // Add columns that may be missing on pre-existing tables
    await client.query(`
      ALTER TABLE monitors ADD COLUMN IF NOT EXISTS org_id      TEXT NOT NULL DEFAULT 'default';
      ALTER TABLE monitors ADD COLUMN IF NOT EXISTS alert_phone TEXT NOT NULL DEFAULT '';
      ALTER TABLE monitors ADD COLUMN IF NOT EXISTS is_critical BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE monitors ADD COLUMN IF NOT EXISTS updated_at  TIMESTAMP NOT NULL DEFAULT NOW();
    `);

    // ── monitor_checks ────────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS monitor_checks (
        id          TEXT PRIMARY KEY,
        monitor_id  TEXT NOT NULL,
        org_id      TEXT NOT NULL DEFAULT 'default',
        checked_at  BIGINT NOT NULL,
        ok          BOOLEAN NOT NULL,
        latency     INTEGER DEFAULT 0,
        status_code INTEGER,
        error       TEXT
      );
    `);

    // Add columns that may be missing on pre-existing tables
    await client.query(`
      ALTER TABLE monitor_checks ADD COLUMN IF NOT EXISTS org_id      TEXT NOT NULL DEFAULT 'default';
      ALTER TABLE monitor_checks ADD COLUMN IF NOT EXISTS status_code INTEGER;
      ALTER TABLE monitor_checks ADD COLUMN IF NOT EXISTS error       TEXT;
    `);

    // ── monitor_incidents ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS monitor_incidents (
        id          TEXT PRIMARY KEY,
        monitor_id  TEXT NOT NULL,
        org_id      TEXT NOT NULL DEFAULT 'default',
        started_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMP,
        duration_s  INTEGER,
        error       TEXT
      );
    `);

    // ── Indexes ───────────────────────────────────────────────────────────────
    await client.query(`
      CREATE INDEX IF NOT EXISTS monitors_org_id_idx
        ON monitors(org_id);

      CREATE INDEX IF NOT EXISTS monitor_checks_monitor_id_idx
        ON monitor_checks(monitor_id);

      CREATE INDEX IF NOT EXISTS monitor_checks_checked_at_idx
        ON monitor_checks(checked_at);

      CREATE INDEX IF NOT EXISTS monitor_incidents_monitor_id_idx
        ON monitor_incidents(monitor_id);

      CREATE INDEX IF NOT EXISTS monitor_incidents_started_at_idx
        ON monitor_incidents(started_at);
    `);

    logger.info("[init-monitors] monitors, monitor_checks, monitor_incidents tables ready");
  } catch (err) {
    logger.error({ err }, "[init-monitors] Table creation failed");
    throw err;
  } finally {
    client.release();
  }
}
