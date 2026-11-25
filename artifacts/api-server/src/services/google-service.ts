/**
 * google-service.ts — Core Google OAuth helpers + GBP API calls
 *
 * Token storage: primary table is `google_tokens` (read by getValidToken).
 * `google_accounts` is updated in parallel for profile info (email, google_id).
 *
 * Encryption: AES-256-GCM keyed from JWT_SECRET so tokens at rest are opaque.
 */

import { pool } from "@workspace/db";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";
import { logger } from "../lib/logger.js";

const GOOGLE_AUTH_BASE  = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL  = "https://oauth2.googleapis.com/token";

/**
 * Canonical scopes for the shared Google product connection.
 *
 * Keep Analytics read-only. GA4 account/property discovery and reporting are
 * supported by the readonly scope; this flow must never request Analytics
 * Admin write access.
 *
 * Both /api/google/connect and the legacy /api/google/oauth/start alias call
 * generateAuthUrl(), so the exported allowlist is also the single source of
 * truth used by regression tests.
 */
export const GOOGLE_INTEGRATION_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/business.manage",
  "https://www.googleapis.com/auth/analytics.readonly",
] as const;

export const GOOGLE_INTEGRATION_SCOPE_SET = new Set<string>(GOOGLE_INTEGRATION_SCOPES);

// ── Encryption ────────────────────────────────────────────────────────────────

const ENC_KEY = createHash("sha256")
  .update(process.env["JWT_SECRET"] ?? "dev-key-please-change")
  .digest();

export function encryptToken(token: string): string {
  const iv     = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const enc    = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return [iv.toString("hex"), enc.toString("hex"), tag.toString("hex")].join(":");
}

export function decryptToken(encrypted: string): string {
  const [ivHex, encHex, tagHex] = encrypted.split(":");
  const iv       = Buffer.from(ivHex, "hex");
  const encBuf   = Buffer.from(encHex, "hex");
  const tag      = Buffer.from(tagHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", ENC_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encBuf), decipher.final()]).toString("utf8");
}

// ── Config ────────────────────────────────────────────────────────────────────

export function isGoogleConfigured(): boolean {
  return !!(process.env["GOOGLE_CLIENT_ID"] && process.env["GOOGLE_CLIENT_SECRET"]);
}

// ── OAuth flow ────────────────────────────────────────────────────────────────

export function generateAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id:     process.env["GOOGLE_CLIENT_ID"] ?? "",
    redirect_uri:  process.env["GOOGLE_REDIRECT_URI"] ?? "",
    response_type: "code",
    scope:         GOOGLE_INTEGRATION_SCOPES.join(" "),
    access_type:   "offline",
    prompt:        "consent",   // always prompt so we always get a refresh_token
    state,
  });
  return `${GOOGLE_AUTH_BASE}?${params}`;
}

export interface GoogleTokens {
  accessToken:  string;
  refreshToken: string | null;
  expiresAt:    number;
  scope:        string;
  email?:       string;
  name?:        string;
}

export async function getTokensFromCode(code: string): Promise<GoogleTokens> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     process.env["GOOGLE_CLIENT_ID"] ?? "",
      client_secret: process.env["GOOGLE_CLIENT_SECRET"] ?? "",
      redirect_uri:  process.env["GOOGLE_REDIRECT_URI"] ?? "",
      grant_type:    "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  if (data["error"]) throw new Error(String(data["error_description"] ?? data["error"]));
  return {
    accessToken:  String(data["access_token"]),
    refreshToken: data["refresh_token"] ? String(data["refresh_token"]) : null,
    expiresAt:    Date.now() + Number(data["expires_in"] ?? 3600) * 1000,
    scope:        String(data["scope"] ?? ""),
  };
}

async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token:  refreshToken,
      client_id:      process.env["GOOGLE_CLIENT_ID"] ?? "",
      client_secret:  process.env["GOOGLE_CLIENT_SECRET"] ?? "",
      grant_type:     "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  return {
    accessToken:  String(data["access_token"]),
    refreshToken: refreshToken, // refresh tokens don't rotate unless revoked
    expiresAt:    Date.now() + Number(data["expires_in"] ?? 3600) * 1000,
    scope:        String(data["scope"] ?? ""),
  };
}

// ── Token storage (primary: google_tokens) ────────────────────────────────────

export async function saveTokens(orgId: string, tokens: GoogleTokens): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO google_tokens (org_id, account_id, access_token, refresh_token, expires_at, created_at)
       VALUES ($1, 'primary', $2, $3, $4, NOW())
       ON CONFLICT (org_id, account_id) DO UPDATE SET
         access_token  = $2,
         refresh_token = COALESCE($3, google_tokens.refresh_token),
         expires_at    = $4,
         updated_at    = NOW()`,
      [
        orgId,
        encryptToken(tokens.accessToken),
        tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
        new Date(tokens.expiresAt),
      ]
    );
  } finally {
    client.release();
  }
}

/**
 * Returns a valid (auto-refreshed) access token for the given org.
 * Checks google_tokens first, then falls back to google_accounts (legacy rows).
 * Throws if no connection exists.
 */
export async function getValidToken(orgId: string): Promise<string> {
  const client = await pool.connect();
  try {
    // Les tables Google sont creees a la premiere connexion : tant qu'aucune organisation ne s'est
    // connectee, elles n'existent pas (42P01). C'est « jamais connecte », pas un echec d'autorisation.
    const missingTable = (e: unknown) => (e as { code?: string })?.code === "42P01";
    // Primary: google_tokens
    let row: Record<string, unknown> | undefined;
    try {
      const r1 = await client.query(
        `SELECT access_token, refresh_token, expires_at FROM google_tokens WHERE org_id=$1 LIMIT 1`,
        [orgId]
      );
      if (r1.rows[0]) row = r1.rows[0] as Record<string, unknown>;
    } catch (e) {
      if (!missingTable(e)) throw e;
    }
    if (!row) {
      // Fallback: google_accounts (pre-migration rows)
      try {
        const r2 = await client.query(
          `SELECT access_token, refresh_token, token_expiry AS expires_at
           FROM google_accounts WHERE org_id=$1 LIMIT 1`,
          [orgId]
        );
        if (r2.rows[0]) row = r2.rows[0] as Record<string, unknown>;
      } catch (e) {
        if (!missingTable(e)) throw e;
      }
    }

    if (!row) throw new Error(`Google not connected for org: ${orgId}`);

    const expiresAt = new Date(row["expires_at"] as string).getTime();
    const accessToken = decryptToken(row["access_token"] as string);

    // Token still valid (with 60s buffer)
    if (expiresAt > Date.now() + 60_000) return accessToken;

    // Refresh
    if (!row["refresh_token"]) throw new Error("Token expired and no refresh token");
    const fresh = await refreshAccessToken(decryptToken(row["refresh_token"] as string));
    await saveTokens(orgId, fresh);
    return fresh.accessToken;
  } finally {
    client.release();
  }
}

// ── GBP status ────────────────────────────────────────────────────────────────

/**
 * Fast token-only connection check — true as soon as OAuth tokens are saved,
 * even before GA4/GSC property discovery has run.
 */
export async function hasGoogleConnection(orgId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT 1 FROM google_tokens WHERE org_id=$1 LIMIT 1`, [orgId]
    );
    return r.rows.length > 0;
  } catch { return false; } finally { client.release(); }
}

export async function getGBPStatus(orgId: string): Promise<{
  connected: boolean; accountsCount: number; locationsCount: number; email?: string;
}> {
  const client = await pool.connect();
  try {
    const [tokens, account, locs] = await Promise.all([
      client.query(`SELECT 1 FROM google_tokens WHERE org_id=$1 LIMIT 1`, [orgId]),
      client.query(`SELECT email FROM google_accounts WHERE org_id=$1 LIMIT 1`, [orgId]),
      client.query(`SELECT COUNT(*)::int AS c FROM google_locations WHERE org_id=$1`, [orgId]),
    ]);
    const connected = tokens.rows.length > 0;
    return {
      connected,
      accountsCount: connected ? 1 : 0,
      locationsCount: Number((locs.rows[0] as Record<string, number>)?.["c"] ?? 0),
      email: (account.rows[0] as Record<string, string> | undefined)?.["email"],
    };
  } catch {
    return { connected: false, accountsCount: 0, locationsCount: 0 };
  } finally {
    client.release();
  }
}

// ── GBP API helpers ───────────────────────────────────────────────────────────

const GBP_ACCOUNT_MGMT_URL = "https://mybusinessaccountmanagement.googleapis.com/v1";
const GBP_BUSINESS_INFO_URL = "https://mybusinessbusinessinformation.googleapis.com/v1";
const GBP_V4_URL = "https://mybusiness.googleapis.com/v4";
const GBP_PERFORMANCE_URL = "https://businessprofileperformance.googleapis.com/v1";

/**
 * Fields requested from the Business Information API (the `readMask` is mandatory there,
 * the API returns HTTP 400 without it). Only fields that exist on `Location`.
 */
export const GBP_LOCATION_READ_MASK =
  "name,title,storeCode,storefrontAddress,websiteUri,phoneNumbers,categories,latlng,regularHours,serviceArea,openInfo,profile,metadata";

export type GoogleApiErrorCode =
  | "NOT_CONNECTED"
  | "UNAUTHORIZED"
  | "API_NOT_ENABLED"
  | "QUOTA_EXCEEDED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "BAD_REQUEST"
  | "UPSTREAM_ERROR"
  | "NETWORK_ERROR";

/** Typed error for every Google Business Profile call: callers/UI can show a real reason. */
export class GoogleApiError extends Error {
  readonly code: GoogleApiErrorCode;
  readonly status: number;
  readonly api: string;
  readonly reason?: string;
  readonly googleMessage?: string;
  constructor(init: { code: GoogleApiErrorCode; status: number; api: string; message: string; reason?: string; googleMessage?: string }) {
    super(init.message);
    this.name = "GoogleApiError";
    this.code = init.code;
    this.status = init.status;
    this.api = init.api;
    this.reason = init.reason;
    this.googleMessage = init.googleMessage;
  }
  toJSON() {
    return { code: this.code, status: this.status, api: this.api, reason: this.reason, message: this.message, googleMessage: this.googleMessage };
  }
}

/** Builds a GoogleApiError from a non-2xx Google response (reads the standard error body). */
export async function googleApiErrorFromResponse(res: Response, api: string): Promise<GoogleApiError> {
  let body: { error?: { message?: string; status?: string; details?: Array<{ reason?: string }> } } = {};
  try { body = await res.json() as typeof body; } catch { /* non-JSON body */ }
  const gMsg = body.error?.message;
  const gStatus = body.error?.status;
  const reason = body.error?.details?.map(d => d.reason).find(Boolean) ?? gStatus;
  const haystack = `${gMsg ?? ""} ${reason ?? ""}`.toLowerCase();
  let code: GoogleApiErrorCode;
  if (res.status === 401) code = "UNAUTHORIZED";
  else if (res.status === 429 || gStatus === "RESOURCE_EXHAUSTED" || reason === "RATE_LIMIT_EXCEEDED" || haystack.includes("quota")) code = "QUOTA_EXCEEDED";
  else if (res.status === 403 && (reason === "SERVICE_DISABLED" || haystack.includes("has not been used") || haystack.includes("is not enabled") || haystack.includes("disabled"))) code = "API_NOT_ENABLED";
  else if (res.status === 403) code = "FORBIDDEN";
  else if (res.status === 404) code = "NOT_FOUND";
  else if (res.status === 400) code = "BAD_REQUEST";
  else code = "UPSTREAM_ERROR";
  const label: Record<GoogleApiErrorCode, string> = {
    NOT_CONNECTED: "Google account not connected",
    UNAUTHORIZED: "Google rejected the access token (reconnect Google)",
    API_NOT_ENABLED: "Google API not enabled on the Cloud project",
    QUOTA_EXCEEDED: "Google API quota exceeded (or quota is 0 until the API access request is approved)",
    FORBIDDEN: "Google refused access (missing scope or permission)",
    NOT_FOUND: "Google resource not found",
    BAD_REQUEST: "Google rejected the request parameters",
    UPSTREAM_ERROR: "Google API error",
    NETWORK_ERROR: "Google API unreachable",
  };
  return new GoogleApiError({
    code, status: res.status, api, reason, googleMessage: gMsg,
    message: `${label[code]} — ${api} HTTP ${res.status}${reason ? ` (${reason})` : ""}`,
  });
}

async function googleGet<T>(token: string, url: string, api: string, timeoutMs = 12_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new GoogleApiError({ code: "NETWORK_ERROR", status: 0, api, message: `Google API unreachable — ${api}: ${(e as Error).message}` });
  }
  if (!res.ok) {
    const err = await googleApiErrorFromResponse(res, api);
    logger.warn({ api, status: err.status, code: err.code, reason: err.reason, googleMessage: err.googleMessage }, "[google] API call failed");
    throw err;
  }
  return res.json() as Promise<T>;
}

async function requireToken(orgId: string): Promise<string> {
  try {
    return await getValidToken(orgId);
  } catch (e) {
    throw new GoogleApiError({ code: "NOT_CONNECTED", status: 401, api: "oauth", message: (e as Error).message });
  }
}

/** `accounts/123` or `123` -> `123`. Rejects the legacy placeholder `primary` (it is not a GBP account). */
export function normalizeGbpAccountId(accountId: string): string {
  const id = String(accountId ?? "").replace(/^accounts\//, "").trim();
  if (!id || id === "primary") {
    throw new GoogleApiError({ code: "BAD_REQUEST", status: 400, api: "gbp-accounts", message: "Invalid Google Business Profile account id" });
  }
  return id;
}

/** `locations/456`, `accounts/1/locations/456` or `456` -> `456`. */
export function gbpLocationId(locationName: string): string {
  const m = String(locationName ?? "").match(/(?:^|\/)locations\/([^/]+)/);
  if (m?.[1]) return m[1];
  return /^[^/]+$/.test(String(locationName ?? "")) ? String(locationName) : "";
}

export async function getAccounts(orgId: string): Promise<unknown[]> {
  const token = await requireToken(orgId);
  const out: unknown[] = [];
  let pageToken = "";
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({ pageSize: "20" });
    if (pageToken) qs.set("pageToken", pageToken);
    const data = await googleGet<{ accounts?: unknown[]; nextPageToken?: string }>(
      token, `${GBP_ACCOUNT_MGMT_URL}/accounts?${qs}`, "mybusinessaccountmanagement:accounts.list");
    out.push(...(data.accounts ?? []));
    pageToken = data.nextPageToken ?? "";
    if (!pageToken) break;
  }
  return out;
}

/**
 * Lists every location of a GBP account through the Business Information API
 * (`accounts.locations.list`). The Account Management API has no `/locations` endpoint.
 * Follows `nextPageToken`; throws GoogleApiError on failure (never returns a silent []).
 */
export async function getLocations(orgId: string, accountId: string): Promise<unknown[]> {
  const accId = normalizeGbpAccountId(accountId);
  const token = await requireToken(orgId);
  const out: unknown[] = [];
  let pageToken = "";
  for (let page = 0; page < 50; page++) {
    const qs = new URLSearchParams({ readMask: GBP_LOCATION_READ_MASK, pageSize: "100" });
    if (pageToken) qs.set("pageToken", pageToken);
    const data = await googleGet<{ locations?: unknown[]; nextPageToken?: string }>(
      token, `${GBP_BUSINESS_INFO_URL}/accounts/${encodeURIComponent(accId)}/locations?${qs}`,
      "mybusinessbusinessinformation:accounts.locations.list");
    out.push(...(data.locations ?? []));
    pageToken = data.nextPageToken ?? "";
    if (!pageToken) break;
  }
  return out;
}

/** Account name (`accounts/{a}`) + location name (`locations/{l}`) -> v4 resource name. */
export function buildV4LocationName(accountName: string, locationName: string): string {
  const acc = accountName.startsWith("accounts/") ? accountName : `accounts/${accountName}`;
  return `${acc}/locations/${gbpLocationId(locationName)}`;
}

/** Maps a Business Information `Location` to a google_locations row (pure, unit-tested). */
export function mapLocationToRow(
  orgId: string,
  accountName: string,
  loc: Record<string, unknown>,
  stats?: { averageRating?: number; totalReviewCount?: number },
) {
  const name = String(loc["name"] ?? "");
  const locId = gbpLocationId(name);
  const categories = loc["categories"] as { primaryCategory?: { displayName?: string; name?: string } } | undefined;
  const latlng = loc["latlng"] as { latitude?: number; longitude?: number } | undefined;
  const phones = loc["phoneNumbers"] as { primaryPhone?: string } | undefined;
  const primary = categories?.primaryCategory;
  // raw_data keeps the Google payload; `primaryCategory` is lifted to the top level because the
  // Local Presence Optimizer reads it there, and `v4Name` is what v4 (reviews/posts) endpoints need.
  const rawData = {
    ...loc,
    ...(primary ? { primaryCategory: primary } : {}),
    accountName,
    v4Name: buildV4LocationName(accountName, name),
  };
  return {
    id: `${orgId}_${name}`,
    orgId,
    locationId: locId,
    name: String(loc["title"] ?? "") || name,
    primaryCategory: primary?.displayName ?? primary?.name ?? null,
    rating: stats?.averageRating ?? null,
    reviewsCount: stats?.totalReviewCount ?? 0,
    phone: phones?.primaryPhone ?? null,
    website: (loc["websiteUri"] as string | undefined) ?? null,
    lat: latlng?.latitude ?? null,
    lng: latlng?.longitude ?? null,
    rawData,
  };
}

/** Resolves a location name to the v4 `accounts/{a}/locations/{l}` form via google_locations. */
async function resolveV4LocationName(orgId: string, locationName: string): Promise<string> {
  if (/^accounts\/[^/]+\/locations\/[^/]+/.test(locationName)) return locationName;
  const locId = gbpLocationId(locationName);
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT raw_data->>'v4Name' AS v4 FROM google_locations
       WHERE org_id=$1 AND (raw_data->>'name' = $2 OR location_id = $3) LIMIT 1`,
      [orgId, `locations/${locId}`, locId],
    );
    const v4 = (r.rows[0] as { v4?: string } | undefined)?.v4;
    if (v4) return v4;
  } finally {
    client.release();
  }
  throw new GoogleApiError({ code: "BAD_REQUEST", status: 400, api: "gbp-v4", message: "Unknown Google account for this location — run a Google Business Profile sync first" });
}

export async function getLocationReviews(
  orgId: string, locationName: string,
): Promise<{ reviews: unknown[]; averageRating?: number; totalReviewCount?: number }> {
  const token = await requireToken(orgId);
  const v4 = await resolveV4LocationName(orgId, locationName);
  const reviews: unknown[] = [];
  let averageRating: number | undefined;
  let totalReviewCount: number | undefined;
  let pageToken = "";
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ pageSize: "50" });
    if (pageToken) qs.set("pageToken", pageToken);
    const data = await googleGet<{ reviews?: unknown[]; averageRating?: number; totalReviewCount?: number; nextPageToken?: string }>(
      token, `${GBP_V4_URL}/${v4}/reviews?${qs}`, "mybusiness.v4:reviews.list");
    reviews.push(...(data.reviews ?? []));
    averageRating = data.averageRating ?? averageRating;
    totalReviewCount = data.totalReviewCount ?? totalReviewCount;
    pageToken = data.nextPageToken ?? "";
    if (!pageToken) break;
  }
  return { reviews, averageRating, totalReviewCount };
}

/** Business Profile Performance API v1 `fetchMultiDailyMetricsTimeSeries` (UTC dates, snake_case range). */
export function buildPerformanceUrl(locationName: string, startTime: string, endTime: string, metrics: readonly string[]): string {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const locId = gbpLocationId(locationName);
  if (!locId || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    throw new GoogleApiError({ code: "BAD_REQUEST", status: 400, api: "businessprofileperformance", message: "Invalid Google Business Profile performance request" });
  }
  const params = new URLSearchParams();
  for (const m of metrics) params.append("dailyMetrics", m);
  for (const [prefix, d] of [["start_date", start], ["end_date", end]] as const) {
    params.set(`dailyRange.${prefix}.year`, String(d.getUTCFullYear()));
    params.set(`dailyRange.${prefix}.month`, String(d.getUTCMonth() + 1));
    params.set(`dailyRange.${prefix}.day`, String(d.getUTCDate()));
  }
  return `${GBP_PERFORMANCE_URL}/locations/${encodeURIComponent(locId)}:fetchMultiDailyMetricsTimeSeries?${params}`;
}

const DEFAULT_PERFORMANCE_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "CALL_CLICKS", "WEBSITE_CLICKS", "BUSINESS_DIRECTION_REQUESTS",
] as const;

/** Flat list of `{ dailyMetric, timeSeries }`; throws GoogleApiError on failure. */
export async function getPerformance(
  orgId: string,
  locationName: string,
  opts: { startTime: string; endTime: string; metrics?: readonly string[] }
): Promise<unknown[]> {
  const token = await requireToken(orgId);
  const url = buildPerformanceUrl(locationName, opts.startTime, opts.endTime, opts.metrics ?? DEFAULT_PERFORMANCE_METRICS);
  const data = await googleGet<{
    multiDailyMetricTimeSeries?: Array<{ dailyMetricTimeSeries?: unknown[] }>;
  }>(token, url, "businessprofileperformance:fetchMultiDailyMetricsTimeSeries");
  return (data.multiDailyMetricTimeSeries ?? []).flatMap(g => g.dailyMetricTimeSeries ?? []);
}

export async function publishGBPPost(
  orgId: string,
  locationName: string,
  post: {
    summary: string;
    topicType?: "STANDARD" | "EVENT" | "OFFER";
    languageCode?: string;
    callToAction?: { actionType: string; url?: string };
    media?: Array<{ mediaFormat: "PHOTO"; sourceUrl: string }>;
    event?: { title: string; schedule: {
      startDate: { year: number; month: number; day: number };
      startTime: { hours: number; minutes: number };
      endDate: { year: number; month: number; day: number };
      endTime: { hours: number; minutes: number };
    }};
    offer?: { couponCode?: string; redeemOnlineUrl?: string; termsConditions?: string };
  }
): Promise<{ ok: boolean; error?: string; postName?: string; code?: string }> {
  let token: string;
  try {
    token = await getValidToken(orgId);
  } catch (e: any) {
    const msg = String(e?.message ?? "");
    // Jamais connecté / jeton expiré sans refresh : action utilisateur requise (reconnecter Google).
    if (/not connected|no refresh token/i.test(msg)) return { ok: false, error: msg, code: "GOOGLE_NOT_CONNECTED" };
    return { ok: false, error: msg, code: "GOOGLE_AUTH_FAILED" };
  }
  let v4Location: string;
  try {
    v4Location = await resolveV4LocationName(orgId, locationName);
  } catch (e: any) {
    // Lieu inconnu (aucune synchronisation GBP) : refus explicite, jamais un faux succes.
    return { ok: false, error: e?.message ?? "Unknown GBP location", code: "GBP_API_REJECTED" };
  }
  try {
    const res = await fetch(
      `${GBP_V4_URL}/${v4Location}/localPosts`,
      {
        method:  "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        // v4 localPosts.create exige topicType ; STANDARD = mise a jour simple.
        body:    JSON.stringify({ languageCode: "fr", topicType: "STANDARD", ...post }),
        signal:  AbortSignal.timeout(12_000),
      }
    );
    if (!res.ok) {
      const code = res.status === 401 ? "GOOGLE_AUTH_FAILED"
        : res.status === 403 ? "GBP_API_FORBIDDEN"
        : res.status === 429 ? "GBP_API_RATE_LIMITED"
        : res.status >= 500 ? "GBP_API_UNAVAILABLE"
        : "GBP_API_REJECTED";
      return { ok: false, error: `GBP API ${res.status}`, code };
    }
    const body = await res.json() as { name?: string };
    // Succès réel = Google a renvoyé l'identifiant de la ressource créée.
    if (!body.name) return { ok: false, error: "GBP API: réponse sans identifiant de post", code: "GBP_API_REJECTED" };
    return { ok: true, postName: body.name };
  } catch (e: any) {
    // Réseau / délai dépassé / réponse illisible.
    return { ok: false, error: e.message, code: "GBP_API_UNAVAILABLE" };
  }
}

export async function replyToReview(
  orgId: string,
  locationName: string,
  reviewName: string,
  comment: string
): Promise<void> {
  const token = await requireToken(orgId);
  const reviewPath = reviewName.includes("/reviews/")
    ? reviewName.replace(/^.*?(accounts\/)/, "$1")
    : `${await resolveV4LocationName(orgId, locationName)}/reviews/${reviewName.replace(/^reviews\//, "")}`;
  const res = await fetch(`${GBP_V4_URL}/${reviewPath}/reply`, {
    method:  "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify({ comment }),
    signal:  AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw await googleApiErrorFromResponse(res, "mybusiness.v4:reviews.updateReply");
}

export async function generateAIReply(
  reviewerName: string,
  rating: number,
  comment: string
): Promise<string> {
  const { aiChatCompletion } = await import("../lib/openai-client.js");
  const reply = await aiChatCompletion({
    systemPrompt: `Tu es le gérant d'un commerce local français. Tu réponds aux avis Google de manière personnalisée, professionnelle et chaleureuse (2-4 phrases max). Adapte le ton à la note : remerciement sincère si positif, excuse et proposition de solution si négatif. Ne mets jamais de guillemets autour de la réponse.`,
    userPrompt: `Avis de ${reviewerName} (${rating}/5 étoiles) : "${comment || "(sans commentaire)"}". Rédige la réponse du gérant.`,
    maxTokens: 220,
    temperature: 0.8,
  });
  const trimmed = reply.trim();
  if (!trimmed) throw new Error("AI_GENERATION_FAILED");
  return trimmed;
}

export interface GbpSyncError { step: string; code: GoogleApiErrorCode | "UNKNOWN"; status?: number; reason?: string; message: string; }
export interface GbpSyncResult { accounts: number; locations: number; reviews: number; errors: GbpSyncError[]; }

const STAR_RATINGS: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
/** v4 `starRating` is an enum word (ONE..FIVE), not a digit. */
export function parseStarRating(value: unknown): number {
  return STAR_RATINGS[String(value ?? "").toUpperCase()] ?? 0;
}

function toSyncError(step: string, e: unknown): GbpSyncError {
  if (e instanceof GoogleApiError) return { step, code: e.code, status: e.status, reason: e.reason, message: e.message };
  return { step, code: "UNKNOWN", message: (e as Error)?.message ?? String(e) };
}

/**
 * Syncs GBP accounts -> locations (Business Information API) -> reviews (v4) into
 * google_locations / google_reviews. Failures are logged and returned in `errors`
 * (a Google failure is never reported as "0 locations" without a reason).
 */
export async function syncAll(orgId: string): Promise<GbpSyncResult> {
  const result: GbpSyncResult = { accounts: 0, locations: 0, reviews: 0, errors: [] };
  let accounts: unknown[];
  try {
    accounts = await getAccounts(orgId);
  } catch (e) {
    const err = toSyncError("accounts", e);
    logger.warn({ orgId, ...err }, "[google] syncAll: accounts failed");
    result.errors.push(err);
    return result;
  }
  result.accounts = accounts.length;
  if (!accounts.length) return result;

  const client = await pool.connect();
  try {
    for (const acc of accounts.slice(0, 3)) {
      const accountName = String((acc as Record<string, unknown>)["name"] ?? "");
      if (!accountName.startsWith("accounts/")) continue;
      let locs: Array<Record<string, unknown>>;
      try {
        locs = await getLocations(orgId, accountName) as Array<Record<string, unknown>>;
      } catch (e) {
        const err = toSyncError(`locations:${accountName}`, e);
        logger.warn({ orgId, ...err }, "[google] syncAll: locations failed");
        result.errors.push(err);
        continue;
      }
      result.locations += locs.length;

      for (const loc of locs.slice(0, 50)) {
        const locName = String(loc["name"] ?? "");
        if (!locName) continue;
        let reviews: Array<Record<string, unknown>> = [];
        let stats: { averageRating?: number; totalReviewCount?: number } = {};
        try {
          const r = await getLocationReviews(orgId, buildV4LocationName(accountName, locName));
          reviews = r.reviews as Array<Record<string, unknown>>;
          stats = r;
          result.reviews += reviews.length;
        } catch (e) {
          // Reviews (v4) can be refused independently of locations: keep the location, report it.
          const err = toSyncError(`reviews:${locName}`, e);
          logger.warn({ orgId, ...err }, "[google] syncAll: reviews failed");
          result.errors.push(err);
        }

        const row = mapLocationToRow(orgId, accountName, loc, stats);
        try {
          await client.query(
            `INSERT INTO google_locations
               (id, org_id, location_id, name, primary_category, rating, reviews_count, phone, website, lat, lng, raw_data, last_sync_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
             ON CONFLICT (id) DO UPDATE SET
               location_id=$3, name=$4, primary_category=$5,
               rating=COALESCE($6, google_locations.rating),
               reviews_count=CASE WHEN $7 > 0 THEN $7 ELSE google_locations.reviews_count END,
               phone=$8, website=$9, lat=$10, lng=$11, raw_data=$12, last_sync_at=NOW()`,
            [row.id, row.orgId, row.locationId, row.name, row.primaryCategory, row.rating, row.reviewsCount,
             row.phone, row.website, row.lat, row.lng, JSON.stringify(row.rawData)]
          );
        } catch (e) {
          const err = toSyncError(`db:google_locations:${locName}`, e);
          logger.warn({ orgId, ...err }, "[google] syncAll: location upsert failed");
          result.errors.push(err);
          continue;
        }

        for (const rev of reviews.slice(0, 200)) {
          try {
            await client.query(
              `INSERT INTO google_reviews
                 (id, org_id, location_id, review_id, reviewer_name, rating, comment, create_time, update_time, reply_comment)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
               ON CONFLICT (review_id, org_id) DO UPDATE SET rating=$6, comment=$7, update_time=$9, reply_comment=$10`,
              [
                `${orgId}_${rev["reviewId"]}`,
                orgId,
                row.id,
                rev["reviewId"] ?? "",
                (rev["reviewer"] as Record<string, string>)?.["displayName"] ?? "",
                parseStarRating(rev["starRating"]),
                (rev["comment"] as string) ?? "",
                rev["createTime"] ?? new Date().toISOString(),
                rev["updateTime"] ?? null,
                (rev["reviewReply"] as Record<string, string> | undefined)?.["comment"] ?? null,
              ]
            );
          } catch (e) {
            result.errors.push(toSyncError("db:google_reviews", e));
          }
        }
      }
    }
  } finally {
    client.release();
  }
  return result;
}
