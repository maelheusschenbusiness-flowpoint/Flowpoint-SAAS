import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

/**
 * Market Intelligence (add-on marketIntelligence) : tables lues/ecrites par
 * routes/market-intelligence.ts et services/market-intel-service.ts.
 *
 * ai_market_reports etait absente de la production (aucun CREATE TABLE) : lecture et
 * generation de rapport repondaient 5xx. Schema identique a Test-Replit
 * (services/init-data-tables.ts). competitor_rankings / industry_signals existent deja
 * en production ; leur creation ici (IF NOT EXISTS) ne sert qu'aux bases neuves.
 * Additif et idempotent : pas de DROP, pas de FK sur org_id.
 */
export async function initMarketIntelTables(): Promise<void> {
  const client = await pool.connect();
  const run = (sql: string) => client.query(sql);
  try {
    await run(`
      CREATE TABLE IF NOT EXISTS ai_market_reports (
        id           TEXT PRIMARY KEY,
        org_id       TEXT NOT NULL DEFAULT 'default',
        title        TEXT NOT NULL,
        summary      TEXT NOT NULL DEFAULT '',
        data         JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_by   TEXT,
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await run(`ALTER TABLE ai_market_reports ADD COLUMN IF NOT EXISTS created_by TEXT`);
    await run(`CREATE INDEX IF NOT EXISTS ai_market_reports_org_history_idx ON ai_market_reports (org_id, generated_at DESC, id DESC)`);

    await run(`
      CREATE TABLE IF NOT EXISTS competitor_rankings (
        id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        org_id            TEXT NOT NULL DEFAULT 'default',
        competitor_domain TEXT,
        keyword           TEXT,
        position          INTEGER,
        url               TEXT,
        checked_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await run(`CREATE INDEX IF NOT EXISTS competitor_rankings_org_idx ON competitor_rankings (org_id, checked_at DESC)`);
    await run(`
      CREATE TABLE IF NOT EXISTS industry_signals (
        id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        org_id      TEXT NOT NULL DEFAULT 'default',
        type        TEXT,
        title       TEXT,
        description TEXT,
        severity    TEXT,
        expires_at  TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await run(`CREATE INDEX IF NOT EXISTS industry_signals_org_idx ON industry_signals (org_id, created_at DESC)`);

    // RLS tenant (meme schema que applyTenantRls de init-data-tables.ts, sans FORCE :
    // le service lit via pool.connect() sans GUC).
    const GUC = `current_setting('app.current_org_id', true)`;
    for (const t of ["ai_market_reports", "competitor_rankings", "industry_signals"]) {
      await run(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
      for (const [op, cmd] of [
        ["select", `FOR SELECT USING     (COALESCE(org_id,'default') = ${GUC})`],
        ["insert", `FOR INSERT WITH CHECK (COALESCE(org_id,'default') = ${GUC})`],
        ["update", `FOR UPDATE USING     (COALESCE(org_id,'default') = ${GUC})`],
        ["delete", `FOR DELETE USING     (COALESCE(org_id,'default') = ${GUC})`],
      ] as [string, string][]) {
        await run(`DROP   POLICY IF EXISTS "tenant_${op}" ON "${t}"`);
        await run(`CREATE POLICY           "tenant_${op}" ON "${t}" ${cmd}`);
      }
    }
  } catch (err) {
    logger.error({ err }, "[init-market-intel-tables] failed");
    throw err;
  } finally {
    client.release();
  }
}
