/**
 * gsc-service.ts — Google Search Console (Search Analytics API)
 *
 * syncGSCData pulls the last 28 days of search analytics and stores them
 * in gsc_keyword_data.  All read functions query that table — never fake data.
 */

import { pool } from "@workspace/db";
import { getValidToken } from "./google-service.js";
import { logger } from "../lib/logger.js";

const GSC_BASE = "https://searchconsole.googleapis.com/webmasters/v3/sites";

// ── Status & site management ──────────────────────────────────────────────────

export async function getGSCStatus(
  orgId: string
): Promise<{ connected: boolean; activeSite: string | null; sitesCount: number }> {
  const client = await pool.connect();
  try {
    const [site, count] = await Promise.all([
      client.query(`SELECT site_url FROM gsc_sites WHERE org_id=$1 AND is_active=true LIMIT 1`, [orgId]),
      client.query(`SELECT COUNT(*)::int AS c FROM gsc_sites WHERE org_id=$1`, [orgId]),
    ]);
    return {
      connected:   site.rows.length > 0,
      activeSite:  (site.rows[0] as Record<string, string> | undefined)?.["site_url"] ?? null,
      sitesCount:  Number((count.rows[0] as Record<string, number>)?.["c"] ?? 0),
    };
  } catch {
    return { connected: false, activeSite: null, sitesCount: 0 };
  } finally {
    client.release();
  }
}

export async function listGSCSites(orgId: string): Promise<unknown[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT * FROM gsc_sites WHERE org_id=$1 ORDER BY created_at DESC`, [orgId]
    );
    return res.rows;
  } catch { return []; } finally { client.release(); }
}

export async function getActiveSite(orgId: string): Promise<string | null> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT site_url FROM gsc_sites WHERE org_id=$1 AND is_active=true LIMIT 1`, [orgId]
    );
    return (res.rows[0] as Record<string, string> | undefined)?.["site_url"] ?? null;
  } catch { return null; } finally { client.release(); }
}

export async function setActiveSite(orgId: string, siteUrl: string, displayName?: string): Promise<void> {
  const client = await pool.connect();
  const id = `gsc_${orgId}_${Buffer.from(siteUrl).toString("base64url").slice(0, 40)}`;
  try {
    await client.query(`UPDATE gsc_sites SET is_active=false WHERE org_id=$1`, [orgId]);
    await client.query(
      `INSERT INTO gsc_sites (id, org_id, site_url, display_name, is_active, created_at)
       VALUES ($1, $2, $3, $4, true, NOW())
       ON CONFLICT (org_id, site_url) DO UPDATE
         SET is_active=true, display_name=COALESCE($4, gsc_sites.display_name), updated_at=NOW()`,
      [id, orgId, siteUrl, displayName ?? null]
    );
  } finally { client.release(); }
}

// ── Discover sites from Google (called after OAuth) ───────────────────────────

export async function discoverAndStoreSites(orgId: string): Promise<number> {
  const token = await getValidToken(orgId).catch(() => null);
  if (!token) return 0;
  try {
    const res = await fetch(`${GSC_BASE}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return 0;
    const data = await res.json() as { siteEntry?: Array<{ siteUrl: string; permissionLevel: string }> };
    const sites = data.siteEntry ?? [];
    const client = await pool.connect();
    try {
      for (const site of sites) {
        const siteId = `gsc_${orgId}_${Buffer.from(site.siteUrl).toString("base64url").slice(0, 40)}`;
        await client.query(
          `INSERT INTO gsc_sites (id, org_id, site_url, permission_level, is_active, created_at)
           VALUES ($1, $2, $3, $4, false, NOW())
           ON CONFLICT (org_id, site_url) DO UPDATE SET permission_level=$4`,
          [siteId, orgId, site.siteUrl, site.permissionLevel]
        ).catch(() => {});
      }
      // Auto-activate the first verified site
      const firstVerified = sites.find(s => s.permissionLevel !== "siteUnverifiedUser");
      if (firstVerified) {
        await setActiveSite(orgId, firstVerified.siteUrl);
      }
    } finally { client.release(); }
    return sites.length;
  } catch (e) {
    logger.warn({ e, orgId }, "[gsc] discoverAndStoreSites failed");
    return 0;
  }
}

// ── Sync (write to gsc_keyword_data) ─────────────────────────────────────────

export async function syncGSCData(orgId: string): Promise<number> {
  const siteUrl = await getActiveSite(orgId);
  if (!siteUrl) return 0;

  const token = await getValidToken(orgId).catch(() => null);
  if (!token) return 0;

  const endDate   = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 28 * 86400 * 1000).toISOString().slice(0, 10);

  try {
    const res = await fetch(
      `${GSC_BASE}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method:  "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate, endDate,
          dimensions: ["query", "date"],
          rowLimit:   1000,
          startRow:   0,
        }),
        signal: AbortSignal.timeout(25_000),
      }
    );

    if (!res.ok) {
      logger.warn({ status: res.status, orgId, siteUrl }, "[gsc] searchAnalytics query failed");
      return 0;
    }

    const data = await res.json() as {
      rows?: Array<{ keys: [string, string]; clicks: number; impressions: number; ctr: number; position: number }>;
    };

    const rows = data.rows ?? [];
    if (rows.length === 0) return 0;

    // Fetch page-level data in the same sync
    const pageRes = await fetch(
      `${GSC_BASE}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method:  "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate, endDate,
          dimensions: ["page", "date"],
          rowLimit:   1000,
          startRow:   0,
        }),
        signal: AbortSignal.timeout(25_000),
      }
    );
    const pageData = pageRes.ok
      ? await pageRes.json() as { rows?: Array<{ keys: [string, string]; clicks: number; impressions: number; ctr: number; position: number }> }
      : { rows: [] };
    const pageRows = pageData.rows ?? [];

    const client = await pool.connect();
    try {
      let inserted = 0;
      for (const row of rows) {
        const [keyword, date] = row.keys;
        await client.query(
          `INSERT INTO gsc_keyword_data
             (org_id, keyword, date, impressions, clicks, ctr, position, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
           ON CONFLICT (org_id, keyword, date) DO UPDATE SET
             impressions=$4, clicks=$5, ctr=$6, position=$7, updated_at=NOW()`,
          [orgId, keyword, date, row.impressions, row.clicks, row.ctr, row.position]
        );
        inserted++;
      }
      for (const row of pageRows) {
        const [page, date] = row.keys;
        await client.query(
          `INSERT INTO gsc_page_data
             (org_id, page, date, impressions, clicks, ctr, position, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
           ON CONFLICT (org_id, page, date) DO UPDATE SET
             impressions=$4, clicks=$5, ctr=$6, position=$7, updated_at=NOW()`,
          [orgId, page, date, row.impressions, row.clicks, row.ctr, row.position]
        );
      }

      await client.query(
        `INSERT INTO gsc_sync_logs (org_id, site_url, rows_synced, synced_at)
         VALUES ($1,$2,$3,NOW())`,
        [orgId, siteUrl, inserted]
      ).catch(() => {});

      logger.info({ orgId, inserted }, "[gsc] syncGSCData complete");
      return inserted;
    } finally {
      client.release();
    }
  } catch (e) {
    logger.warn({ e, orgId }, "[gsc] syncGSCData failed");
    return 0;
  }
}

// ── Read functions (from gsc_keyword_data) ────────────────────────────────────

export async function getTopKeywords(orgId: string, siteUrlOrLimit?: string | number, daysOrLimit?: number, limitArg?: number): Promise<unknown[]> {
  // Supports two signatures:
  //   getTopKeywords(orgId, limit?, days?)           — legacy
  //   getTopKeywords(orgId, siteUrl, days, limit)    — new (siteUrl ignored for DB queries)
  let days: number;
  let limit: number;
  if (typeof siteUrlOrLimit === "string") {
    // new signature: (orgId, siteUrl, days, limit)
    days  = daysOrLimit ?? 28;
    limit = limitArg ?? 20;
  } else {
    // legacy: (orgId, limit?, days?)
    limit = siteUrlOrLimit ?? 20;
    days  = daysOrLimit ?? 28;
  }
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT keyword,
              SUM(impressions)::int  AS impressions,
              SUM(clicks)::int       AS clicks,
              AVG(position)::numeric AS avg_position,
              AVG(ctr)::numeric      AS avg_ctr
       FROM gsc_keyword_data
       WHERE org_id=$1 AND date > NOW() - INTERVAL '${Math.min(days, 90)} days'
       GROUP BY keyword
       ORDER BY impressions DESC
       LIMIT $2`,
      [orgId, limit]
    );
    return res.rows;
  } catch { return []; } finally { client.release(); }
}

export async function getTopPages(orgId: string, siteUrlOrLimit?: string | number, daysOrLimit?: number, limitArg?: number): Promise<unknown[]> {
  // Supports two signatures:
  //   getTopPages(orgId, limit?, days?)           — legacy
  //   getTopPages(orgId, siteUrl, days, limit)    — new (siteUrl ignored for DB queries)
  let days: number;
  let limit: number;
  if (typeof siteUrlOrLimit === "string") {
    // new signature: (orgId, siteUrl, days, limit)
    days  = daysOrLimit ?? 28;
    limit = limitArg ?? 20;
  } else {
    // legacy: (orgId, limit?, days?)
    limit = siteUrlOrLimit ?? 20;
    days  = daysOrLimit ?? 28;
  }
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT page,
              SUM(impressions)::int  AS impressions,
              SUM(clicks)::int       AS clicks,
              AVG(position)::numeric AS avg_position,
              AVG(ctr)::numeric      AS avg_ctr
       FROM gsc_page_data
       WHERE org_id=$1 AND date > NOW() - INTERVAL '${Math.min(days, 90)} days'
       GROUP BY page
       ORDER BY impressions DESC
       LIMIT $2`,
      [orgId, limit]
    );
    return res.rows;
  } catch { return []; } finally { client.release(); }
}

export async function getImpressionsOverTime(
  orgId: string, siteUrlOrDays?: string | number, daysArg?: number
): Promise<Array<{ date: string; impressions: number; clicks: number; position: number; ctr: number }>> {
  // Supports two signatures:
  //   getImpressionsOverTime(orgId, days?)          — legacy
  //   getImpressionsOverTime(orgId, siteUrl, days)  — new (siteUrl ignored for DB queries)
  const days = typeof siteUrlOrDays === "string" ? (daysArg ?? 28) : (siteUrlOrDays ?? 28);
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT date::text,
              SUM(impressions)::int   AS impressions,
              SUM(clicks)::int        AS clicks,
              AVG(position)::numeric  AS position,
              AVG(ctr)::numeric       AS ctr
       FROM gsc_keyword_data
       WHERE org_id=$1 AND date > NOW() - INTERVAL '${Math.min(days, 90)} days'
       GROUP BY date
       ORDER BY date ASC`,
      [orgId]
    );
    return res.rows as Array<{ date: string; impressions: number; clicks: number; position: number; ctr: number }>;
  } catch { return []; } finally { client.release(); }
}

export async function querySearchAnalytics(
  orgId: string,
  siteUrlOrQuery: string | { dimensions: string[]; startDate: string; endDate: string; rowLimit?: number },
  queryArg?: { dimensions: string[]; startDate: string; endDate: string; rowLimit?: number }
): Promise<unknown[]> {
  // Supports two signatures:
  //   querySearchAnalytics(orgId, query)              — legacy
  //   querySearchAnalytics(orgId, siteUrl, query)     — new
  let siteUrlOverride: string | null = null;
  let query: { dimensions: string[]; startDate: string; endDate: string; rowLimit?: number };
  if (typeof siteUrlOrQuery === "string") {
    siteUrlOverride = siteUrlOrQuery;
    query = queryArg!;
  } else {
    query = siteUrlOrQuery;
  }
  const siteUrl = siteUrlOverride ?? (await getActiveSite(orgId));
  if (!siteUrl) return [];

  const token = await getValidToken(orgId).catch(() => null);
  if (!token) return [];

  try {
    const res = await fetch(
      `${GSC_BASE}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      {
        method:  "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate:  query.startDate,
          endDate:    query.endDate,
          dimensions: query.dimensions,
          rowLimit:   query.rowLimit ?? 100,
        }),
        signal: AbortSignal.timeout(20_000),
      }
    );
    if (!res.ok) return [];
    const data = await res.json() as { rows?: unknown[] };
    return data.rows ?? [];
  } catch { return []; }
}

export async function getIndexingStatus(orgId: string, siteUrl?: string, _inspectionUrl?: string): Promise<{ indexed: number; notIndexed: number; errors: number }> {
  const resolvedSiteUrl = siteUrl ?? (await getActiveSite(orgId));
  if (!resolvedSiteUrl) return { indexed: 0, notIndexed: 0, errors: 0 };
  return { indexed: 0, notIndexed: 0, errors: 0 }; // requires Index Coverage API (separate quota)
}

export async function getSitemaps(orgId: string, siteUrlOverride?: string): Promise<unknown[]> {
  const siteUrl = siteUrlOverride ?? (await getActiveSite(orgId));
  if (!siteUrl) return [];

  const token = await getValidToken(orgId).catch(() => null);
  if (!token) return [];

  try {
    const res = await fetch(
      `${GSC_BASE}/${encodeURIComponent(siteUrl)}/sitemaps`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return [];
    const data = await res.json() as { sitemap?: unknown[] };
    return data.sitemap ?? [];
  } catch { return []; }
}

export async function getSyncLogs(orgId: string, limit = 20): Promise<unknown[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT * FROM gsc_sync_logs WHERE org_id=$1 ORDER BY created_at DESC LIMIT $2`,
      [orgId, limit]
    );
    return res.rows;
  } catch { return []; } finally { client.release(); }
}
