import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export async function initMonitorsTables(): Promise<void> {
  const client = await pool.connect();
  try {
    // ── 1. monitors ───────────────────────────────────────────────────────────
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

    // Each column separately — one failure won't abort the rest
    await client.query(`ALTER TABLE monitors ADD COLUMN IF NOT EXISTS org_id          TEXT NOT NULL DEFAULT 'default';`);
    await client.query(`ALTER TABLE monitors ADD COLUMN IF NOT EXISTS alert_phone     TEXT NOT NULL DEFAULT '';`);
    await client.query(`ALTER TABLE monitors ADD COLUMN IF NOT EXISTS is_critical     BOOLEAN NOT NULL DEFAULT false;`);
    await client.query(`ALTER TABLE monitors ADD COLUMN IF NOT EXISTS frequency       TEXT NOT NULL DEFAULT '5min';`);
    await client.query(`ALTER TABLE monitors ADD COLUMN IF NOT EXISTS last_alert_sent BIGINT;`);
    await client.query(`ALTER TABLE monitors ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMP NOT NULL DEFAULT NOW();`);
    await client.query(`ALTER TABLE monitors ADD COLUMN IF NOT EXISTS created_at      TIMESTAMP NOT NULL DEFAULT NOW();`);

    // ── 2. monitor_checks ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS monitor_checks (
        id          TEXT PRIMARY KEY,
        monitor_id  TEXT NOT NULL DEFAULT '',
        org_id      TEXT NOT NULL DEFAULT 'default',
        checked_at  BIGINT NOT NULL DEFAULT 0,
        ok          BOOLEAN NOT NULL DEFAULT true,
        latency     INTEGER DEFAULT 0,
        status_code INTEGER,
        error       TEXT
      );
    `);

    // Guarantee every column exists on pre-existing tables
    await client.query(`ALTER TABLE monitor_checks ADD COLUMN IF NOT EXISTS monitor_id  TEXT NOT NULL DEFAULT '';`);
    await client.query(`ALTER TABLE monitor_checks ADD COLUMN IF NOT EXISTS org_id      TEXT NOT NULL DEFAULT 'default';`);
    await client.query(`ALTER TABLE monitor_checks ADD COLUMN IF NOT EXISTS checked_at  BIGINT NOT NULL DEFAULT 0;`);
    await client.query(`ALTER TABLE monitor_checks ADD COLUMN IF NOT EXISTS ok          BOOLEAN NOT NULL DEFAULT true;`);
    await client.query(`ALTER TABLE monitor_checks ADD COLUMN IF NOT EXISTS latency     INTEGER DEFAULT 0;`);
    await client.query(`ALTER TABLE monitor_checks ADD COLUMN IF NOT EXISTS status_code INTEGER;`);
    await client.query(`ALTER TABLE monitor_checks ADD COLUMN IF NOT EXISTS error       TEXT;`);

    // Migrate camelCase → snake_case (older deployments may have used camelCase)
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitor_checks' AND column_name='monitorid')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitor_checks' AND column_name='monitor_id')
        THEN
          ALTER TABLE monitor_checks ADD COLUMN monitor_id TEXT NOT NULL DEFAULT '';
          UPDATE monitor_checks SET monitor_id = "monitorId";
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitor_checks' AND column_name='checkedat')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitor_checks' AND column_name='checked_at')
        THEN
          ALTER TABLE monitor_checks ADD COLUMN checked_at BIGINT NOT NULL DEFAULT 0;
          UPDATE monitor_checks SET checked_at = "checkedAt";
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitor_checks' AND column_name='createdat')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitor_checks' AND column_name='created_at')
        THEN
          ALTER TABLE monitor_checks ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT NOW();
          UPDATE monitor_checks SET created_at = "createdAt";
        END IF;
      END $$;
    `);

    // ── 3. monitor_incidents ──────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS monitor_incidents (
        id          TEXT PRIMARY KEY,
        monitor_id  TEXT NOT NULL DEFAULT '',
        org_id      TEXT NOT NULL DEFAULT 'default',
        started_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        resolved_at TIMESTAMP,
        duration_s  INTEGER,
        error       TEXT
      );
    `);

    await client.query(`ALTER TABLE monitor_incidents ADD COLUMN IF NOT EXISTS monitor_id  TEXT NOT NULL DEFAULT '';`);
    await client.query(`ALTER TABLE monitor_incidents ADD COLUMN IF NOT EXISTS org_id      TEXT NOT NULL DEFAULT 'default';`);
    await client.query(`ALTER TABLE monitor_incidents ADD COLUMN IF NOT EXISTS started_at  TIMESTAMP NOT NULL DEFAULT NOW();`);
    await client.query(`ALTER TABLE monitor_incidents ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;`);
    await client.query(`ALTER TABLE monitor_incidents ADD COLUMN IF NOT EXISTS duration_s  INTEGER;`);
    await client.query(`ALTER TABLE monitor_incidents ADD COLUMN IF NOT EXISTS error       TEXT;`);

    // Migrate camelCase → snake_case for monitor_incidents
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitor_incidents' AND column_name='monitorid')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitor_incidents' AND column_name='monitor_id')
        THEN
          ALTER TABLE monitor_incidents ADD COLUMN monitor_id TEXT NOT NULL DEFAULT '';
          UPDATE monitor_incidents SET monitor_id = "monitorId";
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitor_incidents' AND column_name='startedat')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitor_incidents' AND column_name='started_at')
        THEN
          ALTER TABLE monitor_incidents ADD COLUMN started_at TIMESTAMP NOT NULL DEFAULT NOW();
          UPDATE monitor_incidents SET started_at = "startedAt";
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitor_incidents' AND column_name='createdat')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitor_incidents' AND column_name='created_at')
        THEN
          ALTER TABLE monitor_incidents ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT NOW();
          UPDATE monitor_incidents SET created_at = "createdAt";
        END IF;
      END $$;
    `);

    // ── 4. Indexes — only after all columns are guaranteed to exist ────────────
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitors' AND column_name='org_id') THEN
          CREATE INDEX IF NOT EXISTS monitors_org_id_idx ON monitors(org_id);
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitor_checks' AND column_name='monitor_id') THEN
          CREATE INDEX IF NOT EXISTS monitor_checks_monitor_id_idx ON monitor_checks(monitor_id);
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitor_checks' AND column_name='org_id') THEN
          CREATE INDEX IF NOT EXISTS monitor_checks_org_id_idx ON monitor_checks(org_id);
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitor_checks' AND column_name='checked_at') THEN
          CREATE INDEX IF NOT EXISTS monitor_checks_checked_at_idx ON monitor_checks(checked_at);
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitor_incidents' AND column_name='monitor_id') THEN
          CREATE INDEX IF NOT EXISTS monitor_incidents_monitor_id_idx ON monitor_incidents(monitor_id);
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitor_incidents' AND column_name='org_id') THEN
          CREATE INDEX IF NOT EXISTS monitor_incidents_org_id_idx ON monitor_incidents(org_id);
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='monitor_incidents' AND column_name='started_at') THEN
          CREATE INDEX IF NOT EXISTS monitor_incidents_started_at_idx ON monitor_incidents(started_at);
        END IF;
      END $$;
    `);

    logger.info("[init-monitors] monitors, monitor_checks, monitor_incidents tables ready");
  } catch (err) {
    logger.error({ err }, "[init-monitors] Table creation failed");
    throw err;
  } finally {
    client.release();
  }
}
