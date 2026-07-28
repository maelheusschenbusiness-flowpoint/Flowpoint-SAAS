import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export async function initMissionsTables(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS missions (
        id                        TEXT PRIMARY KEY,
        org_id                    TEXT NOT NULL DEFAULT 'default',
        title                     TEXT NOT NULL,
        description               TEXT,
        category                  TEXT NOT NULL DEFAULT 'general',
        type                      TEXT NOT NULL DEFAULT 'action',
        priority                  TEXT NOT NULL DEFAULT 'medium',
        priority_score            INTEGER DEFAULT 50,
        status                    TEXT NOT NULL DEFAULT 'todo',
        impact                    TEXT DEFAULT 'Moyen',
        effort                    TEXT DEFAULT '1h',
        estimated_traffic_impact  REAL DEFAULT 0,
        estimated_revenue_impact  REAL DEFAULT 0,
        estimated_seo_impact      REAL DEFAULT 0,
        estimated_conversion_impact REAL DEFAULT 0,
        difficulty_score          INTEGER DEFAULT 50,
        business_impact_score     INTEGER DEFAULT 50,
        ai_explanation            TEXT,
        ai_action_steps           JSONB DEFAULT '[]',
        ai_quick_win              BOOLEAN DEFAULT false,
        ai_reasoning              TEXT,
        ai_summary                TEXT,
        source_type               TEXT DEFAULT 'manual',
        source_data               JSONB DEFAULT '{}',
        steps                     JSONB DEFAULT '[]',
        due_date                  TEXT,
        completed_at              TIMESTAMP,
        dismissed_at              TIMESTAMP,
        assigned_to               TEXT,
        last_refreshed_at         TIMESTAMP,
        history                   JSONB DEFAULT '[]',
        created_at                TIMESTAMP DEFAULT NOW(),
        updated_at                TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS mission_history (
        id          TEXT PRIMARY KEY,
        mission_id  TEXT NOT NULL,
        org_id      TEXT NOT NULL DEFAULT 'default',
        action      TEXT NOT NULL,
        from_status TEXT,
        to_status   TEXT,
        notes       TEXT,
        created_at  TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS mission_ai_logs (
        id            TEXT PRIMARY KEY,
        org_id        TEXT NOT NULL DEFAULT 'default',
        mission_id    TEXT,
        prompt_type   TEXT NOT NULL DEFAULT 'generate',
        model         TEXT DEFAULT 'gpt-5-mini',
        tokens_used   INTEGER DEFAULT 0,
        credits_used  INTEGER DEFAULT 0,
        response_ok   BOOLEAN DEFAULT true,
        error         TEXT,
        metadata      JSONB DEFAULT '{}',
        created_at    TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_missions_org_id ON missions(org_id);
      CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status);
      CREATE INDEX IF NOT EXISTS idx_mission_history_mission_id ON mission_history(mission_id);

      ALTER TABLE missions ADD COLUMN IF NOT EXISTS source_url TEXT;
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS source_audit_id TEXT;
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'manual';
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS source_data JSONB DEFAULT '{}';
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS assigned_to TEXT;

      -- Self-heal: columns added to CREATE TABLE after initial deploy may be absent
      -- on existing Render instances. All ALTER TABLE … ADD COLUMN IF NOT EXISTS are
      -- idempotent — safe to run on every boot via the fast-path.
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS estimated_traffic_impact  REAL DEFAULT 0;
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS estimated_revenue_impact  REAL DEFAULT 0;
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS estimated_seo_impact      REAL DEFAULT 0;
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS estimated_conversion_impact REAL DEFAULT 0;
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS difficulty_score          INTEGER DEFAULT 50;
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS business_impact_score     INTEGER DEFAULT 50;
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS ai_explanation            TEXT;
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS ai_action_steps           JSONB DEFAULT '[]';
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS ai_quick_win              BOOLEAN DEFAULT false;
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS ai_reasoning              TEXT;
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS ai_summary                TEXT;
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS history                   JSONB DEFAULT '[]';
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS last_refreshed_at         TIMESTAMP;
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS completed_at              TIMESTAMP;
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS dismissed_at              TIMESTAMP;
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS due_date                  TEXT;
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS steps                     JSONB DEFAULT '[]';
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS priority_score            INTEGER DEFAULT 50;
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS type                      TEXT DEFAULT 'action';
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS impact                    TEXT DEFAULT 'Moyen';
      ALTER TABLE missions ADD COLUMN IF NOT EXISTS effort                    TEXT DEFAULT '1h';
    `);
    logger.info("Missions tables initialized");
  } catch (err) {
    logger.error("Failed to init missions tables", { err });
    throw err;
  } finally {
    client.release();
  }
}
