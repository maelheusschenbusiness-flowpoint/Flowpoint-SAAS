import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

async function run(client: import("pg").PoolClient, sql: string): Promise<void> {
  try {
    await client.query(sql);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ msg }, "[init-data-tables] Non-fatal SQL warn");
  }
}

export async function initDataTables(): Promise<void> {
  const client = await pool.connect();
  try {
    // ── audits ────────────────────────────────────────────────────────────────
    await run(client, `
      CREATE TABLE IF NOT EXISTS audits (
        id         TEXT PRIMARY KEY,
        url        TEXT NOT NULL,
        score      INTEGER NOT NULL DEFAULT 0,
        status     TEXT NOT NULL DEFAULT 'processing',
        speed      INTEGER NOT NULL DEFAULT 0,
        date       TEXT NOT NULL DEFAULT '',
        issues     INTEGER NOT NULL DEFAULT 0,
        origin     TEXT DEFAULT 'manual',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await run(client, `ALTER TABLE audits ADD COLUMN IF NOT EXISTS origin TEXT DEFAULT 'manual';`);
    await run(client, `ALTER TABLE audits ADD COLUMN IF NOT EXISTS speed INTEGER NOT NULL DEFAULT 0;`);
    await run(client, `ALTER TABLE audits ADD COLUMN IF NOT EXISTS date TEXT NOT NULL DEFAULT '';`);
    await run(client, `ALTER TABLE audits ADD COLUMN IF NOT EXISTS issues INTEGER NOT NULL DEFAULT 0;`);
    await run(client, `CREATE INDEX IF NOT EXISTS audits_url_idx ON audits(url);`);
    await run(client, `CREATE INDEX IF NOT EXISTS audits_created_at_idx ON audits(created_at);`);

    // ── audit_schedules ───────────────────────────────────────────────────────
    await run(client, `
      CREATE TABLE IF NOT EXISTS audit_schedules (
        id         TEXT PRIMARY KEY,
        url        TEXT NOT NULL,
        frequency  TEXT NOT NULL DEFAULT 'weekly',
        next_run   TIMESTAMP,
        last_run   TIMESTAMP,
        enabled    BOOLEAN NOT NULL DEFAULT true,
        org_id     TEXT NOT NULL DEFAULT 'default',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await run(client, `ALTER TABLE audit_schedules ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';`);
    await run(client, `ALTER TABLE audit_schedules ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;`);
    await run(client, `ALTER TABLE audit_schedules ADD COLUMN IF NOT EXISTS next_run TIMESTAMP;`);
    await run(client, `ALTER TABLE audit_schedules ADD COLUMN IF NOT EXISTS last_run TIMESTAMP;`);
    await run(client, `CREATE INDEX IF NOT EXISTS audit_schedules_url_idx ON audit_schedules(url);`);
    await run(client, `CREATE INDEX IF NOT EXISTS audit_schedules_org_id_idx ON audit_schedules(org_id);`);

    // ── notifications ─────────────────────────────────────────────────────────
    await run(client, `
      CREATE TABLE IF NOT EXISTS notifications (
        id         TEXT PRIMARY KEY,
        type       TEXT NOT NULL DEFAULT 'info',
        title      TEXT NOT NULL,
        message    TEXT NOT NULL,
        read       BOOLEAN NOT NULL DEFAULT false,
        link       TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await run(client, `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;`);
    await run(client, `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read BOOLEAN NOT NULL DEFAULT false;`);
    await run(client, `CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON notifications(created_at);`);
    await run(client, `CREATE INDEX IF NOT EXISTS notifications_read_idx ON notifications(read);`);

    // ── competitors ───────────────────────────────────────────────────────────
    await run(client, `
      CREATE TABLE IF NOT EXISTS competitors (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        url           TEXT NOT NULL,
        domain_rating INTEGER NOT NULL DEFAULT 0,
        keywords      INTEGER NOT NULL DEFAULT 0,
        traffic       INTEGER NOT NULL DEFAULT 0,
        threat_level  TEXT NOT NULL DEFAULT 'low',
        delta         INTEGER DEFAULT 0,
        created_at    TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await run(client, `ALTER TABLE competitors ADD COLUMN IF NOT EXISTS domain_rating INTEGER NOT NULL DEFAULT 0;`);
    await run(client, `ALTER TABLE competitors ADD COLUMN IF NOT EXISTS threat_level TEXT NOT NULL DEFAULT 'low';`);
    await run(client, `ALTER TABLE competitors ADD COLUMN IF NOT EXISTS delta INTEGER DEFAULT 0;`);
    await run(client, `CREATE INDEX IF NOT EXISTS competitors_domain_rating_idx ON competitors(domain_rating);`);

    // ── alert_events ──────────────────────────────────────────────────────────
    await run(client, `
      CREATE TABLE IF NOT EXISTS alert_events (
        id           TEXT PRIMARY KEY,
        rule_id      TEXT NOT NULL DEFAULT '',
        rule_name    TEXT NOT NULL DEFAULT '',
        type         TEXT NOT NULL DEFAULT 'seo_score',
        metric_value REAL,
        threshold    REAL,
        operator     TEXT NOT NULL DEFAULT 'lt',
        severity     TEXT NOT NULL DEFAULT 'warning',
        message      TEXT NOT NULL DEFAULT '',
        site_url     TEXT NOT NULL DEFAULT '',
        read_at      TIMESTAMP,
        resolved_at  TIMESTAMP,
        triggered_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS alert_events_triggered_at_idx ON alert_events(triggered_at DESC);`);
    await run(client, `CREATE INDEX IF NOT EXISTS alert_events_read_at_idx ON alert_events(read_at);`);

    // ── calendar_events ───────────────────────────────────────────────────────
    await run(client, `
      CREATE TABLE IF NOT EXISTS calendar_events (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL,
        site       TEXT NOT NULL DEFAULT '',
        type       TEXT NOT NULL DEFAULT 'Autre',
        date       TEXT NOT NULL DEFAULT '',
        start_time TEXT NOT NULL DEFAULT '',
        duration   INTEGER NOT NULL DEFAULT 60,
        notes      TEXT NOT NULL DEFAULT '',
        org_id     TEXT NOT NULL DEFAULT 'default',
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await run(client, `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';`);
    await run(client, `CREATE INDEX IF NOT EXISTS calendar_events_date_idx ON calendar_events(date);`);
    await run(client, `CREATE INDEX IF NOT EXISTS calendar_events_org_id_idx ON calendar_events(org_id);`);

    // ── report_exports ────────────────────────────────────────────────────────
    await run(client, `
      CREATE TABLE IF NOT EXISTS report_exports (
        id         TEXT PRIMARY KEY,
        report_id  TEXT NOT NULL DEFAULT '',
        org_id     TEXT NOT NULL DEFAULT 'default',
        format     TEXT NOT NULL DEFAULT 'pdf',
        url        TEXT,
        size       INTEGER DEFAULT 0,
        expires_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await run(client, `ALTER TABLE report_exports ADD COLUMN IF NOT EXISTS org_id     TEXT      NOT NULL DEFAULT 'default';`);
    await run(client, `ALTER TABLE report_exports ADD COLUMN IF NOT EXISTS report_id  TEXT      NOT NULL DEFAULT '';`);
    await run(client, `ALTER TABLE report_exports ADD COLUMN IF NOT EXISTS format     TEXT      NOT NULL DEFAULT 'pdf';`);
    await run(client, `ALTER TABLE report_exports ADD COLUMN IF NOT EXISTS url        TEXT;`);
    await run(client, `ALTER TABLE report_exports ADD COLUMN IF NOT EXISTS size       INTEGER   DEFAULT 0;`);
    await run(client, `ALTER TABLE report_exports ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;`);
    await run(client, `ALTER TABLE report_exports ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW();`);
    await run(client, `CREATE INDEX IF NOT EXISTS report_exports_org_id_idx     ON report_exports(org_id);`);
    await run(client, `CREATE INDEX IF NOT EXISTS report_exports_created_at_idx ON report_exports(created_at);`);

    // ── team_messages ─────────────────────────────────────────────────────────
    await run(client, `
      CREATE TABLE IF NOT EXISTS team_messages (
        id          TEXT PRIMARY KEY,
        org_id      TEXT NOT NULL DEFAULT 'default',
        sender_id   TEXT NOT NULL DEFAULT 'user',
        sender_name TEXT NOT NULL DEFAULT '',
        content     TEXT NOT NULL DEFAULT '',
        channel     TEXT NOT NULL DEFAULT 'general',
        type        TEXT NOT NULL DEFAULT 'text',
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await run(client, `ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS org_id      TEXT NOT NULL DEFAULT 'default';`);
    await run(client, `ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS sender_id   TEXT NOT NULL DEFAULT 'user';`);
    await run(client, `ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS sender_name TEXT NOT NULL DEFAULT '';`);
    await run(client, `ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS content     TEXT NOT NULL DEFAULT '';`);
    await run(client, `ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS channel     TEXT NOT NULL DEFAULT 'general';`);
    await run(client, `ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS type        TEXT NOT NULL DEFAULT 'text';`);
    // Patch legacy columns if they exist (old schema used "from"/"text", new uses sender_name/content)
    await run(client, `ALTER TABLE team_messages ALTER COLUMN "from" DROP NOT NULL;`);
    await run(client, `ALTER TABLE team_messages ALTER COLUMN "from" SET DEFAULT '';`);
    await run(client, `ALTER TABLE team_messages ALTER COLUMN "text" DROP NOT NULL;`);
    await run(client, `ALTER TABLE team_messages ALTER COLUMN "text" SET DEFAULT '';`);
    await run(client, `CREATE INDEX IF NOT EXISTS team_messages_org_id_idx  ON team_messages(org_id);`);
    await run(client, `CREATE INDEX IF NOT EXISTS team_messages_channel_idx ON team_messages(channel);`);

    logger.info("[init-data-tables] audits, audit_schedules, notifications, competitors, alert_events, calendar_events, report_exports, team_messages ready");
  } catch (err) {
    logger.error({ err }, "[init-data-tables] Unexpected error");
    throw err;
  } finally {
    client.release();
  }
}
