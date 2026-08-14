import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

// Structural type matching pg.PoolClient — avoids importing "pg" directly
// (pg lives in @workspace/db's private node_modules and is not hoisted).
const TEAM_MEMBERS_EXPECTED: Array<{ col: string; sql: string }> = [
  { col: "id",                    sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS id                    TEXT        NOT NULL DEFAULT '';` },
  { col: "org_id",                sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS org_id                TEXT        NOT NULL DEFAULT 'default';` },
  { col: "name",                  sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS name                  TEXT        NOT NULL DEFAULT '';` },
  { col: "email",                 sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS email                 TEXT        NOT NULL DEFAULT '';` },
  { col: "role",                  sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS role                  TEXT        NOT NULL DEFAULT 'viewer';` },
  { col: "joined",                sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS joined                TEXT        NOT NULL DEFAULT '';` },
  { col: "status",                sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS status                TEXT        NOT NULL DEFAULT 'pending';` },
  { col: "invited_at",            sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS invited_at            TIMESTAMPTZ NOT NULL DEFAULT NOW();` },
  { col: "invited_by",            sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS invited_by            TEXT        NOT NULL DEFAULT '';` },
  { col: "invitation_token_hash", sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS invitation_token_hash TEXT;` },
  { col: "expires_at",            sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS expires_at            TIMESTAMPTZ;` },
  { col: "accepted_at",           sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS accepted_at           TIMESTAMPTZ;` },
  { col: "email_status",          sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS email_status          TEXT        NOT NULL DEFAULT 'pending';` },
  { col: "resend_message_id",     sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS resend_message_id     TEXT;` },
  { col: "email_error",           sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS email_error           TEXT;` },
  { col: "updated_at",            sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW();` },
  { col: "created_at",            sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS created_at            TIMESTAMP   NOT NULL DEFAULT NOW();` },
  { col: "user_id",               sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS user_id               TEXT;` },
  { col: "first_name",            sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS first_name            TEXT;` },
  { col: "last_name",             sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS last_name             TEXT;` },
  { col: "invited_by_user_id",    sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS invited_by_user_id    TEXT;` },
  { col: "joined_at",             sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS joined_at             TIMESTAMPTZ;` },
  { col: "resend_count",          sql: `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS resend_count          INTEGER NOT NULL DEFAULT 0;` },
];

/**
 * Queries information_schema.columns for team_members, logs Present/Expected/Missing,
 * auto-repairs each missing column via ALTER TABLE, then verifies repair succeeded.
 * Every DDL failure is logged with full PostgreSQL error detail.
 */
async function verifyTeamMembersSchema(client: PoolClient): Promise<void> {
  try {
    const snapshot = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name='team_members' ORDER BY ordinal_position`
    );
    const present  = snapshot.rows.map(r => r.column_name);
    const expected = TEAM_MEMBERS_EXPECTED.map(e => e.col);
    const missing  = expected.filter(c => !present.includes(c));

    logger.info(
      { present, expected, missing },
      `[team_members schema] Present: ${present.join(", ")} | Expected: ${expected.join(", ")} | Missing: ${missing.length ? missing.join(", ") : "none"}`
    );

    if (missing.length === 0) return;

    // Auto-repair each missing column one by one
    for (const col of missing) {
      const entry = TEAM_MEMBERS_EXPECTED.find(e => e.col === col)!;
      logger.warn({ col, sqlStmt: entry.sql }, `[team_members schema] Auto-repairing missing column "${col}"`);

      try {
        await client.query(entry.sql);
      } catch (err) {
        const e = err as Record<string, unknown>;
        logger.error(
          {
            col,
            sqlMsg:        err instanceof Error ? err.message : String(err),
            sqlCode:       e["code"],
            sqlState:      e["code"],
            sqlDetail:     e["detail"],
            sqlConstraint: e["constraint"],
            sqlTable:      e["table"],
            sqlColumn:     e["column"],
            sqlStmt:       entry.sql,
            stack:         err instanceof Error ? err.stack : undefined,
          },
          `[team_members schema] FAILED to repair column "${col}"`
        );
        continue;
      }

      // Confirm the repair took effect
      const check = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name='team_members' AND column_name=$1`,
        [col]
      );
      if (check.rows.length === 0) {
        logger.error(
          { col, sqlStmt: entry.sql },
          `[team_members schema] Column "${col}" STILL MISSING after ALTER TABLE — DDL silently rejected`
        );
      } else {
        logger.info({ col }, `[team_members schema] Column "${col}" repaired and verified ✓`);
      }
    }

    // Final post-repair snapshot
    const final = await client.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name='team_members' ORDER BY ordinal_position`
    );
    const finalPresent  = final.rows.map(r => r.column_name);
    const finalMissing  = expected.filter(c => !finalPresent.includes(c));
    if (finalMissing.length > 0) {
      logger.error(
        { finalPresent, finalMissing },
        `[team_members schema] POST-REPAIR: columns still missing: ${finalMissing.join(", ")}`
      );
    } else {
      logger.info({ finalPresent }, "[team_members schema] All expected columns present after auto-repair ✓");
    }
  } catch (err) {
    logger.error({ err }, "[team_members schema] verifyTeamMembersSchema failed — information_schema query error");
  }
}

async function run(client: PoolClient, sql: string): Promise<void> {
  try {
    await client.query(sql);
  } catch (err: unknown) {
    const e   = err as Record<string, unknown>;
    const msg = err instanceof Error ? err.message : String(err);
    // Log the SQL statement (first 120 chars) so production logs reveal which DDL failed
    logger.warn(
      {
        sqlMsg:        msg,
        sqlCode:       e["code"],
        sqlTable:      e["table"],
        sqlColumn:     e["column"],
        sqlConstraint: e["constraint"],
        sqlStmt:       sql.replace(/\s+/g, " ").trim().slice(0, 120),
      },
      "[init-data-tables] Non-fatal SQL warn"
    );
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
    // BUGFIX-AUDIT-NAME: audits.name was missing from CREATE TABLE — INSERT (id,url,name,...) failed
    // with Postgres 42703 "column audits.name does not exist" causing every audit creation to return 500.
    await run(client, `ALTER TABLE audits ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';`);
    await run(client, `ALTER TABLE audits ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '';`);
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
    // Idempotent: skips silently if the constraint already exists instead of
    // logging a "Non-fatal SQL warn" on every restart.
    await run(client, `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'tracked_keywords_org_kw_dev_loc_key'
        ) THEN
          ALTER TABLE tracked_keywords
            ADD CONSTRAINT tracked_keywords_org_kw_dev_loc_key UNIQUE (org_id, keyword, device, location);
        END IF;
      END $$;
    `);
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

    // ── google_product_connections — per-product disconnect flags ─────────────
    // Stores explicit connect/disconnect state per Google product (gbp/ga4/gsc)
    // per org. This allows per-product disconnect while the shared OAuth token
    // remains valid for the other products.
    await run(client, `
      CREATE TABLE IF NOT EXISTS google_product_connections (
        org_id     TEXT        NOT NULL,
        product    TEXT        NOT NULL,
        connected  BOOLEAN     NOT NULL DEFAULT true,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (org_id, product)
      )
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS google_product_connections_org_idx ON google_product_connections(org_id);`);
    // ── RLS for google_product_connections ────────────────────────────────────
    await run(client, `ALTER TABLE google_product_connections ENABLE ROW LEVEL SECURITY`);
    await run(client, `ALTER TABLE google_product_connections FORCE ROW LEVEL SECURITY`);
    await run(client, `
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='google_product_connections' AND policyname='tenant_select') THEN
          CREATE POLICY tenant_select ON google_product_connections FOR SELECT TO PUBLIC
            USING (org_id = current_setting('app.current_org_id', true));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='google_product_connections' AND policyname='tenant_insert') THEN
          CREATE POLICY tenant_insert ON google_product_connections FOR INSERT TO PUBLIC WITH CHECK (true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='google_product_connections' AND policyname='tenant_update') THEN
          CREATE POLICY tenant_update ON google_product_connections FOR UPDATE TO PUBLIC
            USING (org_id = current_setting('app.current_org_id', true));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='google_product_connections' AND policyname='tenant_delete') THEN
          CREATE POLICY tenant_delete ON google_product_connections FOR DELETE TO PUBLIC
            USING (org_id = current_setting('app.current_org_id', true));
        END IF;
      END $$
    `);

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
        org_id     TEXT NOT NULL DEFAULT 'default',
        type       TEXT NOT NULL DEFAULT 'info',
        title      TEXT NOT NULL,
        message    TEXT NOT NULL,
        read       BOOLEAN NOT NULL DEFAULT false,
        link       TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await run(client, `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';`);
    await run(client, `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;`);
    await run(client, `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read BOOLEAN NOT NULL DEFAULT false;`);
    // Per-recipient notifications (chat): NULL = org-wide, non-NULL = visible only
    // to that member (matched against userId OR email). Read state is then
    // per-recipient — one member's "mark all read" cannot clear another's alerts.
    await run(client, `ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_id TEXT;`);
    await run(client, `CREATE INDEX IF NOT EXISTS notifications_org_id_idx ON notifications(org_id);`);
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
    // BUG-W2-ALT-003: new columns for real alert pipeline
    await run(client, `ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS org_id     TEXT NOT NULL DEFAULT 'default';`);
    await run(client, `ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS monitor_id TEXT NOT NULL DEFAULT '';`);
    await run(client, `ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS status     TEXT NOT NULL DEFAULT 'open';`);
    await run(client, `ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS dedupe_key TEXT;`);
    // operator is inapplicable for event-based types (monitor_down/up) — allow NULL
    await run(client, `ALTER TABLE alert_events ALTER COLUMN operator DROP NOT NULL;`);
    await run(client, `ALTER TABLE alert_events ALTER COLUMN operator DROP DEFAULT;`);
    await run(client, `CREATE INDEX IF NOT EXISTS alert_events_org_id_idx    ON alert_events(org_id);`);
    await run(client, `CREATE INDEX IF NOT EXISTS alert_events_monitor_id_idx ON alert_events(monitor_id);`);
    // B3: replace old dedupe index (blocked re-firing after resolve) with one
    // conditioned on status='open' so resolved events free their dedupe slot.
    await run(client, `DROP INDEX IF EXISTS alert_events_dedupe_key_idx;`);
    await run(client, `CREATE UNIQUE INDEX IF NOT EXISTS alert_events_open_dedupe_key_idx ON alert_events(dedupe_key) WHERE dedupe_key IS NOT NULL AND status = 'open';`);

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
    await run(client, `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS client_name TEXT NOT NULL DEFAULT '';`);
    // Phase 3 — colonnes IA calendrier (Undo + enrichissement)
    await run(client, `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
    await run(client, `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal';`);
    await run(client, `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '';`);
    await run(client, `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS reminder INTEGER NOT NULL DEFAULT 0;`);
    await run(client, `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS linked_mission_id TEXT;`);
    await run(client, `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS rrule TEXT;`); // Phase 3 — récurrents
    await run(client, `ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS series_id TEXT;`); // Phase 3.2 — lien occurrences
    await run(client, `CREATE INDEX IF NOT EXISTS calendar_events_date_idx ON calendar_events(date);`);
    await run(client, `CREATE INDEX IF NOT EXISTS calendar_events_org_id_idx ON calendar_events(org_id);`);
    await run(client, `CREATE INDEX IF NOT EXISTS calendar_events_date_org_idx ON calendar_events(org_id, date);`);
    await run(client, `CREATE INDEX IF NOT EXISTS calendar_events_series_idx ON calendar_events(org_id, series_id) WHERE series_id IS NOT NULL;`);

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
    await run(client, `ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS type             TEXT NOT NULL DEFAULT 'text';`);
    await run(client, `ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS attachment_url  TEXT;`);
    await run(client, `ALTER TABLE team_messages ADD COLUMN IF NOT EXISTS attachment_name TEXT;`);
    await run(client, `CREATE INDEX IF NOT EXISTS team_messages_org_id_idx  ON team_messages(org_id);`);
    await run(client, `CREATE INDEX IF NOT EXISTS team_messages_channel_idx ON team_messages(channel);`);

    // ── team_files ──────────────────────────────────────────────────────────
    await run(client, `
      CREATE TABLE IF NOT EXISTS team_files (
        id          TEXT PRIMARY KEY,
        org_id      TEXT NOT NULL DEFAULT 'default',
        name        TEXT NOT NULL,
        type        TEXT NOT NULL DEFAULT 'file',
        size        INTEGER DEFAULT 0,
        content     TEXT,
        shared_by   TEXT DEFAULT '',
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS team_files_org_id_idx ON team_files(org_id);`);

    // ── org_secrets — per-org secure credential storage ───────────────────────
    await run(client, `
      CREATE TABLE IF NOT EXISTS org_secrets (
        org_id      TEXT NOT NULL DEFAULT 'default',
        key         TEXT NOT NULL DEFAULT '',
        value       TEXT NOT NULL DEFAULT '',
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (org_id, key)
      );
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS org_secrets_org_id_idx ON org_secrets(org_id);`);

    // ── ai_usage_logs — extended cost logging columns ────────────────────────
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS provider TEXT;`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS cached_tokens INTEGER NOT NULL DEFAULT 0;`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS real_cost_eur REAL NOT NULL DEFAULT 0;`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS credits_debited INTEGER NOT NULL DEFAULT 0;`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS duration_ms INTEGER NOT NULL DEFAULT 0;`);
    // cost_eur, credits_used, tokens_in/out, latency_ms, success, metadata — missing from original CREATE TABLE
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS cost_eur REAL NOT NULL DEFAULT 0;`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS credits_used INTEGER NOT NULL DEFAULT 0;`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS tokens_in INTEGER NOT NULL DEFAULT 0;`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS tokens_out INTEGER NOT NULL DEFAULT 0;`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS latency_ms INTEGER NOT NULL DEFAULT 0;`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS success BOOLEAN NOT NULL DEFAULT true;`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS metadata JSONB;`);
    await run(client, `CREATE INDEX IF NOT EXISTS ai_usage_logs_provider_idx ON ai_usage_logs(provider, created_at DESC);`);
    await run(client, `CREATE INDEX IF NOT EXISTS ai_usage_logs_model_idx ON ai_usage_logs(model, created_at DESC);`);
    await run(client, `CREATE INDEX IF NOT EXISTS ai_usage_logs_feature_idx ON ai_usage_logs(feature, created_at DESC);`);

    // ── ai_monthly_usage — credits/cost columns missing from original CREATE TABLE ──
    await run(client, `ALTER TABLE ai_monthly_usage ADD COLUMN IF NOT EXISTS credits_used INTEGER NOT NULL DEFAULT 0;`);
    await run(client, `ALTER TABLE ai_monthly_usage ADD COLUMN IF NOT EXISTS cost_eur REAL NOT NULL DEFAULT 0;`);
    await run(client, `ALTER TABLE ai_monthly_usage ADD COLUMN IF NOT EXISTS tokens_used INTEGER NOT NULL DEFAULT 0;`);
    await run(client, `ALTER TABLE ai_monthly_usage ADD COLUMN IF NOT EXISTS reset_at TIMESTAMPTZ;`);
    await run(client, `ALTER TABLE ai_monthly_usage ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);

    // ── org_settings — ensure all expected columns exist ─────────────────────
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS trial_ends_at            TIMESTAMPTZ;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS trial_ending_notified_at  TIMESTAMPTZ;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS email                     TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS first_name                TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS subscription_status       TEXT NOT NULL DEFAULT 'none';`);
    // Fix existing rows: change DEFAULT so new rows get 'none', not 'active'
    await run(client, `ALTER TABLE org_settings ALTER COLUMN subscription_status SET DEFAULT 'none';`);
    // Fix: if trial_ends_at was created as TEXT in an older schema, cast to TIMESTAMPTZ
    // so that comparisons with NOW() work (prevents 42883 operator mismatch).
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'org_settings'
            AND column_name = 'trial_ends_at' AND data_type = 'text'
        ) THEN
          ALTER TABLE org_settings
            ALTER COLUMN trial_ends_at TYPE TIMESTAMPTZ
            USING NULLIF(trial_ends_at, '')::timestamptz;
        END IF;
      END $$;
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS org_settings_trial_ends_at_idx ON org_settings(trial_ends_at) WHERE trial_ends_at IS NOT NULL;`);
    await run(client, `CREATE INDEX IF NOT EXISTS org_settings_sub_status_idx    ON org_settings(subscription_status);`);

    // ── trial_consumed_at / trial_started_at — explicit trial lifecycle tracking ──
    // trial_consumed_at: set by Stripe webhook when the FIRST real trialing subscription
    //   is created. NULL = no real Stripe trial was ever started (may be old fake DB trial).
    // trial_started_at:  set when trial_consumed_at is set (can be same value, kept separate
    //   for analytics).
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS trial_consumed_at TIMESTAMPTZ;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS trial_started_at  TIMESTAMPTZ;`);
    await run(client, `CREATE INDEX IF NOT EXISTS org_settings_trial_consumed_idx ON org_settings(trial_consumed_at) WHERE trial_consumed_at IS NOT NULL;`);

    // ── Reclassify fake DB trials → pending_billing ──────────────────────────
    // Accounts created before 2026-07-26 got subscription_status='trialing' at signup
    // without a real Stripe subscription. These are NOT real trials.
    // This UPDATE is idempotent — only touches rows that match the pattern.
    // Accounts with a real Stripe subscription OR trial_consumed_at are left untouched.
    await run(client, `
      UPDATE org_settings
      SET    subscription_status = 'pending_billing',
             updated_at          = NOW()
      WHERE  subscription_status = 'trialing'
        AND  (stripe_subscription_id IS NULL OR stripe_subscription_id = '')
        AND  trial_consumed_at IS NULL;
    `);

    // ── team_members — self-healing creation ──────────────────────────────────
    // ALL columns required by the STEP 6 INSERT are included here so fresh DBs
    // (where CREATE TABLE IF NOT EXISTS actually runs) never hit 42703.
    // Existing DBs fall through to the ALTER TABLE ADD COLUMN IF NOT EXISTS block.
    await run(client, `
      CREATE TABLE IF NOT EXISTS team_members (
        id                    TEXT        NOT NULL DEFAULT '',
        org_id                TEXT        NOT NULL DEFAULT 'default',
        name                  TEXT        NOT NULL DEFAULT '',
        email                 TEXT        NOT NULL DEFAULT '',
        role                  TEXT        NOT NULL DEFAULT 'viewer',
        joined                TEXT        NOT NULL DEFAULT '',
        status                TEXT        NOT NULL DEFAULT 'pending',
        invited_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        invited_by            TEXT        NOT NULL DEFAULT '',
        invitation_token_hash TEXT,
        expires_at            TIMESTAMPTZ,
        accepted_at           TIMESTAMPTZ,
        email_status          TEXT        NOT NULL DEFAULT 'pending',
        resend_message_id     TEXT,
        email_error           TEXT,
        updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at            TIMESTAMP   NOT NULL DEFAULT NOW(),
        PRIMARY KEY (id)
      );
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS team_members_org_id_idx ON team_members(org_id);`);
    await run(client, `CREATE INDEX IF NOT EXISTS team_members_email_idx ON team_members(org_id, email);`);

    // ── alert_rules — CREATE first (idempotent), then ensure columns ─────────
    // Without CREATE TABLE, ALTER TABLE on a fresh DB logs a non-fatal warn but
    // the table never gets created, so INSERT → 500 ("relation does not exist").
    await run(client, `
      CREATE TABLE IF NOT EXISTS alert_rules (
        id           TEXT        PRIMARY KEY,
        org_id       TEXT        NOT NULL DEFAULT 'default',
        name         TEXT        NOT NULL DEFAULT '',
        type         TEXT        NOT NULL DEFAULT 'seo_score',
        operator     TEXT        NOT NULL DEFAULT 'lt',
        threshold    REAL        NOT NULL DEFAULT 0,
        duration_min INTEGER     NOT NULL DEFAULT 0,
        channels     JSONB       NOT NULL DEFAULT '["email"]',
        site_urls    JSONB       NOT NULL DEFAULT '[]',
        enabled      BOOLEAN     NOT NULL DEFAULT true,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await run(client, `ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS org_id        TEXT    NOT NULL DEFAULT 'default';`);
    await run(client, `ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS operator      TEXT    NOT NULL DEFAULT 'lt';`);
    await run(client, `ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS duration_min  INTEGER NOT NULL DEFAULT 0;`);
    await run(client, `ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS site_urls     JSONB   NOT NULL DEFAULT '[]';`);
    await run(client, `ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS enabled       BOOLEAN NOT NULL DEFAULT true;`);
    await run(client, `ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
    await run(client, `CREATE INDEX IF NOT EXISTS alert_rules_org_id_idx ON alert_rules(org_id);`);
    // BUG-W2-ALT-002: event-based rule types (monitor_down, monitor_up) must store NULL
    // for operator and threshold. Remove NOT NULL constraint on existing DBs.
    await run(client, `ALTER TABLE alert_rules ALTER COLUMN operator  DROP NOT NULL;`);
    await run(client, `ALTER TABLE alert_rules ALTER COLUMN operator  DROP DEFAULT;`);
    await run(client, `ALTER TABLE alert_rules ALTER COLUMN threshold DROP NOT NULL;`);
    await run(client, `ALTER TABLE alert_rules ALTER COLUMN threshold DROP DEFAULT;`);
    // Clear stale sentinel values on existing event-based rules
    await run(client, `UPDATE alert_rules SET operator=NULL, threshold=NULL WHERE type IN ('monitor_down','monitor_up') AND (operator='eq' OR threshold=1);`);

    // ── team_members — coerce UUID→TEXT if table was created via Supabase UI ──
    // Supabase Dashboard creates id/org_id as UUID; migrations expect TEXT.
    // ADD COLUMN IF NOT EXISTS silently skips existing columns regardless of type,
    // so we must ALTER COLUMN TYPE explicitly when the types differ.
    // This block is idempotent: the DO $$ guard checks data_type before acting.
    await run(client, `
      DO $$ BEGIN
        IF (
          SELECT data_type FROM information_schema.columns
          WHERE table_schema='public' AND table_name='team_members' AND column_name='id'
        ) = 'uuid' THEN
          -- Drop FK from org_id → organizations.id (UUID only; TEXT has no FK)
          ALTER TABLE team_members DROP CONSTRAINT IF EXISTS team_members_org_id_fkey;
          -- Coerce PRIMARY KEY id: UUID → TEXT (UUID strings are valid TEXT)
          ALTER TABLE team_members ALTER COLUMN id      TYPE TEXT USING id::text;
          -- Coerce org_id: UUID → TEXT so email-based org_ids are accepted
          ALTER TABLE team_members ALTER COLUMN org_id  TYPE TEXT USING COALESCE(org_id::text, 'default');
        END IF;
      END $$;
    `);

    // ── team_members — add org_id + full invite tracking columns ────────────
    // ADD COLUMN IF NOT EXISTS adds name when column is absent (production).
    // ALTER COLUMN SET DEFAULT handles tables where name existed WITHOUT a default
    // (e.g. created before this migration added DEFAULT '') — fixes local dev 23502.
    await run(client, `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS name                    TEXT        NOT NULL DEFAULT '';`);
    await run(client, `ALTER TABLE team_members ALTER COLUMN name SET DEFAULT '';`);
    await run(client, `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS org_id                  TEXT        NOT NULL DEFAULT 'default';`);
    await run(client, `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS status                  TEXT        NOT NULL DEFAULT 'pending';`);
    await run(client, `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS invited_at              TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
    await run(client, `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS invited_by              TEXT        NOT NULL DEFAULT '';`);
    await run(client, `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS invitation_token_hash   TEXT;`);
    await run(client, `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS expires_at              TIMESTAMPTZ;`);
    await run(client, `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS accepted_at             TIMESTAMPTZ;`);
    await run(client, `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS email_status            TEXT        NOT NULL DEFAULT 'pending';`);
    await run(client, `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS resend_message_id       TEXT;`);
    await run(client, `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS email_error             TEXT;`);
    await run(client, `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
    // Update status default to 'pending' for future rows (existing rows unchanged)
    await run(client, `ALTER TABLE team_members ALTER COLUMN status SET DEFAULT 'pending';`);
    // Drop the global UNIQUE(email) constraint and replace with per-org functional index
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'team_members_email_key'
            AND conrelid = 'team_members'::regclass
        ) THEN
          ALTER TABLE team_members DROP CONSTRAINT team_members_email_key;
        END IF;
      END $$;
    `);
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'team_members_org_email_key'
        ) THEN
          ALTER TABLE team_members DROP CONSTRAINT team_members_org_email_key;
        END IF;
      END $$;
    `);
    // ── Switch to partial unique index (pending rows only) ───────────────────
    // Drop the old full unique index (may not exist or may have failed due to
    // pre-existing duplicates).  Then de-dup any existing pending rows, keeping
    // the most-recent by invited_at so the new partial index can be created
    // cleanly.  Same email in different orgs, or same email once accepted/expired,
    // is allowed — only one *pending* row per (org_id, lower(email)) is blocked.
    await run(client, `DROP INDEX IF EXISTS team_members_org_lower_email_idx;`);
    await run(client, `
      DELETE FROM team_members
      WHERE status = 'pending'
        AND ctid NOT IN (
          SELECT DISTINCT ON (org_id, lower(email)) ctid
          FROM   team_members
          WHERE  status = 'pending'
          ORDER  BY org_id, lower(email), invited_at DESC NULLS LAST, ctid DESC
        );
    `);
    await run(client, `
      CREATE UNIQUE INDEX IF NOT EXISTS team_members_org_lower_email_idx
      ON team_members (org_id, lower(email))
      WHERE status = 'pending';
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS team_members_org_idx ON team_members(org_id, email);`);

    // ── Broader uniqueness: one live row per (org_id, email) across active+pending+suspended ──
    // Sanitize duplicate live rows (keep highest-priority status first: active > suspended > pending)
    await run(client, `
      DELETE FROM team_members
      WHERE status IN ('active','pending','suspended')
        AND ctid NOT IN (
          SELECT DISTINCT ON (org_id, lower(trim(email))) ctid
          FROM   team_members
          WHERE  status IN ('active','pending','suspended')
          ORDER  BY org_id,
                    lower(trim(email)),
                    CASE status WHEN 'active' THEN 0 WHEN 'suspended' THEN 1 ELSE 2 END ASC,
                    COALESCE(updated_at, created_at) DESC NULLS LAST,
                    ctid DESC
        );
    `);
    await run(client, `DROP INDEX IF EXISTS team_members_unique_live_email_idx;`);
    await run(client, `
      CREATE UNIQUE INDEX IF NOT EXISTS team_members_unique_live_email_idx
      ON team_members (org_id, lower(trim(email)))
      WHERE status IN ('active','pending','suspended');
    `);

    // ── team_members — organization_members constraints (T06) ────────────────
    // 1. Sanitize invalid roles FIRST (must run before constraint is added/validated)
    //    Uses canonical mapping; anything unrecognised keeps its value so the
    //    final invalid-roles check below catches it explicitly.
    await run(client, `
      UPDATE team_members
      SET role = CASE
        WHEN role IN ('administrator', 'manager')          THEN 'admin'
        WHEN role IN ('user', 'editor', 'collaborator')    THEN 'member'
        WHEN role IN ('read_only', 'readonly', 'client')   THEN 'viewer'
        WHEN role IS NULL OR trim(role) = ''               THEN 'member'
        ELSE role
      END
      WHERE role IS NULL
         OR role NOT IN ('owner','admin','member','viewer');
    `);
    // 2. Drop and re-add constraint to ensure it matches the current allowed set.
    //    Two-step approach: DROP IF EXISTS (idempotent) then ADD — safer than
    //    the DO-IF-NOT-EXISTS pattern when the constraint definition might drift.
    await run(client, `ALTER TABLE team_members DROP CONSTRAINT IF EXISTS team_members_role_check;`);
    await run(client, `
      ALTER TABLE team_members
        ADD CONSTRAINT team_members_role_check
        CHECK (role IN ('owner','admin','member','viewer'));
    `);
    // 3. Verify no invalid roles remain (non-fatal warn if any slipped through)
    {
      const inv = await client.query(
        `SELECT COUNT(*) AS n FROM team_members WHERE role IS NULL OR role NOT IN ('owner','admin','member','viewer')`
      );
      const n = Number(inv.rows[0]?.n ?? 0);
      if (n > 0) {
        logger.warn({ invalidRoles: n }, "[init-data-tables] team_members: invalid roles remain after sanitize — investigate");
      } else {
        logger.info("[init-data-tables] team_members role constraint: all rows valid ✓");
      }
    }
    // 4. Soft FK index on org_id for JOIN performance (TEXT org_id ≠ UUID, no hard FK)
    await run(client, `CREATE INDEX IF NOT EXISTS team_members_org_fk_idx ON team_members(org_id);`);

    // ── org_settings — columns that may be missing in older DBs ─────────────
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS last_name           TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS org_name            TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS website             TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS stripe_customer_id       TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS stripe_subscription_id  TEXT;`);
    // P0-2 normalisation: impossible states where status='active' but no stripe_subscription_id.
    // Root cause: old DEFAULT 'active' created ghost-active rows for every new org.
    // This UPDATE is idempotent — only touches rows that are genuinely invalid.
    // Runs AFTER stripe_subscription_id column is guaranteed to exist.
    await run(client, `
      UPDATE org_settings
      SET    subscription_status =
               CASE
                 WHEN trial_ends_at IS NOT NULL
                      AND trial_ends_at > NOW()                            THEN 'trialing'
                 WHEN stripe_customer_id IS NOT NULL
                      AND stripe_customer_id <> ''                         THEN 'incomplete'
                 ELSE                                                            'none'
               END,
             updated_at = NOW()
      WHERE  subscription_status = 'active'
        AND  (stripe_subscription_id IS NULL OR stripe_subscription_id = '')
        AND  org_id NOT LIKE 'test\_%';
    `);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS addons              JSONB NOT NULL DEFAULT '{}';`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS usage               JSONB NOT NULL DEFAULT '{}';`);
    // Locale / timezone columns
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS timezone    TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS language    TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS currency    TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS date_format TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS time_format TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS pending_plan      TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS pending_plan_date TEXT;`);
    // Location extended
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS region      TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS phone       TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS vat         TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS postal_code TEXT;`);

    // ── org_checklist — server-side checklist persistence (replaces localStorage) ─
    await run(client, `
      CREATE TABLE IF NOT EXISTS org_checklist (
        org_id     TEXT        PRIMARY KEY,
        items      JSONB       NOT NULL DEFAULT '[]',
        extra      JSONB       NOT NULL DEFAULT '{}',
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // ── growth_objectives ────────────────────────────────────────────────────
    await run(client, `
      CREATE TABLE IF NOT EXISTS growth_objectives (
        id          TEXT        PRIMARY KEY,
        org_id      TEXT        NOT NULL,
        label       TEXT        NOT NULL,
        target      NUMERIC     NOT NULL DEFAULT 0,
        unit        TEXT        NOT NULL DEFAULT '',
        deadline    TEXT        NOT NULL DEFAULT '',
        next_action TEXT        NOT NULL DEFAULT '',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS growth_objectives_org_idx ON growth_objectives(org_id);`);

    // ── seo_forecasts (with tenant isolation via org_id) ────────────────────
    await run(client, `
      CREATE TABLE IF NOT EXISTS seo_forecasts (
        id                    TEXT        PRIMARY KEY,
        org_id                TEXT        NOT NULL DEFAULT 'default',
        site_url              TEXT        NOT NULL,
        forecast_date         DATE        NOT NULL,
        predicted_traffic     INT         NOT NULL DEFAULT 0,
        predicted_conversions INT         NOT NULL DEFAULT 0,
        predicted_revenue     NUMERIC     NOT NULL DEFAULT 0,
        confidence            INT         NOT NULL DEFAULT 75,
        scenario              TEXT        NOT NULL DEFAULT 'realistic',
        source                TEXT        NOT NULL DEFAULT 'legacy',
        generated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (org_id, site_url, forecast_date, scenario)
      );
    `);
    // Additive migration: add org_id to existing rows that were inserted without it
    await run(client, `ALTER TABLE seo_forecasts ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'default';`);
    // Forecasts created before provenance existed are intentionally treated as
    // legacy data and are never shown as real predictions.
    await run(client, `ALTER TABLE seo_forecasts ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'legacy';`);
    await run(client, `CREATE INDEX IF NOT EXISTS seo_forecasts_org_site_idx ON seo_forecasts(org_id, site_url);`);
    // Drop old unique constraint that lacks org_id (idempotent — no-op if already gone)
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'seo_forecasts_site_url_forecast_date_scenario_key'
            AND conrelid = 'seo_forecasts'::regclass
        ) THEN
          ALTER TABLE seo_forecasts DROP CONSTRAINT seo_forecasts_site_url_forecast_date_scenario_key;
        END IF;
      END $$;
    `);

    // ── Schema verification: log Present/Expected/Missing + auto-repair ─────────
    await verifyTeamMembersSchema(client);

    // ── organizations table (Wave 3 Lot A) ───────────────────────────────────
    // Provides a first-class organization record for every org.
    // Backfilled from org_settings so existing orgs are not orphaned.
    // organizations.id is UUID — the canonical authoritative type.
    // The UUID→TEXT downgrade blocks that previously lived here have been removed;
    // they were the root cause of SQLSTATE 42804/0A000 boot errors.
    // A one-time migration (fix-org-uuid-relations-v1, further below) handles
    // any legacy TEXT ids on existing databases.
    await run(client, `
      CREATE TABLE IF NOT EXISTS organizations (
        id               UUID        NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
        name             TEXT        NOT NULL DEFAULT '',
        slug             TEXT        NOT NULL DEFAULT '',
        owner_user_id    TEXT        NOT NULL DEFAULT '',
        status           TEXT        NOT NULL DEFAULT 'active',
        plan             TEXT        NOT NULL DEFAULT 'standard',
        stripe_customer_id      TEXT,
        stripe_subscription_id  TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // Backfill: insert one row per org_settings entry (idempotent via ON CONFLICT DO NOTHING).
    // Only runs when organizations.id is TEXT — on UUID databases (new installs or post-migration)
    // org_settings.org_id may contain email addresses which cannot be cast to UUID,
    // so this backfill is intentionally skipped; orgs are created via the signup flow instead.
    await run(client, `
      DO $$ DECLARE org_id_type TEXT;
      BEGIN
        SELECT data_type INTO org_id_type
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name='organizations' AND column_name='id';

        IF org_id_type = 'text' THEN
          INSERT INTO organizations (id, name, slug, owner_user_id, status, plan,
                                      stripe_customer_id, stripe_subscription_id, created_at, updated_at)
          SELECT
            org_id                                AS id,
            COALESCE(NULLIF(org_name, ''), org_id) AS name,
            LOWER(REGEXP_REPLACE(COALESCE(NULLIF(org_name,''), org_id), '[^a-z0-9]+', '-', 'gi')) AS slug,
            org_id                                AS owner_user_id,
            CASE WHEN subscription_status IN ('active','trialing') THEN 'active'
                 WHEN subscription_status = 'canceled' THEN 'inactive'
                 ELSE 'active' END                AS status,
            COALESCE(NULLIF(plan,''), 'standard') AS plan,
            NULLIF(stripe_customer_id,'')         AS stripe_customer_id,
            NULL                                  AS stripe_subscription_id,
            COALESCE(created_at, NOW())           AS created_at,
            NOW()                                 AS updated_at
          FROM org_settings
          ON CONFLICT (id) DO NOTHING;
        END IF;
      END $$;
    `);
    // Additive columns on existing organizations table (safe re-runs)
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS slug TEXT NOT NULL DEFAULT '';`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS owner_user_id TEXT NOT NULL DEFAULT '';`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'standard';`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
    await run(client, `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
    await run(client, `CREATE INDEX IF NOT EXISTS organizations_owner_idx ON organizations(owner_user_id);`);
    await run(client, `CREATE INDEX IF NOT EXISTS organizations_slug_idx  ON organizations(slug);`);

    // ── team_invitations — dedicated invitation table (Wave 3 Lot B) ─────────
    // Invitations are decoupled from team_members: pending/accepted/expired/revoked.
    // When an invitation is accepted, a team_members row with status='active' is created.
    // Token is stored as SHA-256 hash only (raw token delivered by email, never stored).
    await run(client, `
      CREATE TABLE IF NOT EXISTS team_invitations (
        id                 TEXT        NOT NULL PRIMARY KEY,
        org_id             TEXT        NOT NULL DEFAULT 'default',
        email              TEXT        NOT NULL DEFAULT '',
        role               TEXT        NOT NULL DEFAULT 'viewer',
        token_hash         TEXT        NOT NULL DEFAULT '',
        status             TEXT        NOT NULL DEFAULT 'pending',
        invited_by_user_id TEXT,
        expires_at         TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
        accepted_at        TIMESTAMPTZ,
        revoked_at         TIMESTAMPTZ,
        resend_count       INTEGER     NOT NULL DEFAULT 0,
        last_resent_at     TIMESTAMPTZ,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await run(client, `ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS id                 TEXT NOT NULL DEFAULT '';`);
    await run(client, `ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS org_id             TEXT NOT NULL DEFAULT 'default';`);
    await run(client, `ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS email              TEXT NOT NULL DEFAULT '';`);
    await run(client, `ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS role               TEXT NOT NULL DEFAULT 'viewer';`);
    await run(client, `ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS token_hash         TEXT NOT NULL DEFAULT '';`);
    await run(client, `ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS status             TEXT NOT NULL DEFAULT 'pending';`);
    await run(client, `ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS invited_by_user_id TEXT;`);
    await run(client, `ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS expires_at         TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days');`);
    await run(client, `ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS accepted_at        TIMESTAMPTZ;`);
    await run(client, `ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS revoked_at         TIMESTAMPTZ;`);
    await run(client, `ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS resend_count       INTEGER NOT NULL DEFAULT 0;`);
    await run(client, `ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS last_resent_at     TIMESTAMPTZ;`);
    await run(client, `ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
    await run(client, `ALTER TABLE team_invitations ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
    // Indexes
    await run(client, `CREATE INDEX IF NOT EXISTS team_invitations_org_idx      ON team_invitations(org_id);`);
    await run(client, `CREATE INDEX IF NOT EXISTS team_invitations_token_idx    ON team_invitations(token_hash);`);
    await run(client, `CREATE INDEX IF NOT EXISTS team_invitations_email_idx    ON team_invitations(org_id, lower(email));`);
    await run(client, `CREATE INDEX IF NOT EXISTS team_invitations_status_idx   ON team_invitations(org_id, status);`);
    // One pending invitation per (org_id, email) — prevent duplicate pending invites
    await run(client, `
      CREATE UNIQUE INDEX IF NOT EXISTS team_invitations_pending_email_idx
      ON team_invitations (org_id, lower(email))
      WHERE status = 'pending';
    `);
    // Token hash uniqueness (globally unique per invitation)
    await run(client, `
      CREATE UNIQUE INDEX IF NOT EXISTS team_invitations_token_hash_unique_idx
      ON team_invitations (token_hash)
      WHERE status = 'pending';
    `);

    // ── team_members — new columns for active member tracking (Wave 3 Lot B) ──
    await run(client, `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS user_id            TEXT;`);
    await run(client, `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS first_name         TEXT;`);
    await run(client, `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS last_name          TEXT;`);
    await run(client, `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS invited_by_user_id TEXT;`);
    await run(client, `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS joined_at          TIMESTAMPTZ;`);
    await run(client, `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS resend_count       INTEGER NOT NULL DEFAULT 0;`);

    // ── team_members status constraint ───────────────────────────────────────
    // Sanitize first, then enforce.
    await run(client, `
      UPDATE team_members
      SET status = 'active'
      WHERE status IS NULL OR status NOT IN ('active','pending','removed','suspended');
    `);
    await run(client, `ALTER TABLE team_members DROP CONSTRAINT IF EXISTS team_members_status_check;`);
    await run(client, `
      ALTER TABLE team_members
        ADD CONSTRAINT team_members_status_check
        CHECK (status IN ('active','pending','removed','suspended'));
    `);

    // ── team_invitations role constraint ─────────────────────────────────────
    // Owners cannot be invited (invite always creates admin/member/viewer).
    await run(client, `
      UPDATE team_invitations
      SET role = 'viewer'
      WHERE role IS NULL OR role NOT IN ('admin','member','viewer');
    `);
    await run(client, `ALTER TABLE team_invitations DROP CONSTRAINT IF EXISTS team_invitations_role_check;`);
    await run(client, `
      ALTER TABLE team_invitations
        ADD CONSTRAINT team_invitations_role_check
        CHECK (role IN ('admin','member','viewer'));
    `);

    // ── team_invitations status constraint ───────────────────────────────────
    await run(client, `
      UPDATE team_invitations
      SET status = 'pending'
      WHERE status IS NULL OR status NOT IN ('pending','accepted','revoked','expired');
    `);
    await run(client, `ALTER TABLE team_invitations DROP CONSTRAINT IF EXISTS team_invitations_status_check;`);
    await run(client, `
      ALTER TABLE team_invitations
        ADD CONSTRAINT team_invitations_status_check
        CHECK (status IN ('pending','accepted','revoked','expired'));
    `);

    // ── behavior_events / behavior_sessions / behavior_insights — org_id column ─
    // Wave 4 Lot 4B-S: add org_id to behavioral tables that were created without it.
    // Each block is wrapped in IF EXISTS so startup never raises 42P01 when the
    // behavioral module has not been deployed to this environment.
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='behavior_events') THEN
          EXECUTE 'ALTER TABLE behavior_events ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT ''default''';
          EXECUTE 'CREATE INDEX IF NOT EXISTS behavior_events_org_id_idx ON behavior_events(org_id)';
          IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='behavior_site_tokens') THEN
            EXECUTE $upd$
              UPDATE behavior_events be SET org_id = bst.org_id
              FROM behavior_site_tokens bst
              WHERE be.site_url = bst.site_url AND be.org_id = 'default'
                AND bst.org_id IS NOT NULL AND bst.org_id <> ''
            $upd$;
          END IF;
        END IF;
      END $$;
    `);

    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='behavior_sessions') THEN
          EXECUTE 'ALTER TABLE behavior_sessions ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT ''default''';
          EXECUTE 'CREATE INDEX IF NOT EXISTS behavior_sessions_org_id_idx ON behavior_sessions(org_id)';
          IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='behavior_site_tokens') THEN
            EXECUTE $upd$
              UPDATE behavior_sessions bs SET org_id = bst.org_id
              FROM behavior_site_tokens bst
              WHERE bs.site_url = bst.site_url AND bs.org_id = 'default'
                AND bst.org_id IS NOT NULL AND bst.org_id <> ''
            $upd$;
          END IF;
        END IF;
      END $$;
    `);

    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='behavior_insights') THEN
          EXECUTE 'ALTER TABLE behavior_insights ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT ''default''';
          EXECUTE 'ALTER TABLE behavior_insights ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT ''open''';
          EXECUTE 'CREATE INDEX IF NOT EXISTS behavior_insights_org_id_idx ON behavior_insights(org_id)';
          IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='behavior_site_tokens') THEN
            EXECUTE $upd$
              UPDATE behavior_insights bi SET org_id = bst.org_id
              FROM behavior_site_tokens bst
              WHERE bi.site_url = bst.site_url AND bi.org_id = 'default'
                AND bst.org_id IS NOT NULL AND bst.org_id <> ''
            $upd$;
          END IF;
        END IF;
      END $$;
    `);

    // ── traffic_losses — org_id column + FORCE RLS ────────────────────────────
    // traffic_losses existed with USING=(true) RLS; add org_id for proper isolation.
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'traffic_losses') THEN
          EXECUTE 'ALTER TABLE traffic_losses ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT ''default''';
          EXECUTE 'CREATE INDEX IF NOT EXISTS traffic_losses_org_id_idx ON traffic_losses(org_id)';
          EXECUTE 'ALTER TABLE traffic_losses ENABLE ROW LEVEL SECURITY';
        END IF;
      END $$;
    `);

    // ── cro_recommendations — add org_id, source, fix ai_generated type ──────
    // Wrapped in IF EXISTS: table absent on deployments without the CRO module.
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='cro_recommendations') THEN
          EXECUTE 'ALTER TABLE cro_recommendations ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT ''default''';
          EXECUTE 'ALTER TABLE cro_recommendations ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT ''rules''';
          -- Convert ai_generated text → boolean only if still text type
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name='cro_recommendations' AND column_name='ai_generated'
              AND data_type IN ('character varying','text')
          ) THEN
            EXECUTE 'ALTER TABLE cro_recommendations ALTER COLUMN ai_generated DROP DEFAULT';
            EXECUTE 'ALTER TABLE cro_recommendations ALTER COLUMN ai_generated TYPE BOOLEAN USING (ai_generated = ''true'')';
            EXECUTE 'ALTER TABLE cro_recommendations ALTER COLUMN ai_generated SET DEFAULT false';
            EXECUTE 'UPDATE cro_recommendations SET ai_generated = false WHERE ai_generated = true';
          END IF;
          EXECUTE 'CREATE INDEX IF NOT EXISTS cro_recommendations_org_id_idx ON cro_recommendations(org_id)';
        END IF;
      END $$;
    `);

    // ── cro_scores / cro_experiments — add org_id ─────────────────────────────
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='cro_scores') THEN
          EXECUTE 'ALTER TABLE cro_scores ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT ''default''';
          EXECUTE 'CREATE INDEX IF NOT EXISTS cro_scores_org_id_idx ON cro_scores(org_id)';
        END IF;
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='cro_experiments') THEN
          EXECUTE 'ALTER TABLE cro_experiments ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT ''default''';
          EXECUTE 'CREATE INDEX IF NOT EXISTS cro_experiments_org_id_idx ON cro_experiments(org_id)';
        END IF;
      END $$;
    `);

    // ── revenue_leaks — add org_id ────────────────────────────────────────────
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='revenue_leaks') THEN
          EXECUTE 'ALTER TABLE revenue_leaks ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT ''default''';
          EXECUTE 'CREATE INDEX IF NOT EXISTS revenue_leaks_org_id_idx ON revenue_leaks(org_id)';
        END IF;
      END $$;
    `);

    // ── Fix RLS on behavioral/CRO tables: USING=(true) → org_id filter ───────
    // Drop both old *_isolation policies AND old tenant_* permissive bypass policies.
    // Old tenant_select/update/delete with USING(true) coexist with *_isolation ALL
    // and because PostgreSQL OR-fuses permissive policies, USING(true) wins → bypass.
    await run(client, `
      DO $$ DECLARE t TEXT; p TEXT;
      BEGIN
        FOREACH t IN ARRAY ARRAY['behavior_events','behavior_sessions','behavior_insights',
                                  'traffic_losses','cro_recommendations','cro_scores',
                                  'cro_experiments','revenue_leaks']
        LOOP
          -- Guard: skip tables that do not yet exist (prevents 42P01 relation not found).
          -- DROP POLICY IF EXISTS only suppresses a missing policy, NOT a missing table.
          IF to_regclass('public.' || t) IS NULL THEN
            CONTINUE;
          END IF;
          FOREACH p IN ARRAY ARRAY['tenant_select','tenant_insert','tenant_update','tenant_delete',
                                    'behavior_events_isolation','behavior_sessions_isolation',
                                    'behavior_insights_isolation','cro_recommendations_isolation',
                                    'cro_scores_isolation','cro_experiments_isolation',
                                    'revenue_leaks_isolation','traffic_losses_isolation']
          LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON %I', p, t);
          END LOOP;
        END LOOP;
      END $$;
    `);
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'behavior_events' AND rowsecurity = true) THEN
          CREATE POLICY behavior_events_isolation ON behavior_events
            USING (org_id = current_setting('app.current_org_id', true));
        END IF;
      END $$;
    `);
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'behavior_sessions' AND rowsecurity = true) THEN
          CREATE POLICY behavior_sessions_isolation ON behavior_sessions
            USING (org_id = current_setting('app.current_org_id', true));
        END IF;
      END $$;
    `);
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'behavior_insights' AND rowsecurity = true) THEN
          CREATE POLICY behavior_insights_isolation ON behavior_insights
            USING (org_id = current_setting('app.current_org_id', true));
        END IF;
      END $$;
    `);
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'cro_recommendations' AND rowsecurity = true) THEN
          CREATE POLICY cro_recommendations_isolation ON cro_recommendations
            USING (org_id = current_setting('app.current_org_id', true));
        END IF;
      END $$;
    `);
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'cro_scores' AND rowsecurity = true) THEN
          CREATE POLICY cro_scores_isolation ON cro_scores
            USING (org_id = current_setting('app.current_org_id', true));
        END IF;
      END $$;
    `);
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'cro_experiments' AND rowsecurity = true) THEN
          CREATE POLICY cro_experiments_isolation ON cro_experiments
            USING (org_id = current_setting('app.current_org_id', true));
        END IF;
      END $$;
    `);
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'revenue_leaks' AND rowsecurity = true) THEN
          CREATE POLICY revenue_leaks_isolation ON revenue_leaks
            USING (org_id = current_setting('app.current_org_id', true));
        END IF;
      END $$;
    `);

    // ── traffic_losses — FORCE RLS + isolation policy ─────────────────────────
    // RLS was already enabled; add FORCE RLS so superuser connections (pooler)
    // are also subject to the policy, and add the org_id isolation policy.
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'traffic_losses') THEN
          EXECUTE 'ALTER TABLE traffic_losses ENABLE ROW LEVEL SECURITY';
          EXECUTE 'ALTER TABLE traffic_losses FORCE ROW LEVEL SECURITY';
          IF NOT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE tablename = 'traffic_losses' AND policyname = 'traffic_losses_isolation'
          ) THEN
            EXECUTE 'CREATE POLICY traffic_losses_isolation ON traffic_losses
              FOR ALL
              USING (org_id = current_setting(''app.current_org_id'', true))
              WITH CHECK (org_id = current_setting(''app.current_org_id'', true))';
          END IF;
        END IF;
      END $$;
    `);

    // ── funnels + funnel_steps ────────────────────────────────────────────────
    await run(client, `
      CREATE TABLE IF NOT EXISTS funnels (
        id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id              TEXT         NOT NULL,
        site_url            TEXT         NOT NULL,
        name                TEXT         NOT NULL CHECK (trim(name) <> ''),
        description         TEXT,
        ga4_property_id     TEXT,
        is_open_funnel      BOOLEAN      NOT NULL DEFAULT false,
        lookback_days       INTEGER      NOT NULL DEFAULT 30
                                         CHECK (lookback_days BETWEEN 1 AND 365),
        breakdown_dimension TEXT,
        created_by          TEXT,
        created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);
    await run(client, `
      CREATE TABLE IF NOT EXISTS funnel_steps (
        id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id                TEXT         NOT NULL,
        funnel_id             UUID         NOT NULL,
        position              INTEGER      NOT NULL CHECK (position BETWEEN 1 AND 10),
        name                  TEXT         NOT NULL CHECK (trim(name) <> ''),
        event_name            TEXT,
        page_path_match_type  TEXT,
        page_path_value       TEXT,
        parameter_filters     JSONB,
        created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        UNIQUE (funnel_id, position)
      );
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS funnels_org_id_idx          ON funnels(org_id);`);
    await run(client, `CREATE INDEX IF NOT EXISTS funnels_org_site_idx         ON funnels(org_id, site_url);`);
    await run(client, `CREATE INDEX IF NOT EXISTS funnel_steps_org_id_idx      ON funnel_steps(org_id);`);
    await run(client, `CREATE INDEX IF NOT EXISTS funnel_steps_funnel_pos_idx  ON funnel_steps(funnel_id, position);`);

    // Self-healing: add pageLocation columns to funnel_steps if missing
    await run(client, `ALTER TABLE funnel_steps ADD COLUMN IF NOT EXISTS page_location_match_type TEXT;`);
    await run(client, `ALTER TABLE funnel_steps ADD COLUMN IF NOT EXISTS page_location_value TEXT;`);

    // RLS for funnels
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'funnels') THEN
          EXECUTE 'ALTER TABLE funnels ENABLE ROW LEVEL SECURITY';
          EXECUTE 'ALTER TABLE funnels FORCE ROW LEVEL SECURITY';
        END IF;
      END $$;
    `);
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'funnels') THEN
          DROP POLICY IF EXISTS funnels_isolation ON funnels;
          DROP POLICY IF EXISTS tenant_select     ON funnels;
          DROP POLICY IF EXISTS tenant_insert     ON funnels;
          DROP POLICY IF EXISTS tenant_update     ON funnels;
          DROP POLICY IF EXISTS tenant_delete     ON funnels;
        END IF;
      END $$;
    `);
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'funnels' AND rowsecurity = true) THEN
          EXECUTE 'CREATE POLICY funnels_isolation ON funnels
            FOR ALL
            USING (org_id = current_setting(''app.current_org_id'', true))
            WITH CHECK (org_id = current_setting(''app.current_org_id'', true))';
        END IF;
      END $$;
    `);

    // RLS for funnel_steps
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'funnel_steps') THEN
          EXECUTE 'ALTER TABLE funnel_steps ENABLE ROW LEVEL SECURITY';
          EXECUTE 'ALTER TABLE funnel_steps FORCE ROW LEVEL SECURITY';
        END IF;
      END $$;
    `);
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'funnel_steps') THEN
          DROP POLICY IF EXISTS funnel_steps_isolation ON funnel_steps;
          DROP POLICY IF EXISTS tenant_select          ON funnel_steps;
          DROP POLICY IF EXISTS tenant_insert          ON funnel_steps;
          DROP POLICY IF EXISTS tenant_update          ON funnel_steps;
          DROP POLICY IF EXISTS tenant_delete          ON funnel_steps;
        END IF;
      END $$;
    `);
    await run(client, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'funnel_steps' AND rowsecurity = true) THEN
          EXECUTE 'CREATE POLICY funnel_steps_isolation ON funnel_steps
            FOR ALL
            USING (org_id = current_setting(''app.current_org_id'', true))
            WITH CHECK (org_id = current_setting(''app.current_org_id'', true))';
        END IF;
      END $$;
    `);

    // ── local_pack_history — persists Local Pack positions from DataForSEO/GBP scans ──
    await run(client, `
      CREATE TABLE IF NOT EXISTS local_pack_history (
        id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id          TEXT         NOT NULL,
        recorded_date   DATE         NOT NULL DEFAULT CURRENT_DATE,
        avg_position    NUMERIC(5,2),
        in_pack_count   INTEGER      DEFAULT 0,
        keyword_count   INTEGER      DEFAULT 0,
        source          TEXT         NOT NULL DEFAULT 'dataforseo',
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS local_pack_history_org_date_idx ON local_pack_history(org_id, recorded_date DESC);`);
    await run(client, `CREATE UNIQUE INDEX IF NOT EXISTS local_pack_history_org_date_src_uidx ON local_pack_history(org_id, recorded_date, source);`);

    // ── overview_insights_cache — persistent AI insights cache (context-hash dedup) ──
    await run(client, `
      CREATE TABLE IF NOT EXISTS overview_insights_cache (
        org_id          TEXT         NOT NULL,
        content         TEXT         NOT NULL,
        context_hash    TEXT         NOT NULL,
        generated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        expires_at      TIMESTAMPTZ  NOT NULL,
        PRIMARY KEY (org_id)
      );
    `);

    // ── overview_insights_rl — PG-based rate limit + generation mutex ──────────
    await run(client, `
      CREATE TABLE IF NOT EXISTS overview_insights_rl (
        org_id        TEXT         PRIMARY KEY,
        window_start  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        gen_count     INTEGER      NOT NULL DEFAULT 0,
        generating    BOOLEAN      NOT NULL DEFAULT FALSE,
        gen_started   TIMESTAMPTZ,
        last_gen_at   TIMESTAMPTZ
      );
    `);

    // ── pending_signups — temporary pre-registration storage (new signup flow) ──
    // Rows expire after 2 hours. No account exists until Stripe payment is confirmed.
    await run(client, `
      CREATE TABLE IF NOT EXISTS pending_signups (
        token        TEXT         PRIMARY KEY,
        email        TEXT         NOT NULL,
        first_name   TEXT         NOT NULL,
        last_name    TEXT         NOT NULL,
        company_name TEXT         NOT NULL,
        country      TEXT,
        address      TEXT,
        city         TEXT,
        postal_code  TEXT,
        phone        TEXT,
        vat          TEXT,
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        expires_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW() + INTERVAL '2 hours'
      );
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS pending_signups_email_idx   ON pending_signups(email);`);
    await run(client, `CREATE INDEX IF NOT EXISTS pending_signups_expires_idx ON pending_signups(expires_at);`);
    await run(client, `ALTER TABLE pending_signups ADD COLUMN IF NOT EXISTS consumed_at      TIMESTAMPTZ`);
    await run(client, `ALTER TABLE pending_signups ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`);

    // ── Deduplicate & purge before creating unique index ──────────────────────
    // Step 1: Delete expired unconsumed rows. These have consumed_at IS NULL but
    // expires_at < NOW(), so they can never be used — but they DO block the unique
    // index below, causing legitimate retry attempts to fail.
    await run(client, `
      DELETE FROM pending_signups
        WHERE consumed_at IS NULL AND expires_at < NOW()
    `);
    // Step 2: Remove older duplicate non-consumed rows, keeping the most recent
    // one per email. Tie-breaker on token (lexicographic) handles rows with
    // identical created_at, ensuring exactly one survivor per email regardless.
    await run(client, `
      DELETE FROM pending_signups ps
        WHERE consumed_at IS NULL
          AND EXISTS (
            SELECT 1 FROM pending_signups ps2
             WHERE lower(ps2.email) = lower(ps.email)
               AND ps2.consumed_at IS NULL
               AND (ps2.created_at > ps.created_at
                    OR (ps2.created_at = ps.created_at AND ps2.token > ps.token))
          )
    `);
    // Step 3: Create unique index (only one unconsumed row per email at a time).
    // We intentionally bypass the run() helper here so that a failure is surfaced
    // as an explicit error log rather than a silent warn — failing to create this
    // index means the race-condition guard is not in effect.
    try {
      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS pending_signups_email_active_uniq
          ON pending_signups(lower(email))
          WHERE consumed_at IS NULL
      `);
      logger.info("[init] pending_signups unique email index OK");
    } catch (idxErr) {
      logger.error(
        { err: (idxErr as Error).message },
        "[init] FAILED to create pending_signups_email_active_uniq — " +
        "race-condition guard NOT active; check for remaining duplicate rows"
      );
    }

    // ── magic_link_tokens — single-use magic link storage ──────────────────────
    // Referenced by auth.ts (storeMagicToken / atomicConsumeToken / peekToken).
    // Must be created here (not only in migrations/*.sql which don't auto-run in prod).
    await run(client, `
      CREATE TABLE IF NOT EXISTS magic_link_tokens (
        token       TEXT         PRIMARY KEY,
        email       TEXT         NOT NULL,
        expires_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW() + INTERVAL '15 minutes',
        used        BOOLEAN      NOT NULL DEFAULT FALSE,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS magic_link_tokens_email_idx ON magic_link_tokens(email);`);
    await run(client, `CREATE INDEX IF NOT EXISTS magic_link_tokens_expires_idx ON magic_link_tokens(expires_at);`);
    // Remove expired/used tokens to keep the table small
    await run(client, `
      DELETE FROM magic_link_tokens
        WHERE expires_at < NOW() - INTERVAL '1 day'
           OR used = true
    `).catch(() => { /* non-fatal cleanup */ });

    // ── activity_logs — event feed for dashboard activity panel ────────────────
    await run(client, `
      CREATE TABLE IF NOT EXISTS activity_logs (
        id          TEXT        PRIMARY KEY,
        org_id      TEXT        NOT NULL DEFAULT 'default',
        type        TEXT        NOT NULL DEFAULT 'misc',
        label       TEXT        NOT NULL DEFAULT '',
        target_id   TEXT,
        target_type TEXT,
        metadata    JSONB       NOT NULL DEFAULT '{}',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS activity_logs_org_created_idx ON activity_logs(org_id, created_at DESC);`);
    await run(client, `CREATE INDEX IF NOT EXISTS activity_logs_type_idx ON activity_logs(type);`);
    // Self-healing columns — ensure rows from older schemas are compatible
    await run(client, `ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS org_id      TEXT NOT NULL DEFAULT 'default'`);
    await run(client, `ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS target_id   TEXT`);
    await run(client, `ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS target_type TEXT`);
    await run(client, `ALTER TABLE activity_logs ADD COLUMN IF NOT EXISTS metadata    JSONB NOT NULL DEFAULT '{}'`);
    // ── RLS on activity_logs — enable inline so it takes effect on first boot ──
    // init-rls-migration runs before this table is created on the slow path;
    // adding ENABLE here ensures the table has RLS immediately after creation.
    // NO FORCE: backend accesses via raw pool.query() (superuser BYPASSRLS).
    // Tenant policies (4 × CRUD) are added by init-rls-migration on next run.
    await run(client, `ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY`);
    await run(client, `ALTER TABLE activity_logs NO FORCE ROW LEVEL SECURITY`);

    // ── user_sessions — self-heal ip_address + user_agent columns ──────────────
    // These columns may not exist on older deployments (table was created before
    // login history feature). Add idempotently so the INSERT in sessions.ts works.
    await run(client, `ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS ip_address TEXT`);
    await run(client, `ALTER TABLE user_sessions ADD COLUMN IF NOT EXISTS user_agent TEXT`);

    // ── P1-3 : schema_migrations — per-block migration tracking ───────────────
    // Tracks which migration blocks have been applied so expensive CREATE TABLE
    // blocks are skipped on subsequent boots.  Self-healing ALTER TABLE blocks
    // still run unconditionally (they are idempotent and protect against drift).
    await run(client, `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id           SERIAL      PRIMARY KEY,
        migration_id TEXT        UNIQUE NOT NULL,
        executed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        checksum     TEXT
      )
    `);
    // ── RLS on schema_migrations — backend-only, no public policies ────────────
    // This table must never be readable by anon/authenticated (PostgREST) clients.
    // ENABLE RLS with no public policies = implicit deny-all for client roles.
    // NO FORCE: backend pool.query() uses postgres superuser (BYPASSRLS) so we
    // keep FORCE off while the app relies on raw pool.query() throughout.
    // REVOKE is belt-and-suspenders in case anon/authenticated have SELECT grants.
    await run(client, `ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY`);
    await run(client, `ALTER TABLE schema_migrations NO FORCE ROW LEVEL SECURITY`);
    await run(client, `REVOKE ALL ON schema_migrations FROM anon`);
    await run(client, `REVOKE ALL ON schema_migrations FROM authenticated`);

    // Helper: returns true if a migration_id has already been recorded.
    const hasMigration = async (migId: string): Promise<boolean> => {
      try {
        const r = await client.query<{ c: number }>(
          `SELECT COUNT(*)::int AS c FROM schema_migrations WHERE migration_id = $1`,
          [migId],
        );
        return Number(r.rows[0]?.c ?? 0) > 0;
      } catch { return false; }
    };
    const recordMigration = async (migId: string): Promise<void> => {
      await run(client, `INSERT INTO schema_migrations (migration_id) VALUES ('${migId}') ON CONFLICT DO NOTHING`);
    };

    // ── P0-3 / P0-4 : Missing production tables ────────────────────────────────
    // All 19 tables below were used by production code but had no CREATE TABLE
    // in any init file. They are created here with correct columns + full inline
    // RLS (ENABLE, FORCE, 4 tenant policies).
    //
    // v2 supersedes v1 (which lacked RLS and had wrong github_connections schema).
    // On DBs that ran v1, the schema_migrations record is replaced by v2 so the
    // RLS and github_connections fix are applied exactly once.

    // Inline helper: ENABLE RLS + 4 org-scoped tenant policies on any TEXT-org_id table.
    // Idempotent: DROP POLICY IF EXISTS before CREATE.
    // NOTE: We do NOT set FORCE ROW LEVEL SECURITY here — the 19 new tables are accessed
    // by several services via raw pool/client.query() (no withOrgDb GUC setup).
    // FORCE would deny all access for those services under a non-BYPASSRLS application role.
    // The 4 agent tables (in init-agent-tables.ts) that use req.orgDb/withOrgDb keep FORCE.
    const applyTenantRls = async (t: string): Promise<void> => {
      const GUC = `current_setting('app.current_org_id', true)`;
      await run(client, `ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
      for (const [op, cmd] of [
        ["select", `FOR SELECT USING     (COALESCE(org_id,'default') = ${GUC})`],
        ["insert", `FOR INSERT WITH CHECK (COALESCE(org_id,'default') = ${GUC})`],
        ["update", `FOR UPDATE USING     (COALESCE(org_id,'default') = ${GUC})`],
        ["delete", `FOR DELETE USING     (COALESCE(org_id,'default') = ${GUC})`],
      ] as [string, string][]) {
        await run(client, `DROP   POLICY IF EXISTS "tenant_${op}" ON "${t}"`);
        await run(client, `CREATE POLICY           "tenant_${op}" ON "${t}" ${cmd}`);
      }
    };

    if (!await hasMigration("missing-production-tables-v3")) {
      // Supersede v1 and v2 (v2 had wrong schemas + FORCE RLS for raw-pool services)
      await run(client, `DELETE FROM schema_migrations WHERE migration_id IN ('missing-production-tables-v1','missing-production-tables-v2')`);

      // ── P0-4 : github_connections — exact schema from github-service.ts ─────
      // The service does: INSERT (org_id, github_user_id[number], login, name,
      // email, avatar_url, access_token, scope, connected_at) … ON CONFLICT (org_id)
      // DO UPDATE. Therefore: org_id TEXT UNIQUE (one connection per org),
      // github_user_id BIGINT (GitHub API returns numeric IDs).
      //
      // Approach: CREATE TABLE IF NOT EXISTS for fresh installs.
      // For existing tables with wrong column types, use safe in-place ALTER rather
      // than DROP TABLE which would destroy production OAuth connections.
      await run(client, `
        CREATE TABLE IF NOT EXISTS github_connections (
          id             BIGSERIAL   PRIMARY KEY,
          org_id         TEXT        NOT NULL UNIQUE DEFAULT 'default',
          github_user_id BIGINT      NOT NULL DEFAULT 0,
          login          TEXT,
          name           TEXT,
          email          TEXT,
          avatar_url     TEXT,
          access_token   TEXT,
          scope          TEXT,
          connected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at     TIMESTAMPTZ
        )
      `);
      // Safe in-place repair: if org_id is UUID, cast to TEXT preserving data.
      await run(client, `
        DO $$ BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='github_connections'
              AND column_name='org_id' AND data_type='uuid'
          ) THEN
            ALTER TABLE github_connections
              ALTER COLUMN org_id TYPE TEXT USING org_id::text;
          END IF;
        END $$
      `);
      // If github_user_id is TEXT, cast to BIGINT; rows where cast fails default to 0.
      await run(client, `
        DO $$ BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name='github_connections'
              AND column_name='github_user_id' AND data_type='text'
          ) THEN
            ALTER TABLE github_connections
              ALTER COLUMN github_user_id TYPE BIGINT
                USING CASE WHEN github_user_id ~ '^[0-9]+$'
                           THEN github_user_id::BIGINT ELSE 0 END;
          END IF;
        END $$
      `);
      await run(client, `CREATE INDEX IF NOT EXISTS github_connections_org_idx ON github_connections(org_id)`);
      await applyTenantRls("github_connections");

      // ── permission_logs ─────────────────────────────────────────────────────
      await run(client, `
        CREATE TABLE IF NOT EXISTS permission_logs (
          id         TEXT        PRIMARY KEY,
          org_id     TEXT        NOT NULL DEFAULT 'default',
          user_id    TEXT,
          resource   TEXT        NOT NULL DEFAULT '',
          action     TEXT        NOT NULL DEFAULT '',
          allowed    BOOLEAN     NOT NULL DEFAULT false,
          reason     TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await run(client, `CREATE INDEX IF NOT EXISTS permission_logs_org_idx ON permission_logs(org_id, created_at DESC)`);
      await applyTenantRls("permission_logs");

      // ── report_templates ────────────────────────────────────────────────────
      await run(client, `
        CREATE TABLE IF NOT EXISTS report_templates (
          id                       TEXT        PRIMARY KEY,
          org_id                   TEXT        NOT NULL DEFAULT 'default',
          name                     TEXT        NOT NULL DEFAULT '',
          logo_url                 TEXT,
          primary_color            TEXT,
          secondary_color          TEXT,
          font                     TEXT,
          footer_text              TEXT,
          header_text              TEXT,
          hide_flowpoint_branding  BOOLEAN     NOT NULL DEFAULT false,
          is_default               BOOLEAN     NOT NULL DEFAULT false,
          created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await run(client, `CREATE INDEX IF NOT EXISTS report_templates_org_idx ON report_templates(org_id)`);
      await applyTenantRls("report_templates");

      // ── google_reviews ──────────────────────────────────────────────────────
      await run(client, `
        CREATE TABLE IF NOT EXISTS google_reviews (
          id                TEXT        PRIMARY KEY,
          org_id            TEXT        NOT NULL DEFAULT 'default',
          location_id       TEXT,
          review_id         TEXT        NOT NULL DEFAULT '',
          reviewer_name     TEXT,
          reviewer_photo    TEXT,
          rating            INTEGER,
          comment           TEXT,
          create_time       TEXT,
          update_time       TEXT,
          owner_reply       TEXT,
          reply_comment     TEXT,
          reply_updated_at  TIMESTAMPTZ
        )
      `);
      await run(client, `CREATE UNIQUE INDEX IF NOT EXISTS google_reviews_review_org_idx ON google_reviews(review_id, org_id)`);
      await run(client, `CREATE INDEX IF NOT EXISTS google_reviews_org_loc_idx ON google_reviews(org_id, location_id)`);
      await applyTenantRls("google_reviews");

      // ── gbp_posts — gbp-posting-service.ts UPDATE sets published_at ──────────
      await run(client, `
        CREATE TABLE IF NOT EXISTS gbp_posts (
          id             TEXT        PRIMARY KEY,
          org_id         TEXT        NOT NULL DEFAULT 'default',
          location_id    TEXT,
          location_name  TEXT,
          post_type      TEXT        NOT NULL DEFAULT 'STANDARD',
          title          TEXT,
          content        TEXT        NOT NULL DEFAULT '',
          cta_type       TEXT,
          cta_url        TEXT,
          media_urls     JSONB       NOT NULL DEFAULT '[]',
          event_title    TEXT,
          event_start    TIMESTAMPTZ,
          event_end      TIMESTAMPTZ,
          offer_code     TEXT,
          status         TEXT        NOT NULL DEFAULT 'draft',
          scheduled_at   TIMESTAMPTZ,
          published_at   TIMESTAMPTZ,
          seo_keywords   JSONB       NOT NULL DEFAULT '[]',
          ai_generated   BOOLEAN     NOT NULL DEFAULT false,
          views          INTEGER     NOT NULL DEFAULT 0,
          clicks         INTEGER     NOT NULL DEFAULT 0,
          calls          INTEGER     NOT NULL DEFAULT 0,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await run(client, `CREATE INDEX IF NOT EXISTS gbp_posts_org_idx ON gbp_posts(org_id, created_at DESC)`);
      await applyTenantRls("gbp_posts");

      // ── dataforseo_quota (composite PK; no surrogate id) ────────────────────
      await run(client, `
        CREATE TABLE IF NOT EXISTS dataforseo_quota (
          org_id        TEXT    NOT NULL DEFAULT 'default',
          date          DATE    NOT NULL DEFAULT CURRENT_DATE,
          requests_used INTEGER NOT NULL DEFAULT 0,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (org_id, date)
        )
      `);
      await applyTenantRls("dataforseo_quota");

      // ── roles ───────────────────────────────────────────────────────────────
      await run(client, `
        CREATE TABLE IF NOT EXISTS roles (
          id          TEXT        PRIMARY KEY,
          org_id      TEXT        NOT NULL DEFAULT 'default',
          name        TEXT        NOT NULL DEFAULT '',
          description TEXT,
          is_system   BOOLEAN     NOT NULL DEFAULT false,
          permissions JSONB       NOT NULL DEFAULT '[]',
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await run(client, `CREATE INDEX IF NOT EXISTS roles_org_idx ON roles(org_id)`);
      await applyTenantRls("roles");

      // ── gsc_sites — gsc-service.ts discover INSERT uses permission_level ──────
      await run(client, `
        CREATE TABLE IF NOT EXISTS gsc_sites (
          id               TEXT        PRIMARY KEY,
          org_id           TEXT        NOT NULL DEFAULT 'default',
          site_url         TEXT        NOT NULL DEFAULT '',
          display_name     TEXT,
          permission_level TEXT,
          is_active        BOOLEAN     NOT NULL DEFAULT true,
          created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await run(client, `CREATE UNIQUE INDEX IF NOT EXISTS gsc_sites_org_url_idx ON gsc_sites(org_id, site_url)`);
      await applyTenantRls("gsc_sites");

      // ── reviews ─────────────────────────────────────────────────────────────
      await run(client, `
        CREATE TABLE IF NOT EXISTS reviews (
          id         TEXT        PRIMARY KEY,
          org_id     TEXT        NOT NULL DEFAULT 'default',
          author     TEXT,
          rating     INTEGER,
          text       TEXT,
          sentiment  TEXT,
          platform   TEXT        NOT NULL DEFAULT 'google',
          replied    BOOLEAN     NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await run(client, `CREATE INDEX IF NOT EXISTS reviews_org_idx ON reviews(org_id, created_at DESC)`);
      await applyTenantRls("reviews");

      // ── crm_sync_logs — crm-service.ts uses records_processed/created/failed ─
      await run(client, `
        CREATE TABLE IF NOT EXISTS crm_sync_logs (
          id                  TEXT        PRIMARY KEY,
          org_id              TEXT        NOT NULL DEFAULT 'default',
          crm_integration_id  TEXT,
          provider            TEXT,
          direction           TEXT        NOT NULL DEFAULT 'import',
          entity_type         TEXT,
          status              TEXT        NOT NULL DEFAULT 'pending',
          count               INTEGER     NOT NULL DEFAULT 0,
          records_processed   INTEGER     NOT NULL DEFAULT 0,
          records_created     INTEGER     NOT NULL DEFAULT 0,
          records_updated     INTEGER     NOT NULL DEFAULT 0,
          records_failed      INTEGER     NOT NULL DEFAULT 0,
          duration_ms         INTEGER,
          error               TEXT,
          started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          completed_at        TIMESTAMPTZ
        )
      `);
      await run(client, `CREATE INDEX IF NOT EXISTS crm_sync_logs_org_idx ON crm_sync_logs(org_id, started_at DESC)`);
      await applyTenantRls("crm_sync_logs");

      // ── automation_templates — schema derived from production DB inspection ───
      // integrations-service.ts queries: active=true ORDER BY popularity DESC
      // NOT NULL cols that need defaults: platform, category, trigger_event, action_type
      await run(client, `
        CREATE TABLE IF NOT EXISTS automation_templates (
          id              TEXT        PRIMARY KEY,
          org_id          TEXT        NOT NULL DEFAULT 'default',
          name            TEXT        NOT NULL DEFAULT '',
          description     TEXT,
          platform        TEXT        NOT NULL DEFAULT 'custom',
          category        TEXT        NOT NULL DEFAULT 'general',
          trigger_event   TEXT        NOT NULL DEFAULT '',
          action_type     TEXT        NOT NULL DEFAULT '',
          config_template JSONB                DEFAULT '{}',
          icon            TEXT                 DEFAULT '⚡',
          color           TEXT                 DEFAULT '#2563EB',
          popularity      INTEGER              DEFAULT 0,
          plan_required   TEXT                 DEFAULT 'Standard',
          active          BOOLEAN              DEFAULT true,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await run(client, `CREATE INDEX IF NOT EXISTS automation_templates_org_idx ON automation_templates(org_id)`);
      await applyTenantRls("automation_templates");

      // ── local_heatmaps — local-maps-service.ts INSERT columns ────────────────
      await run(client, `
        CREATE TABLE IF NOT EXISTS local_heatmaps (
          id          TEXT        PRIMARY KEY,
          org_id      TEXT        NOT NULL DEFAULT 'default',
          location_id TEXT,
          name        TEXT,
          keyword     TEXT,
          center_lat  REAL,
          center_lng  REAL,
          lat         REAL,
          lng         REAL,
          radius_km   REAL,
          grid_size   INTEGER     NOT NULL DEFAULT 5,
          status      TEXT        NOT NULL DEFAULT 'pending',
          results     JSONB       NOT NULL DEFAULT '[]',
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await run(client, `CREATE INDEX IF NOT EXISTS local_heatmaps_org_idx ON local_heatmaps(org_id, created_at DESC)`);
      await applyTenantRls("local_heatmaps");

      // ── competitor_map_results — real DataForSEO Maps discoveries ───────────
      await run(client, `
        CREATE TABLE IF NOT EXISTS competitor_map_results (
          id TEXT PRIMARY KEY, org_id TEXT NOT NULL DEFAULT 'default',
          keyword TEXT NOT NULL, location TEXT NOT NULL, place_id TEXT NOT NULL,
          name TEXT NOT NULL, address TEXT, category TEXT, rating REAL,
          review_count INTEGER NOT NULL DEFAULT 0, rank INTEGER,
          photo_url TEXT, authority_score INTEGER NOT NULL DEFAULT 0,
          source TEXT NOT NULL DEFAULT 'dataforseo_maps', fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          UNIQUE(org_id, keyword, location, place_id)
        )
      `);
      await run(client, `CREATE INDEX IF NOT EXISTS competitor_map_results_org_idx ON competitor_map_results(org_id, fetched_at DESC)`);
      await applyTenantRls("competitor_map_results");

      // ── login_audits — sso-service.ts INSERT uses method, failure_reason ─────
      await run(client, `
        CREATE TABLE IF NOT EXISTS login_audits (
          id             TEXT        PRIMARY KEY,
          org_id         TEXT        NOT NULL DEFAULT 'default',
          user_id        TEXT,
          email          TEXT,
          action         TEXT        NOT NULL DEFAULT 'login',
          method         TEXT,
          ip             TEXT,
          user_agent     TEXT,
          success        BOOLEAN     NOT NULL DEFAULT true,
          failure_reason TEXT,
          created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await run(client, `CREATE INDEX IF NOT EXISTS login_audits_org_idx ON login_audits(org_id, created_at DESC)`);
      await run(client, `CREATE INDEX IF NOT EXISTS login_audits_email_idx ON login_audits(email)`);
      await applyTenantRls("login_audits");

      // ── crm_integrations — crm-service.ts INSERT/UPDATE columns ─────────────
      await run(client, `
        CREATE TABLE IF NOT EXISTS crm_integrations (
          id                TEXT        PRIMARY KEY,
          org_id            TEXT        NOT NULL DEFAULT 'default',
          provider          TEXT        NOT NULL DEFAULT '',
          name              TEXT,
          status            TEXT        NOT NULL DEFAULT 'active',
          access_token      TEXT,
          refresh_token     TEXT,
          token_expires_at  TIMESTAMPTZ,
          portal_id         TEXT,
          scope             TEXT,
          instance_url      TEXT,
          metadata          JSONB       NOT NULL DEFAULT '{}',
          last_sync_at      TIMESTAMPTZ,
          last_sync_status  TEXT,
          synced_contacts   INTEGER     NOT NULL DEFAULT 0,
          connected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await run(client, `CREATE UNIQUE INDEX IF NOT EXISTS crm_integrations_org_provider_idx ON crm_integrations(org_id, provider)`);
      await applyTenantRls("crm_integrations");

      // ── google_locations ────────────────────────────────────────────────────
      await run(client, `
        CREATE TABLE IF NOT EXISTS google_locations (
          id              TEXT        PRIMARY KEY,
          org_id          TEXT        NOT NULL DEFAULT 'default',
          location_id     TEXT,
          name            TEXT        NOT NULL DEFAULT '',
          primary_category TEXT,
          rating          REAL,
          reviews_count   INTEGER     NOT NULL DEFAULT 0,
          phone           TEXT,
          website         TEXT,
          lat             REAL,
          lng             REAL,
          raw_data        JSONB       NOT NULL DEFAULT '{}',
          last_sync_at    TIMESTAMPTZ
        )
      `);
      await run(client, `CREATE INDEX IF NOT EXISTS google_locations_org_idx ON google_locations(org_id)`);
      await applyTenantRls("google_locations");

      // ── org_auth_config — sso-service.ts ON CONFLICT(org_id) uses these columns ─
      await run(client, `
        CREATE TABLE IF NOT EXISTS org_auth_config (
          id                TEXT        PRIMARY KEY,
          org_id            TEXT        NOT NULL UNIQUE DEFAULT 'default',
          provider          TEXT,
          client_id         TEXT,
          client_secret     TEXT,
          metadata_url      TEXT,
          enabled           BOOLEAN     NOT NULL DEFAULT false,
          sso_required      BOOLEAN     NOT NULL DEFAULT false,
          allow_magic_link  BOOLEAN     NOT NULL DEFAULT true,
          allow_password    BOOLEAN     NOT NULL DEFAULT true,
          session_ttl_hours INTEGER     NOT NULL DEFAULT 24,
          mfa_enabled       BOOLEAN     NOT NULL DEFAULT false,
          allowed_domains   TEXT[]      NOT NULL DEFAULT '{}',
          created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await applyTenantRls("org_auth_config");

      // ── google_accounts ─────────────────────────────────────────────────────
      await run(client, `
        CREATE TABLE IF NOT EXISTS google_accounts (
          id            TEXT        PRIMARY KEY,
          org_id        TEXT        NOT NULL UNIQUE DEFAULT 'default',
          google_id     TEXT,
          email         TEXT,
          access_token  TEXT,
          refresh_token TEXT,
          token_expiry  TIMESTAMPTZ,
          scopes        JSONB       NOT NULL DEFAULT '[]',
          connected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at    TIMESTAMPTZ
        )
      `);
      await applyTenantRls("google_accounts");

      // ── sso_providers — sso-service.ts uses: type,name,client_id,issuer,default_role ─
      await run(client, `
        CREATE TABLE IF NOT EXISTS sso_providers (
          id           TEXT        PRIMARY KEY,
          org_id       TEXT        NOT NULL DEFAULT 'default',
          type         TEXT        NOT NULL DEFAULT 'saml',
          name         TEXT,
          client_id    TEXT,
          issuer       TEXT,
          enabled      BOOLEAN     NOT NULL DEFAULT true,
          default_role TEXT        NOT NULL DEFAULT 'member',
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await run(client, `CREATE INDEX IF NOT EXISTS sso_providers_org_idx ON sso_providers(org_id)`);
      await applyTenantRls("sso_providers");

      // ── ga4_properties — ga4-service.ts uses property_name; ON CONFLICT(org_id) ─
      await run(client, `
        CREATE TABLE IF NOT EXISTS ga4_properties (
          id            TEXT        PRIMARY KEY,
          org_id        TEXT        NOT NULL UNIQUE DEFAULT 'default',
          account_id    TEXT,
          property_id   TEXT        NOT NULL DEFAULT '',
          property_name TEXT,
          is_active     BOOLEAN     NOT NULL DEFAULT true,
          website_url   TEXT,
          created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await run(client, `CREATE UNIQUE INDEX IF NOT EXISTS ga4_properties_org_idx ON ga4_properties(org_id)`);
      await applyTenantRls("ga4_properties");

      // Verify all 19 tables exist, have RLS enabled, and have all 4 tenant policies
      // before recording the migration. run() swallows individual DDL errors; this
      // spot-check prevents permanently marking a partial migration as complete.
      const VERIFY_TABLES = [
        "github_connections","permission_logs","report_templates","google_reviews",
        "gbp_posts","dataforseo_quota","roles","gsc_sites","reviews","crm_sync_logs",
        "automation_templates","local_heatmaps","login_audits","crm_integrations",
        "google_locations","org_auth_config","google_accounts","sso_providers","ga4_properties",
      ];
      // Also spot-check required columns for the tables with the most critical schema fixes.
      const VERIFY_COLUMNS: Record<string, string[]> = {
        sso_providers:    ["type","name","client_id","issuer","default_role"],
        org_auth_config:  ["sso_required","allow_magic_link","allow_password","session_ttl_hours","mfa_enabled"],
        login_audits:     ["method","failure_reason"],
        ga4_properties:   ["property_name"],
        gsc_sites:        ["permission_level"],
        gbp_posts:        ["published_at"],
        local_heatmaps:   ["location_id","center_lat","radius_km","status"],
        crm_integrations: ["name","status","token_expires_at","portal_id","metadata"],
        crm_sync_logs:       ["records_processed","records_created","records_failed","duration_ms"],
        github_connections:  ["github_user_id","login","connected_at"],
        automation_templates:["active","popularity"],
      };
      const failures: string[] = [];
      for (const t of VERIFY_TABLES) {
        // Table existence
        const te = await client.query<{ e: boolean }>(
          `SELECT to_regclass($1) IS NOT NULL AS e`, [`public.${t}`]
        );
        if (!te.rows[0]?.e) { failures.push(`${t}:missing`); continue; }
        // RLS enabled (not FORCE — these tables use raw pool queries)
        const rlsr = await client.query<{ rls: boolean }>(
          `SELECT c.relrowsecurity AS rls FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = $1`, [t]
        );
        if (!rlsr.rows[0]?.rls) failures.push(`${t}:rls_not_enabled`);
        // All 4 tenant policies
        const pr = await client.query<{ cnt: number }>(
          `SELECT COUNT(*)::int AS cnt FROM pg_policies
           WHERE schemaname='public' AND tablename=$1
             AND policyname LIKE 'tenant_%'`, [t]
        );
        if (Number(pr.rows[0]?.cnt) < 4) failures.push(`${t}:policies_${pr.rows[0]?.cnt}`);
        // Column spot-check
        const reqCols = VERIFY_COLUMNS[t];
        if (reqCols?.length) {
          const colr = await client.query<{ column_name: string }>(
            `SELECT column_name FROM information_schema.columns
             WHERE table_schema='public' AND table_name=$1`, [t]
          );
          const colSet = new Set(colr.rows.map(r => r.column_name));
          for (const col of reqCols) {
            if (!colSet.has(col)) failures.push(`${t}:missing_col_${col}`);
          }
        }
      }
      if (failures.length > 0) {
        logger.warn({ failures }, "[init-data-tables] missing-production-tables-v3: verification failed — NOT recording, will retry on next boot");
      } else {
        await recordMigration("missing-production-tables-v3");
        logger.info("[init-data-tables] missing-production-tables-v3: 19 tables, RLS, policies, and columns verified ✓");
      }
    } else {
      logger.info("[init-data-tables] missing-production-tables-v3: already applied — skipping");
    }

    // ── Self-heal: competitor_map_results ──────────────────────────────────────
    // This table was added to the missing-production-tables-v3 block AFTER some
    // deployments had already recorded v3 in schema_migrations, so the gated
    // CREATE was skipped forever on those DBs (prod 500 on GET
    // /api/local-maps/competitors). Always-run CREATE IF NOT EXISTS repairs it.
    await run(client, `
      CREATE TABLE IF NOT EXISTS competitor_map_results (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL DEFAULT 'default',
        keyword TEXT NOT NULL, location TEXT NOT NULL, place_id TEXT NOT NULL,
        name TEXT NOT NULL, address TEXT, category TEXT, rating REAL,
        review_count INTEGER NOT NULL DEFAULT 0, rank INTEGER,
        photo_url TEXT, authority_score INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'dataforseo_maps', fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(org_id, keyword, location, place_id)
      )
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS competitor_map_results_org_idx ON competitor_map_results(org_id, fetched_at DESC)`);
    await run(client, `ALTER TABLE competitor_map_results ENABLE ROW LEVEL SECURITY`);
    await run(client, `ALTER TABLE competitor_map_results NO FORCE ROW LEVEL SECURITY`);

    // ── Self-healing column additions for tables created by v1/v2 migrations ──
    // These always run (idempotent ADD COLUMN IF NOT EXISTS) to repair existing
    // installs that had the old incomplete schemas from v1/v2 migrations.
    // automation_templates: self-heal all columns, including NOT NULL ones that
    // need backfill before the constraint can be enforced.
    await run(client, `ALTER TABLE automation_templates ADD COLUMN IF NOT EXISTS active         BOOLEAN DEFAULT true`);
    await run(client, `ALTER TABLE automation_templates ADD COLUMN IF NOT EXISTS popularity     INTEGER DEFAULT 0`);
    await run(client, `ALTER TABLE automation_templates ADD COLUMN IF NOT EXISTS platform       TEXT`);
    await run(client, `ALTER TABLE automation_templates ADD COLUMN IF NOT EXISTS trigger_event  TEXT`);
    await run(client, `ALTER TABLE automation_templates ADD COLUMN IF NOT EXISTS action_type    TEXT`);
    await run(client, `ALTER TABLE automation_templates ADD COLUMN IF NOT EXISTS config_template JSONB DEFAULT '{}'`);
    await run(client, `ALTER TABLE automation_templates ADD COLUMN IF NOT EXISTS icon           TEXT DEFAULT '⚡'`);
    await run(client, `ALTER TABLE automation_templates ADD COLUMN IF NOT EXISTS color          TEXT DEFAULT '#2563EB'`);
    await run(client, `ALTER TABLE automation_templates ADD COLUMN IF NOT EXISTS plan_required  TEXT DEFAULT 'Standard'`);
    // Backfill NULLs before setting NOT NULL + DEFAULT
    await run(client, `UPDATE automation_templates SET platform='custom'      WHERE platform      IS NULL`);
    await run(client, `UPDATE automation_templates SET trigger_event=''       WHERE trigger_event IS NULL`);
    await run(client, `UPDATE automation_templates SET action_type=''         WHERE action_type   IS NULL`);
    await run(client, `ALTER TABLE automation_templates ALTER COLUMN platform      SET DEFAULT 'custom'`);
    await run(client, `ALTER TABLE automation_templates ALTER COLUMN trigger_event SET DEFAULT ''`);
    await run(client, `ALTER TABLE automation_templates ALTER COLUMN action_type   SET DEFAULT ''`);
    // sso_providers: rename provider_type→keep old, add new service columns
    await run(client, `ALTER TABLE sso_providers ADD COLUMN IF NOT EXISTS type         TEXT NOT NULL DEFAULT 'saml'`);
    await run(client, `ALTER TABLE sso_providers ADD COLUMN IF NOT EXISTS name         TEXT`);
    await run(client, `ALTER TABLE sso_providers ADD COLUMN IF NOT EXISTS client_id    TEXT`);
    await run(client, `ALTER TABLE sso_providers ADD COLUMN IF NOT EXISTS issuer       TEXT`);
    await run(client, `ALTER TABLE sso_providers ADD COLUMN IF NOT EXISTS default_role TEXT NOT NULL DEFAULT 'member'`);
    // org_auth_config: new SSO config columns
    await run(client, `ALTER TABLE org_auth_config ADD COLUMN IF NOT EXISTS sso_required      BOOLEAN NOT NULL DEFAULT false`);
    await run(client, `ALTER TABLE org_auth_config ADD COLUMN IF NOT EXISTS allow_magic_link  BOOLEAN NOT NULL DEFAULT true`);
    await run(client, `ALTER TABLE org_auth_config ADD COLUMN IF NOT EXISTS allow_password    BOOLEAN NOT NULL DEFAULT true`);
    await run(client, `ALTER TABLE org_auth_config ADD COLUMN IF NOT EXISTS session_ttl_hours INTEGER NOT NULL DEFAULT 24`);
    await run(client, `ALTER TABLE org_auth_config ADD COLUMN IF NOT EXISTS mfa_enabled       BOOLEAN NOT NULL DEFAULT false`);
    await run(client, `ALTER TABLE org_auth_config ADD COLUMN IF NOT EXISTS allowed_domains   TEXT[]  NOT NULL DEFAULT '{}'`);
    // login_audits: method + failure_reason
    await run(client, `ALTER TABLE login_audits ADD COLUMN IF NOT EXISTS method         TEXT`);
    await run(client, `ALTER TABLE login_audits ADD COLUMN IF NOT EXISTS failure_reason TEXT`);
    // ga4_properties: property_name (service uses instead of display_name) + UNIQUE(org_id) for ON CONFLICT
    await run(client, `ALTER TABLE ga4_properties ADD COLUMN IF NOT EXISTS property_name TEXT`);
    await run(client, `CREATE UNIQUE INDEX IF NOT EXISTS ga4_properties_org_idx ON ga4_properties(org_id)`);
    // google_product_connections: ensure table exists + RLS (for installs created before this migration)
    await run(client, `
      CREATE TABLE IF NOT EXISTS google_product_connections (
        org_id     TEXT        NOT NULL,
        product    TEXT        NOT NULL,
        connected  BOOLEAN     NOT NULL DEFAULT true,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (org_id, product)
      )
    `);
    await run(client, `ALTER TABLE google_product_connections ENABLE ROW LEVEL SECURITY`);
    await run(client, `ALTER TABLE google_product_connections FORCE ROW LEVEL SECURITY`);
    await run(client, `
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='google_product_connections' AND policyname='tenant_select') THEN
          CREATE POLICY tenant_select ON google_product_connections FOR SELECT TO PUBLIC
            USING (org_id = current_setting('app.current_org_id', true));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='google_product_connections' AND policyname='tenant_insert') THEN
          CREATE POLICY tenant_insert ON google_product_connections FOR INSERT TO PUBLIC WITH CHECK (true);
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='google_product_connections' AND policyname='tenant_update') THEN
          CREATE POLICY tenant_update ON google_product_connections FOR UPDATE TO PUBLIC
            USING (org_id = current_setting('app.current_org_id', true));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='google_product_connections' AND policyname='tenant_delete') THEN
          CREATE POLICY tenant_delete ON google_product_connections FOR DELETE TO PUBLIC
            USING (org_id = current_setting('app.current_org_id', true));
        END IF;
      END $$
    `);
    // gsc_sites: permission_level
    await run(client, `ALTER TABLE gsc_sites ADD COLUMN IF NOT EXISTS permission_level TEXT`);
    // gbp_posts: published_at
    await run(client, `ALTER TABLE gbp_posts ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ`);
    // local_heatmaps: full new column set
    await run(client, `ALTER TABLE local_heatmaps ADD COLUMN IF NOT EXISTS location_id TEXT`);
    await run(client, `ALTER TABLE local_heatmaps ADD COLUMN IF NOT EXISTS name        TEXT`);
    await run(client, `ALTER TABLE local_heatmaps ADD COLUMN IF NOT EXISTS center_lat  REAL`);
    await run(client, `ALTER TABLE local_heatmaps ADD COLUMN IF NOT EXISTS center_lng  REAL`);
    await run(client, `ALTER TABLE local_heatmaps ADD COLUMN IF NOT EXISTS radius_km   REAL`);
    await run(client, `ALTER TABLE local_heatmaps ADD COLUMN IF NOT EXISTS status      TEXT NOT NULL DEFAULT 'pending'`);
    // crm_integrations: all service columns
    await run(client, `ALTER TABLE crm_integrations ADD COLUMN IF NOT EXISTS name             TEXT`);
    await run(client, `ALTER TABLE crm_integrations ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'active'`);
    await run(client, `ALTER TABLE crm_integrations ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ`);
    await run(client, `ALTER TABLE crm_integrations ADD COLUMN IF NOT EXISTS portal_id        TEXT`);
    await run(client, `ALTER TABLE crm_integrations ADD COLUMN IF NOT EXISTS scope            TEXT`);
    await run(client, `ALTER TABLE crm_integrations ADD COLUMN IF NOT EXISTS metadata         JSONB NOT NULL DEFAULT '{}'`);
    await run(client, `ALTER TABLE crm_integrations ADD COLUMN IF NOT EXISTS last_sync_at     TIMESTAMPTZ`);
    await run(client, `ALTER TABLE crm_integrations ADD COLUMN IF NOT EXISTS last_sync_status TEXT`);
    await run(client, `ALTER TABLE crm_integrations ADD COLUMN IF NOT EXISTS synced_contacts  INTEGER NOT NULL DEFAULT 0`);
    // crm_sync_logs: records columns
    await run(client, `ALTER TABLE crm_sync_logs ADD COLUMN IF NOT EXISTS records_processed INTEGER NOT NULL DEFAULT 0`);
    await run(client, `ALTER TABLE crm_sync_logs ADD COLUMN IF NOT EXISTS records_created   INTEGER NOT NULL DEFAULT 0`);
    await run(client, `ALTER TABLE crm_sync_logs ADD COLUMN IF NOT EXISTS records_updated   INTEGER NOT NULL DEFAULT 0`);
    await run(client, `ALTER TABLE crm_sync_logs ADD COLUMN IF NOT EXISTS records_failed    INTEGER NOT NULL DEFAULT 0`);
    await run(client, `ALTER TABLE crm_sync_logs ADD COLUMN IF NOT EXISTS duration_ms       INTEGER`);
    // keyword_clusters: columns required by AI clustering persistence (keyword-engine.generateClusters)
    await run(client, `ALTER TABLE keyword_clusters ADD COLUMN IF NOT EXISTS keywords       JSONB`);
    await run(client, `ALTER TABLE keyword_clusters ADD COLUMN IF NOT EXISTS keyword_count  INTEGER DEFAULT 0`);
    await run(client, `ALTER TABLE keyword_clusters ADD COLUMN IF NOT EXISTS avg_position   REAL`);
    await run(client, `ALTER TABLE keyword_clusters ADD COLUMN IF NOT EXISTS avg_volume     INTEGER DEFAULT 0`);
    await run(client, `ALTER TABLE keyword_clusters ADD COLUMN IF NOT EXISTS avg_difficulty INTEGER DEFAULT 0`);
    await run(client, `ALTER TABLE keyword_clusters ADD COLUMN IF NOT EXISTS total_volume   INTEGER DEFAULT 0`);
    await run(client, `ALTER TABLE keyword_clusters ADD COLUMN IF NOT EXISTS ai_summary     TEXT`);
    await run(client, `ALTER TABLE keyword_clusters ADD COLUMN IF NOT EXISTS color          TEXT DEFAULT '#2563EB'`);
    await run(client, `ALTER TABLE keyword_clusters ADD COLUMN IF NOT EXISTS updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    // keyword_opportunities: columns required by generateOpportunities persistence
    await run(client, `ALTER TABLE keyword_opportunities ADD COLUMN IF NOT EXISTS search_volume      INTEGER DEFAULT 0`);
    await run(client, `ALTER TABLE keyword_opportunities ADD COLUMN IF NOT EXISTS difficulty         INTEGER DEFAULT 0`);
    await run(client, `ALTER TABLE keyword_opportunities ADD COLUMN IF NOT EXISTS cpc                NUMERIC DEFAULT 0`);
    await run(client, `ALTER TABLE keyword_opportunities ADD COLUMN IF NOT EXISTS intent             TEXT`);
    await run(client, `ALTER TABLE keyword_opportunities ADD COLUMN IF NOT EXISTS opportunity_score  INTEGER DEFAULT 0`);
    await run(client, `ALTER TABLE keyword_opportunities ADD COLUMN IF NOT EXISTS type               TEXT NOT NULL DEFAULT 'quick_win'`);
    await run(client, `ALTER TABLE keyword_opportunities ADD COLUMN IF NOT EXISTS current_position   INTEGER`);
    await run(client, `ALTER TABLE keyword_opportunities ADD COLUMN IF NOT EXISTS potential_position INTEGER`);
    await run(client, `ALTER TABLE keyword_opportunities ADD COLUMN IF NOT EXISTS estimated_traffic  INTEGER DEFAULT 0`);
    await run(client, `ALTER TABLE keyword_opportunities ADD COLUMN IF NOT EXISTS ai_explanation     TEXT`);
    await run(client, `ALTER TABLE keyword_opportunities ADD COLUMN IF NOT EXISTS status             TEXT DEFAULT 'new'`);
    await run(client, `ALTER TABLE keyword_opportunities ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    logger.info("[init-data-tables] self-healing column ALTERs for v1/v2 schema gaps done");

    // ── Remove FORCE ROW LEVEL SECURITY from all raw-pool-accessed tables ─────
    // These 19 tables were set to FORCE RLS by the v2 migration but are accessed
    // via raw pool.query() without withOrgDb in several services (sso, crm, ga4,
    // gsc, gbp-posting, local-maps). FORCE would break every query under a
    // non-BYPASSRLS application role. This runs every boot (idempotent).
    for (const _t of [
      "github_connections","permission_logs","report_templates","google_reviews",
      "gbp_posts","dataforseo_quota","roles","gsc_sites","reviews","crm_sync_logs",
      "automation_templates","local_heatmaps","login_audits","crm_integrations",
      "google_locations","org_auth_config","google_accounts","sso_providers","ga4_properties",
    ]) {
      await run(client, `ALTER TABLE "${_t}" ENABLE ROW LEVEL SECURITY`);
      await run(client, `ALTER TABLE "${_t}" NO FORCE ROW LEVEL SECURITY`);
    }
    logger.info("[init-data-tables] NO FORCE RLS applied to 19 raw-pool tenant tables");

    // ── P0-5 self-healing ALTERs — always run (idempotent, protect drift) ────
    // org_addons.activated_at — used by billing addons service
    await run(client, `ALTER TABLE org_addons ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ`);
    // org_addons.quantity — durable per-pack quantity for QTY_ADDONS (monitorsPack10/50, extraSeats…)
    await run(client, `ALTER TABLE org_addons ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1`);
    // ai_monthly_usage extra columns (already in block above but repeat for safety)
    await run(client, `ALTER TABLE ai_monthly_usage ADD COLUMN IF NOT EXISTS credits_used NUMERIC    NOT NULL DEFAULT 0`);
    await run(client, `ALTER TABLE ai_monthly_usage ADD COLUMN IF NOT EXISTS cost_eur     NUMERIC    NOT NULL DEFAULT 0`);
    await run(client, `ALTER TABLE ai_monthly_usage ADD COLUMN IF NOT EXISTS tokens_used  BIGINT     NOT NULL DEFAULT 0`);
    await run(client, `ALTER TABLE ai_monthly_usage ADD COLUMN IF NOT EXISTS reset_at     TIMESTAMPTZ`);
    await run(client, `ALTER TABLE ai_monthly_usage ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    // ai_usage_logs — all columns written by ai-engine.ts
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS user_id          UUID`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS provider         TEXT`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS credits_used     NUMERIC`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS credits_debited  NUMERIC`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS tokens_in        INTEGER`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS tokens_out       INTEGER`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS cached_tokens    INTEGER`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS cost_eur         NUMERIC`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS real_cost_eur    NUMERIC`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS latency_ms       INTEGER`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS duration_ms      INTEGER`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS success          BOOLEAN`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS metadata         JSONB`);
    await run(client, `ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS idempotency_key  TEXT`);

    // ── fix-org-uuid-relations-v1 — one-time migration, fixes 3 boot SQL errors ─
    // Error 1 (42804): ai_usage_logs_org_id_fkey type mismatch UUID vs TEXT
    // Error 2 (0A000): org_addons ALTER COLUMN TYPE blocked by RLS policies
    // Error 3 (42804): TEXT email inserted into UUID organizations.id (fixed in public-billing.ts)
    //
    // Guarded by schema_migrations — runs exactly once.
    // Each DO block checks the current column type, so individual steps are
    // idempotent if a previous partial run already converted some columns.
    if (!await hasMigration("fix-org-uuid-relations-v1")) {
      // Retry-on-next-boot: use client.query() directly so errors are not swallowed.
      // If any step throws, the migration is NOT recorded — the next boot will retry.
      // Only after ALL steps succeed is the migration marker written (idempotency guard).
      let _migOk = false;
      try {
      // Session-scoped temp table holds old_id→new_id mapping across DO blocks.
      // No ON COMMIT DROP — persists for the lifetime of this pool connection.
      await client.query(`
        CREATE TEMP TABLE IF NOT EXISTS _fp_uuid_map (
          old_id TEXT NOT NULL,
          new_id UUID NOT NULL
        )
      `);

      // Step A: organizations.id TEXT→UUID
      // If organizations.id is TEXT (legacy/fresh-DB scenario), generate canonical
      // UUIDs for any non-UUID rows (email addresses, 'default', slugs),
      // propagate to dependent TEXT org_id columns, then ALTER the PK to UUID.
      await client.query(`
        DO $org_uuid_fix$
        DECLARE col_type TEXT;
        BEGIN
          SELECT data_type INTO col_type
          FROM information_schema.columns
          WHERE table_schema='public' AND table_name='organizations' AND column_name='id';

          IF col_type = 'text' THEN
            -- Build old→new mapping for non-UUID ids
            INSERT INTO _fp_uuid_map (old_id, new_id)
            SELECT id, gen_random_uuid()
            FROM organizations
            WHERE id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

            IF EXISTS (SELECT 1 FROM _fp_uuid_map) THEN
              -- Propagate new UUIDs to all TEXT org_id columns before PK change
              UPDATE org_settings         SET org_id = m.new_id::text FROM _fp_uuid_map m WHERE org_settings.org_id        = m.old_id;
              UPDATE org_addons           SET org_id = m.new_id::text FROM _fp_uuid_map m WHERE org_addons.org_id          = m.old_id;
              UPDATE org_checklist        SET org_id = m.new_id::text FROM _fp_uuid_map m WHERE org_checklist.org_id       = m.old_id;
              UPDATE org_secrets          SET org_id = m.new_id::text FROM _fp_uuid_map m WHERE org_secrets.org_id         = m.old_id;
              UPDATE team_members         SET org_id = m.new_id::text FROM _fp_uuid_map m WHERE team_members.org_id        = m.old_id;
              UPDATE ai_usage_logs        SET org_id = m.new_id::text FROM _fp_uuid_map m WHERE ai_usage_logs.org_id       = m.old_id;
              UPDATE ai_monthly_usage     SET org_id = m.new_id::text FROM _fp_uuid_map m WHERE ai_monthly_usage.org_id    = m.old_id;
              UPDATE ai_credit_purchases  SET org_id = m.new_id::text FROM _fp_uuid_map m WHERE ai_credit_purchases.org_id = m.old_id;
              -- Update organizations.id itself (must be last)
              UPDATE organizations SET id = m.new_id::text FROM _fp_uuid_map m WHERE organizations.id = m.old_id;
            END IF;

            -- Drop ALL FK constraints referencing organizations(id) BEFORE type change.
            -- PostgreSQL refuses ALTER COLUMN TYPE on a PK that is still referenced by FKs.
            ALTER TABLE IF EXISTS org_settings  DROP CONSTRAINT IF EXISTS org_settings_org_id_fkey;
            ALTER TABLE IF EXISTS org_checklist DROP CONSTRAINT IF EXISTS org_checklist_org_id_fkey;
            ALTER TABLE IF EXISTS org_secrets   DROP CONSTRAINT IF EXISTS org_secrets_org_id_fkey;
            ALTER TABLE IF EXISTS team_members  DROP CONSTRAINT IF EXISTS team_members_org_id_fkey;
            ALTER TABLE IF EXISTS org_addons    DROP CONSTRAINT IF EXISTS org_addons_org_id_fkey;

            -- All id values are now valid UUID strings — safe to cast
            ALTER TABLE organizations ALTER COLUMN id TYPE UUID USING id::uuid;
            ALTER TABLE organizations ALTER COLUMN id SET DEFAULT gen_random_uuid();
          END IF;
        END $org_uuid_fix$;
      `);

      // Step B: org_addons.org_id TEXT→UUID with RLS dance (Error 2 fix)
      // RLS policies that reference org_id block ALTER COLUMN TYPE (SQLSTATE 0A000).
      // Solution: drop policies, alter, recreate with ::text cast for GUC compat.
      await client.query(`
        DO $org_addons_uuid$
        DECLARE col_type TEXT;
        BEGIN
          SELECT data_type INTO col_type
          FROM information_schema.columns
          WHERE table_schema='public' AND table_name='org_addons' AND column_name='org_id';

          IF col_type IN ('text','character varying') THEN
            -- Drop RLS policies that block ALTER COLUMN TYPE (Error 2)
            DROP POLICY IF EXISTS rls_org_isolation ON org_addons;
            DROP POLICY IF EXISTS tenant_select      ON org_addons;
            DROP POLICY IF EXISTS tenant_insert      ON org_addons;
            DROP POLICY IF EXISTS tenant_update      ON org_addons;
            DROP POLICY IF EXISTS tenant_delete      ON org_addons;
            -- Drop FK before type change
            ALTER TABLE org_addons DROP CONSTRAINT IF EXISTS org_addons_org_id_fkey;
            -- Apply mapping from Step A (in case org_addons was updated there)
            UPDATE org_addons oa SET org_id = m.new_id::text
              FROM _fp_uuid_map m WHERE oa.org_id = m.old_id;
            -- Delete rows whose org_id cannot be cast to UUID (legacy 'default' sentinel)
            DELETE FROM org_addons
            WHERE org_id IS NOT NULL
              AND org_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
            -- Drop DEFAULT before type change ('default' TEXT cannot auto-cast to UUID)
            ALTER TABLE org_addons ALTER COLUMN org_id DROP DEFAULT;
            -- Cast TEXT → UUID
            ALTER TABLE org_addons ALTER COLUMN org_id TYPE UUID USING org_id::uuid;
            -- Recreate FK to organizations(id)
            ALTER TABLE org_addons
              ADD CONSTRAINT org_addons_org_id_fkey
              FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
            -- Recreate RLS policies; compare via ::text cast so GUC TEXT value works
            CREATE POLICY tenant_select ON org_addons FOR SELECT
              USING     (org_id::text = current_setting('app.current_org_id', true));
            CREATE POLICY tenant_insert ON org_addons FOR INSERT
              WITH CHECK(org_id::text = current_setting('app.current_org_id', true));
            CREATE POLICY tenant_update ON org_addons FOR UPDATE
              USING     (org_id::text = current_setting('app.current_org_id', true));
            CREATE POLICY tenant_delete ON org_addons FOR DELETE
              USING     (org_id::text = current_setting('app.current_org_id', true));
          END IF;
        END $org_addons_uuid$;
      `);

      // Step C: ai_usage_logs.org_id TEXT→UUID + FK to organizations(id) (Error 1 fix)
      await client.query(`
        DO $ai_logs_uuid$
        DECLARE col_type TEXT; org_col_type TEXT;
        BEGIN
          SELECT data_type INTO col_type
          FROM information_schema.columns
          WHERE table_schema='public' AND table_name='ai_usage_logs' AND column_name='org_id';

          SELECT data_type INTO org_col_type
          FROM information_schema.columns
          WHERE table_schema='public' AND table_name='organizations' AND column_name='id';

          IF col_type IN ('text','character varying') THEN
            -- RLS dance: policies referencing org_id block ALTER COLUMN TYPE (0A000).
            -- Drop ONLY the 4 tenant policies + legacy isolation policy, recreate after cast.
            DROP POLICY IF EXISTS tenant_select     ON ai_usage_logs;
            DROP POLICY IF EXISTS tenant_insert     ON ai_usage_logs;
            DROP POLICY IF EXISTS tenant_update     ON ai_usage_logs;
            DROP POLICY IF EXISTS tenant_delete     ON ai_usage_logs;
            DROP POLICY IF EXISTS rls_org_isolation ON ai_usage_logs;
            -- Drop FK if present (recreated below once column is UUID)
            ALTER TABLE ai_usage_logs DROP CONSTRAINT IF EXISTS ai_usage_logs_org_id_fkey;
            UPDATE ai_usage_logs SET org_id = m.new_id::text
              FROM _fp_uuid_map m WHERE ai_usage_logs.org_id = m.old_id;
            DELETE FROM ai_usage_logs
            WHERE org_id IS NOT NULL
              AND org_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
            ALTER TABLE ai_usage_logs ALTER COLUMN org_id DROP DEFAULT;
            ALTER TABLE ai_usage_logs ALTER COLUMN org_id TYPE UUID USING NULLIF(org_id, '')::uuid;
            DROP INDEX IF EXISTS ai_usage_logs_org_idx;
            CREATE INDEX IF NOT EXISTS ai_usage_logs_org_created_idx
              ON ai_usage_logs(org_id, created_at DESC);
            -- Only add FK when organizations.id is also UUID (prevents SQLSTATE 42804)
            IF org_col_type = 'uuid' AND NOT EXISTS (
              SELECT 1 FROM information_schema.table_constraints
              WHERE table_name='ai_usage_logs' AND constraint_name='ai_usage_logs_org_id_fkey'
                AND constraint_type='FOREIGN KEY'
            ) THEN
              ALTER TABLE ai_usage_logs
                ADD CONSTRAINT ai_usage_logs_org_id_fkey
                FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
            END IF;
            -- Recreate the 4 tenant policies; ::text cast so the TEXT GUC still compares
            CREATE POLICY tenant_select ON ai_usage_logs FOR SELECT
              USING     (org_id::text = current_setting('app.current_org_id', true));
            CREATE POLICY tenant_insert ON ai_usage_logs FOR INSERT
              WITH CHECK(org_id::text = current_setting('app.current_org_id', true));
            CREATE POLICY tenant_update ON ai_usage_logs FOR UPDATE
              USING     (org_id::text = current_setting('app.current_org_id', true));
            CREATE POLICY tenant_delete ON ai_usage_logs FOR DELETE
              USING     (org_id::text = current_setting('app.current_org_id', true));
          END IF;
        END $ai_logs_uuid$;
      `);

      // Step D: ai_monthly_usage.org_id TEXT→UUID + FK + RLS policy recreation.
      // The four tenant policies depend on org_id and must be removed before the
      // type cast.  The entire DO block is transactional: a failure restores the
      // original policies and column definition instead of leaving partial state.
      await client.query(`
        DO $ai_monthly_uuid$
        DECLARE col_type TEXT; org_col_type TEXT;
        BEGIN
          SELECT data_type INTO col_type
          FROM information_schema.columns
          WHERE table_schema='public' AND table_name='ai_monthly_usage' AND column_name='org_id';

          SELECT data_type INTO org_col_type
          FROM information_schema.columns
          WHERE table_schema='public' AND table_name='organizations' AND column_name='id';

          IF col_type IN ('text','character varying') THEN
            DROP POLICY IF EXISTS tenant_select ON ai_monthly_usage;
            DROP POLICY IF EXISTS tenant_insert ON ai_monthly_usage;
            DROP POLICY IF EXISTS tenant_update ON ai_monthly_usage;
            DROP POLICY IF EXISTS tenant_delete ON ai_monthly_usage;
            ALTER TABLE ai_monthly_usage DROP CONSTRAINT IF EXISTS ai_monthly_usage_org_id_fkey;
            UPDATE ai_monthly_usage SET org_id = m.new_id::text
              FROM _fp_uuid_map m WHERE ai_monthly_usage.org_id = m.old_id;
            DELETE FROM ai_monthly_usage
            WHERE org_id IS NOT NULL
              AND org_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
            ALTER TABLE ai_monthly_usage ALTER COLUMN org_id DROP DEFAULT;
            ALTER TABLE ai_monthly_usage ALTER COLUMN org_id TYPE UUID USING NULLIF(org_id, '')::uuid;
            IF org_col_type = 'uuid' THEN
              ALTER TABLE ai_monthly_usage
                ADD CONSTRAINT ai_monthly_usage_org_id_fkey
                FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
            END IF;
            CREATE POLICY tenant_select ON ai_monthly_usage FOR SELECT
              USING     (org_id::text = current_setting('app.current_org_id', true));
            CREATE POLICY tenant_insert ON ai_monthly_usage FOR INSERT
              WITH CHECK(org_id::text = current_setting('app.current_org_id', true));
            CREATE POLICY tenant_update ON ai_monthly_usage FOR UPDATE
              USING     (org_id::text = current_setting('app.current_org_id', true));
            CREATE POLICY tenant_delete ON ai_monthly_usage FOR DELETE
              USING     (org_id::text = current_setting('app.current_org_id', true));
          END IF;
        END $ai_monthly_uuid$;
      `);

      // Step E: ai_credit_purchases.org_id TEXT→UUID + FK + RLS policy recreation.
      await client.query(`
        DO $ai_credits_uuid$
        DECLARE col_type TEXT; org_col_type TEXT;
        BEGIN
          SELECT data_type INTO col_type
          FROM information_schema.columns
          WHERE table_schema='public' AND table_name='ai_credit_purchases' AND column_name='org_id';

          SELECT data_type INTO org_col_type
          FROM information_schema.columns
          WHERE table_schema='public' AND table_name='organizations' AND column_name='id';

          IF col_type IN ('text','character varying') THEN
            DROP POLICY IF EXISTS tenant_select ON ai_credit_purchases;
            DROP POLICY IF EXISTS tenant_insert ON ai_credit_purchases;
            DROP POLICY IF EXISTS tenant_update ON ai_credit_purchases;
            DROP POLICY IF EXISTS tenant_delete ON ai_credit_purchases;
            ALTER TABLE ai_credit_purchases DROP CONSTRAINT IF EXISTS ai_credit_purchases_org_id_fkey;
            UPDATE ai_credit_purchases SET org_id = m.new_id::text
              FROM _fp_uuid_map m WHERE ai_credit_purchases.org_id = m.old_id;
            DELETE FROM ai_credit_purchases
            WHERE org_id IS NOT NULL
              AND org_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
            ALTER TABLE ai_credit_purchases ALTER COLUMN org_id DROP DEFAULT;
            ALTER TABLE ai_credit_purchases ALTER COLUMN org_id TYPE UUID USING NULLIF(org_id, '')::uuid;
            IF org_col_type = 'uuid' THEN
              ALTER TABLE ai_credit_purchases
                ADD CONSTRAINT ai_credit_purchases_org_id_fkey
                FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
            END IF;
            CREATE POLICY tenant_select ON ai_credit_purchases FOR SELECT
              USING     (org_id::text = current_setting('app.current_org_id', true));
            CREATE POLICY tenant_insert ON ai_credit_purchases FOR INSERT
              WITH CHECK(org_id::text = current_setting('app.current_org_id', true));
            CREATE POLICY tenant_update ON ai_credit_purchases FOR UPDATE
              USING     (org_id::text = current_setting('app.current_org_id', true));
            CREATE POLICY tenant_delete ON ai_credit_purchases FOR DELETE
              USING     (org_id::text = current_setting('app.current_org_id', true));
          END IF;
        END $ai_credits_uuid$;
      `);

        _migOk = true;
      } catch (migErr: unknown) {
        logger.error({ err: migErr }, "[init-data-tables] fix-org-uuid-relations-v1 migration FAILED — will retry on next boot");
      }
      if (_migOk) {
        await recordMigration("fix-org-uuid-relations-v1");
        logger.info("[init-data-tables] fix-org-uuid-relations-v1 migration complete ✓");
      }
    }

    // ── P1-2 : ai_usage_logs org_id type fix (idempotent fallback guard) ────────
    // Runs only if fix-org-uuid-relations-v1 failed or hasn't run yet.
    // Guards FK creation on organizations.id being UUID to prevent SQLSTATE 42804.
    await run(client, `
      DO $$
      DECLARE col_type TEXT; org_col_type TEXT;
      BEGIN
        SELECT data_type INTO col_type
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name='ai_usage_logs' AND column_name='org_id';

        SELECT data_type INTO org_col_type
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name='organizations' AND column_name='id';

        IF col_type = 'text' THEN
          -- RLS dance: policies referencing org_id block ALTER COLUMN TYPE (0A000).
          DROP POLICY IF EXISTS tenant_select     ON ai_usage_logs;
          DROP POLICY IF EXISTS tenant_insert     ON ai_usage_logs;
          DROP POLICY IF EXISTS tenant_update     ON ai_usage_logs;
          DROP POLICY IF EXISTS tenant_delete     ON ai_usage_logs;
          DROP POLICY IF EXISTS rls_org_isolation ON ai_usage_logs;
          ALTER TABLE ai_usage_logs DROP CONSTRAINT IF EXISTS ai_usage_logs_org_id_fkey;
          -- Remove legacy rows whose org_id cannot be cast to UUID
          DELETE FROM ai_usage_logs
          WHERE org_id IS NOT NULL
            AND org_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND org_id NOT IN ('default', '');
          -- NULL-ify the sentinel values before casting
          UPDATE ai_usage_logs SET org_id = NULL WHERE org_id IN ('default', '');
          -- Drop the DEFAULT before casting (TEXT default cannot auto-cast to UUID)
          ALTER TABLE ai_usage_logs ALTER COLUMN org_id DROP DEFAULT;
          -- Cast column type ('' → NULL, valid UUID strings cast cleanly)
          ALTER TABLE ai_usage_logs ALTER COLUMN org_id TYPE UUID USING NULLIF(org_id, '')::uuid;
          -- Recreate org index (name may vary across schema generations)
          DROP INDEX IF EXISTS ai_usage_logs_org_idx;
          CREATE INDEX IF NOT EXISTS ai_usage_logs_org_created_idx
            ON ai_usage_logs(org_id, created_at DESC);
          -- Only add FK when organizations.id is also UUID (prevents SQLSTATE 42804)
          IF org_col_type = 'uuid' AND NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE table_name='ai_usage_logs' AND constraint_name='ai_usage_logs_org_id_fkey'
              AND constraint_type='FOREIGN KEY'
          ) THEN
            ALTER TABLE ai_usage_logs
              ADD CONSTRAINT ai_usage_logs_org_id_fkey
              FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE;
          END IF;
          -- Recreate the 4 tenant policies; ::text cast so the TEXT GUC still compares
          CREATE POLICY tenant_select ON ai_usage_logs FOR SELECT
            USING     (org_id::text = current_setting('app.current_org_id', true));
          CREATE POLICY tenant_insert ON ai_usage_logs FOR INSERT
            WITH CHECK(org_id::text = current_setting('app.current_org_id', true));
          CREATE POLICY tenant_update ON ai_usage_logs FOR UPDATE
            USING     (org_id::text = current_setting('app.current_org_id', true));
          CREATE POLICY tenant_delete ON ai_usage_logs FOR DELETE
            USING     (org_id::text = current_setting('app.current_org_id', true));
        END IF;
      END $$;
    `);

    // Same cast for ai_monthly_usage if it has TEXT org_id
    await run(client, `
      DO $$
      DECLARE col_type TEXT;
      BEGIN
        SELECT data_type INTO col_type
        FROM information_schema.columns
        WHERE table_schema='public' AND table_name='ai_monthly_usage' AND column_name='org_id';

        IF col_type = 'text' THEN
          DELETE FROM ai_monthly_usage
          WHERE org_id IS NOT NULL
            AND org_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            AND org_id NOT IN ('default', '');
          UPDATE ai_monthly_usage SET org_id = NULL WHERE org_id IN ('default', '');
          ALTER TABLE ai_monthly_usage ALTER COLUMN org_id DROP DEFAULT;
          ALTER TABLE ai_monthly_usage ALTER COLUMN org_id TYPE UUID USING org_id::uuid;
        END IF;
      END $$;
    `);

    // ── user_activity_days — one row per org per day for accurate streak ─────────
    // PK (org_id, user_id, day) ensures idempotent upsert on every dashboard request.
    await run(client, `
      CREATE TABLE IF NOT EXISTS user_activity_days (
        org_id  TEXT NOT NULL DEFAULT 'default',
        user_id TEXT NOT NULL DEFAULT 'default',
        day     DATE NOT NULL,
        PRIMARY KEY (org_id, user_id, day)
      )
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS user_activity_days_org_idx ON user_activity_days(org_id, day DESC)`);
    await run(client, `ALTER TABLE user_activity_days ENABLE ROW LEVEL SECURITY`);
    await run(client, `ALTER TABLE user_activity_days NO FORCE ROW LEVEL SECURITY`);
    await run(client, `DROP POLICY IF EXISTS "uad_select" ON "user_activity_days"`);
    await run(client, `DROP POLICY IF EXISTS "uad_insert" ON "user_activity_days"`);
    await run(client, `DROP POLICY IF EXISTS "uad_delete" ON "user_activity_days"`);
    await run(client, `CREATE POLICY "uad_select" ON "user_activity_days" FOR SELECT USING (COALESCE(org_id,'default') = current_setting('app.current_org_id', true))`);
    await run(client, `CREATE POLICY "uad_insert" ON "user_activity_days" FOR INSERT WITH CHECK (COALESCE(org_id,'default') = current_setting('app.current_org_id', true))`);
    await run(client, `CREATE POLICY "uad_delete" ON "user_activity_days" FOR DELETE USING (COALESCE(org_id,'default') = current_setting('app.current_org_id', true))`);

    // ── team_channels — persisted channel registry for team chat ─────────────────
    // Channels survive even when they have zero messages.
    await run(client, `
      CREATE TABLE IF NOT EXISTS team_channels (
        org_id     TEXT        NOT NULL DEFAULT 'default',
        name       TEXT        NOT NULL,
        created_by TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (org_id, name)
      )
    `);
    await run(client, `CREATE INDEX IF NOT EXISTS team_channels_org_idx ON team_channels(org_id)`);
    // Back-fill: persist every channel that already has messages
    await run(client, `
      INSERT INTO team_channels (org_id, name, created_by, created_at)
      SELECT DISTINCT org_id, channel, 'system', NOW()
      FROM team_messages
      WHERE NOT EXISTS (
        SELECT 1 FROM team_channels tc
        WHERE tc.org_id = team_messages.org_id AND tc.name = team_messages.channel
      )
      ON CONFLICT (org_id, name) DO NOTHING
    `);
    await run(client, `ALTER TABLE team_channels ENABLE ROW LEVEL SECURITY`);
    await run(client, `ALTER TABLE team_channels NO FORCE ROW LEVEL SECURITY`);
    await run(client, `DROP POLICY IF EXISTS "tc_select" ON "team_channels"`);
    await run(client, `DROP POLICY IF EXISTS "tc_insert" ON "team_channels"`);
    await run(client, `DROP POLICY IF EXISTS "tc_update" ON "team_channels"`);
    await run(client, `DROP POLICY IF EXISTS "tc_delete" ON "team_channels"`);
    await run(client, `CREATE POLICY "tc_select" ON "team_channels" FOR SELECT USING (COALESCE(org_id,'default') = current_setting('app.current_org_id', true))`);
    await run(client, `CREATE POLICY "tc_insert" ON "team_channels" FOR INSERT WITH CHECK (COALESCE(org_id,'default') = current_setting('app.current_org_id', true))`);
    await run(client, `CREATE POLICY "tc_update" ON "team_channels" FOR UPDATE USING (COALESCE(org_id,'default') = current_setting('app.current_org_id', true))`);
    await run(client, `CREATE POLICY "tc_delete" ON "team_channels" FOR DELETE USING (COALESCE(org_id,'default') = current_setting('app.current_org_id', true))`);

    logger.info("[init-data-tables] all tables, schema_migrations, missing-production-tables, P0-5 ALTERs, P1-2 type fixes done");
  } catch (err) {
    logger.error({ err }, "[init-data-tables] Unexpected error");
    throw err;
  } finally {
    client.release();
  }
}

interface DbClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query<T extends Record<string, unknown> = Record<string, unknown>>(queryText: string, values?: any[]): Promise<{ rows: T[]; rowCount: number | null }>;
  release(err?: boolean | Error): void;
}

type PoolClient = DbClient;
