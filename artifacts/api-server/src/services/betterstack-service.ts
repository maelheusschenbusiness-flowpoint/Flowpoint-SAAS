import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

const BS_BASE = "https://uptime.betterstack.com/api/v2";
const TOKEN = process.env.BETTERSTACK_API_TOKEN;

// ── In-memory cache ────────────────────────────────────────────────────────────
const cache = new Map<string, { data: unknown; expiresAt: number }>();
function getCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) { cache.delete(key); return null; }
  return entry.data as T;
}
function setCache(key: string, data: unknown, ttlMs = 60_000): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// ── HTTP client with retry + rate-limit handling ───────────────────────────────
async function bsRequest<T>(
  path: string,
  options: RequestInit = {},
  attempt = 1
): Promise<T> {
  if (!TOKEN) throw new Error("BETTERSTACK_API_TOKEN not configured");

  const url = `${BS_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...((options.headers as Record<string, string>) || {}),
    },
  });

  // Rate limit — wait and retry
  if (res.status === 429 && attempt <= 3) {
    const retryAfter = parseInt(res.headers.get("Retry-After") || "2", 10);
    await sleep(retryAfter * 1000);
    return bsRequest<T>(path, options, attempt + 1);
  }

  // Server errors — exponential backoff
  if (res.status >= 500 && attempt <= 3) {
    await sleep(Math.pow(2, attempt) * 500);
    return bsRequest<T>(path, options, attempt + 1);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`BetterStack API error ${res.status}: ${body}`);
  }

  if (res.status === 204 || res.headers.get("content-length") === "0") {
    return {} as T;
  }
  return res.json() as Promise<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Type definitions ───────────────────────────────────────────────────────────
export interface BSMonitor {
  id: string;
  type: string;
  attributes: {
    url: string;
    name: string;
    pronunciation_name?: string;
    monitor_type: string;
    status: string;
    required_keyword?: string;
    request_timeout: number;
    verify_ssl: boolean;
    check_frequency: number;
    regions: string[];
    paused: boolean;
    team_name?: string;
    recovery_period: number;
    follow_redirects: boolean;
    remember_cookies: boolean;
    ssl_expiration?: number;
    uptime_percentage?: string;
    avg_response_time?: number;
    created_at: string;
    updated_at: string;
  };
}

export interface BSIncident {
  id: string;
  type: string;
  attributes: {
    name: string;
    url: string;
    http_method?: string;
    cause: string;
    started_at?: string;
    resolved_at?: string;
    acknowledged_at?: string;
    acknowledged_by?: string;
    status: string;
    response_content?: string;
  };
}

export interface BSHeartbeat {
  id: string;
  type: string;
  attributes: {
    name: string;
    period: number;
    grace: number;
    status: string;
    last_ping_at?: string;
    url?: string;
    email?: string;
    paused: boolean;
    created_at: string;
    updated_at: string;
  };
}

export interface BSStatusPage {
  id: string;
  type: string;
  attributes: {
    name: string;
    subdomain: string;
    custom_domain?: string;
    created_at: string;
    updated_at: string;
  };
}

interface BSListResponse<T> {
  data: T[];
  pagination?: { first?: string; last?: string; prev?: string; next?: string };
}

interface BSSingleResponse<T> {
  data: T;
}

// ── Monitors ──────────────────────────────────────────────────────────────────
export async function listMonitors(orgId: string): Promise<BSMonitor[]> {
  const cacheKey = `monitors:${orgId}`;
  const cached = getCache<BSMonitor[]>(cacheKey);
  if (cached) return cached;

  const res = await bsRequest<BSListResponse<BSMonitor>>("/monitors?per_page=250");
  const monitors = res.data || [];
  setCache(cacheKey, monitors, 30_000);

  // Persist to DB
  await syncMonitorsToDB(monitors, orgId);
  return monitors;
}

export async function getMonitor(bsId: string): Promise<BSMonitor> {
  const res = await bsRequest<BSSingleResponse<BSMonitor>>(`/monitors/${bsId}`);
  return res.data;
}

export async function createMonitor(orgId: string, payload: {
  url: string;
  name: string;
  monitor_type?: string;
  check_frequency?: number;
  regions?: string[];
  required_keyword?: string;
  verify_ssl?: boolean;
  follow_redirects?: boolean;
}): Promise<BSMonitor> {
  const res = await bsRequest<BSSingleResponse<BSMonitor>>("/monitors", {
    method: "POST",
    body: JSON.stringify({ data: { type: "monitor", attributes: payload } }),
  });
  cache.delete(`monitors:${orgId}`);
  return res.data;
}

export async function updateMonitor(bsId: string, orgId: string, attrs: Partial<BSMonitor["attributes"]>): Promise<BSMonitor> {
  const res = await bsRequest<BSSingleResponse<BSMonitor>>(`/monitors/${bsId}`, {
    method: "PATCH",
    body: JSON.stringify({ data: { type: "monitor", attributes: attrs } }),
  });
  cache.delete(`monitors:${orgId}`);
  return res.data;
}

export async function deleteMonitor(bsId: string, orgId: string): Promise<void> {
  await bsRequest<unknown>(`/monitors/${bsId}`, { method: "DELETE" });
  cache.delete(`monitors:${orgId}`);
}

export async function pauseMonitor(bsId: string, orgId: string): Promise<void> {
  await bsRequest<unknown>(`/monitors/${bsId}/pause`, { method: "POST" });
  cache.delete(`monitors:${orgId}`);
}

export async function resumeMonitor(bsId: string, orgId: string): Promise<void> {
  await bsRequest<unknown>(`/monitors/${bsId}/resume`, { method: "POST" });
  cache.delete(`monitors:${orgId}`);
}

// ── Monitor SLA ───────────────────────────────────────────────────────────────
export async function getMonitorSLA(bsId: string, fromDate?: string, toDate?: string): Promise<unknown> {
  const cacheKey = `sla:${bsId}:${fromDate}:${toDate}`;
  const cached = getCache<unknown>(cacheKey);
  if (cached) return cached;

  let path = `/monitors/${bsId}/sla`;
  if (fromDate || toDate) path += `?from=${fromDate || ''}&to=${toDate || ''}`;
  const data = await bsRequest<unknown>(path);
  setCache(cacheKey, data, 300_000); // 5 min cache
  return data;
}

// ── Monitor Response Times ────────────────────────────────────────────────────
export async function getResponseTimes(bsId: string, period: string = "24h"): Promise<unknown> {
  const cacheKey = `rt:${bsId}:${period}`;
  const cached = getCache<unknown>(cacheKey);
  if (cached) return cached;

  const data = await bsRequest<unknown>(`/monitors/${bsId}/response-times?period=${period}`);
  setCache(cacheKey, data, 120_000); // 2 min cache
  return data;
}

// ── Incidents ─────────────────────────────────────────────────────────────────
export async function listIncidents(orgId: string, params?: {
  monitor_id?: string;
  from?: string;
  to?: string;
  resolved?: boolean;
}): Promise<BSIncident[]> {
  const query = new URLSearchParams({ per_page: "50" });
  if (params?.monitor_id) query.set("monitor_id", params.monitor_id);
  if (params?.from) query.set("from", params.from);
  if (params?.to) query.set("to", params.to);
  if (params?.resolved !== undefined) query.set("resolved", String(params.resolved));

  const cacheKey = `incidents:${orgId}:${query.toString()}`;
  const cached = getCache<BSIncident[]>(cacheKey);
  if (cached) return cached;

  const res = await bsRequest<BSListResponse<BSIncident>>(`/incidents?${query}`);
  const incidents = res.data || [];
  setCache(cacheKey, incidents, 60_000);

  await syncIncidentsToDB(incidents, orgId);
  return incidents;
}

export async function getIncident(bsId: string): Promise<BSIncident> {
  const res = await bsRequest<BSSingleResponse<BSIncident>>(`/incidents/${bsId}`);
  return res.data;
}

export async function acknowledgeIncident(bsId: string): Promise<void> {
  await bsRequest<unknown>(`/incidents/${bsId}/acknowledge`, { method: "POST" });
}

// ── Heartbeats ────────────────────────────────────────────────────────────────
export async function listHeartbeats(orgId: string): Promise<BSHeartbeat[]> {
  const cacheKey = `heartbeats:${orgId}`;
  const cached = getCache<BSHeartbeat[]>(cacheKey);
  if (cached) return cached;

  const res = await bsRequest<BSListResponse<BSHeartbeat>>("/heartbeats?per_page=250");
  const hbs = res.data || [];
  setCache(cacheKey, hbs, 60_000);

  await syncHeartbeatsToDB(hbs, orgId);
  return hbs;
}

export async function createHeartbeat(orgId: string, payload: {
  name: string;
  period: number;
  grace?: number;
  email?: string;
}): Promise<BSHeartbeat> {
  const res = await bsRequest<BSSingleResponse<BSHeartbeat>>("/heartbeats", {
    method: "POST",
    body: JSON.stringify({ data: { type: "heartbeat", attributes: payload } }),
  });
  cache.delete(`heartbeats:${orgId}`);
  return res.data;
}

// ── Status Pages ──────────────────────────────────────────────────────────────
export async function listStatusPages(orgId: string): Promise<BSStatusPage[]> {
  const cacheKey = `status_pages:${orgId}`;
  const cached = getCache<BSStatusPage[]>(cacheKey);
  if (cached) return cached;

  const res = await bsRequest<BSListResponse<BSStatusPage>>("/status-pages?per_page=250");
  const pages = res.data || [];
  setCache(cacheKey, pages, 300_000);

  await syncStatusPagesToDB(pages, orgId);
  return pages;
}

export async function createStatusPage(orgId: string, payload: {
  name: string;
  subdomain: string;
  custom_domain?: string;
}): Promise<BSStatusPage> {
  const res = await bsRequest<BSSingleResponse<BSStatusPage>>("/status-pages", {
    method: "POST",
    body: JSON.stringify({ data: { type: "status-page", attributes: payload } }),
  });
  cache.delete(`status_pages:${orgId}`);
  return res.data;
}

// ── Aggregate stats ───────────────────────────────────────────────────────────
export async function getMonitoringStats(orgId: string): Promise<{
  totalMonitors: number;
  up: number;
  down: number;
  paused: number;
  avgUptime: number;
  avgResponseTime: number;
  sslWarnings: number;
  activeIncidents: number;
  heartbeatsOk: number;
  heartbeatsMissed: number;
}> {
  const cacheKey = `stats:${orgId}`;
  const cached = getCache<ReturnType<typeof getMonitoringStats>>(cacheKey);
  if (cached) return cached as ReturnType<typeof getMonitoringStats>;

  const [monitors, incidents, heartbeats] = await Promise.allSettled([
    listMonitors(orgId),
    listIncidents(orgId, { resolved: false }),
    listHeartbeats(orgId),
  ]);

  const ms = monitors.status === "fulfilled" ? monitors.value : [];
  const inc = incidents.status === "fulfilled" ? incidents.value : [];
  const hbs = heartbeats.status === "fulfilled" ? heartbeats.value : [];

  const activeMs = ms.filter(m => !m.attributes.paused);
  const uptimes = ms.map(m => parseFloat(m.attributes.uptime_percentage || "100")).filter(u => !isNaN(u));
  const rts = ms.map(m => m.attributes.avg_response_time || 0).filter(rt => rt > 0);
  const sslWarnings = ms.filter(m => {
    const days = m.attributes.ssl_expiration;
    return typeof days === "number" && days < 30;
  }).length;

  const stats = {
    totalMonitors: ms.length,
    up: ms.filter(m => m.attributes.status === "up").length,
    down: ms.filter(m => m.attributes.status === "down" || m.attributes.status === "seems_down").length,
    paused: ms.filter(m => m.attributes.paused).length,
    avgUptime: uptimes.length ? Math.round(uptimes.reduce((a, b) => a + b, 0) / uptimes.length * 10) / 10 : 100,
    avgResponseTime: rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : 0,
    sslWarnings,
    activeIncidents: inc.length,
    heartbeatsOk: hbs.filter(h => h.attributes.status === "up").length,
    heartbeatsMissed: hbs.filter(h => h.attributes.status === "pending" || h.attributes.status === "down").length,
  };

  setCache(cacheKey, stats, 60_000);
  return stats;
}

// ── DB sync helpers ───────────────────────────────────────────────────────────
async function syncMonitorsToDB(monitors: BSMonitor[], orgId: string): Promise<void> {
  const client = await pool.connect();
  try {
    for (const m of monitors) {
      const a = m.attributes;
      const sslDays = typeof a.ssl_expiration === "number" ? a.ssl_expiration : null;
      await client.query(`
        INSERT INTO bs_monitors (
          id, org_id, bs_id, name, url, monitor_type, status, check_frequency,
          regions, paused, uptime_percentage, avg_response_time,
          ssl_days_remaining, verify_ssl, follow_redirects, remember_cookies,
          team_name, recovery_period, synced_at, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          uptime_percentage = EXCLUDED.uptime_percentage,
          avg_response_time = EXCLUDED.avg_response_time,
          ssl_days_remaining = EXCLUDED.ssl_days_remaining,
          paused = EXCLUDED.paused,
          synced_at = NOW(),
          updated_at = NOW()
      `, [
        `bs_${m.id}`, orgId, m.id, a.pronounceable_name || a.url || 'Monitor', a.url, a.monitor_type, a.status,
        a.check_frequency, JSON.stringify(a.regions || []), a.paused,
        parseFloat(a.uptime_percentage || "100"),
        a.avg_response_time || null, sslDays,
        a.verify_ssl, a.follow_redirects, a.remember_cookies,
        a.team_name || null, a.recovery_period,
      ]);
    }
  } catch (err) {
    logger.warn({ err }, "[BetterStack] syncMonitorsToDB failed");
  } finally {
    client.release();
  }
}

async function syncIncidentsToDB(incidents: BSIncident[], orgId: string): Promise<void> {
  const client = await pool.connect();
  try {
    for (const inc of incidents) {
      const a = inc.attributes;
      const startedAt = a.started_at ? new Date(a.started_at) : null;
      const resolvedAt = a.resolved_at ? new Date(a.resolved_at) : null;
      const durationSec = startedAt && resolvedAt
        ? Math.round((resolvedAt.getTime() - startedAt.getTime()) / 1000)
        : null;

      await client.query(`
        INSERT INTO bs_incidents (
          id, org_id, bs_id, name, url, cause, status,
          started_at, resolved_at, duration_seconds,
          acknowledged_at, acknowledged_by, synced_at, created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          resolved_at = EXCLUDED.resolved_at,
          duration_seconds = EXCLUDED.duration_seconds,
          acknowledged_at = EXCLUDED.acknowledged_at,
          synced_at = NOW()
      `, [
        `bsinc_${inc.id}`, orgId, inc.id, a.name, a.url, a.cause, a.status,
        startedAt, resolvedAt, durationSec,
        a.acknowledged_at ? new Date(a.acknowledged_at) : null,
        a.acknowledged_by || null,
      ]);
    }
  } catch (err) {
    logger.warn({ err }, "[BetterStack] syncIncidentsToDB failed");
  } finally {
    client.release();
  }
}

async function syncHeartbeatsToDB(hbs: BSHeartbeat[], orgId: string): Promise<void> {
  const client = await pool.connect();
  try {
    for (const hb of hbs) {
      const a = hb.attributes;
      await client.query(`
        INSERT INTO bs_heartbeats (
          id, org_id, bs_id, name, period, grace, status,
          last_ping_at, url, email, paused, synced_at, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          last_ping_at = EXCLUDED.last_ping_at,
          synced_at = NOW(),
          updated_at = NOW()
      `, [
        `bshb_${hb.id}`, orgId, hb.id, a.name, a.period, a.grace, a.status,
        a.last_ping_at ? new Date(a.last_ping_at) : null,
        a.url || null, a.email || null, a.paused,
      ]);
    }
  } catch (err) {
    logger.warn({ err }, "[BetterStack] syncHeartbeatsToDB failed");
  } finally {
    client.release();
  }
}

async function syncStatusPagesToDB(pages: BSStatusPage[], orgId: string): Promise<void> {
  const client = await pool.connect();
  try {
    for (const p of pages) {
      const a = p.attributes;
      await client.query(`
        INSERT INTO bs_status_pages (
          id, org_id, bs_id, name, subdomain, custom_domain, synced_at, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW(),NOW())
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          subdomain = EXCLUDED.subdomain,
          custom_domain = EXCLUDED.custom_domain,
          synced_at = NOW(),
          updated_at = NOW()
      `, [
        `bssp_${p.id}`, orgId, p.id, a.name, a.subdomain, a.custom_domain || null,
      ]);
    }
  } catch (err) {
    logger.warn({ err }, "[BetterStack] syncStatusPagesToDB failed");
  } finally {
    client.release();
  }
}

export function isBSConfigured(): boolean {
  return !!TOKEN;
}
