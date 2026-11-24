/**
 * AI GBP Posting : schema additif et idempotent.
 *
 * - gbp_post_queue et gbp_media_assets etaient lues par GET /api/gbp-posts/queue et
 *   /media sans qu'aucun CREATE TABLE n'existe en production (relation absente).
 * - gbp_posts existe en production mais sans les colonnes que le code de publication
 *   reel (Test-Replit) lit et ecrit : offer_terms, approved_at, google_post_id,
 *   generation_options, last_error_code, last_error_message.
 *
 * Aucune migration destructive, aucune FK sur org_id, RLS tenant (4 politiques).
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

async function run(client: import("pg").PoolClient, sql: string): Promise<void> {
  try { await client.query(sql); }
  catch (err) { logger.warn({ err, sql: sql.replace(/\s+/g, " ").slice(0, 100) }, "[gbp-posting-tables] non-fatal DDL warning"); }
}

async function applyTenantRls(client: import("pg").PoolClient, t: string): Promise<void> {
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
}

export async function initGbpPostingTables(): Promise<void> {
  const client = await pool.connect();
  try {
    // gbp_posts : colonnes requises par la publication reelle (additif).
    await run(client, `
      CREATE TABLE IF NOT EXISTS gbp_posts (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL DEFAULT 'default',
        location_id TEXT, location_name TEXT, post_type TEXT NOT NULL DEFAULT 'STANDARD',
        title TEXT, content TEXT NOT NULL DEFAULT '', cta_type TEXT, cta_url TEXT,
        media_urls JSONB NOT NULL DEFAULT '[]', event_title TEXT, event_start TIMESTAMPTZ,
        event_end TIMESTAMPTZ, offer_code TEXT, status TEXT NOT NULL DEFAULT 'draft',
        scheduled_at TIMESTAMPTZ, published_at TIMESTAMPTZ, seo_keywords JSONB NOT NULL DEFAULT '[]',
        ai_generated BOOLEAN NOT NULL DEFAULT false, views INTEGER NOT NULL DEFAULT 0,
        clicks INTEGER NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await run(client, `ALTER TABLE gbp_posts ADD COLUMN IF NOT EXISTS offer_terms TEXT`);
    await run(client, `ALTER TABLE gbp_posts ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`);
    await run(client, `ALTER TABLE gbp_posts ADD COLUMN IF NOT EXISTS google_post_id TEXT`);
    await run(client, `ALTER TABLE gbp_posts ADD COLUMN IF NOT EXISTS generation_options JSONB NOT NULL DEFAULT '{}'`);
    await run(client, `ALTER TABLE gbp_posts ADD COLUMN IF NOT EXISTS last_error_code TEXT`);
    await run(client, `ALTER TABLE gbp_posts ADD COLUMN IF NOT EXISTS last_error_message TEXT`);
    await run(client, `CREATE INDEX IF NOT EXISTS gbp_posts_org_idx ON gbp_posts(org_id, created_at DESC)`);
    await run(client, `CREATE INDEX IF NOT EXISTS gbp_posts_due_idx ON gbp_posts(scheduled_at) WHERE status = 'scheduled'`);
    await applyTenantRls(client, "gbp_posts");

    // gbp_post_queue : lue par GET /gbp-posts/queue (JOIN gbp_posts sur post_id, tri scheduled_for).
    await run(client, `
      CREATE TABLE IF NOT EXISTS gbp_post_queue (
        id            TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        org_id        TEXT        NOT NULL DEFAULT 'default',
        post_id       TEXT        NOT NULL,
        scheduled_for TIMESTAMPTZ,
        status        TEXT        NOT NULL DEFAULT 'pending',
        attempts      INTEGER     NOT NULL DEFAULT 0,
        last_error    TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await run(client, `CREATE INDEX IF NOT EXISTS gbp_post_queue_org_idx ON gbp_post_queue(org_id, scheduled_for)`);
    await applyTenantRls(client, "gbp_post_queue");

    // gbp_media_assets : lue par GET /gbp-posts/media (tri created_at DESC).
    await run(client, `
      CREATE TABLE IF NOT EXISTS gbp_media_assets (
        id          TEXT        PRIMARY KEY DEFAULT gen_random_uuid()::text,
        org_id      TEXT        NOT NULL DEFAULT 'default',
        location_id TEXT,
        url         TEXT        NOT NULL DEFAULT '',
        media_type  TEXT        NOT NULL DEFAULT 'PHOTO',
        filename    TEXT,
        size_bytes  INTEGER,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
    await run(client, `CREATE INDEX IF NOT EXISTS gbp_media_assets_org_idx ON gbp_media_assets(org_id, created_at DESC)`);
    await applyTenantRls(client, "gbp_media_assets");
  } finally { client.release(); }
}
