/**
 * Usage events — cumulative, append-only usage accounting.
 *
 * Deleting a report/monitor must NOT erase its consumption history: quotas are
 * measured against events recorded at action time, never against live row
 * counts alone. Events are org-scoped and monthly (queried by created_at).
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export const USAGE_EVENT_KINDS = new Set([
  "report_created",
  "monitor_created",
  "audit_created",
  "pdf_export",
  "export",
  "health_export",
]);

let _tableReady = false;

async function ensureTable(): Promise<void> {
  if (_tableReady) return;
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS usage_events (
        id         BIGSERIAL PRIMARY KEY,
        org_id     TEXT NOT NULL,
        kind       TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_usage_events_org_month ON usage_events (org_id, kind, created_at)`);
    // Inline RLS — rule: every new tenant table enables RLS at creation time.
    await client.query(`ALTER TABLE usage_events ENABLE ROW LEVEL SECURITY`);
    await client.query(`ALTER TABLE usage_events FORCE ROW LEVEL SECURITY`);
    await client.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'usage_events' AND policyname = 'usage_events_org_isolation') THEN
          CREATE POLICY usage_events_org_isolation ON usage_events
            USING (org_id = current_setting('app.org_id', true))
            WITH CHECK (org_id = current_setting('app.org_id', true));
        END IF;
      END $$`);
    _tableReady = true;
  } catch (err) {
    logger.error({ err }, "[UsageEvents] ensureTable failed");
  } finally {
    client.release();
  }
}

/** Fire-and-forget safe: never throws. Explicit org_id (superuser pool bypasses RLS). */
export async function recordUsageEvent(orgId: string, kind: string): Promise<void> {
  if (!orgId || orgId === "default" || !USAGE_EVENT_KINDS.has(kind)) return;
  try {
    await ensureTable();
    await pool.query(`INSERT INTO usage_events (org_id, kind) VALUES ($1, $2)`, [orgId, kind]);
  } catch (err) {
    logger.warn({ err, orgId, kind }, "[UsageEvents] record failed (non-fatal)");
  }
}

/** Current-month counts per kind for an org. Returns {} on failure. */
export async function getMonthlyUsageCounts(orgId: string): Promise<Record<string, number>> {
  if (!orgId) return {};
  try {
    await ensureTable();
    const r = await pool.query(
      `SELECT kind, COUNT(*)::int AS n
       FROM usage_events
       WHERE org_id = $1 AND created_at >= date_trunc('month', now())
       GROUP BY kind`,
      [orgId]
    );
    const out: Record<string, number> = {};
    for (const row of r.rows) out[row.kind as string] = Number(row.n) || 0;
    return out;
  } catch (err) {
    logger.warn({ err, orgId }, "[UsageEvents] monthly counts failed");
    return {};
  }
}
