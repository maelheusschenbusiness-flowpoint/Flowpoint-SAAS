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

// All 3 services requested in a single OAuth consent — user authorises once.
const SCOPES = [
  "openid", "email", "profile",
  "https://www.googleapis.com/auth/webmasters.readonly",       // GSC
  "https://www.googleapis.com/auth/business.manage",            // GBP
  "https://www.googleapis.com/auth/analytics.readonly",         // GA4
  "https://www.googleapis.com/auth/analytics.edit",             // GA4 admin (list properties)
].join(" ");

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
    scope:         SCOPES,
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
      `INSERT INTO google_tokens (org_id, access_token, refresh_token, expires_at, scope, created_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (org_id) DO UPDATE SET
         access_token  = $2,
         refresh_token = COALESCE($3, google_tokens.refresh_token),
         expires_at    = $4,
         scope         = $5,
         updated_at    = NOW()`,
      [
        orgId,
        encryptToken(tokens.accessToken),
        tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
        new Date(tokens.expiresAt),
        tokens.scope,
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
    // Primary: google_tokens
    let row: Record<string, unknown> | undefined;
    const r1 = await client.query(
      `SELECT access_token, refresh_token, expires_at FROM google_tokens WHERE org_id=$1 LIMIT 1`,
      [orgId]
    );
    if (r1.rows[0]) {
      row = r1.rows[0] as Record<string, unknown>;
    } else {
      // Fallback: google_accounts (pre-migration rows)
      const r2 = await client.query(
        `SELECT access_token, refresh_token, token_expiry AS expires_at
         FROM google_accounts WHERE org_id=$1 LIMIT 1`,
        [orgId]
      );
      if (r2.rows[0]) row = r2.rows[0] as Record<string, unknown>;
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

async function gbpFetch<T>(token: string, path: string, baseUrl = "https://mybusinessaccountmanagement.googleapis.com/v1"): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`GBP API ${res.status} — ${path}`);
  return res.json() as Promise<T>;
}

export async function getAccounts(orgId: string): Promise<unknown[]> {
  const token = await getValidToken(orgId).catch(() => null);
  if (!token) return [];
  try {
    const data = await gbpFetch<Record<string, unknown>>(token, "/accounts");
    return (data["accounts"] as unknown[]) ?? [];
  } catch { return []; }
}

export async function getLocations(orgId: string, accountId: string): Promise<unknown[]> {
  const token = await getValidToken(orgId).catch(() => null);
  if (!token) return [];
  try {
    const data = await gbpFetch<Record<string, unknown>>(token, `/accounts/${accountId}/locations`);
    return (data["locations"] as unknown[]) ?? [];
  } catch { return []; }
}

export async function getLocationReviews(orgId: string, locationName: string): Promise<unknown[]> {
  const token = await getValidToken(orgId).catch(() => null);
  if (!token) return [];
  try {
    const res = await fetch(
      `https://mybusiness.googleapis.com/v4/${locationName}/reviews`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return [];
    const data = await res.json() as Record<string, unknown>;
    return (data["reviews"] as unknown[]) ?? [];
  } catch { return []; }
}

export async function getPerformance(
  orgId: string,
  locationName: string,
  opts: { startTime: string; endTime: string }
): Promise<unknown> {
  const token = await getValidToken(orgId).catch(() => null);
  if (!token) return { metricValues: [] };
  const start = new Date(opts.startTime);
  const end   = new Date(opts.endTime);
  const url = [
    `https://businessprofileperformance.googleapis.com/v1/${locationName}:getDailyMetricsTimeSeries`,
    `?dailyMetric=ALL`,
    `&dailyRange.startDate.year=${start.getFullYear()}`,
    `&dailyRange.startDate.month=${start.getMonth() + 1}`,
    `&dailyRange.startDate.day=${start.getDate()}`,
    `&dailyRange.endDate.year=${end.getFullYear()}`,
    `&dailyRange.endDate.month=${end.getMonth() + 1}`,
    `&dailyRange.endDate.day=${end.getDate()}`,
  ].join("");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return { metricValues: [] };
  return res.json();
}

export async function publishGBPPost(
  orgId: string,
  locationName: string,
  post: { summary: string; callToAction?: { actionType: string; url: string } }
): Promise<{ ok: boolean; error?: string }> {
  try {
    const token = await getValidToken(orgId);
    const res = await fetch(
      `https://mybusiness.googleapis.com/v4/${locationName}/localPosts`,
      {
        method:  "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body:    JSON.stringify(post),
        signal:  AbortSignal.timeout(12_000),
      }
    );
    if (!res.ok) return { ok: false, error: `GBP API ${res.status}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function replyToReview(
  orgId: string,
  locationName: string,
  reviewName: string,
  comment: string
): Promise<void> {
  const token = await getValidToken(orgId);
  const res = await fetch(
    `https://mybusiness.googleapis.com/v4/${locationName}/${reviewName}/reply`,
    {
      method:  "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body:    JSON.stringify({ comment }),
      signal:  AbortSignal.timeout(12_000),
    }
  );
  if (!res.ok) throw new Error(`replyToReview ${res.status}`);
}

export async function generateAIReply(
  reviewerName: string,
  rating: number,
  comment: string
): Promise<string> {
  if (rating >= 4) {
    return `Bonjour ${reviewerName}, merci beaucoup pour votre avis positif ! Nous sommes ravis que vous soyez satisfait de nos services. N'hésitez pas à nous recommander. 🙏`;
  }
  if (rating <= 2) {
    return `Bonjour ${reviewerName}, nous sommes sincèrement désolés que votre expérience n'ait pas été à la hauteur. Votre retour est précieux — n'hésitez pas à nous contacter directement pour que nous puissions corriger la situation. 🤝`;
  }
  return `Bonjour ${reviewerName}, merci pour votre retour ! Nous prenons note de vos commentaires pour améliorer continuellement notre service. 😊`;
}

export async function syncAll(orgId: string): Promise<{ accounts: number; locations: number; reviews: number }> {
  try {
    const accounts = await getAccounts(orgId);
    if (!accounts.length) return { accounts: 0, locations: 0, reviews: 0 };

    let totalLocations = 0;
    let totalReviews   = 0;
    const client = await pool.connect();
    try {
      for (const acc of accounts.slice(0, 3)) {
        const accId = (acc as Record<string, string>)["name"]?.split("/")[1] ?? "";
        if (!accId) continue;
        const locs = await getLocations(orgId, accId);
        totalLocations += locs.length;

        for (const loc of locs.slice(0, 10)) {
          const locName = (loc as Record<string, string>)["name"] ?? "";
          const reviews = await getLocationReviews(orgId, locName);
          totalReviews += reviews.length;

          // Upsert location into google_locations
          await client.query(
            `INSERT INTO google_locations (id, org_id, name, raw_data, last_sync_at)
             VALUES ($1,$2,$3,$4,NOW())
             ON CONFLICT (id) DO UPDATE SET raw_data=$4, last_sync_at=NOW()`,
            [`${orgId}_${locName}`, orgId, (loc as Record<string, string>)["title"] ?? locName, JSON.stringify(loc)]
          ).catch(() => {});

          // Upsert reviews
          for (const rev of (reviews as Array<Record<string, unknown>>).slice(0, 20)) {
            await client.query(
              `INSERT INTO google_reviews
                 (id, org_id, location_id, review_id, reviewer_name, rating, comment, create_time)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT (review_id, org_id) DO UPDATE SET rating=$6, comment=$7`,
              [
                `${orgId}_${rev["reviewId"]}`,
                orgId,
                locName,
                rev["reviewId"] ?? "",
                (rev["reviewer"] as Record<string, string>)?.["displayName"] ?? "",
                parseInt(String((rev["starRating"] ?? "ZERO")).replace(/\D+/, "")) || 0,
                (rev["comment"] as string) ?? "",
                rev["createTime"] ?? new Date().toISOString(),
              ]
            ).catch(() => {});
          }
        }
      }
    } finally {
      client.release();
    }

    return { accounts: accounts.length, locations: totalLocations, reviews: totalReviews };
  } catch (e) {
    logger.warn({ e, orgId }, "[google] syncAll failed");
    return { accounts: 0, locations: 0, reviews: 0 };
  }
}
