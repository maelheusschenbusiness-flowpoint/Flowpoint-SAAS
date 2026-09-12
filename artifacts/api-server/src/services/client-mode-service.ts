import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export interface ClientKPIs {
  avg_seo_score: number | null;
  audit_count: number;
  monitor_count: number;
  avg_uptime: number | null;
  monitors_up: number;
  monitors_down: number;
  reports_shared: number;
  missions_total: number;
  missions_done: number;
  gbp_rating: number | null;
}

export interface ClientReport {
  id: string;
  name: string;
  type: string;
  date: string;
  pages: number | null;
  token: string | null;
}

export interface ClientStatus {
  org_id: string;
  plan: string | null;
  site_count: number;
  client_mode_enabled: boolean;
  permissions: {
    can_view_audits: boolean;
    can_view_reports: boolean;
    can_view_kpis: boolean;
    can_view_monitors: boolean;
    can_edit: boolean;
    can_access_billing: boolean;
    can_access_settings: boolean;
    can_view_api_keys: boolean;
  };
}

// ── SQL error classification ──────────────────────────────────────────────────
// Reliability: we must NOT swallow SQL/schema failures as legitimate empty
// results. A genuine empty state (no rows) is a successful query returning 0
// rows — that is preserved. A schema/connection failure is an *error* and must
// surface so the frontend can show a retry affordance instead of a false
// "everything is empty" state.

/** PostgreSQL error code for "relation does not exist" (undefined_table). */
const PG_UNDEFINED_TABLE = "42P01";
/** PostgreSQL error code for "column does not exist" (undefined_column). */
const PG_UNDEFINED_COLUMN = "42703";

function pgCode(err: unknown): string | undefined {
  return (err as { code?: string })?.code
    ?? (err as { raw?: { code?: string } })?.raw?.code;
}

/**
 * True when the failure is a missing table/column — i.e. schema drift that our
 * self-healing init routines can repair. These are still errors (never a
 * silent empty array) but are eligible for a one-shot self-heal + retry.
 */
function isSchemaMissing(err: unknown): boolean {
  const code = pgCode(err);
  return code === PG_UNDEFINED_TABLE || code === PG_UNDEFINED_COLUMN;
}

/**
 * Runs the data-tables self-heal (idempotent CREATE TABLE / ALTER TABLE IF NOT
 * EXISTS). Imported lazily to avoid a startup import cycle and so the service
 * stays cheap to import for callers that never hit schema drift.
 */
async function selfHealDataTables(): Promise<void> {
  const { initDataTables } = await import("./init-data-tables.js");
  await initDataTables();
}

export async function getClientStatus(orgId: string): Promise<ClientStatus> {
  let plan: string | null = null;
  let siteCount = 0;
  const client = await pool.connect();
  try {
    const r = await client.query(`SELECT plan FROM organizations WHERE id=$1 LIMIT 1`, [orgId]);
    plan = r.rows?.[0]?.plan ? String(r.rows[0].plan) : null;
    const sc = await client.query(`SELECT COUNT(*) as c FROM audits WHERE org_id=$1`, [orgId]);
    siteCount = Number(sc.rows?.[0]?.c ?? 0);
  } catch (err) {
    // Do not silently pretend the org has no plan / no sites on a real DB
    // failure — surface it so the route returns 500 and the client retries.
    logger.error({ err, orgId }, "[client-mode] getClientStatus query failed");
    throw err;
  } finally {
    client.release();
  }
  return {
    org_id: orgId,
    plan,
    site_count: siteCount,
    client_mode_enabled: true,
    permissions: {
      can_view_audits: true,
      can_view_reports: true,
      can_view_kpis: true,
      can_view_monitors: true,
      can_edit: false,
      can_access_billing: false,
      can_access_settings: false,
      can_view_api_keys: false,
    },
  };
}

export async function getClientKPIs(orgId: string): Promise<ClientKPIs> {
  let avgSeoScore: number | null = null;
  let auditCount = 0;
  let monitorCount = 0;
  let avgUptime: number | null = null;
  let monitorsUp = 0;
  let monitorsDown = 0;
  let reportsShared = 0;
  let missionsTotal = 0;
  let missionsDone = 0;
  let gbpRating: number | null = null;

  const client = await pool.connect();
  try {
    const ar = await client.query(`SELECT COUNT(*) as c, AVG(score) as avg FROM audits WHERE org_id=$1`, [orgId]);
    auditCount = Number(ar.rows?.[0]?.c ?? 0);
    const rawAvg = ar.rows?.[0]?.avg;
    if (rawAvg != null) avgSeoScore = Math.round(Number(rawAvg));

    const mr = await client.query(
      `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='up') as up, COUNT(*) FILTER (WHERE status='down') as down, AVG(uptime) as avg_up FROM monitors WHERE org_id=$1`,
      [orgId]
    );
    monitorCount = Number(mr.rows?.[0]?.total ?? 0);
    monitorsUp = Number(mr.rows?.[0]?.up ?? 0);
    monitorsDown = Number(mr.rows?.[0]?.down ?? 0);
    const rawUp = mr.rows?.[0]?.avg_up;
    if (rawUp != null) avgUptime = Math.round(Number(rawUp) * 10) / 10;

    const rr = await client.query(
      `SELECT COUNT(*) FILTER (WHERE shared=true) as shared FROM reports WHERE org_id=$1`,
      [orgId]
    );
    reportsShared = Number(rr.rows?.[0]?.shared ?? 0);

    const misr = await client.query(
      `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='done') as done FROM missions WHERE org_id=$1`,
      [orgId]
    );
    missionsTotal = Number(misr.rows?.[0]?.total ?? 0);
    missionsDone = Number(misr.rows?.[0]?.done ?? 0);

    // gbp_profiles is an optional/experimental table. A missing table here is a
    // genuine "feature not provisioned" state → leave gbp_rating null. Any
    // OTHER SQL error is a real failure and must propagate so the whole KPI
    // payload is not silently served as partial/zeroed data.
    try {
      const gr = await client.query(`SELECT avg_rating FROM gbp_profiles WHERE org_id=$1 LIMIT 1`, [orgId]);
      const raw = gr.rows?.[0]?.avg_rating;
      if (raw != null) gbpRating = Math.round(Number(raw) * 10) / 10;
    } catch (err) {
      if (isSchemaMissing(err)) {
        logger.debug({ orgId }, "[client-mode] gbp_profiles not provisioned — gbp_rating stays null");
      } else {
        throw err;
      }
    }
  } catch (err) {
    logger.error({ err, orgId }, "[client-mode] getClientKPIs query failed");
    throw err;
  } finally {
    client.release();
  }

  return {
    avg_seo_score: avgSeoScore,
    audit_count: auditCount,
    monitor_count: monitorCount,
    avg_uptime: avgUptime,
    monitors_up: monitorsUp,
    monitors_down: monitorsDown,
    reports_shared: reportsShared,
    missions_total: missionsTotal,
    missions_done: missionsDone,
    gbp_rating: gbpRating,
  };
}

/**
 * Shared reports for the org. Joins reports → share_tokens so the client link
 * (token) is exposed. Both tables are provisioned by initDataTables; if either
 * is missing we self-heal ONCE and retry, so a fresh/drifted DB does not
 * masquerade as "no shared reports". Any non-schema error propagates.
 */
export async function getClientReports(orgId: string): Promise<ClientReport[]> {
  const sql =
    `SELECT r.id, r.name, r.type, r.date, r.pages, st.token
       FROM reports r
       LEFT JOIN share_tokens st ON st.report_id = r.id
       WHERE r.org_id=$1 AND r.shared=true
       ORDER BY r.date DESC LIMIT 50`;

  const runQuery = async () => {
    const client = await pool.connect();
    try {
      const r = await client.query(sql, [orgId]);
      return (r.rows ?? []).map((row) => ({
        id: String(row.id ?? ""),
        name: String(row.name ?? ""),
        type: String(row.type ?? "PDF"),
        date: row.date ? new Date(row.date as string).toLocaleDateString("fr-FR") : "—",
        pages: row.pages != null ? Number(row.pages) : null,
        token: row.token ? String(row.token) : null,
      }));
    } finally {
      client.release();
    }
  };

  try {
    return await runQuery();
  } catch (err) {
    if (isSchemaMissing(err)) {
      logger.warn({ orgId, code: pgCode(err) }, "[client-mode] reports/share_tokens schema missing — self-healing and retrying");
      await selfHealDataTables();
      // Retry once. If it still fails, propagate — never a silent empty array.
      return await runQuery();
    }
    logger.error({ err, orgId }, "[client-mode] getClientReports query failed");
    throw err;
  }
}

export async function getClientAudits(orgId: string, limit = 20): Promise<Record<string, unknown>[]> {
  const sql =
    `SELECT id, url, score, created_at, status FROM audits WHERE org_id=$1 ORDER BY created_at DESC LIMIT $2`;

  const runQuery = async () => {
    const client = await pool.connect();
    try {
      const r = await client.query(sql, [orgId, limit]);
      return (r.rows ?? []).map((row) => ({
        id: String(row.id ?? ""),
        url: String(row.url ?? "—"),
        score: row.score != null ? Number(row.score) : null,
        status: String(row.status ?? "done"),
        date: row.created_at ? new Date(row.created_at as string).toLocaleDateString("fr-FR") : "—",
      }));
    } finally {
      client.release();
    }
  };

  try {
    return await runQuery();
  } catch (err) {
    if (isSchemaMissing(err)) {
      logger.warn({ orgId, code: pgCode(err) }, "[client-mode] audits schema missing — self-healing and retrying");
      await selfHealDataTables();
      return await runQuery();
    }
    logger.error({ err, orgId }, "[client-mode] getClientAudits query failed");
    throw err;
  }
}
