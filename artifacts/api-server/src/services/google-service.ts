import { pool } from "@workspace/db";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";
import { logger } from "../lib/logger.js";

const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPES = [
  "openid", "email", "profile",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/business.manage",
  "https://www.googleapis.com/auth/analytics.readonly",
].join(" ");

// ── Encryption helpers ────────────────────────────────────────────────────────
const ENC_KEY = createHash("sha256").update(process.env["JWT_SECRET"] ?? "dev-key-please-change").digest();

export function encryptToken(token: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), enc.toString("hex"), tag.toString("hex")].join(":");
}

export function decryptToken(encrypted: string): string {
  const [ivHex, encHex, tagHex] = encrypted.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const encBuf = Buffer.from(encHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", ENC_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encBuf), decipher.final()]).toString("utf8");
}

// ── Config check ──────────────────────────────────────────────────────────────
export function isGoogleConfigured(): boolean {
  return !!(process.env["GOOGLE_CLIENT_ID"] && process.env["GOOGLE_CLIENT_SECRET"]);
}

// ── OAuth flow ────────────────────────────────────────────────────────────────
export function generateAuthUrl(state: string): string {
  const clientId  = process.env["GOOGLE_CLIENT_ID"] ?? "";
  const redirect  = process.env["GOOGLE_REDIRECT_URI"] ?? "";
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_BASE}?${params}`;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scope: string;
  email?: string;
  name?: string;
}

export async function getTokensFromCode(code: string): Promise<GoogleTokens> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id:     process.env["GOOGLE_CLIENT_ID"] ?? "",
      client_secret: process.env["GOOGLE_CLIENT_SECRET"] ?? "",
      redirect_uri:  process.env["GOOGLE_REDIRECT_URI"] ?? "",
      grant_type:    "authorization_code",
    }),
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

export async function refreshToken(refresh: string): Promise<GoogleTokens> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token:  refresh,
      client_id:      process.env["GOOGLE_CLIENT_ID"] ?? "",
      client_secret:  process.env["GOOGLE_CLIENT_SECRET"] ?? "",
      grant_type:     "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status}`);
  const data = await res.json() as Record<string, unknown>;
  return {
    accessToken:  String(data["access_token"]),
    refreshToken: refresh,
    expiresAt:    Date.now() + Number(data["expires_in"] ?? 3600) * 1000,
    scope:        String(data["scope"] ?? ""),
  };
}

// ── Token storage ─────────────────────────────────────────────────────────────
export async function saveTokens(orgId: string, tokens: GoogleTokens): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO google_tokens (org_id, access_token, refresh_token, expires_at, scope, created_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (org_id) DO UPDATE SET
         access_token=$2, refresh_token=COALESCE($3, google_tokens.refresh_token),
         expires_at=$4, scope=$5, updated_at=NOW()`,
      [orgId, encryptToken(tokens.accessToken),
       tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
       new Date(tokens.expiresAt), tokens.scope]
    );
  } finally { client.release(); }
}

export async function getValidToken(orgId: string): Promise<string> {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT * FROM google_tokens WHERE org_id=$1 LIMIT 1`, [orgId]);
    if (!res.rows[0]) throw new Error("Google not connected for org: " + orgId);
    const r = res.rows[0];
    const expiresAt = new Date(r.expires_at).getTime();
    if (expiresAt > Date.now() + 60_000) return decryptToken(r.access_token);
    if (!r.refresh_token) throw new Error("Token expired and no refresh token available");
    const newTokens = await refreshToken(decryptToken(r.refresh_token));
    await saveTokens(orgId, newTokens);
    return newTokens.accessToken;
  } finally { client.release(); }
}

// ── Google Business Profile ────────────────────────────────────────────────────
async function gbpFetch<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://mybusinessaccountmanagement.googleapis.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`GBP API ${res.status} — ${path}`);
  return res.json() as Promise<T>;
}

export async function getAccounts(orgId: string): Promise<unknown[]> {
  const token = await getValidToken(orgId).catch(() => null);
  if (!token) return [];
  const data = await gbpFetch<Record<string, unknown>>(token, "/accounts");
  return (data["accounts"] as unknown[]) ?? [];
}

export async function getLocations(orgId: string, accountId: string): Promise<unknown[]> {
  const token = await getValidToken(orgId).catch(() => null);
  if (!token) return [];
  const data = await gbpFetch<Record<string, unknown>>(token, `/accounts/${accountId}/locations`);
  return (data["locations"] as unknown[]) ?? [];
}

export async function getLocationReviews(orgId: string, locationName: string): Promise<unknown[]> {
  const token = await getValidToken(orgId).catch(() => null);
  if (!token) return [];
  const res = await fetch(
    `https://mybusiness.googleapis.com/v4/${locationName}/reviews`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }
  );
  if (!res.ok) return [];
  const data = await res.json() as Record<string, unknown>;
  return (data["reviews"] as unknown[]) ?? [];
}

export async function getGBPStatus(orgId: string): Promise<{
  connected: boolean; accountsCount: number; locationsCount: number;
}> {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT COUNT(*) as c FROM google_tokens WHERE org_id=$1`, [orgId]);
    const connected = Number(res.rows[0]?.c ?? 0) > 0;
    return { connected, accountsCount: connected ? 1 : 0, locationsCount: connected ? 1 : 0 };
  } catch { return { connected: false, accountsCount: 0, locationsCount: 0 }; }
  finally { client.release(); }
}

export async function getPerformance(orgId: string, locationName: string, opts: { startTime: string; endTime: string }): Promise<unknown> {
  const token = await getValidToken(orgId).catch(() => null);
  if (!token) return { metricValues: [] };
  const res = await fetch(
    `https://businessprofileperformance.googleapis.com/v1/${locationName}:getDailyMetricsTimeSeries?dailyMetric=ALL&dailyRange.startDate.year=${new Date(opts.startTime).getFullYear()}&dailyRange.startDate.month=${new Date(opts.startTime).getMonth() + 1}&dailyRange.startDate.day=${new Date(opts.startTime).getDate()}&dailyRange.endDate.year=${new Date(opts.endTime).getFullYear()}&dailyRange.endDate.month=${new Date(opts.endTime).getMonth() + 1}&dailyRange.endDate.day=${new Date(opts.endTime).getDate()}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }
  );
  if (!res.ok) return { metricValues: [] };
  return res.json();
}

export async function publishGBPPost(orgId: string, locationName: string, post: {
  summary: string; callToAction?: { actionType: string; url: string };
}): Promise<unknown> {
  const token = await getValidToken(orgId);
  const res = await fetch(
    `https://mybusiness.googleapis.com/v4/${locationName}/localPosts`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(post),
      signal: AbortSignal.timeout(10_000),
    }
  );
  if (!res.ok) throw new Error(`publishGBPPost ${res.status}`);
  return res.json();
}

export async function replyToReview(orgId: string, reviewName: string, comment: string): Promise<unknown> {
  const token = await getValidToken(orgId);
  const res = await fetch(
    `https://mybusiness.googleapis.com/v4/${reviewName}/reply`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ comment }),
      signal: AbortSignal.timeout(10_000),
    }
  );
  if (!res.ok) throw new Error(`replyToReview ${res.status}`);
  return res.json();
}

export async function generateAIReply(reviewText: string, rating: number): Promise<string> {
  if (rating >= 4) {
    return `Merci beaucoup pour votre avis positif ! Nous sommes ravis que vous soyez satisfait de nos services. N'hésitez pas à nous recommander à vos proches. 🙏`;
  }
  if (rating <= 2) {
    return `Bonjour, nous sommes désolés d'apprendre que votre expérience n'a pas été à la hauteur de vos attentes. Votre retour est précieux et nous permet de nous améliorer. N'hésitez pas à nous contacter directement pour que nous puissions corriger la situation. 🤝`;
  }
  return `Merci pour votre retour ! Nous prenons note de vos commentaires pour améliorer continuellement notre service. 😊`;
}

export async function syncAll(orgId: string): Promise<{ accounts: number; locations: number; reviews: number }> {
  try {
    const accounts = await getAccounts(orgId);
    return { accounts: accounts.length, locations: 0, reviews: 0 };
  } catch { return { accounts: 0, locations: 0, reviews: 0 }; }
}
