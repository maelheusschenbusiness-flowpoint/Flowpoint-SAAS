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

// ── Quota management ──────────────────────────────────────────────────────────

export async function checkAndIncrementQuota(orgId = "default", units = 1): Promise<boolean> {
  const client = await pool.connect();
  try {
    const today = new Date().toISOString().slice(0, 10);
    const res = await client.query(
      `INSERT INTO dataforseo_quota (org_id, date, requests_used, created_at)
       VALUES ($1,$2,$3,NOW())
       ON CONFLICT (org_id, date)
       DO UPDATE SET requests_used = dataforseo_quota.requests_used + $3
       RETURNING requests_used`,
      [orgId, today, units]
    );
    return Number(res.rows[0]?.requests_used ?? 0) <= MAX_DAILY_REQUESTS;
  } catch { return true; } finally { client.release(); }
}

export async function getQuotaUsage(
  orgId = "default"
): Promise<{ used: number; limit: number; resetAt: string }> {
  const client = await pool.connect();
  try {
    const today = new Date().toISOString().slice(0, 10);
    const res = await client.query(
      `SELECT requests_used FROM dataforseo_quota WHERE org_id=$1 AND date=$2`,
      [orgId, today]
    );
    const reset = new Date();
    reset.setHours(24, 0, 0, 0);
    return {
      used:    Number(res.rows[0]?.requests_used ?? 0),
      limit:   MAX_DAILY_REQUESTS,
      resetAt: reset.toISOString(),
    };
  } catch {
    return { used: 0, limit: MAX_DAILY_REQUESTS, resetAt: new Date().toISOString() };
  } finally { client.release(); }
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
    return data[0]?.result?.[0] as unknown[] ?? [];
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
): Promise<{ referring_domains: number; backlinks: number; domain_rank: number }> {
  if (!await isDataForSEOConfigured(orgId)) return { referring_domains: 0, backlinks: 0, domain_rank: 0 };
  try {
    type DFSResult = Array<{ result?: Array<Record<string, number>> }>;
    const data = await dfsRequest<DFSResult>("/backlinks/summary/live", [{ target: domain }], orgId);
    const r = data[0]?.result?.[0] ?? {};
    return {
      referring_domains: r["referring_domains"] ?? 0,
      backlinks:         r["backlinks"]          ?? 0,
      domain_rank:       r["rank"]               ?? 0,
    };
  } catch { return { referring_domains: 0, backlinks: 0, domain_rank: 0 }; }
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

export async function getGoogleMapsResults(
  keyword: string, location: string, orgId = "default"
): Promise<Array<{ name: string; rating: number; reviews: number; address: string; category: string }>> {
  if (!await isDataForSEOConfigured(orgId)) return [];
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

    return items.map(item => ({
      name:     item.title    ?? "",
      rating:   item.rating?.value       ?? 0,
      reviews:  item.rating?.votes_count ?? 0,
      address:  item.address  ?? "",
      category: item.category ?? "",
    }));
  } catch (e) {
    logger.warn({ e }, "[dfs] getGoogleMapsResults failed");
    return [];
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
  orgId: string, domain: string, keywords: string[]
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
