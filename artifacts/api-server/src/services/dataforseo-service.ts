/**
 * dataforseo-service.ts — DataForSEO API client
 *
 * All functions check await isDataForSEOConfigured() and fall back to empty
 * arrays / null values when credentials are absent — no more fake data.
 *
 * Quota system: tracks daily requests per org in dataforseo_quota table.
 */

import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

const DFS_BASE           = "https://api.dataforseo.com/v3";
const MAX_DAILY_REQUESTS = 1000;

/** Read per-org secrets from DB; returns null if not set. */
async function getOrgCredentials(orgId = "default"): Promise<{ login: string; password: string } | null> {
  try {
    const res = await pool.query(
      `SELECT value FROM org_secrets WHERE org_id = $1 AND key = 'dataforseo_password'`,
      [orgId]
    );
    const password = res.rows[0]?.value ?? "";
    const loginRes = await pool.query(
      `SELECT value FROM org_secrets WHERE org_id = $1 AND key = 'dataforseo_login'`,
      [orgId]
    );
    const login = loginRes.rows[0]?.value ?? "";
    if (login && password) return { login, password };
  } catch { /* non-fatal */ }
  return null;
}

/** Check if DataForSEO is configured for a given org (DB overrides env). */
export async function isDataForSEOConfigured(orgId = "default"): Promise<boolean> {
  const orgCreds = await getOrgCredentials(orgId);
  if (orgCreds) return true;
  return !!(process.env["DATAFORSEO_LOGIN"] && process.env["DATAFORSEO_PASSWORD"]);
}

/** Build Basic auth header — org DB credentials take priority over env. */
async function getAuth(orgId = "default"): Promise<string> {
  const orgCreds = await getOrgCredentials(orgId);
  const login = orgCreds?.login ?? (process.env["DATAFORSEO_LOGIN"] ?? "");
  const pass  = orgCreds?.password ?? (process.env["DATAFORSEO_PASSWORD"] ?? "");
  return `Basic ${Buffer.from(`${login}:${pass}`).toString("base64")}`;
}

export async function dfsRequest<T>(path: string, body: unknown, orgId = "default"): Promise<T> {
  const res = await fetch(`${DFS_BASE}${path}`, {
    method:  "POST",
    headers: { Authorization: await getAuth(orgId), "Content-Type": "application/json" },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DataForSEO ${res.status} — ${path}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

// ── Quota management (in-memory + async DB persistence) ───────────────────────

/** In-memory quota counters: key = "orgId:YYYY-MM-DD" */
const _quotaMemory = new Map<string, number>();

function _quotaKey(orgId: string): string {
  return `${orgId}:${new Date().toISOString().slice(0, 10)}`;
}

function _quotaResetAt(): string {
  const d = new Date();
  d.setHours(24, 0, 0, 0);
  return d.toISOString();
}

/** Async DB upsert — fire-and-forget from sync callers */
async function _persistQuota(orgId: string, today: string, used: number): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO dataforseo_quota (org_id, date, requests_used, created_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (org_id, date)
       DO UPDATE SET requests_used = GREATEST(dataforseo_quota.requests_used, $3)`,
      [orgId, today, used]
    );
  } catch { /* non-fatal */ } finally { client.release(); }
}

export async function checkAndIncrementQuota(orgId = "default", planOrUnits?: string | number, units = 1): Promise<boolean> {
  // Callers pass either (orgId, plan, units) or the shorthand (orgId, units).
  const effectiveUnits = typeof planOrUnits === "number" ? planOrUnits : units;
  const key = _quotaKey(orgId);
  const current = (_quotaMemory.get(key) ?? 0) + effectiveUnits;
  _quotaMemory.set(key, current);
  _persistQuota(orgId, new Date().toISOString().slice(0, 10), current).catch(() => {});
  return current <= MAX_DAILY_REQUESTS;
}

export function getQuotaUsage(
  orgId = "default", _plan?: string
): { used: number; limit: number; resetAt: string } {
  const key = _quotaKey(orgId);
  return {
    used:    _quotaMemory.get(key) ?? 0,
    limit:   MAX_DAILY_REQUESTS,
    resetAt: _quotaResetAt(),
  };
}

// ── Keywords ──────────────────────────────────────────────────────────────────

export async function getKeywordSuggestions(
  keyword: string, location = "France", lang = "fr", orgId = "default"
): Promise<Array<{ keyword: string; volume: number; difficulty: number; cpc: number }>> {
  if (!await isDataForSEOConfigured(orgId)) return [];
  try {
    type DFSKwResult = Array<{
      result?: Array<{ keyword: string; search_volume: number; keyword_difficulty: number; cpc: number }>;
    }>;
    const data = await dfsRequest<DFSKwResult>("/keywords_data/google/search_volume/live", [{
      keywords:      [keyword, `${keyword} local`, `${keyword} gratuit`, `meilleur ${keyword}`, `${keyword} pas cher`],
      location_name: location,
      language_code: lang,
    }], orgId);
    return (data[0]?.result ?? []).map(r => ({
      keyword:    r.keyword,
      volume:     r.search_volume,
      difficulty: r.keyword_difficulty,
      cpc:        r.cpc,
    }));
  } catch (e) {
    logger.warn({ e }, "[dfs] getKeywordSuggestions failed");
    return [];
  }
}

export async function getSERP(
  keyword: string, location = "France", lang = "fr", orgId = "default"
): Promise<unknown[]> {
  if (!await isDataForSEOConfigured(orgId)) return [];
  try {
    type DFSResult = Array<{ result?: Array<Record<string, unknown>> }>;
    const data = await dfsRequest<DFSResult>("/serp/google/organic/live/regular", [{
      keyword, location_name: location, language_code: lang, depth: 10,
    }], orgId);
    return (data[0]?.result?.[0] as unknown as unknown[]) ?? [];
  } catch { return []; }
}

export async function getCompetitors(
  domain: string, orgId = "default"
): Promise<Array<{ domain: string; organicTraffic: number; keywords: number; authority: number }>> {
  if (!await isDataForSEOConfigured(orgId)) return [];
  try {
    type DFSResult = Array<{
      result?: Array<{
        domain: string; organic_traffic: number; organic_count: number; authority: number;
      }>;
    }>;
    const data = await dfsRequest<DFSResult>(
      "/dataforseo_labs/google/competitors_domain/live",
      [{ target: domain, location_name: "France", language_name: "French" }],
      orgId
    );
    return (data[0]?.result ?? []).slice(0, 10).map(r => ({
      domain:         r.domain,
      organicTraffic: r.organic_traffic,
      keywords:       r.organic_count,
      authority:      r.authority,
    }));
  } catch { return []; }
}

export async function getBacklinks(
  domain: string, orgId = "default"
): Promise<{ referring_domains: number; backlinks: number; domain_rank: number; total: number; dofollow: number; items: Record<string, unknown>[] }> {
  const empty = { referring_domains: 0, backlinks: 0, domain_rank: 0, total: 0, dofollow: 0, items: [] };
  if (!await isDataForSEOConfigured(orgId)) return empty;
  try {
    type DFSResult = Array<{ result?: Array<Record<string, unknown>> }>;
    const data = await dfsRequest<DFSResult>("/backlinks/summary/live", [{ target: domain }], orgId);
    const r = data[0]?.result?.[0] ?? {};
    const total    = Number(r["backlinks"]          ?? 0);
    const dofollow = Number(r["dofollow_links"]      ?? 0);
    return {
      referring_domains: Number(r["referring_domains"] ?? 0),
      backlinks:         total,
      domain_rank:       Number(r["rank"]              ?? 0),
      total,
      dofollow,
      items:             (r["items"] as Record<string, unknown>[] | undefined) ?? [],
    };
  } catch { return empty; }
}

export async function getDomainMetrics(
  domain: string, orgId = "default"
): Promise<{ traffic: number; keywords: number; rank: number; backlinks: number }> {
  if (!await isDataForSEOConfigured(orgId)) return { traffic: 0, keywords: 0, rank: 0, backlinks: 0 };
  try {
    type DFSResult = Array<{ result?: Array<Record<string, number>> }>;
    const data = await dfsRequest<DFSResult>(
      "/dataforseo_labs/google/domain_metrics/live",
      [{ target: domain, location_name: "France" }],
      orgId
    );
    const r = data[0]?.result?.[0] ?? {};
    return {
      traffic:  r["organic_traffic"] ?? 0,
      keywords: r["organic_count"]   ?? 0,
      rank:     r["rank"]            ?? 0,
      backlinks:r["backlinks"]       ?? 0,
    };
  } catch { return { traffic: 0, keywords: 0, rank: 0, backlinks: 0 }; }
}

export async function getKeywordDifficulty(keyword: string, orgId = "default"): Promise<number> {
  if (!await isDataForSEOConfigured(orgId)) return 0;
  try {
    type DFSResult = Array<{ result?: Array<{ keyword_difficulty: number }> }>;
    const data = await dfsRequest<DFSResult>(
      "/dataforseo_labs/google/keyword_difficulty/live",
      [{ keywords: [keyword], location_name: "France" }],
      orgId
    );
    return data[0]?.result?.[0]?.keyword_difficulty ?? 0;
  } catch { return 0; }
}

// ── Local Pack (Google Maps / Pack 3) ─────────────────────────────────────────

export async function getLocalPackRank(
  keyword: string, location: string, orgId = "default"
): Promise<Array<{ rank: number; title: string; rating: number; reviews: number; address?: string }>> {
  if (!await isDataForSEOConfigured(orgId)) return [];
  try {
    type DFSResult = Array<{
      status_code: number;
      result?: Array<{
        items?: Array<{
          type: string;
          rank_absolute: number;
          title?: string;
          rating?: { value: number; votes_count: number };
          address?: string;
        }>;
      }>;
    }>;
    const data = await dfsRequest<DFSResult>("/serp/google/local_pack/live/regular", [{
      keyword,
      location_name: location,
      language_code: "fr",
      depth: 3,
    }], orgId);

    const items = (data[0]?.result?.[0]?.items ?? [])
      .filter(i => i.type === "local_pack")
      .slice(0, 3);

    return items.map((item, idx) => ({
      rank:     item.rank_absolute ?? idx + 1,
      title:    item.title ?? `Résultat ${idx + 1}`,
      rating:   item.rating?.value ?? 0,
      reviews:  item.rating?.votes_count ?? 0,
      address:  item.address,
    }));
  } catch (e) {
    logger.warn({ e }, "[dfs] getLocalPackRank failed");
    return [];
  }
}

export type DomainMetricsFetchResult =
  | {
      ok: true;
      provider: "DataForSEO";
      providerModel: "dataforseo_labs/google/domain_metrics/live";
      traffic: number;
      keywords: number;
      authority: number;
    }
  | {
      ok: false;
      provider: "DataForSEO";
      reason: "not_configured" | "provider_error" | "no_metrics";
    };

/**
 * Fetch persisted competitor metrics without converting an unavailable provider
 * into a plausible-looking zero. Callers can therefore keep the competitor and
 * render an explicit unavailable/retry state instead of fabricated metrics.
 */
export async function fetchCompetitorDomainMetrics(
  domain: string,
  orgId = "default",
): Promise<DomainMetricsFetchResult> {
  if (!await isDataForSEOConfigured(orgId)) {
    return { ok: false, provider: "DataForSEO", reason: "not_configured" };
  }

  try {
    type DFSResult = Array<{ result?: Array<Record<string, unknown>> }>;
    const data = await dfsRequest<DFSResult>(
      "/dataforseo_labs/google/domain_metrics/live",
      [{ target: domain, location_name: "France" }],
      orgId,
    );
    const result = data[0]?.result?.[0];
    if (!result) return { ok: false, provider: "DataForSEO", reason: "no_metrics" };

    const metric = (key: string): number => {
      const value = Number(result[key]);
      return Number.isFinite(value) && value >= 0 ? Math.round(value) : 0;
    };
    return {
      ok: true,
      provider: "DataForSEO",
      providerModel: "dataforseo_labs/google/domain_metrics/live",
      traffic: metric("organic_traffic"),
      keywords: metric("organic_count"),
      authority: metric("rank"),
    };
  } catch (err) {
    logger.warn({ err, domain }, "[dfs] competitor domain metrics failed");
    return { ok: false, provider: "DataForSEO", reason: "provider_error" };
  }
}

export async function getGoogleMapsResults(
  keyword: string, location: string, orgId = "default"
): Promise<{ results: Array<{ name: string; rating: number; reviews: number; address: string; category: string; placeId: string; rank: number; photoUrl: string | null }>; error?: string }> {
  if (!await isDataForSEOConfigured(orgId)) return { results: [] };
  try {
    type DFSResult = Array<{
      status_code: number;
      result?: Array<{
        items?: Array<{
          type: string;
          title?: string;
          rating?: { value: number; votes_count: number };
          address?: string;
          category?: string;
          place_id?: string;
          rank_absolute?: number;
          image_url?: string;
        }>;
      }>;
    }>;
    const data = await dfsRequest<DFSResult>("/serp/google/maps/live/regular", [{
      keyword,
      location_name: location,
      language_code: "fr",
      depth: 10,
    }], orgId);

    const items = (data[0]?.result?.[0]?.items ?? [])
      .filter(i => i.type === "maps_search")
      .slice(0, 10);

    return { results: items.map(item => ({
      name:     item.title    ?? "",
      rating:   item.rating?.value       ?? 0,
      reviews:  item.rating?.votes_count ?? 0,
      address:  item.address  ?? "",
      category: item.category ?? "",
      placeId:  item.place_id ?? "",
      rank:     item.rank_absolute ?? 0,
      photoUrl: item.image_url ?? null,
    })) };
  } catch (e) {
    logger.warn({ e }, "[dfs] getGoogleMapsResults failed");
    return { results: [], error: "provider_error" };
  }
}

// ── AI Visibility (LLM) ───────────────────────────────────────────────────────

export async function getAIVisibility(
  domain: string
): Promise<{ score: number; mentions: number; sentiment: string; models: string[] }> {
  // DataForSEO does not yet have a standard LLM visibility endpoint.
  // This will be implemented when the endpoint becomes available.
  return { score: 0, mentions: 0, sentiment: "neutral", models: ["ChatGPT", "Claude", "Gemini", "Perplexity"] };
}

// ── Content optimisation ──────────────────────────────────────────────────────

export async function getContentOptimization(
  url: string, keyword: string, orgId = "default"
): Promise<{ score: number; wordCount: number; headings: number; recommendations: string[] }> {
  if (!await isDataForSEOConfigured(orgId)) {
    return { score: 0, wordCount: 0, headings: 0, recommendations: [] };
  }
  try {
    type DFSResult = Array<{
      result?: Array<{
        main_keyword?: string;
        content_quality_score?: number;
        word_count?: number;
        meta?: { htags?: Record<string, string[]> };
        recommendations?: string[];
      }>;
    }>;
    const data = await dfsRequest<DFSResult>("/content_analysis/summary/live", [{
      url, keyword, location_name: "France", language_code: "fr",
    }], orgId);
    const r = data[0]?.result?.[0] ?? {};
    const htags = r.meta?.htags ?? {};
    const headings = Object.values(htags).flat().length;
    return {
      score:           Math.round((r.content_quality_score ?? 0) * 100),
      wordCount:       r.word_count ?? 0,
      headings,
      recommendations: r.recommendations ?? [],
    };
  } catch { return { score: 0, wordCount: 0, headings: 0, recommendations: [] }; }
}

// ── SEO Missions (generated from competitor gap analysis) ─────────────────────

export async function generateSEOMissions(
  orgId: string, domain: string, keywords: string[] = []
): Promise<unknown[]> {
  if (!await isDataForSEOConfigured(orgId) || keywords.length === 0) return [];
  try {
    type DFSResult = Array<{
      result?: Array<{
        keyword: string;
        keyword_difficulty: number;
        search_volume: number;
      }>;
    }>;
    const data = await dfsRequest<DFSResult>(
      "/dataforseo_labs/google/keyword_difficulty/live",
      [{ keywords: keywords.slice(0, 20), location_name: "France" }],
      orgId
    );
    return (data[0]?.result ?? []).map((r, i) => ({
      id:               `dfs_mission_${i}`,
      keyword:           r.keyword,
      difficulty:        r.keyword_difficulty,
      volume:            r.search_volume,
      estimatedClicks:   Math.round(r.search_volume * 0.08),
      actionPlan:       ["Créer du contenu optimisé", "Obtenir des backlinks ciblés", "Améliorer l'UX de la page"],
    }));
  } catch { return []; }
}

/** Refresh cached domain metrics for a given domain (used by cron). */
export async function refreshSEOCache(domain: string, orgId = "default"): Promise<void> {
  await getDomainMetrics(domain, orgId).catch(() => {});
}
