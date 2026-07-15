import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

const LOG = "[init-ai-migration]";

/**
 * Applies AI-specific DDL migrations at startup — idempotent, safe to run
 * on every boot. Any statement that fails (e.g. already exists) is swallowed
 * as a non-fatal warning so the server always continues.
 */
export async function initAiMigration(): Promise<void> {
  const client = await pool.connect();
  const run = async (label: string, sql: string) => {
    try {
      await client.query(sql);
    } catch (err: any) {
      logger.warn({ msg: err.message?.split("\n")[0] }, `${LOG} ${label} — non-fatal`);
    }
  };

  try {
    // ── 016 : ai_recommendations table ─────────────────────────────────────────
    await run("ai_recommendations table", `
      CREATE TABLE IF NOT EXISTS ai_recommendations (
        id          TEXT PRIMARY KEY DEFAULT ('rec_' || gen_random_uuid()::TEXT),
        org_id      TEXT NOT NULL,
        type        TEXT NOT NULL DEFAULT 'general',
        title       TEXT NOT NULL,
        description TEXT,
        priority    INTEGER NOT NULL DEFAULT 5,
        status      TEXT NOT NULL DEFAULT 'active',
        source      TEXT DEFAULT 'ai',
        metadata    JSONB,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at  TIMESTAMPTZ
      )
    `);

    await run("ai_recommendations org index", `
      CREATE INDEX IF NOT EXISTS ai_recommendations_org_idx
        ON ai_recommendations (org_id, priority ASC, created_at DESC)
    `);

    await run("ai_recommendations status index", `
      CREATE INDEX IF NOT EXISTS ai_recommendations_status_idx
        ON ai_recommendations (org_id, status, expires_at)
    `);

    await run("ai_recommendations RLS", `
      ALTER TABLE ai_recommendations ENABLE ROW LEVEL SECURITY
    `);

    await run("ai_recommendations tenant policy", `
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_policies
          WHERE schemaname='public' AND tablename='ai_recommendations'
            AND policyname='ai_recommendations_org_isolation'
        ) THEN
          CREATE POLICY ai_recommendations_org_isolation
            ON ai_recommendations
            USING (org_id = current_setting('app.org_id', true));
        END IF;
      END $$
    `);

    // ── 016 : idempotency_key on ai_usage_logs ──────────────────────────────────
    await run("ai_usage_logs idempotency_key column", `
      ALTER TABLE ai_usage_logs ADD COLUMN IF NOT EXISTS idempotency_key TEXT
    `);

    await run("ai_usage_logs idempotency_key unique index", `
      CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_logs_idempotency_key_idx
        ON ai_usage_logs (idempotency_key)
        WHERE idempotency_key IS NOT NULL
    `);

    logger.info(`${LOG} AI DDL migrations applied`);
  } finally {
    client.release();
  }
}
