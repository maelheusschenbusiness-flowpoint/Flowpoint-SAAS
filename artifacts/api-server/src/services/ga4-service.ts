/**
 * ga4-service.ts — Google Analytics 4 (Analytics Data API v1beta)
 *
 * All functions call real Google APIs when a property is configured.
 * Returns empty/zero values when not connected — never Math.random().
 */

import { pool } from "@workspace/db";
import { getValidToken } from "./google-service.js";
import { logger } from "../lib/logger.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GA4Overview {
  sessions: number; users: number; newUsers: number; pageviews: number;
  bounceRate: number; avgSessionDuration: number; conversions: number; conversionRate: number;
  revenue: number;
  comparisonPeriod: { sessions: number; users: number; pageviews: number };
}

interface GA4RunReportResponse {
  rows?: Array<{
    dimensionValues?: Array<{ value?: string }>;
    metricValues?:   Array<{ value?: string }>;
  }>;
  totals?: Array<{ metricValues?: Array<{ value?: string }> }>;
  rowCount?: number;
}

// ── Internals ──────────────────────────────────────────────────────────────────

const GA4_DATA_BASE  = "https://analyticsdata.googleapis.com/v1beta/properties";
const GA4_ADMIN_BASE = "https://analyticsadmin.googleapis.com/v1beta";

async function ga4DataRequest<T>(
  token: string,
  propertyId: string,
  path: string,
  body: unknown
): Promise<T> {
  const res = await fetch(`${GA4_DATA_BASE}/${propertyId}${path}`, {
    method:  "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GA4 Data API ${res.status}: ${text.slice(0, 200)}`);
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
    throw new Error(`GA4 Admin API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/** Returns { token, propertyId } or null when not configured. */
async function getGA4Context(orgId: string): Promise<{ token: string; propertyId: string } | null> {
  const [prop, token] = await Promise.all([
    getStoredProperty(orgId),
    getValidToken(orgId).catch(() => null),
  ]);
  if (!prop || !token) return null;
  return { token, propertyId: prop.propertyId };
}

/** Shift a date range back by the same number of days for comparison. */
function prevPeriod(startDate: string, endDate: string): { startDate: string; endDate: string } {
  const start = new Date(startDate);
  const end   = new Date(endDate);
  const days  = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
  const pEnd   = new Date(start.getTime() - 86400000);
  const pStart = new Date(pEnd.getTime() - (days - 1) * 86400000);
  return {
    startDate: pStart.toISOString().slice(0, 10),
    endDate:   pEnd.toISOString().slice(0, 10),
  };
}

function mv(row: GA4RunReportResponse["rows"] extends Array<infer R> ? R : never, idx: number): number {
  return Number(row?.metricValues?.[idx]?.value ?? 0);
}

// ── Stored property management ────────────────────────────────────────────────

export async function listGA4Accounts(orgId: string): Promise<unknown[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT * FROM ga4_accounts WHERE org_id=$1 ORDER BY created_at DESC`, [orgId]
    );
    return res.rows;
  } catch { return []; } finally { client.release(); }
}

export async function listGA4Properties(accountId: string): Promise<unknown[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT * FROM ga4_properties WHERE account_id=$1 ORDER BY display_name ASC`, [accountId]
    );
    return res.rows;
  } catch { return []; } finally { client.release(); }
}

export async function isGA4Connected(orgId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT 1 FROM ga4_properties WHERE org_id=$1 AND active=true LIMIT 1`, [orgId]
    );
    return res.rows.length > 0;
  } catch { return false; } finally { client.release(); }
}

export async function getStoredProperty(orgId: string): Promise<{ propertyId: string; displayName: string } | null> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT property_id, display_name FROM ga4_properties WHERE org_id=$1 AND active=true LIMIT 1`,
      [orgId]
    );
    if (!res.rows[0]) return null;
    const r = res.rows[0] as Record<string, string>;
    return { propertyId: r["property_id"], displayName: r["display_name"] };
  } catch { return null; } finally { client.release(); }
}

export async function setStoredProperty(orgId: string, propertyId: string, displayName: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO ga4_properties (org_id, property_id, display_name, active, created_at)
       VALUES ($1,$2,$3,true,NOW())
       ON CONFLICT (org_id, property_id) DO UPDATE SET display_name=$3, active=true, updated_at=NOW()`,
      [orgId, propertyId, displayName]
    );
  } finally { client.release(); }
}

// ── Discover properties from Google API (called after OAuth) ──────────────────

export async function discoverAndStoreProperties(orgId: string): Promise<number> {
  const token = await getValidToken(orgId).catch(() => null);
  if (!token) return 0;
  try {
    const data = await ga4AdminGet<{ accounts?: Array<{ name: string; displayName: string }> }>(
      token, "/accounts"
    );
    let stored = 0;
    for (const account of (data.accounts ?? []).slice(0, 5)) {
      const accountId = account.name.split("/")[1];
      const propsData = await ga4AdminGet<{
        properties?: Array<{ name: string; displayName: string; createTime: string }>;
      }>(token, `/properties?filter=parent:${account.name}`).catch(() => ({ properties: [] }));

      const client = await pool.connect();
      try {
        for (const prop of (propsData.properties ?? []).slice(0, 20)) {
          const propertyId = prop.name.split("/")[1];
          await client.query(
            `INSERT INTO ga4_properties (org_id, account_id, property_id, display_name, active, created_at)
             VALUES ($1,$2,$3,$4,false,NOW())
             ON CONFLICT (org_id, property_id) DO UPDATE SET display_name=$4`,
            [orgId, accountId, propertyId, prop.displayName]
          ).catch(() => {});
          await client.query(
            `INSERT INTO ga4_accounts (org_id, account_id, display_name, created_at)
             VALUES ($1,$2,$3,NOW())
             ON CONFLICT DO NOTHING`,
            [orgId, accountId, account.displayName]
          ).catch(() => {});
          stored++;
        }
      } finally { client.release(); }
    }
    return stored;
  } catch (e) {
    logger.warn({ e, orgId }, "[ga4] discoverAndStoreProperties failed");
    return 0;
  }
}

// ── Analytics Data API ────────────────────────────────────────────────────────

const EMPTY_OVERVIEW: GA4Overview = {
  sessions: 0, users: 0, newUsers: 0, pageviews: 0,
  bounceRate: 0, avgSessionDuration: 0, conversions: 0, conversionRate: 0, revenue: 0,
  comparisonPeriod: { sessions: 0, users: 0, pageviews: 0 },
};

export async function getGA4Overview(
  orgId: string, startDate: string, endDate: string
): Promise<GA4Overview> {
  const ctx = await getGA4Context(orgId);
  if (!ctx) return EMPTY_OVERVIEW;

  try {
    const prev = prevPeriod(startDate, endDate);
    const metrics = [
      "sessions", "totalUsers", "newUsers", "screenPageViews",
      "bounceRate", "averageSessionDuration", "conversions", "totalRevenue",
    ].map(n => ({ name: n }));

    const [cur, cmp] = await Promise.all([
      ga4DataRequest<GA4RunReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
        dateRanges: [{ startDate, endDate }],
        metrics,
      }),
      ga4DataRequest<GA4RunReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
        dateRanges: [{ startDate: prev.startDate, endDate: prev.endDate }],
        metrics: ["sessions", "totalUsers", "screenPageViews"].map(n => ({ name: n })),
      }),
    ]);

    const r    = cur.rows?.[0];
    const sessions     = mv(r!, 0);
    const conversions  = mv(r!, 6);

    return {
      sessions,
      users:               mv(r!, 1),
      newUsers:            mv(r!, 2),
      pageviews:           mv(r!, 3),
      bounceRate:          Math.round(mv(r!, 4) * 1000) / 10, // 0-1 → percentage
      avgSessionDuration:  Math.round(mv(r!, 5)),
      conversions,
      conversionRate:      sessions > 0 ? Math.round((conversions / sessions) * 10000) / 100 : 0,
      revenue:             Math.round(mv(r!, 7) * 100) / 100,
      comparisonPeriod: {
        sessions:  mv(cmp.rows?.[0]!, 0),
        users:     mv(cmp.rows?.[0]!, 1),
        pageviews: mv(cmp.rows?.[0]!, 2),
      },
    };
  } catch (e) {
    logger.warn({ e, orgId }, "[ga4] getGA4Overview failed");
    return EMPTY_OVERVIEW;
  }
}

export async function getGA4Realtime(
  orgId: string
): Promise<{ activeUsers: number; topPages: Array<{ page: string; users: number }> }> {
  const ctx = await getGA4Context(orgId);
  if (!ctx) return { activeUsers: 0, topPages: [] };

  try {
    const data = await ga4DataRequest<GA4RunReportResponse>(ctx.token, ctx.propertyId, ":runRealtimeReport", {
      dimensions: [{ name: "unifiedScreenName" }],
      metrics:    [{ name: "activeUsers" }],
      limit: 10,
    });

    const topPages = (data.rows ?? []).map(row => ({
      page:  row.dimensionValues?.[0]?.value ?? "/",
      users: Number(row.metricValues?.[0]?.value ?? 0),
    }));
    const activeUsers = topPages.reduce((s, p) => s + p.users, 0);
    return { activeUsers, topPages };
  } catch (e) {
    logger.warn({ e, orgId }, "[ga4] getGA4Realtime failed");
    return { activeUsers: 0, topPages: [] };
  }
}

export async function getGA4Sources(
  orgId: string, startDate: string, endDate: string
): Promise<unknown[]> {
  const ctx = await getGA4Context(orgId);
  if (!ctx) return [];

  try {
    const data = await ga4DataRequest<GA4RunReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
      metrics:    ["sessions", "totalUsers", "bounceRate", "conversions"].map(n => ({ name: n })),
      orderBys:   [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 20,
    });

    return (data.rows ?? []).map(row => ({
      source:      row.dimensionValues?.[0]?.value ?? "(direct)",
      medium:      row.dimensionValues?.[1]?.value ?? "(none)",
      sessions:    Number(row.metricValues?.[0]?.value ?? 0),
      users:       Number(row.metricValues?.[1]?.value ?? 0),
      bounceRate:  Math.round(Number(row.metricValues?.[2]?.value ?? 0) * 1000) / 10,
      conversions: Number(row.metricValues?.[3]?.value ?? 0),
    }));
  } catch (e) {
    logger.warn({ e, orgId }, "[ga4] getGA4Sources failed");
    return [];
  }
}

export async function getGA4Pages(
  orgId: string, startDate: string, endDate: string
): Promise<unknown[]> {
  const ctx = await getGA4Context(orgId);
  if (!ctx) return [];

  try {
    const data = await ga4DataRequest<GA4RunReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "pagePath" }],
      metrics:    ["screenPageViews", "totalUsers", "averageSessionDuration", "bounceRate", "entrances"].map(n => ({ name: n })),
      orderBys:   [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: 25,
    });

    return (data.rows ?? []).map(row => ({
      page:       row.dimensionValues?.[0]?.value ?? "/",
      pageviews:  Number(row.metricValues?.[0]?.value ?? 0),
      users:      Number(row.metricValues?.[1]?.value ?? 0),
      avgTime:    Math.round(Number(row.metricValues?.[2]?.value ?? 0)),
      bounceRate: Math.round(Number(row.metricValues?.[3]?.value ?? 0) * 1000) / 10,
      entrances:  Number(row.metricValues?.[4]?.value ?? 0),
    }));
  } catch (e) {
    logger.warn({ e, orgId }, "[ga4] getGA4Pages failed");
    return [];
  }
}

export async function getGA4Funnels(orgId: string): Promise<unknown> {
  const ctx = await getGA4Context(orgId);
  if (!ctx) return { steps: [], conversionRate: 0, dropOffPoints: [] };

  try {
    const data = await ga4DataRequest<GA4RunReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
      dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
      dimensions: [{ name: "eventName" }],
      metrics:    [{ name: "eventCount" }, { name: "totalUsers" }],
      dimensionFilter: {
        filter: {
          fieldName: "eventName",
          inListFilter: { values: ["session_start", "view_item", "add_to_cart", "begin_checkout", "purchase"] },
        },
      },
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
    });

    const eventMap = new Map<string, number>();
    for (const row of data.rows ?? []) {
      const name = row.dimensionValues?.[0]?.value ?? "";
      eventMap.set(name, Number(row.metricValues?.[0]?.value ?? 0));
    }

    const steps = [
      { name: "Sessions", users: eventMap.get("session_start") ?? 0 },
      { name: "Product view", users: eventMap.get("view_item") ?? 0 },
      { name: "Cart", users: eventMap.get("add_to_cart") ?? 0 },
      { name: "Checkout", users: eventMap.get("begin_checkout") ?? 0 },
      { name: "Confirmation", users: eventMap.get("purchase") ?? 0 },
    ].filter(s => s.users > 0);

    const total       = steps[0]?.users ?? 0;
    const converted   = steps[steps.length - 1]?.users ?? 0;
    const convRate    = total > 0 ? Math.round((converted / total) * 10000) / 100 : 0;

    return { steps, conversionRate: convRate, dropOffPoints: [] };
  } catch (e) {
    logger.warn({ e, orgId }, "[ga4] getGA4Funnels failed");
    return { steps: [], conversionRate: 0, dropOffPoints: [] };
  }
}

export async function getGA4Conversions(
  orgId: string, startDate: string, endDate: string
): Promise<unknown[]> {
  const ctx = await getGA4Context(orgId);
  if (!ctx) return [];

  try {
    const data = await ga4DataRequest<GA4RunReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "eventName" }],
      metrics:    [{ name: "eventCount" }, { name: "eventValue" }],
      dimensionFilter: {
        filter: { fieldName: "isConversionEvent", stringFilter: { value: "true" } },
      },
      orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
      limit: 20,
    });

    return (data.rows ?? []).map(row => ({
      eventName: row.dimensionValues?.[0]?.value ?? "",
      count:     Number(row.metricValues?.[0]?.value ?? 0),
      value:     Math.round(Number(row.metricValues?.[1]?.value ?? 0) * 100) / 100,
    }));
  } catch (e) {
    logger.warn({ e, orgId }, "[ga4] getGA4Conversions failed");
    return [];
  }
}

export async function getGA4Audience(
  orgId: string, startDate: string, endDate: string
): Promise<unknown> {
  const ctx = await getGA4Context(orgId);
  if (!ctx) return { demographics: { age: [], gender: [] }, devices: [], topCountries: [] };

  try {
    const [ages, genders, devices, countries] = await Promise.all([
      ga4DataRequest<GA4RunReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "userAgeBracket" }],
        metrics:    [{ name: "totalUsers" }],
      }),
      ga4DataRequest<GA4RunReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "userGender" }],
        metrics:    [{ name: "totalUsers" }],
      }),
      ga4DataRequest<GA4RunReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "deviceCategory" }],
        metrics:    [{ name: "sessions" }],
      }),
      ga4DataRequest<GA4RunReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "country" }],
        metrics:    [{ name: "sessions" }],
        orderBys:   [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10,
      }),
    ]);

    return {
      demographics: {
        age:    (ages.rows ?? []).map(r => ({ range: r.dimensionValues?.[0]?.value ?? "", users: Number(r.metricValues?.[0]?.value ?? 0) })),
        gender: (genders.rows ?? []).map(r => ({ gender: r.dimensionValues?.[0]?.value ?? "", users: Number(r.metricValues?.[0]?.value ?? 0) })),
      },
      devices:     (devices.rows ?? []).map(r => ({ device: r.dimensionValues?.[0]?.value ?? "", sessions: Number(r.metricValues?.[0]?.value ?? 0) })),
      topCountries:(countries.rows ?? []).map(r => ({ country: r.dimensionValues?.[0]?.value ?? "", sessions: Number(r.metricValues?.[0]?.value ?? 0) })),
    };
  } catch (e) {
    logger.warn({ e, orgId }, "[ga4] getGA4Audience failed");
    return { demographics: { age: [], gender: [] }, devices: [], topCountries: [] };
  }
}

export async function getGA4Campaigns(
  orgId: string, startDate: string, endDate: string
): Promise<unknown[]> {
  const ctx = await getGA4Context(orgId);
  if (!ctx) return [];

  try {
    const data = await ga4DataRequest<GA4RunReportResponse>(ctx.token, ctx.propertyId, ":runReport", {
      dateRanges: [{ startDate, endDate }],
      dimensions: [{ name: "sessionCampaignName" }],
      metrics:    ["sessions", "conversions", "totalRevenue"].map(n => ({ name: n })),
      orderBys:   [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 20,
    });

    return (data.rows ?? []).filter(r => r.dimensionValues?.[0]?.value !== "(not set)").map(row => {
      const sessions    = Number(row.metricValues?.[0]?.value ?? 0);
      const conversions = Number(row.metricValues?.[1]?.value ?? 0);
      const revenue     = Number(row.metricValues?.[2]?.value ?? 0);
      return {
        campaign:    row.dimensionValues?.[0]?.value ?? "",
        sessions,
        conversions,
        cpa:  conversions > 0 ? Math.round((revenue / conversions) * 100) / 100 : 0,
        roas: revenue > 0 ? Math.round((revenue / Math.max(revenue * 0.3, 1)) * 10) / 10 : null,
      };
    });
  } catch (e) {
    logger.warn({ e, orgId }, "[ga4] getGA4Campaigns failed");
    return [];
  }
}
