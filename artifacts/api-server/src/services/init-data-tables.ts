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
    // BUGFIX: audits.org_id was never added outside of the RLS migration
    // (pnpm run migrate), which had never been executed against production —
    // POST /api/audits INSERTs an org_id column that did not exist there,
    // causing a 500 (Postgres 42703 "column audits.org_id does not exist").
    await run(client, `ALTER TABLE audits ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';`);
    await run(client, `CREATE INDEX IF NOT EXISTS audits_url_idx ON audits(url);`);
    await run(client, `CREATE INDEX IF NOT EXISTS audits_created_at_idx ON audits(created_at);`);
    await run(client, `CREATE INDEX IF NOT EXISTS audits_org_id_idx ON audits(org_id);`);

    // ── reports + share_tokens ───────────────────────────────────────────────
    // BUGFIX: the `reports` table was never created on production — it only
    // existed in migrations/002_dashboard_tables.sql, which is not wired into
    // any automatic runner. POST /api/reports failed with Postgres 42P01
    // ("relation reports does not exist") -> 500. Columns below match exactly
    // what routes/reports.ts inserts/selects today.
    await run(client, `
      CREATE TABLE IF NOT EXISTS reports (
        id                 TEXT PRIMARY KEY,
        org_id             TEXT NOT NULL DEFAULT 'default',
        name               TEXT NOT NULL,
        type               TEXT NOT NULL DEFAULT 'PDF',
        date               TEXT NOT NULL DEFAULT '',
        pages              INTEGER NOT NULL DEFAULT 0,
        shared             BOOLEAN NOT NULL DEFAULT false,
        audit_id           TEXT DEFAULT '',
        white_label        BOOLEAN NOT NULL DEFAULT false,
        pdf_ready          BOOLEAN NOT NULL DEFAULT false,
        meeting_notes_json TEXT DEFAULT '[]',
        date_start         TEXT DEFAULT '',
        date_end           TEXT DEFAULT '',
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await run(client, `ALTER TABLE reports ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';`);
    await run(client, `ALTER TABLE reports ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'PDF';`);
    await run(client, `ALTER TABLE reports ADD COLUMN IF NOT EXISTS pages INTEGER NOT NULL DEFAULT 0;`);
    await run(client, `ALTER TABLE reports ADD COLUMN IF NOT EXISTS shared BOOLEAN NOT NULL DEFAULT false;`);
    await run(client, `ALTER TABLE reports ADD COLUMN IF NOT EXISTS pdf_ready BOOLEAN NOT NULL DEFAULT false;`);
    await run(client, `ALTER TABLE reports ADD COLUMN IF NOT EXISTS meeting_notes_json TEXT DEFAULT '[]';`);
    await run(client, `CREATE INDEX IF NOT EXISTS reports_org_id_idx ON reports(org_id);`);
    await run(client, `CREATE INDEX IF NOT EXISTS reports_date_idx ON reports(date DESC);`);

    await run(client, `
      CREATE TABLE IF NOT EXISTS share_tokens (
        token              TEXT PRIMARY KEY,
        report_id          TEXT NOT NULL,
        org_id             TEXT NOT NULL DEFAULT 'default',
        report_json        TEXT DEFAULT '{}',
        branding_json      TEXT DEFAULT '{}',
        audits_json        TEXT DEFAULT '[]',
        meeting_notes_json TEXT DEFAULT '[]',
        views              INTEGER NOT NULL DEFAULT 0,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at         TIMESTAMPTZ
      );
    `);
    await run(client, `ALTER TABLE share_tokens ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';`);
    await run(client, `CREATE INDEX IF NOT EXISTS share_tokens_report_id_idx ON share_tokens(report_id);`);

    // ── tracked_keywords ─────────────────────────────────────────────────────
    // BUGFIX: production's tracked_keywords table existed but was missing the
    // `url` column (and several others) that keyword-engine.ts's trackKeyword()
    // reads/writes — POST /api/keywords/track failed with Postgres 42703
    // ("column tracked_keywords.url does not exist") -> 500.
    await run(client, `
      CREATE TABLE IF NOT EXISTS tracked_keywords (
        id               TEXT PRIMARY KEY,
        org_id           TEXT NOT NULL DEFAULT 'default',
        keyword          TEXT NOT NULL,
        url              TEXT,
        location         TEXT NOT NULL DEFAULT 'France',
        device           TEXT NOT NULL DEFAULT 'desktop',
        intent           TEXT,
        tag              TEXT,
        cluster_id       TEXT,
        active           BOOLEAN NOT NULL DEFAULT true,
        current_position INTEGER,
        prev_position    INTEGER,
        position_change  INTEGER DEFAULT 0,
        search_volume    INTEGER DEFAULT 0,
        difficulty       INTEGER DEFAULT 0,
        trend            TEXT DEFAULT 'stable',
        volatility       REAL DEFAULT 0,
        last_sync_at     TIMESTAMPTZ,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await run(client, `ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS url TEXT;`);
    await run(client, `ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS intent TEXT;`);
    await run(client, `ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS tag TEXT;`);
    await run(client, `ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS cluster_id TEXT;`);
    await run(client, `ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;`);
    await run(client, `ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS current_position INTEGER;`);
    await run(client, `ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS prev_position INTEGER;`);
    await run(client, `ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS position_change INTEGER DEFAULT 0;`);
    await run(client, `ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS search_volume INTEGER DEFAULT 0;`);
    await run(client, `ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS difficulty INTEGER DEFAULT 0;`);
    await run(client, `ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS trend TEXT DEFAULT 'stable';`);
    await run(client, `ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS volatility REAL DEFAULT 0;`);
    await run(client, `ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;`);
    await run(client, `ALTER TABLE tracked_keywords ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
    // Matches the ON CONFLICT (org_id, keyword, device, location) target used by trackKeyword().
    await run(client, `ALTER TABLE tracked_keywords ADD CONSTRAINT tracked_keywords_org_kw_dev_loc_key UNIQUE (org_id, keyword, device, location);`);
    await run(client, `CREATE INDEX IF NOT EXISTS tracked_keywords_org_active_idx ON tracked_keywords(org_id, active);`);

    // ── google_oauth_states ──────────────────────────────────────────────────
    // BUGFIX: table was never created anywhere — migrations 014/015 only add
    // RLS policies to it, assuming it already exists. registerOAuthState()
    // in routes/google.ts failed with Postgres 42P01 ("relation
    // google_oauth_states does not exist"), which was unhandled (no try/catch)
    // -> raw 500 on GET /api/google/connect.
    await run(client, `
      CREATE TABLE IF NOT EXISTS google_oauth_states (
        state      TEXT PRIMARY KEY,
        org_id     TEXT NOT NULL DEFAULT 'default',
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await run(client, `ALTER TABLE google_oauth_states ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';`);
    await run(client, `CREATE INDEX IF NOT EXISTS google_oauth_states_expires_idx ON google_oauth_states(expires_at);`);

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
    await run(client, `CREATE INDEX IF NOT EXISTS team_messages_org_id_idx  ON team_messages(org_id);`);
    await run(client, `CREATE INDEX IF NOT EXISTS team_messages_channel_idx ON team_messages(channel);`);

    // ── org_settings — ensure all expected columns exist ─────────────────────
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS trial_ends_at            TIMESTAMPTZ;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS trial_ending_notified_at  TIMESTAMPTZ;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS email                     TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS first_name                TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS subscription_status       TEXT NOT NULL DEFAULT 'active';`);
    await run(client, `CREATE INDEX IF NOT EXISTS org_settings_trial_ends_at_idx ON org_settings(trial_ends_at) WHERE trial_ends_at IS NOT NULL;`);
    await run(client, `CREATE INDEX IF NOT EXISTS org_settings_sub_status_idx    ON org_settings(subscription_status);`);

    logger.info("[init-data-tables] audits, audit_schedules, notifications, competitors, alert_events, calendar_events, report_exports, team_messages ready");
  } catch (err) {
    logger.error({ err }, "[init-data-tables] Unexpected error");
    throw err;
  } finally {
    client.release();
  }
}
