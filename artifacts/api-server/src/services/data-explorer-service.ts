import { pool } from "@workspace/db";
import { getGA4Sources, getGA4Pages, getGA4Overview, getGA4Conversions } from "./ga4-service.js";
import { getTopKeywords, getTopPages as getGSCTopPages } from "./gsc-service.js";

export type DESource =
  | "ga4_traffic"
  | "ga4_pages"
  | "ga4_overview"
  | "ga4_conversions"
  | "gsc_keywords"
  | "gsc_pages"
  | "audits"
  | "monitors"
  | "missions";

export interface DEQueryOpts {
  days?: number;
  limit?: number;
  offset?: number;
  sort?: string;
  sortDir?: "asc" | "desc";
  filter?: string;
}

export interface DEResult {
  source: DESource;
  columns: { key: string; label: string; type: "string" | "number" | "date" }[];
  rows: Record<string, unknown>[];
  total: number;
  days: number;
}

function safe(v: unknown): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function pct(a: unknown, b: unknown): number {
  const total = safe(b);
  return total > 0 ? Math.round((safe(a) / total) * 100 * 10) / 10 : 0;
}

// ── GA4 Traffic ─────────────────────────────────────────────────────────────
async function queryGA4Traffic(orgId: string, opts: DEQueryOpts): Promise<DEResult> {
  const days = opts.days ?? 30;
  let rows: Record<string, unknown>[] = [];
  try {
    const raw = await getGA4Sources(orgId, days);
    if (Array.isArray(raw)) {
      const totalSessions = (raw as Record<string, unknown>[]).reduce((s, x) => s + safe(x.sessions), 0);
      rows = raw.map((r: Record<string, unknown>) => ({
        channel: String(r.channel ?? r.source ?? "—"),
        sessions: safe(r.sessions),
        users: safe(r.users ?? 0),
        bounce_rate: safe(r.bounceRate ?? r.bounce_rate ?? 0),
        conversion_rate: safe(r.conversionRate ?? r.conversion_rate ?? 0),
        share_pct: pct(r.sessions, totalSessions),
      }));
    }
  } catch { rows = []; }
  return applyOpts(rows, "ga4_traffic", days, opts, [
    { key: "channel", label: "Canal", type: "string" },
    { key: "sessions", label: "Sessions", type: "number" },
    { key: "users", label: "Utilisateurs", type: "number" },
    { key: "bounce_rate", label: "Taux rebond (%)", type: "number" },
    { key: "conversion_rate", label: "Taux conv. (%)", type: "number" },
    { key: "share_pct", label: "Part (%)", type: "number" },
  ]);
}

// ── GA4 Pages ────────────────────────────────────────────────────────────────
async function queryGA4Pages(orgId: string, opts: DEQueryOpts): Promise<DEResult> {
  const days = opts.days ?? 30;
  let rows: Record<string, unknown>[] = [];
  try {
    const raw = await getGA4Pages(orgId, days);
    if (Array.isArray(raw)) {
      rows = raw.map((r: Record<string, unknown>) => ({
        page: String(r.page ?? r.pagePath ?? "—"),
        sessions: safe(r.sessions),
        pageviews: safe(r.pageviews ?? r.screenPageViews ?? 0),
        avg_session_duration: safe(r.avgSessionDuration ?? 0),
        bounce_rate: safe(r.bounceRate ?? r.bounce_rate ?? 0),
      }));
    }
  } catch { rows = []; }
  return applyOpts(rows, "ga4_pages", days, opts, [
    { key: "page", label: "Page", type: "string" },
    { key: "sessions", label: "Sessions", type: "number" },
    { key: "pageviews", label: "Pages vues", type: "number" },
    { key: "avg_session_duration", label: "Durée moy. (s)", type: "number" },
    { key: "bounce_rate", label: "Taux rebond (%)", type: "number" },
  ]);
}

// ── GA4 Overview ─────────────────────────────────────────────────────────────
async function queryGA4Overview(orgId: string, opts: DEQueryOpts): Promise<DEResult> {
  const days = opts.days ?? 30;
  let rows: Record<string, unknown>[] = [];
  try {
    const raw = await getGA4Overview(orgId, days);
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      rows = [{
        sessions: safe(obj.sessions),
        users: safe(obj.users ?? obj.activeUsers ?? 0),
        new_users: safe(obj.newUsers ?? 0),
        bounce_rate: safe(obj.bounceRate ?? 0),
        avg_session_duration: safe(obj.avgSessionDuration ?? 0),
        conversions: safe(obj.conversions ?? 0),
        revenue: safe(obj.revenue ?? obj.totalRevenue ?? 0),
        period_days: days,
      }];
    }
  } catch { rows = []; }
  return applyOpts(rows, "ga4_overview", days, opts, [
    { key: "period_days", label: "Période (j)", type: "number" },
    { key: "sessions", label: "Sessions", type: "number" },
    { key: "users", label: "Utilisateurs", type: "number" },
    { key: "new_users", label: "Nouveaux", type: "number" },
    { key: "bounce_rate", label: "Taux rebond (%)", type: "number" },
    { key: "avg_session_duration", label: "Durée moy. (s)", type: "number" },
    { key: "conversions", label: "Conversions", type: "number" },
    { key: "revenue", label: "Revenu (€)", type: "number" },
  ]);
}

// ── GA4 Conversions ──────────────────────────────────────────────────────────
async function queryGA4Conversions(orgId: string, opts: DEQueryOpts): Promise<DEResult> {
  const days = opts.days ?? 30;
  let rows: Record<string, unknown>[] = [];
  try {
    const raw = await getGA4Conversions(orgId, days);
    if (Array.isArray(raw)) {
      rows = raw.map((r: Record<string, unknown>) => ({
        event: String(r.eventName ?? r.event ?? "—"),
        count: safe(r.count ?? r.eventCount ?? 0),
        value: safe(r.value ?? r.totalValue ?? 0),
      }));
    }
  } catch { rows = []; }
  return applyOpts(rows, "ga4_conversions", days, opts, [
    { key: "event", label: "Événement", type: "string" },
    { key: "count", label: "Occurrences", type: "number" },
    { key: "value", label: "Valeur (€)", type: "number" },
  ]);
}

// ── GSC Keywords ─────────────────────────────────────────────────────────────
async function queryGSCKeywords(orgId: string, opts: DEQueryOpts): Promise<DEResult> {
  const days = opts.days ?? 28;
  let rows: Record<string, unknown>[] = [];
  try {
    const raw = await getTopKeywords(orgId, 200, days);
    if (Array.isArray(raw)) {
      rows = raw.map((r: Record<string, unknown>) => ({
        keyword: String(r.keyword ?? r.query ?? "—"),
        clicks: safe(r.clicks),
        impressions: safe(r.impressions),
        ctr: safe(r.ctr ?? 0),
        position: safe(r.position),
      }));
    }
  } catch { rows = []; }
  return applyOpts(rows, "gsc_keywords", days, opts, [
    { key: "keyword", label: "Mot-clé", type: "string" },
    { key: "clicks", label: "Clics", type: "number" },
    { key: "impressions", label: "Impressions", type: "number" },
    { key: "ctr", label: "CTR (%)", type: "number" },
    { key: "position", label: "Position moy.", type: "number" },
  ]);
}

// ── GSC Pages ────────────────────────────────────────────────────────────────
async function queryGSCPages(orgId: string, opts: DEQueryOpts): Promise<DEResult> {
  const days = opts.days ?? 28;
  let rows: Record<string, unknown>[] = [];
  try {
    const raw = await getGSCTopPages(orgId, 200, days);
    if (Array.isArray(raw)) {
      rows = raw.map((r: Record<string, unknown>) => ({
        page: String(r.page ?? (Array.isArray(r.keys) ? r.keys[0] : "—") ?? "—"),
        clicks: safe(r.clicks),
        impressions: safe(r.impressions),
        ctr: safe(r.ctr ?? 0),
        position: safe(r.position),
      }));
    }
  } catch { rows = []; }
  return applyOpts(rows, "gsc_pages", days, opts, [
    { key: "page", label: "Page", type: "string" },
    { key: "clicks", label: "Clics", type: "number" },
    { key: "impressions", label: "Impressions", type: "number" },
    { key: "ctr", label: "CTR (%)", type: "number" },
    { key: "position", label: "Position moy.", type: "number" },
  ]);
}

// ── Audits ───────────────────────────────────────────────────────────────────
async function queryAudits(orgId: string, opts: DEQueryOpts): Promise<DEResult> {
  const days = opts.days ?? 90;
  let rows: Record<string, unknown>[] = [];
  const client = await pool.connect();
  try {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const result = await client.query(
      `SELECT id, url, score, created_at, status FROM audits WHERE org_id=$1 AND created_at>=$2 ORDER BY created_at DESC LIMIT 500`,
      [orgId, since]
    );
    rows = (result.rows ?? []).map((r) => ({
      url: String(r.url ?? "—"),
      score: r.score != null ? Number(r.score) : null,
      status: String(r.status ?? "done"),
      date: r.created_at ? new Date(r.created_at as string).toLocaleDateString("fr-FR") : "—",
    }));
  } catch { rows = []; }
  finally { client.release(); }
  return applyOpts(rows, "audits", days, opts, [
    { key: "url", label: "URL", type: "string" },
    { key: "score", label: "Score SEO", type: "number" },
    { key: "status", label: "Statut", type: "string" },
    { key: "date", label: "Date", type: "date" },
  ]);
}

// ── Monitors ─────────────────────────────────────────────────────────────────
async function queryMonitors(orgId: string, opts: DEQueryOpts): Promise<DEResult> {
  let rows: Record<string, unknown>[] = [];
  const client = await pool.connect();
  try {
    const result = await client.query(
      `SELECT id, name, url, status, uptime, response_time, created_at FROM monitors WHERE org_id=$1 ORDER BY name LIMIT 500`,
      [orgId]
    );
    rows = (result.rows ?? []).map((r) => ({
      name: String(r.name ?? "—"),
      url: String(r.url ?? "—"),
      status: String(r.status ?? "—"),
      uptime_pct: r.uptime != null ? Number(r.uptime) : null,
      response_time_ms: r.response_time != null ? Number(r.response_time) : null,
    }));
  } catch { rows = []; }
  finally { client.release(); }
  return applyOpts(rows, "monitors", 0, opts, [
    { key: "name", label: "Monitor", type: "string" },
    { key: "url", label: "URL", type: "string" },
    { key: "status", label: "Statut", type: "string" },
    { key: "uptime_pct", label: "Uptime (%)", type: "number" },
    { key: "response_time_ms", label: "Temps réponse (ms)", type: "number" },
  ]);
}

// ── Missions ─────────────────────────────────────────────────────────────────
async function queryMissions(orgId: string, opts: DEQueryOpts): Promise<DEResult> {
  const days = opts.days ?? 90;
  let rows: Record<string, unknown>[] = [];
  const client = await pool.connect();
  try {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const result = await client.query(
      `SELECT id, title, status, priority, assigned_to, created_at, due_date FROM missions WHERE org_id=$1 AND created_at>=$2 ORDER BY created_at DESC LIMIT 500`,
      [orgId, since]
    );
    rows = (result.rows ?? []).map((r) => ({
      title: String(r.title ?? "—"),
      status: String(r.status ?? "—"),
      priority: String(r.priority ?? "normal"),
      assigned_to: r.assigned_to ? String(r.assigned_to) : "—",
      due_date: r.due_date ? new Date(r.due_date as string).toLocaleDateString("fr-FR") : "—",
      created_at: r.created_at ? new Date(r.created_at as string).toLocaleDateString("fr-FR") : "—",
    }));
  } catch { rows = []; }
  finally { client.release(); }
  return applyOpts(rows, "missions", days, opts, [
    { key: "title", label: "Mission", type: "string" },
    { key: "status", label: "Statut", type: "string" },
    { key: "priority", label: "Priorité", type: "string" },
    { key: "assigned_to", label: "Assigné à", type: "string" },
    { key: "due_date", label: "Échéance", type: "date" },
    { key: "created_at", label: "Créé le", type: "date" },
  ]);
}

// ── Shared: apply filter / sort / pagination ─────────────────────────────────
function applyOpts(
  rows: Record<string, unknown>[],
  source: DESource,
  days: number,
  opts: DEQueryOpts,
  columns: DEResult["columns"]
): DEResult {
  let out = [...rows];
  if (opts.filter && opts.filter.trim()) {
    const f = opts.filter.trim().toLowerCase();
    out = out.filter((r) =>
      Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(f))
    );
  }
  if (opts.sort) {
    const key = opts.sort;
    const dir = opts.sortDir === "asc" ? 1 : -1;
    out.sort((a, b) => {
      const av = a[key] ?? "";
      const bv = b[key] ?? "";
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }
  const total = out.length;
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;
  out = out.slice(offset, offset + limit);
  return { source, columns, rows: out, total, days };
}

// ── Public query dispatcher ───────────────────────────────────────────────────
export async function queryDataExplorer(orgId: string, source: DESource, opts: DEQueryOpts = {}): Promise<DEResult> {
  switch (source) {
    case "ga4_traffic":     return queryGA4Traffic(orgId, opts);
    case "ga4_pages":       return queryGA4Pages(orgId, opts);
    case "ga4_overview":    return queryGA4Overview(orgId, opts);
    case "ga4_conversions": return queryGA4Conversions(orgId, opts);
    case "gsc_keywords":    return queryGSCKeywords(orgId, opts);
    case "gsc_pages":       return queryGSCPages(orgId, opts);
    case "audits":          return queryAudits(orgId, opts);
    case "monitors":        return queryMonitors(orgId, opts);
    case "missions":        return queryMissions(orgId, opts);
    default:                throw new Error(`Unknown source: ${source as string}`);
  }
}

export const AVAILABLE_SOURCES: {
  source: DESource; label: string; category: string; requiresGA4?: boolean; requiresGSC?: boolean;
}[] = [
  { source: "ga4_traffic",     label: "Sources de trafic GA4",      category: "Google Analytics 4", requiresGA4: true  },
  { source: "ga4_pages",       label: "Pages top GA4",               category: "Google Analytics 4", requiresGA4: true  },
  { source: "ga4_overview",    label: "Vue d'ensemble GA4",          category: "Google Analytics 4", requiresGA4: true  },
  { source: "ga4_conversions", label: "Événements conversions GA4",  category: "Google Analytics 4", requiresGA4: true  },
  { source: "gsc_keywords",    label: "Mots-clés Search Console",    category: "Search Console",     requiresGSC: true  },
  { source: "gsc_pages",       label: "Pages Search Console",        category: "Search Console",     requiresGSC: true  },
  { source: "audits",          label: "Audits SEO",                  category: "FlowPoint interne"   },
  { source: "monitors",        label: "Monitors uptime",             category: "FlowPoint interne"   },
  { source: "missions",        label: "Missions",                    category: "FlowPoint interne"   },
];
