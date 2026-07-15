import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

// ── Expected columns for team_members (source of truth) ───────────────────────
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
];

/**
 * Queries information_schema.columns for team_members, logs Present/Expected/Missing,
 * auto-repairs each missing column via ALTER TABLE, then verifies repair succeeded.
 * Every DDL failure is logged with full PostgreSQL error detail.
 */
async function verifyTeamMembersSchema(client: import("pg").PoolClient): Promise<void> {
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

async function run(client: import("pg").PoolClient, sql: string): Promise<void> {
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
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS subscription_status       TEXT NOT NULL DEFAULT 'active';`);
    await run(client, `CREATE INDEX IF NOT EXISTS org_settings_trial_ends_at_idx ON org_settings(trial_ends_at) WHERE trial_ends_at IS NOT NULL;`);
    await run(client, `CREATE INDEX IF NOT EXISTS org_settings_sub_status_idx    ON org_settings(subscription_status);`);

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
    // Functional unique index on (org_id, lower(email)) — same email allowed in different orgs
    await run(client, `CREATE UNIQUE INDEX IF NOT EXISTS team_members_org_lower_email_idx ON team_members(org_id, lower(email));`);
    await run(client, `CREATE INDEX IF NOT EXISTS team_members_org_idx ON team_members(org_id, email);`);

    // ── org_settings — columns that may be missing in older DBs ─────────────
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS last_name           TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS org_name            TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS website             TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS stripe_customer_id  TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS addons              JSONB NOT NULL DEFAULT '{}';`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS usage               JSONB NOT NULL DEFAULT '{}';`);
    // Locale / timezone columns
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS timezone    TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS language    TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS currency    TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS date_format TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS time_format TEXT;`);
    // Location extended
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS region      TEXT;`);
    await run(client, `ALTER TABLE org_settings ADD COLUMN IF NOT EXISTS phone       TEXT;`);

    // ── Schema verification: log Present/Expected/Missing + auto-repair ─────────
    await verifyTeamMembersSchema(client);

    logger.info("[init-data-tables] audits, audit_schedules, notifications, competitors, alert_events, calendar_events, report_exports, team_messages ready");
  } catch (err) {
    logger.error({ err }, "[init-data-tables] Unexpected error");
    throw err;
  } finally {
    client.release();
  }
}
