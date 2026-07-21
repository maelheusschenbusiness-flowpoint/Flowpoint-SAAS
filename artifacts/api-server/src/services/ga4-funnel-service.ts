/**
 * ga4-funnel-service.ts — Configurable GA4 Funnel Reports (v1alpha API)
 *
 * Calls POST /v1alpha/properties/{propertyId}:runFunnelReport
 * All step filters are validated against allowlists before forwarding.
 * No synthetic fallback — null or empty on missing/zero data.
 * Cache is tenant-safe (keyed by orgId + funnelId + config hash).
 */

import { createHash } from "node:crypto";
import { getValidToken } from "./google-service.js";
import { logger } from "../lib/logger.js";

// ── Configurable base URL (overridable via env or setGA4FunnelBaseUrl for QA) ─

let GA4_FUNNEL_BASE =
  process.env["GA4_FUNNEL_BASE_URL"] ??
  "https://analyticsdata.googleapis.com/v1alpha/properties";

export function setGA4FunnelBaseUrl(url: string): void {
  GA4_FUNNEL_BASE = url;
}

export function getGA4FunnelBaseUrl(): string {
  return GA4_FUNNEL_BASE;
}

// ── Allowlists ─────────────────────────────────────────────────────────────────

export const ALLOWED_MATCH_TYPES = new Set([
  "EXACT", "BEGINS_WITH", "ENDS_WITH", "CONTAINS", "REGEXP", "PARTIAL_REGEXP",
]);

export const ALLOWED_BREAKDOWN_DIMENSIONS = new Set([
  "deviceCategory", "country", "browser", "operatingSystem",
  "sessionDefaultChannelGrouping", "sourceMedium", "city", "region",
]);

// ── Types ──────────────────────────────────────────────────────────────────────

export interface FunnelStepConfig {
  position: number;
  name: string;
  eventName?: string | null;
  pagePathMatchType?: string | null;
  pagePathValue?: string | null;
  parameterFilters?: unknown;
}

export interface RunFunnelInput {
  orgId: string;
  siteUrl: string;
  propertyId: string;
  startDate: string;
  endDate: string;
  isOpenFunnel: boolean;
  steps: FunnelStepConfig[];
  breakdownDimension?: string | null;
  funnelId: string;
}

export interface NormalizedFunnelStep {
  position: number;
  name: string;
  activeUsers: number;
  completionRate: number | null;
  abandonmentRate: number | null;
  abandonments: number | null;
}

export interface NormalizedFunnelResult {
  funnelId: string;
  source: "ga4";
  fetchedAt: string;
  cached: boolean;
  cachedAt?: string;
  stale?: boolean;
  dateRange: { startDate: string; endDate: string };
  isOpenFunnel: boolean;
  steps: NormalizedFunnelStep[];
  overallConversionRate: number | null;
  totals: { entries: number; completions: number };
  breakdown?: unknown[];
  quota?: { tokensConsumed?: number; tokensRemaining?: number };
}

// ── GA4 v1alpha response types ─────────────────────────────────────────────────

interface GA4FunnelRow {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?: Array<{ value?: string }>;
}

interface GA4FunnelResponse {
  funnelTable?: {
    dimensionHeaders?: Array<{ name?: string }>;
    metricHeaders?: Array<{ name?: string; type?: string }>;
    rows?: GA4FunnelRow[];
    totals?: GA4FunnelRow[];
  };
  funnelVisualization?: unknown;
  propertyQuota?: {
    tokensPerDay?: { consumed?: number; remaining?: number };
    tokensPerHour?: { consumed?: number; remaining?: number };
  };
}

// ── In-memory cache (tenant-safe, keyed by orgId) ─────────────────────────────

interface CacheEntry {
  data: NormalizedFunnelResult;
  cachedAt: number;
}

const _cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function buildCacheKey(input: RunFunnelInput): string {
  const configHash = createHash("md5")
    .update(
      JSON.stringify({
        steps: [...input.steps].sort((a, b) => a.position - b.position),
        isOpenFunnel: input.isOpenFunnel,
        breakdownDimension: input.breakdownDimension ?? null,
      })
    )
    .digest("hex")
    .slice(0, 12);
  // Key always starts with orgId so there is NEVER cross-tenant sharing
  return `${input.orgId}:${input.funnelId}:${input.startDate}:${input.endDate}:${configHash}`;
}

function getCached(key: string): { hit: true; entry: CacheEntry } | { hit: false } {
  const entry = _cache.get(key);
  if (!entry) return { hit: false };
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
    _cache.delete(key);
    return { hit: false };
  }
  return { hit: true, entry };
}

// Periodically evict stale entries
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _cache) {
    if (now - v.cachedAt > CACHE_TTL_MS) _cache.delete(k);
  }
}, 5 * 60 * 1000).unref();

// ── Step filter builder ────────────────────────────────────────────────────────

function buildStepFilterExpression(step: FunnelStepConfig): unknown {
  const expressions: unknown[] = [];

  if (step.eventName?.trim()) {
    expressions.push({ funnelEventFilter: { eventName: step.eventName.trim() } });
  }

  if (step.pagePathValue?.trim()) {
    const matchType =
      step.pagePathMatchType && ALLOWED_MATCH_TYPES.has(step.pagePathMatchType)
        ? step.pagePathMatchType
        : "EXACT";
    expressions.push({
      funnelFieldFilter: {
        fieldName: "pagePath",
        stringFilter: { matchType, value: step.pagePathValue.trim() },
      },
    });
  }

  if (expressions.length === 0) {
    throw Object.assign(
      new Error(`Step "${step.name}" at position ${step.position} has no valid filter condition`),
      { status: 400 }
    );
  }

  if (expressions.length === 1) return expressions[0];
  return { andGroup: { expressions } };
}

// ── GA4 request builder (exported for test inspection) ────────────────────────

export function buildGA4FunnelRequest(input: RunFunnelInput): unknown {
  const sortedSteps = [...input.steps].sort((a, b) => a.position - b.position);

  const ga4Steps = sortedSteps.map(step => ({
    name: step.name,
    filterExpression: buildStepFilterExpression(step),
  }));

  const body: Record<string, unknown> = {
    dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
    funnel: { isOpenFunnel: input.isOpenFunnel, steps: ga4Steps },
    returnPropertyQuota: true,
  };

  if (
    input.breakdownDimension &&
    ALLOWED_BREAKDOWN_DIMENSIONS.has(input.breakdownDimension)
  ) {
    body["funnelBreakdown"] = {
      breakdownDimension: { name: input.breakdownDimension },
    };
  }

  return body;
}

// ── Response normalizer ────────────────────────────────────────────────────────

function normalizeResponse(raw: GA4FunnelResponse, input: RunFunnelInput): NormalizedFunnelResult {
  const sortedSteps = [...input.steps].sort((a, b) => a.position - b.position);
  const rows = raw.funnelTable?.rows ?? [];

  const stepUsers: number[] = sortedSteps.map((_, i) => {
    const row = rows[i];
    if (!row) return 0;
    // Primary metric is the first metricValue (cohortActiveUsers or activeUsers)
    const raw_val = row.metricValues?.[0]?.value;
    return raw_val !== undefined ? Math.max(0, parseInt(raw_val, 10) || 0) : 0;
  });

  const normalizedSteps: NormalizedFunnelStep[] = sortedSteps.map((step, i) => {
    const activeUsers = stepUsers[i] ?? 0;
    const prevUsers = i > 0 ? (stepUsers[i - 1] ?? 0) : null;

    let completionRate: number | null = null;
    let abandonmentRate: number | null = null;
    let abandonments: number | null = null;

    if (prevUsers !== null) {
      if (prevUsers === 0) {
        // Division by zero — return null, never invent a value
        completionRate = null;
        abandonmentRate = null;
        abandonments = null;
      } else {
        completionRate = Math.round((activeUsers / prevUsers) * 10000) / 10000;
        abandonmentRate = Math.round((1 - completionRate) * 10000) / 10000;
        abandonments = prevUsers - activeUsers;
      }
    }

    return { position: step.position, name: step.name, activeUsers, completionRate, abandonmentRate, abandonments };
  });

  const firstUsers = stepUsers[0] ?? 0;
  const lastUsers = stepUsers[sortedSteps.length - 1] ?? 0;
  const overallConversionRate =
    firstUsers === 0 ? null : Math.round((lastUsers / firstUsers) * 10000) / 10000;

  const quota = raw.propertyQuota
    ? {
        tokensConsumed: raw.propertyQuota.tokensPerDay?.consumed,
        tokensRemaining: raw.propertyQuota.tokensPerDay?.remaining,
      }
    : undefined;

  return {
    funnelId: input.funnelId,
    source: "ga4",
    fetchedAt: new Date().toISOString(),
    cached: false,
    dateRange: { startDate: input.startDate, endDate: input.endDate },
    isOpenFunnel: input.isOpenFunnel,
    steps: normalizedSteps,
    overallConversionRate,
    totals: { entries: firstUsers, completions: lastUsers },
    quota,
  };
}

// ── Public: runConfiguredFunnel ───────────────────────────────────────────────

/**
 * Run a configured funnel report via the GA4 v1alpha API.
 * Throws typed errors with `.code` for known failure modes (GA4_NOT_CONNECTED, etc.).
 * Returns null metrics — never synthetic data.
 */
export async function runConfiguredFunnel(input: RunFunnelInput): Promise<NormalizedFunnelResult> {
  if (input.steps.length < 2) {
    throw Object.assign(new Error("Funnel requires at least 2 steps"), { status: 400 });
  }
  if (input.steps.length > 10) {
    throw Object.assign(new Error("Funnel allows at most 10 steps"), { status: 400 });
  }

  const cacheKey = buildCacheKey(input);
  const cached = getCached(cacheKey);
  if (cached.hit) {
    return {
      ...cached.entry.data,
      cached: true,
      cachedAt: new Date(cached.entry.cachedAt).toISOString(),
    };
  }

  // Validate token — throws with GA4_NOT_CONNECTED if not connected
  let token: string;
  try {
    token = await getValidToken(input.orgId);
  } catch {
    throw Object.assign(
      new Error("Google Analytics not connected for this organisation"),
      { status: 409, code: "GA4_NOT_CONNECTED" }
    );
  }

  const requestBody = buildGA4FunnelRequest(input);
  const url = `${GA4_FUNNEL_BASE}/${encodeURIComponent(input.propertyId)}:runFunnelReport`;

  logger.info({ orgId: input.orgId, funnelId: input.funnelId, url_path: ":runFunnelReport" }, "[ga4-funnel] calling GA4 v1alpha");

  let raw: GA4FunnelResponse;
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 25_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(tid);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 429) {
        throw Object.assign(
          new Error(`GA4 quota exceeded: ${text.slice(0, 200)}`),
          { status: 429, code: "GA4_QUOTA_EXCEEDED" }
        );
      }
      if (res.status === 401) {
        throw Object.assign(
          new Error("GA4 authentication failed — token may need refresh"),
          { status: 401, code: "GA4_REAUTH_REQUIRED" }
        );
      }
      if (res.status === 403) {
        throw Object.assign(
          new Error("GA4 access denied — check property permissions"),
          { status: 403, code: "GA4_PERMISSION_DENIED" }
        );
      }
      throw Object.assign(
        new Error(`GA4 API error ${res.status}: ${text.slice(0, 200)}`),
        { status: 502, code: "GA4_API_ERROR" }
      );
    }

    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      throw Object.assign(
        new Error("GA4 returned non-JSON response"),
        { status: 502, code: "GA4_INVALID_RESPONSE" }
      );
    }

    if (!parsed || typeof parsed !== "object") {
      throw Object.assign(
        new Error("GA4 returned an invalid response"),
        { status: 502, code: "GA4_INVALID_RESPONSE" }
      );
    }

    raw = parsed as GA4FunnelResponse;
  } catch (e) {
    const err = e as Error & { code?: string; status?: number };
    if (err.code) throw e; // already typed
    const name = err.name;
    if (name === "AbortError" || name === "TimeoutError") {
      throw Object.assign(
        new Error("GA4 request timed out after 25s"),
        { status: 504, code: "GA4_TIMEOUT" }
      );
    }
    logger.warn({ e, orgId: input.orgId }, "[ga4-funnel] fetch network error");
    throw Object.assign(
      new Error(`GA4 request failed: ${err.message}`),
      { status: 502, code: "GA4_API_ERROR" }
    );
  }

  const result = normalizeResponse(raw, input);
  _cache.set(cacheKey, { data: result, cachedAt: Date.now() });
  return result;
}
