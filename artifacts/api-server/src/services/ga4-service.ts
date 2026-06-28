/**
 * ga4-service.ts — Google Analytics 4 (Analytics Data API v1beta)
 *
 * All public functions return data in the raw GA4 API format:
 * { rows: [{dimensionValues, metricValues}], totals: [...] }
 *
 * This matches exactly what the FlowPoint dashboard.js rendering code expects.
 * No Math.random() — empty/zero structures when not connected.
 */

import { pool } from "@workspace/db";
import { getValidToken } from "./google-service.js";
import { logger } from "../lib/logger.js";

// ── Types ──────────────────────────────────────────────────────────────────────

interface DimValue   { value?: string }
interface MetricValue { value?: string }

interface GA4Row {
  dimensionValues?: DimValue[];
  metricValues?:   MetricValue[];
}

interface GA4ReportResponse {
  rows?:    GA4Row[];
  totals?:  Array<{ metricValues?: MetricValue[] }>;
  rowCount?: number;
}

// ── Internals ──────────────────────────────────────────────────────────────────

const GA4_DATA_BASE  = "https://analyticsdata.googleapis.com/v1beta/properties";
const GA4_ADMIN_BASE = "https://analyticsadmin.googleapis.com/v1beta";

async function ga4Post<T>(token: string, propertyId: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${GA4_DATA_BASE}/${propertyId}${path}`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GA4 Data API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

async function ga4AdminGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${GA4_ADMIN_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal:  AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GA4 Admin API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

async function getGA4Context(orgId: string): Promise<{ token: string; propertyId: string } | null> {
  const [stored, token] = await Promise.all([
    getStoredProperty(orgId),
    getValidToken(orgId).catch(() => null),
  ]);
  if (!stored || !token) return null;
  return { token, propertyId: stored.propertyId };
}

function prevPeriod(startDate: string, endDate: string): { startDate: string; endDate: string } {
  const start = new Date(startDate);
  const end   = new Date(endDate);
  const days  = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const pEnd   = new Date(start.getTime() - 86_400_000);
  const pStart = new Date(pEnd.getTime() - (days - 1) * 86_400_000);
  return {
    startDate: pStart.toISOString().slice(0, 10),
    endDate:   pEnd.toISOString().slice(0, 10),
  };
}

// ── Stored property management ────────────────────────────────────────────────

/** Lists GA4 accounts live from the Google Admin API (not DB). */
export async function listGA4Accounts(orgId: string): Promise<unknown[]> {
  const token = await getValidToken(orgId).catch(() => null);
  if (!token) return [];
  try {
    const data = await ga4AdminGet<{
      accounts?: Array<{ name: string; displayName: string; createTime: string }>;
    }>(token, "/accounts");
    return (data.accounts ?? []).map(a => ({
      account_id:   a.name.split("/")[1],
      display_name: a.displayName,
      created_at:   a.createTime,
    }));
  } catch (e) {
    logger.warn({ e, orgId }, "[ga4] listGA4Accounts failed");
    return [];
  }
}

/** Lists GA4 properties for an account live from the Google Admin API (not DB). */
export async function listGA4Properties(accountId: string, orgId?: string): Promise<unknown[]> {
  const resolvedOrgId = orgId ?? "default";
  const token = await getValidToken(resolvedOrgId).catch(() => null);
  if (!token || !accountId) return [];
  try {
    const data = await ga4AdminGet<{
      properties?: Array<{ name: string; displayName: string; createTime: string; industryCategory?: string }>;
    }>(token, `/properties?filter=parent:accounts/${accountId}`);
    return (data.properties ?? []).map(p => ({
      property_id:   p.name.split("/")[1],
      name:          p.name,  // "properties/123456"
      display_name:  p.displayName,
      created_at:    p.createTime,
    }));
  } catch (e) {
    logger.warn({ e, resolvedOrgId }, "[ga4] listGA4Properties failed");
    return [];
  }
}

export async function isGA4Connected(orgId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT 1 FROM ga4_properties WHERE org_id=$1 AND is_active=true LIMIT 1`, [orgId]
    );
    return res.rows.length > 0;
  } catch { return false; } finally { client.release(); }
}

export async function getStoredProperty(orgId: string): Promise<{ propertyId: string; displayName: string } | null> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT property_id, property_name FROM ga4_properties WHERE org_id=$1 AND is_active=true LIMIT 1`,
      [orgId]
    );
    if (!res.rows[0]) return null;
    const r = res.rows[0] as Record<string, string>;
    return { propertyId: r["property_id"]!, displayName: r["property_name"] ?? "" };
  } catch { return null; } finally { client.release(); }
}

export async function setStoredProperty(orgId: string, propertyId: string, displayName: string): Promise<void> {
  const client = await pool.connect();
  try {
    // ga4_properties has UNIQUE(org_id) — one active property per org
    await client.query(
      `INSERT INTO ga4_properties (id, org_id, property_id, property_name, is_active, created_at)
       VALUES ($1, $2, $3, $4, true, NOW())
       ON CONFLICT (org_id) DO UPDATE
         SET property_id=$3, property_name=$4, is_active=true, updated_at=NOW()`,
      [`ga4prop_${orgId}`, orgId, propertyId, displayName]
    );
  } finally { client.release(); }
}

// ── Discover from Google APIs (called after OAuth connect) ───────────────────

/**
 * Discovers GA4 accounts+properties from the Google Admin API.
 * Does NOT store to DB (the DB schema only supports one property per org via UNIQUE(org_id)).
 * Returns the count of properties found — caller can then call setStoredProperty to activate one.
 */
export async function discoverAndStoreProperties(orgId: string): Promise<number> {
  const token = await getValidToken(orgId).catch(() => null);
  if (!token) return 0;
  try {
    const data = await ga4AdminGet<{ accounts?: Array<{ name: string }> }>(token, "/accounts");
    let count = 0;
    for (const account of (data.accounts ?? []).slice(0, 5)) {
      const propsData = await ga4AdminGet<{
        properties?: Array<{ name: string; displayName: string }>;
      }>(token, `/properties?filter=parent:${account.name}`).catch(() => ({ properties: [] }));
      count += (propsData.properties ?? []).length;
    }
    return count;
  } catch (e) {
    logger.warn({ e, orgId }, "[ga4] discoverAndStoreProperties failed");
    return 0;
  }
}

// ── Analytics Data API — raw format responses ─────────────────────────────────
//
// Each function returns data in native GA4 API format so dashboard.js can access
// row.dimensionValues[n].value and row.metricValues[n].value directly.

/**
 * Overview: daily rows by date + totals for current and previous period.
 *
 * Metrics order (fixed, dashboard.js reads by index):
 *   0=sessions  1=totalUsers  2=newUsers  3=bounceRate  4=engagementRate
 *   5=averageSessionDuration  6=screenPageViews  7=conversions
 */
export async function getGA4Overview(
  orgId: string, startDate: string, endDate: string
): Promise<{ rows: GA4Row[]; totals: Array<{ metricValues: MetricValue[] }> }> {
  const EMPTY = { rows: [], totals: [] };
  const ctx = await getGA4Context(orgId);
  if (!ctx) return EMPTY;

  const metrics = [
    "sessions", "totalUsers", "newUsers", "bounceRate",
    "engagementRate", "averageSessionDuration", "screenPageViews", "conversions",
  ].map(n => ({ name: n }));

  const prev = prevPeriod(startDate, endDate);

  try {
    const [daily, curTotals, prevTotals] = await Promise.all([
      // Daily breakdown for sparkline chart
      ga4Post<GA4ReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "date" }],
        metrics,
        orderBys: [{ dimension: { dimensionName: "date" }, desc: false }],
      }),
      // Current period totals
      ga4Post<GA4ReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
        dateRanges: [{ startDate, endDate }],
        metrics,
        returnPropertyQuota: false,
      }),
      // Previous period totals for comparison
      ga4Post<GA4ReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
        dateRanges: [{ startDate: prev.startDate, endDate: prev.endDate }],
        metrics,
        returnPropertyQuota: false,
      }),
    ]);

    // Synthetic totals row (sum across all rows in the period response)
    const buildTotals = (report: GA4ReportResponse): MetricValue[] => {
      if (report.totals?.[0]?.metricValues) return report.totals[0].metricValues;
      if (!report.rows?.length) return metrics.map(() => ({ value: "0" }));
      const sums = metrics.map(() => 0);
      for (const row of report.rows) {
        row.metricValues?.forEach((mv, i) => {
          sums[i] = (sums[i] ?? 0) + parseFloat(mv.value ?? "0");
        });
      }
      return sums.map(v => ({ value: String(Math.round(v * 10000) / 10000) }));
    };

    return {
      rows:   daily.rows ?? [],
      totals: [
        { metricValues: buildTotals(curTotals)  },
        { metricValues: buildTotals(prevTotals) },
      ],
    };
  } catch (e) {
    logger.warn({ e, orgId }, "[ga4] getGA4Overview failed");
    return EMPTY;
  }
}

/**
 * Realtime: returns raw rows so fp-backend.js can sum metricValues[0] for activeUsers.
 *
 * Dimension order: [0]=country  [1]=city  [2]=unifiedScreenName(page)  [3]=deviceCategory
 * Metric  order:   [0]=activeUsers  [1]=screenPageViews
 */
export async function getGA4Realtime(
  orgId: string
): Promise<{ rows: GA4Row[]; activeUsers: number }> {
  const ctx = await getGA4Context(orgId);
  if (!ctx) return { rows: [], activeUsers: 0 };

  try {
    const data = await ga4Post<GA4ReportResponse>(ctx.token, ctx.propertyId, ":runRealtimeReport", {
      dimensions: [
        { name: "country" },
        { name: "city" },
        { name: "unifiedScreenName" },
        { name: "deviceCategory" },
      ],
      metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
      limit: 50,
    });

    const rows = data.rows ?? [];
    const activeUsers = rows.reduce((sum, row) => sum + Number(row.metricValues?.[0]?.value ?? 0), 0);
    return { rows, activeUsers };
  } catch (e) {
    logger.warn({ e, orgId }, "[ga4] getGA4Realtime failed");
    return { rows: [], activeUsers: 0 };
  }
}

/**
 * Traffic sources: raw rows.
 *
 * Dimension order: [0]=sessionDefaultChannelGrouping  [1]=sessionSource  [2]=sessionMedium
 * Metric  order:   [0]=sessions  [1]=totalUsers  [2]=bounceRate  [3]=conversions
 */
export async function getGA4Sources(
  orgId: string, startDate: string, endDate: string
): Promise<{ rows: GA4Row[] }> {
  const ctx = await getGA4Context(orgId);
  if (!ctx) return { rows: [] };

  try {
    const data = await ga4Post<GA4ReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
      dateRanges: [{ startDate, endDate }],
      dimensions: [
        { name: "sessionDefaultChannelGrouping" },
        { name: "sessionSource" },
        { name: "sessionMedium" },
      ],
      metrics: [
        { name: "sessions" }, { name: "totalUsers" },
        { name: "bounceRate" }, { name: "conversions" },
      ],
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 25,
    });
    return { rows: data.rows ?? [] };
  } catch (e) {
    logger.warn({ e, orgId }, "[ga4] getGA4Sources failed");
    return { rows: [] };
  }
}

/**
 * Top pages: raw rows.
 *
 * Dimension order: [0]=pagePath  [1]=pageTitle
 * Metric  order:   [0]=screenPageViews  [1]=totalUsers  [2]=averageSessionDuration  [3]=bounceRate
 */
export async function getGA4Pages(
  orgId: string, startDate: string, endDate: string
): Promise<{ rows: GA4Row[] }> {
  const ctx = await getGA4Context(orgId);
  if (!ctx) return { rows: [] };

  try {
    const data = await ga4Post<GA4ReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
      metrics: [
        { name: "screenPageViews" }, { name: "totalUsers" },
        { name: "averageSessionDuration" }, { name: "bounceRate" },
      ],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 30,
    });
    return { rows: data.rows ?? [] };
  } catch (e) {
    logger.warn({ e, orgId }, "[ga4] getGA4Pages failed");
    return { rows: [] };
  }
}

/**
 * Funnels: landing pages + conversion paths raw rows.
 *
 * landingPages.rows: [0]=landingPage, metrics: [0]=sessions, [1]=bounceRate, [2]=conversions
 * conversionPaths.rows: [0]=source/medium, [1]=campaign, metrics: [0]=conversions, [1]=totalRevenue
 */
export async function getGA4Funnels(
  orgId: string
): Promise<{ landingPages: { rows: GA4Row[] }; conversionPaths: { rows: GA4Row[] } }> {
  const EMPTY = { landingPages: { rows: [] }, conversionPaths: { rows: [] } };
  const ctx = await getGA4Context(orgId);
  if (!ctx) return EMPTY;

  try {
    const [lp, cp] = await Promise.all([
      ga4Post<GA4ReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
        dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
        dimensions: [{ name: "landingPage" }],
        metrics: [{ name: "sessions" }, { name: "bounceRate" }, { name: "conversions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 20,
      }),
      ga4Post<GA4ReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
        dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
        dimensions: [{ name: "sourceMedium" }, { name: "sessionCampaignName" }],
        metrics: [{ name: "conversions" }, { name: "totalRevenue" }],
        orderBys: [{ metric: { metricName: "conversions" }, desc: true }],
        limit: 20,
      }),
    ]);
    return {
      landingPages:    { rows: lp.rows ?? [] },
      conversionPaths: { rows: cp.rows ?? [] },
    };
  } catch (e) {
    logger.warn({ e, orgId }, "[ga4] getGA4Funnels failed");
    return EMPTY;
  }
}

/**
 * Conversions: raw rows.
 *
 * Dimension order: [0]=eventName
 * Metric  order:   [0]=eventCount  [1]=totalRevenue
 */
export async function getGA4Conversions(
  orgId: string, startDate: string, endDate: string
): Promise<{ rows: GA4Row[] }> {
  const ctx = await getGA4Context(orgId);
  if (!ctx) return { rows: [] };

  try {
    const data = await ga4Post<GA4ReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "eventName" }],
      metrics: [{ name: "eventCount" }, { name: "totalRevenue" }],
      dimensionFilter: {
        filter: { fieldName: "isConversionEvent", stringFilter: { value: "true" } },
      },
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 30,
    });
    return { rows: data.rows ?? [] };
  } catch (e) {
    logger.warn({ e, orgId }, "[ga4] getGA4Conversions failed");
    return { rows: [] };
  }
}

/**
 * Audience: devices + geo + new vs returning — each as { rows: [...] }.
 *
 * devices.rows:     [0]=deviceCategory, metrics: [0]=sessions
 * geo.rows:         [0]=country, [1]=region, metrics: [0]=sessions, [1]=totalUsers
 * newVsReturn.rows: [0]=newVsReturning, metrics: [0]=totalUsers
 */
export async function getGA4Audience(
  orgId: string, startDate: string, endDate: string
): Promise<{
  devices:     { rows: GA4Row[] };
  geo:         { rows: GA4Row[] };
  newVsReturn: { rows: GA4Row[] };
}> {
  const EMPTY = { devices: { rows: [] }, geo: { rows: [] }, newVsReturn: { rows: [] } };
  const ctx = await getGA4Context(orgId);
  if (!ctx) return EMPTY;

  try {
    const [devices, geo, nvr] = await Promise.all([
      ga4Post<GA4ReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "deviceCategory" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      }),
      ga4Post<GA4ReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "country" }, { name: "region" }],
        metrics: [{ name: "sessions" }, { name: "totalUsers" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 20,
      }),
      ga4Post<GA4ReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "newVsReturning" }],
        metrics: [{ name: "totalUsers" }],
      }),
    ]);
    return {
      devices:     { rows: devices.rows ?? [] },
      geo:         { rows: geo.rows ?? [] },
      newVsReturn: { rows: nvr.rows ?? [] },
    };
  } catch (e) {
    logger.warn({ e, orgId }, "[ga4] getGA4Audience failed");
    return EMPTY;
  }
}

/**
 * Campaigns: raw rows + totals.
 *
 * Dimension order: [0]=sessionCampaignName  [1]=sessionDefaultChannelGrouping
 *                  [2]=sessionSource/sessionMedium combined as sourceMedium
 * Metric  order:   [0]=sessions  [1]=totalUsers  [2]=conversions
 *                  [3]=bounceRate  [4]=averageSessionDuration  [5]=sessionConversionRate
 */
export async function getGA4Campaigns(
  orgId: string, startDate: string, endDate: string
): Promise<{ rows: GA4Row[]; totals: Array<{ metricValues: MetricValue[] }> }> {
  const EMPTY = { rows: [], totals: [] };
  const ctx = await getGA4Context(orgId);
  if (!ctx) return EMPTY;

  try {
    const data = await ga4Post<GA4ReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
      dateRanges: [{ startDate, endDate }],
      dimensions: [
        { name: "sessionCampaignName" },
        { name: "sessionDefaultChannelGrouping" },
        { name: "sourceMedium" },
      ],
      metrics: [
        { name: "sessions" }, { name: "totalUsers" }, { name: "conversions" },
        { name: "bounceRate" }, { name: "averageSessionDuration" }, { name: "sessionConversionRate" },
      ],
      dimensionFilter: {
        notExpression: {
          filter: { fieldName: "sessionCampaignName", stringFilter: { matchType: "EXACT", value: "(not set)" } },
        },
      },
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 30,
    });

    const totals = data.totals ?? [];
    return { rows: data.rows ?? [], totals };
  } catch (e) {
    logger.warn({ e, orgId }, "[ga4] getGA4Campaigns failed");
    return EMPTY;
  }
}
