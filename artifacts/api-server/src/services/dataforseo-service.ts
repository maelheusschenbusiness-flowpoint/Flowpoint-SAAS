/**
 * dataforseo-service.ts — DataForSEO API client
 *
 * All functions check await isDataForSEOConfigured() and fall back to empty
 * arrays / null values when credentials are absent — no more fake data.
 *
 * Quota system: tracks daily requests per org in dataforseo_quota table.
 */

import { AsyncLocalStorage } from "node:async_hooks";
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
    // Appel refuse par le fournisseur : rien n'est facture, donc rien ne doit
    // etre consomme. On ne compte pas cet appel (voir `suivreAppelsPayants`).
    const text = await res.text().catch(() => "");
    throw new Error(`DataForSEO ${res.status} — ${path}: ${text.slice(0, 200)}`);
  }
  const suivi = _appelsPayants.getStore();
  if (suivi) suivi.reussis += 1;
  // The DFS API wraps results in {tasks:[...]}.
  // Callers type T as the tasks array (Array<{result?:...}>), so we extract .tasks here.
  const json = await res.json() as { tasks?: T };
  return (json.tasks ?? []) as T;
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

/**
 * Suivi des appels payants reellement effectues pendant une requete HTTP.
 *
 * Le quota est reserve AVANT le traitement (sinon il ne protegerait rien), mais
 * deux situations mesurees le 17/10/2026 consommaient du quota sans qu'aucun
 * appel payant n'ait lieu :
 *
 *   - organisation SANS identifiants DataForSEO : `withQuota` reservait une
 *     unite, puis chaque fonction du service sortait sur
 *     `isDataForSEOConfigured() === false` et renvoyait un tableau vide. Le
 *     client payait son quota pour une reponse vide.
 *   - ERREUR DU FOURNISSEUR (401, 429, 500, delai depasse) : `dfsRequest` leve,
 *     les fonctions attrapent et renvoient vide. L'unite restait consommee
 *     alors que DataForSEO ne facture pas un appel en echec.
 *
 * `dfsRequest` incremente donc un compteur de contexte apres une reponse 2xx
 * seulement, et l'appelant rembourse quand ce compteur est reste a zero.
 */
const _appelsPayants = new AsyncLocalStorage<{ reussis: number }>();

export async function suivreAppelsPayants<T>(fn: () => Promise<T>): Promise<{ resultat: T; appelsReussis: number }> {
  const contexte = { reussis: 0 };
  const resultat = await _appelsPayants.run(contexte, fn);
  return { resultat, appelsReussis: contexte.reussis };
}

/** Rend des unites reservees mais non consommees. Ne descend jamais sous zero. */
export async function rembourserQuota(orgId = "default", units = 1): Promise<void> {
  if (units <= 0) return;
  const today = new Date().toISOString().slice(0, 10);
  const key = _quotaKey(orgId);
  try {
    const client = await pool.connect();
    try {
      const r = await client.query<{ requests_used: number }>(
        `UPDATE dataforseo_quota
            SET requests_used = GREATEST(0, requests_used - $3)
          WHERE org_id = $1 AND date = $2
          RETURNING requests_used`,
        [orgId, today, units]
      );
      const restant = r.rows[0]?.requests_used;
      if (restant !== undefined) _quotaMemory.set(key, Number(restant));
    } finally {
      client.release();
    }
  } catch (err) {
    // Un remboursement perdu surconsomme le quota du client : c'est genant,
    // jamais dangereux. On le journalise sans faire echouer la requete.
    logger.warn({ err, orgId }, "[DataForSEO] remboursement de quota non persiste");
  }
}

/** Verdict d'une tentative de consommation de quota. */
export type VerdictQuota =
  | { autorise: true; utilise: number; limite: number }
  | { autorise: false; motif: "plafond"; utilise: number; limite: number }
  | { autorise: false; motif: "indisponible" };

/**
 * Consomme du quota et dit si l'appel payant est autorise.
 *
 * Le compteur vivait uniquement en memoire de processus. Deux consequences
 * mesurees le 17/10/2026 :
 *
 *   - un REDEMARRAGE remettait le plafond a zero. `_quotaMemory` est vide au
 *     demarrage et cette fonction ne lisait jamais la base : apres chaque
 *     deploiement Render, les 1000 requetes payantes quotidiennes repartaient
 *     de zero, en silence.
 *   - avec PLUSIEURS INSTANCES, chacune comptait pour elle : le plafond reel
 *     aurait valu N fois le plafond annonce. Le service tourne aujourd'hui en
 *     une seule instance, mais le compteur ne devait pas dependre de cela.
 *
 * L'increment se fait donc EN BASE, en une seule instruction : PostgreSQL
 * serialise les ecritures concurrentes sur la meme ligne, et la valeur
 * retournee est le compte reel, partage et durable. La memoire ne sert plus
 * que de cache de lecture.
 *
 * POLITIQUE FAIL-CLOSED (decision du 17/10/2026) : si PostgreSQL est
 * injoignable, le quota ne peut pas etre verifie, donc aucun appel payant
 * n'est autorise. Le repli en memoire a ete retire : il laissait passer des
 * appels factures sur un compteur reparti de zero a chaque redemarrage, ce qui
 * est exactement le trou que ce plafond doit fermer. Rien n'est consomme dans
 * ce cas — l'appelant doit repondre 503, pas 429.
 */
export async function verifierEtConsommerQuota(
  orgId = "default", planOrUnits?: string | number, units = 1
): Promise<VerdictQuota> {
  // Callers pass either (orgId, plan, units) or the shorthand (orgId, units).
  const effectiveUnits = typeof planOrUnits === "number" ? planOrUnits : units;
  const today = new Date().toISOString().slice(0, 10);
  const key = _quotaKey(orgId);

  try {
    const client = await pool.connect();
    try {
      const r = await client.query<{ requests_used: number }>(
        `INSERT INTO dataforseo_quota (org_id, date, requests_used, created_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (org_id, date)
         DO UPDATE SET requests_used = dataforseo_quota.requests_used + EXCLUDED.requests_used
         RETURNING requests_used`,
        [orgId, today, effectiveUnits]
      );
      const used = Number(r.rows[0]?.requests_used ?? effectiveUnits);
      _quotaMemory.set(key, used);
      if (used <= MAX_DAILY_REQUESTS) return { autorise: true, utilise: used, limite: MAX_DAILY_REQUESTS };
      return { autorise: false, motif: "plafond", utilise: used, limite: MAX_DAILY_REQUESTS };
    } finally {
      client.release();
    }
  } catch (err) {
    logger.warn({ err, orgId }, "[DataForSEO] quota non verifiable — appel payant refuse");
    return { autorise: false, motif: "indisponible" };
  }
}

/**
 * Forme booleenne historique. Conservee pour les appelants qui ne distinguent
 * pas les deux refus ; preferer `verifierEtConsommerQuota` pour pouvoir
 * repondre 503 plutot que 429 quand la verification est impossible.
 */
export async function checkAndIncrementQuota(orgId = "default", planOrUnits?: string | number, units = 1): Promise<boolean> {
  return (await verifierEtConsommerQuota(orgId, planOrUnits, units)).autorise;
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

/**
 * DB-backed quota read — warms the in-memory cache from `dataforseo_quota`
 * so the value survives server restarts and F5.
 * Callers that need the authoritative used count (e.g. /api/me, /api/seo/status)
 * should prefer this over the sync `getQuotaUsage()`.
 */
export async function getQuotaUsageFromDB(
  orgId = "default", _plan?: string
): Promise<{ used: number; limit: number; resetAt: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const key   = `${orgId}:${today}`;
  // Only hit the DB when the in-memory cache is cold (missing key = fresh process/restart).
  if (!_quotaMemory.has(key)) {
    // `pool.connect()` etait HORS du try : une base injoignable faisait remonter
    // l'erreur et /api/seo/status — un endpoint gratuit — repondait 500. Les
    // chemins qui ne declenchent aucun appel payant doivent rester accessibles.
    try {
      const client = await pool.connect();
      try {
        // Rankings use reserveRankingSearch → local_seo_ranking_history (not dataforseo_quota).
        // General DFS API calls use checkAndIncrementQuota → dataforseo_quota.
        // Both are daily per-org counters; take the maximum so neither is hidden.
        const [qr, rh] = await Promise.all([
          client.query<{ n: string }>(
            `SELECT COALESCE(requests_used, 0) AS n FROM dataforseo_quota WHERE org_id=$1 AND date=$2::date`,
            [orgId, today]
          ),
          client.query<{ n: string }>(
            `SELECT COUNT(*)::int AS n FROM local_seo_ranking_history WHERE org_id=$1 AND searched_at::date=$2::date`,
            [orgId, today]
          ),
        ]);
        const quotaUsed = Number(qr.rows[0]?.n ?? 0);
        const rankUsed  = Number(rh.rows[0]?.n ?? 0);
        // Rankings dominate the quota UI — use the higher of the two sources.
        _quotaMemory.set(key, Math.max(quotaUsed, rankUsed));
      } finally { client.release(); }
    } catch { /* non-fatal — fall through with 0 */ }
  }
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
    type DFSItem = {
      domain: string;
      intersections?: number;
      full_domain_metrics?: { organic?: { count?: number; etv?: number } };
      competitor_metrics?:  { organic?: { count?: number; etv?: number } };
    };
    type DFSResult = Array<{ result?: Array<{ items?: DFSItem[] }> }>;
    // No location filter — global competitors; France-only returns empty for many international domains.
    const data = await dfsRequest<DFSResult>(
      "/dataforseo_labs/google/competitors_domain/live",
      [{ target: domain, location_code: 2840, language_code: "en" }],
      orgId
    );
    // data[0] = first task; .result[0] = first result object; .items = competitor list
    const items: DFSItem[] = data[0]?.result?.[0]?.items ?? [];
    return items.slice(0, 10).map(r => {
      const org = r.full_domain_metrics?.organic ?? r.competitor_metrics?.organic ?? {};
      return {
        domain:         r.domain,
        organicTraffic: Math.round(Number(org["etv"]   ?? 0)),
        keywords:       Math.round(Number(org["count"] ?? 0)),
        authority:      0, // fetched separately via backlinks/summary if needed
      };
    });
  } catch { return []; }
}

export async function getBacklinks(
  domain: string, orgId = "default"
): Promise<{ available: boolean; reason?: string; referring_domains: number | null; backlinks: number | null; domain_rank: number | null; total: number | null; dofollow: number | null; items: Record<string, unknown>[] }> {
  const empty = { available: false, reason: "not_configured", referring_domains: null, backlinks: null, domain_rank: null, total: null, dofollow: null, items: [] as Record<string, unknown>[] };
  if (!await isDataForSEOConfigured(orgId)) return empty;
  try {
    type DFSResult = Array<{ result?: Array<Record<string, unknown>> }>;
    const data = await dfsRequest<DFSResult>("/backlinks/summary/live", [{ target: domain }], orgId);
    const r = data[0]?.result?.[0];
    if (!r) return { ...empty, reason: "no_provider_data" };
    const totalValue = nullableMetric(r["backlinks"]);
    const dofollowValue = nullableMetric(r["dofollow_links"]);
    return {
      available: true,
      referring_domains: nullableMetric(r["referring_domains"]),
      backlinks: totalValue,
      domain_rank: nullableMetric(r["rank"]),
      total: totalValue,
      dofollow: dofollowValue,
      items:             (r["items"] as Record<string, unknown>[] | undefined) ?? [],
    };
  } catch { return { ...empty, reason: "provider_error" }; }
}

export interface BacklinkHistoryPoint {
  date: string;
  rank: number | null;
  backlinks: number | null;
  new_backlinks: number | null;
  lost_backlinks: number | null;
  referring_domains: number | null;
  new_referring_domains: number | null;
  lost_referring_domains: number | null;
}

const nullableMetric = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function normalizeBacklinkDetails(items: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return items.flatMap((item) => {
    const urlFrom = String(item["url_from"] ?? "");
    const domainFrom = String(item["domain_from"] ?? "");
    if (!urlFrom && !domainFrom) return [];
    return [{
      url_from: urlFrom || null,
      domain_from: domainFrom || null,
      url_to: String(item["url_to"] ?? "") || null,
      anchor: String(item["anchor"] ?? "") || null,
      dofollow: typeof item["dofollow"] === "boolean" ? item["dofollow"] : null,
      rank: nullableMetric(item["rank"]),
      first_seen: String(item["first_seen"] ?? "") || null,
      last_seen: String(item["last_seen"] ?? "") || null,
      links_count: nullableMetric(item["links_count"]),
    }];
  });
}

export async function getBacklinkDetails(domain: string, orgId = "default"): Promise<{
  available: boolean; reason?: string; items: Record<string, unknown>[];
}> {
  const empty = { available: false, reason: "not_configured", items: [] as Record<string, unknown>[] };
  if (!await isDataForSEOConfigured(orgId)) return empty;
  try {
    type DFSResult = Array<{ status_code?: number; result?: Array<Record<string, unknown>> }>;
    const data = await dfsRequest<DFSResult>("/backlinks/backlinks/live", [{
      target: domain, limit: 25, mode: "as_is", backlinks_status_type: "live",
      rank_scale: "one_hundred", order_by: ["rank,desc"],
    }], orgId);
    const task = data[0];
    if (!task || Number(task.status_code) >= 40000) return { ...empty, reason: "provider_no_details" };
    const items = normalizeBacklinkDetails((task.result?.[0]?.["items"] as Record<string, unknown>[] | undefined) ?? []);
    return { available: items.length > 0, reason: items.length ? undefined : "no_details", items };
  } catch {
    return { ...empty, reason: "provider_error" };
  }
}

export function normalizeBacklinkHistoryItems(items: readonly Record<string, unknown>[]): BacklinkHistoryPoint[] {
  return items.flatMap((item) => {
    const date = String(item["date"] ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))) return [];
    return [{
      date,
      rank: nullableMetric(item["rank"]),
      backlinks: nullableMetric(item["backlinks"]),
      new_backlinks: nullableMetric(item["new_backlinks"]),
      lost_backlinks: nullableMetric(item["lost_backlinks"]),
      referring_domains: nullableMetric(item["referring_domains"]),
      new_referring_domains: nullableMetric(item["new_referring_domains"]),
      lost_referring_domains: nullableMetric(item["lost_referring_domains"]),
    }];
  }).sort((a, b) => a.date.localeCompare(b.date));
}

export async function getBacklinkHistory(domain: string, orgId = "default", months = 12): Promise<{
  available: boolean; reason?: string; source: "dataforseo" | "none"; domain: string;
  date_from: string; date_to: string; items: BacklinkHistoryPoint[];
}> {
  const today = new Date();
  const dateTo = today.toISOString().slice(0, 10);
  const safeMonths = Math.max(3, Math.min(24, Math.trunc(months) || 12));
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - safeMonths + 1, 1));
  const dateFrom = from.toISOString().slice(0, 10);
  const empty = { available: false, reason: "not_configured", source: "none" as const, domain, date_from: dateFrom, date_to: dateTo, items: [] as BacklinkHistoryPoint[] };
  if (!await isDataForSEOConfigured(orgId)) return empty;
  try {
    type DFSResult = Array<{ status_code?: number; result?: Array<Record<string, unknown>> }>;
    const data = await dfsRequest<DFSResult>("/backlinks/history/live", [{
      target: domain, date_from: dateFrom, date_to: dateTo, rank_scale: "one_hundred",
    }], orgId);
    const task = data[0];
    if (!task || (Number(task.status_code) >= 40000)) return { ...empty, reason: "provider_no_history" };
    const result = task.result?.[0];
    if (!result) return { ...empty, reason: "provider_no_history" };
    const items = normalizeBacklinkHistoryItems((result["items"] as Record<string, unknown>[] | undefined) ?? []);
    return { ...empty, available: items.length > 0, reason: items.length ? undefined : "no_history", source: items.length ? "dataforseo" : "none", items };
  } catch {
    return { ...empty, reason: "provider_error" };
  }
}

export async function getDomainMetrics(
  domain: string, orgId = "default"
): Promise<{ traffic: number; keywords: number; rank: number; backlinks: number }> {
  if (!await isDataForSEOConfigured(orgId)) return { traffic: 0, keywords: 0, rank: 0, backlinks: 0 };
  try {
    // Use domain_rank_overview (global, no location filter) — domain_metrics/live does not exist.
    type DROResult = Array<{ result?: Array<{ items?: Array<{ metrics?: { organic?: { count?: number; etv?: number } } }> }> }>;
    const data = await dfsRequest<DROResult>(
      "/dataforseo_labs/google/domain_rank_overview/live",
      [{ target: domain, location_code: 2840, language_code: "en" }],
      orgId,
    );
    const item = data[0]?.result?.[0]?.items?.[0];
    const org  = item?.metrics?.organic ?? {};
    const keywords = Math.round(Number(org["count"] ?? 0));
    const traffic  = Math.round(Number(org["etv"]   ?? 0));
    // Domain rank from backlinks/summary/live
    let rank = 0;
    try {
      type BLResult = Array<{ result?: Array<{ rank?: number }> }>;
      const blData = await dfsRequest<BLResult>("/backlinks/summary/live", [{ target: domain }], orgId);
      rank = Math.round(Number(blData[0]?.result?.[0]?.rank ?? 0));
    } catch { /* rank stays 0 if backlinks endpoint unavailable */ }
    return { traffic, keywords, rank, backlinks: 0 };
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
): Promise<Array<{ rank: number; title: string; rating: number; reviews: number; address?: string; lat?: number; lng?: number; place_id?: string }>> {
  if (!await isDataForSEOConfigured(orgId)) return [];
  try {
    // Use business_listings/search/live — works on the standard DFS subscription tier.
    // The legacy /serp/google/local_pack/live/regular endpoint requires a higher-tier SERP plan.
    // We request 10 results and extract lat/lng so the frontend can place markers without
    // relying on a secondary geocoding pass (which fails silently for non-FR addresses).
    type BLItem = {
      title?: string;
      rating?: { value?: number; votes_count?: number };
      address?: string;
      place_id?: string;
      latitude?: number;
      longitude?: number;
    };
    type BLResult = Array<{
      status_code?: number;
      result?: Array<{ items?: BLItem[] }>;
    }>;
    const data = await dfsRequest<BLResult>("/business_data/business_listings/search/live", [{
      keyword,
      location_name: location, // Use the caller-supplied location string, not a hardcoded country code
      limit: 10,
    }], orgId);

    const items = data[0]?.result?.[0]?.items ?? [];
    return items.map((item, idx) => ({
      rank:     idx + 1,
      title:    item.title ?? `Résultat ${idx + 1}`,
      rating:   item.rating?.value ?? 0,
      reviews:  item.rating?.votes_count ?? 0,
      address:  item.address,
      lat:      item.latitude  != null ? Number(item.latitude)  : undefined,
      lng:      item.longitude != null ? Number(item.longitude) : undefined,
      place_id: item.place_id,
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
    // Domain authority metrics are global — do NOT filter by location_name.
    // A per-location filter on /domain_metrics silently returns empty results for
    // many international domains (e.g. odoo.com, salesforce.com) even when global
    // metrics exist. We request global metrics and then log the raw response so
    // callers can distinguish "DFS returned data but mapping was wrong" from
    // "DFS returned no data for this domain".
    // Use domain_rank_overview — /domain_metrics/live does not exist on the DFS API.
    // Field mapping: items[0].metrics.organic.count → keywords, .etv → traffic.
    // Authority (domain_rank) comes from backlinks/summary/live.
    type DROResult = Array<{ result?: Array<{ items?: Array<{ metrics?: { organic?: Record<string, number> } }> }> }>;
    const data = await dfsRequest<DROResult>(
      "/dataforseo_labs/google/domain_rank_overview/live",
      [{ target: domain, location_code: 2840, language_code: "en" }],
      orgId,
    );
    const item   = data[0]?.result?.[0]?.items?.[0];
    const org    = item?.metrics?.organic ?? {};
    logger.info({ domain, hasItem: !!item, orgKeys: Object.keys(org) }, "[dfs] domain_rank_overview raw");
    if (!item) {
      logger.warn({ domain, data: JSON.stringify(data).slice(0, 500) }, "[dfs] domain_rank_overview: no item — no_metrics");
      return { ok: false, provider: "DataForSEO", reason: "no_metrics" };
    }
    const keywords = Math.round(Number(org["count"] ?? 0));
    const traffic  = Math.round(Number(org["etv"]   ?? 0));
    // Fetch domain authority from backlinks/summary
    let authority = 0;
    try {
      type BLResult = Array<{ result?: Array<{ rank?: number }> }>;
      const blData = await dfsRequest<BLResult>("/backlinks/summary/live", [{ target: domain }], orgId);
      authority = Math.round(Number(blData[0]?.result?.[0]?.rank ?? 0));
    } catch { /* authority stays 0 */ }
    logger.info({ domain, authority, traffic, keywords }, "[dfs] domain_rank_overview mapped");
    return {
      ok: true,
      provider: "DataForSEO",
      providerModel: "dataforseo_labs/google/domain_rank_overview/live" as never,
      traffic,
      keywords,
      authority,
    };
  } catch (err) {
    logger.warn({ err, domain }, "[dfs] competitor domain metrics failed");
    return { ok: false, provider: "DataForSEO", reason: "provider_error" };
  }
}

export async function getGoogleMapsResults(
  keyword: string, location: string, orgId = "default"
): Promise<{ results: Array<{ name: string; rating: number; reviews: number; address: string; category: string; placeId: string; rank: number; photoUrl: string | null; lat?: number; lng?: number }>; error?: string }> {
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
          latitude?: number;
          longitude?: number;
        }>;
      }>;
    }>;
    const data = await dfsRequest<DFSResult>("/serp/google/maps/live/regular", [{
      keyword,
      location_name: location,
      language_code: "fr",
      depth: 10,
    }], orgId);

    const allItems = data[0]?.result?.[0]?.items ?? [];
    // DFS returns "maps_search" for standard map pack results and sometimes
    // "local_pack" for local pack entries — accept both.
    const items = allItems
      .filter(i => i.type === "maps_search" || i.type === "local_pack")
      .slice(0, 10);
    if (items.length === 0 && allItems.length > 0) {
      // Log all item types so we can diagnose unexpected type values.
      logger.warn({ types: allItems.map(i => i.type).slice(0, 20), keyword, location },
        "[dfs] getGoogleMapsResults: 0 items matched type filter but allItems non-empty");
    }

    return { results: items.map(item => ({
      name:     item.title    ?? "",
      rating:   item.rating?.value       ?? 0,
      reviews:  item.rating?.votes_count ?? 0,
      address:  item.address  ?? "",
      category: item.category ?? "",
      placeId:  item.place_id ?? "",
      rank:     item.rank_absolute ?? 0,
      photoUrl: item.image_url ?? null,
      lat:      item.latitude  != null ? Number(item.latitude)  : undefined,
      lng:      item.longitude != null ? Number(item.longitude) : undefined,
    })) };
  } catch (e) {
    logger.warn({ e }, "[dfs] getGoogleMapsResults failed");
    return { results: [], error: "provider_error" };
  }
}

/** Google Maps results for one measured point in a local geo grid. */
export async function getGoogleMapsResultsAtCoordinate(
  keyword: string,
  latitude: number,
  longitude: number,
  orgId = "default",
): Promise<{ results: Array<{ name: string; rank: number }>; error?: string }> {
  if (!await isDataForSEOConfigured(orgId)) return { results: [], error: "not_configured" };
  try {
    type DFSResult = Array<{
      status_code?: number;
      status_message?: string;
      result?: Array<{
        items?: Array<{
          type: string;
          title?: string;
          rank_group?: number;
          rank_absolute?: number;
        }>;
      }>;
    }>;
    const coordinate = `${latitude.toFixed(7)},${longitude.toFixed(7)},17z`;
    const data = await dfsRequest<DFSResult>("/serp/google/maps/live/advanced", [{
      keyword,
      location_coordinate: coordinate,
      language_code: "fr",
      depth: 20,
      search_places: false,
      search_this_area: true,
    }], orgId);
    const task = data[0];
    if (!task || task.status_code !== 20000) {
      logger.warn({
        statusCode: task?.status_code ?? null,
        statusMessage: task?.status_message ?? null,
        keyword,
        latitude,
        longitude,
      }, "[dfs] coordinate maps task failed");
      return { results: [], error: "provider_error" };
    }
    const allItems = task.result?.[0]?.items ?? [];
    const mapItems = allItems.filter(item => item.type === "maps_search" || item.type === "local_pack");
    if (mapItems.some(item => !Number.isInteger(item.rank_group) || item.rank_group! < 1)) {
      logger.warn({ keyword, latitude, longitude }, "[dfs] coordinate maps response is missing a valid rank_group");
      return { results: [], error: "invalid_provider_response" };
    }
    return {
      results: mapItems
        .map(item => ({ name: item.title ?? "", rank: item.rank_group! }))
        .filter(item => item.name && item.rank > 0),
    };
  } catch (error) {
    logger.warn({ error, keyword, latitude, longitude }, "[dfs] coordinate maps lookup failed");
    return { results: [], error: "provider_error" };
  }
}

// ── AI Visibility (LLM) ───────────────────────────────────────────────────────

export async function getAIVisibility(
      _domain: string
    ): Promise<{ available: false; code: "AI_VISIBILITY_UNAVAILABLE"; error: string }> {
      return {
        available: false,
        code: "AI_VISIBILITY_UNAVAILABLE",
        error: "Aucune source de mesure de visibilité IA n'est actuellement configurée.",
      };
    }

    // ── Content optimisation ──────────────────────────────────────────────────────

export class DataForSEOUnavailableError extends Error {
      constructor(readonly code: "DATAFORSEO_NOT_CONFIGURED" | "DATAFORSEO_NO_RESULT" | "DATAFORSEO_PROVIDER_ERROR") {
        super(code);
        this.name = "DataForSEOUnavailableError";
      }
    }

    export async function getContentOptimization(
      url: string, keyword: string, orgId = "default"
    ): Promise<{ score: number; wordCount: number; headings: number; recommendations: string[] }> {
      if (!await isDataForSEOConfigured(orgId)) throw new DataForSEOUnavailableError("DATAFORSEO_NOT_CONFIGURED");
      type DFSResult = Array<{ result?: Array<{
        main_keyword?: string; content_quality_score?: number; word_count?: number;
        meta?: { htags?: Record<string, string[]> }; recommendations?: string[];
      }> }>;
      let data: DFSResult;
      try {
        data = await dfsRequest<DFSResult>("/content_analysis/summary/live", [{ url, keyword, location_name: "France", language_code: "fr" }], orgId);
      } catch { throw new DataForSEOUnavailableError("DATAFORSEO_PROVIDER_ERROR"); }
      const r = data[0]?.result?.[0];
      if (!r) throw new DataForSEOUnavailableError("DATAFORSEO_NO_RESULT");
      const headings = Object.values(r.meta?.htags ?? {}).flat().length;
      return { score: Math.round((r.content_quality_score ?? 0) * 100), wordCount: r.word_count ?? 0, headings, recommendations: r.recommendations ?? [] };
    }

    export async function generateSEOMissions(orgId: string, domain: string, keywords: string[] = []): Promise<unknown[]> {
      if (!await isDataForSEOConfigured(orgId)) throw new DataForSEOUnavailableError("DATAFORSEO_NOT_CONFIGURED");
      if (!keywords.length) return [];
      type DFSResult = Array<{ result?: Array<{ keyword: string; keyword_difficulty: number; search_volume: number }> }>;
      let data: DFSResult;
      try {
        data = await dfsRequest<DFSResult>("/dataforseo_labs/google/keyword_difficulty/live", [{ keywords: keywords.slice(0, 20), location_name: "France" }], orgId);
      } catch { throw new DataForSEOUnavailableError("DATAFORSEO_PROVIDER_ERROR"); }
      const results = data[0]?.result ?? [];
      if (!results.length) throw new DataForSEOUnavailableError("DATAFORSEO_NO_RESULT");
      return results.map((r, i) => ({ id: "dfs_mission_" + i, keyword: r.keyword, difficulty: r.keyword_difficulty, volume: r.search_volume, estimatedClicks: Math.round(r.search_volume * 0.08), actionPlan: ["Créer du contenu optimisé", "Obtenir des backlinks ciblés", "Améliorer l'UX de la page"] }));
    }

    /** Refresh cached domain metrics for a given domain (used by cron). */
export async function refreshSEOCache(domain: string, orgId = "default"): Promise<void> {
  await getDomainMetrics(domain, orgId).catch(() => {});
}
