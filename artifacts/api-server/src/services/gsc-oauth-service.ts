import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const GSC_SCOPES = ["openid", "email", GSC_SCOPE] as const;
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SITES_URL = "https://searchconsole.googleapis.com/webmasters/v3/sites";
const DEFAULT_PROPERTY = "sc-domain:flowpoint.pro";
const STATE_TTL_MINUTES = 10;

function encryptionKey(): Buffer {
  const raw = process.env["GOOGLE_GSC_TOKEN_ENCRYPTION_KEY"] ?? "";
  if (!/^[a-f\d]{64}$/i.test(raw)) throw new Error("GOOGLE_GSC_TOKEN_ENCRYPTION_KEY must be 32-byte hex");
  return Buffer.from(raw, "hex");
}

export function encryptGscToken(value: string, key = encryptionKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${body.toString("hex")}`;
}

export function decryptGscToken(value: string, key = encryptionKey()): string {
  const [ivHex, tagHex, bodyHex] = value.split(":");
  if (!ivHex || !tagHex || !bodyHex) throw new Error("Malformed encrypted GSC token");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(bodyHex, "hex")), decipher.final()]).toString("utf8");
}

export function gscPropertyUrl(): string {
  return process.env["GOOGLE_GSC_PROPERTY_URL"] ?? "";
}

export function gscRedirectUri(): string {
  if (process.env["GOOGLE_GSC_REDIRECT_URI"]) return process.env["GOOGLE_GSC_REDIRECT_URI"];
  const base = process.env["PUBLIC_URL"] ?? process.env["FRONTEND_URL"] ?? "https://app.flowpoint.pro";
  return `${base.replace(/\/+$/, "")}/api/google/gsc/callback`;
}

export function buildGscAuthUrl(state: string): string {
  const clientId = process.env["GOOGLE_GSC_CLIENT_ID"];
  if (!clientId || !process.env["GOOGLE_GSC_CLIENT_SECRET"]) throw new Error("GSC OAuth is not configured");
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: gscRedirectUri(),
    response_type: "code",
    scope: GSC_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${query}`;
}

export async function createGscState(orgId: string, state: string): Promise<void> {
  const hash = createHash("sha256").update(state).digest("hex");
  await pool.query(
    `INSERT INTO gsc_oauth_states (state_hash, org_id, expires_at)
     VALUES ($1,$2,NOW() + $3::int * INTERVAL '1 minute')`,
    [hash, orgId, STATE_TTL_MINUTES]
  );
}

export async function consumeGscState(state: string): Promise<string | null> {
  if (!/^[a-f\d]{64}$/i.test(state)) return null;
  const hash = createHash("sha256").update(state).digest("hex");
  const result = await pool.query(
    `DELETE FROM gsc_oauth_states WHERE state_hash=$1 AND expires_at > NOW() RETURNING org_id`,
    [hash]
  );
  return (result.rows[0] as { org_id?: string } | undefined)?.org_id ?? null;
}

export async function exchangeGscCode(code: string): Promise<Record<string, unknown>> {
  const clientId = process.env["GOOGLE_GSC_CLIENT_ID"];
  const clientSecret = process.env["GOOGLE_GSC_CLIENT_SECRET"];
  if (!clientId || !clientSecret) throw new Error("GSC OAuth is not configured");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code, client_id: clientId, client_secret: clientSecret,
      redirect_uri: gscRedirectUri(), grant_type: "authorization_code",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GSC token exchange failed: ${response.status}`);
  return await response.json() as Record<string, unknown>;
}

export async function saveGscTokens(orgId: string, tokens: Record<string, unknown>, email: string, property: string): Promise<void> {
  const access = String(tokens["access_token"] ?? "");
  const refresh = String(tokens["refresh_token"] ?? "");
  const scopes = String(tokens["scope"] ?? "").split(/\s+/).filter(Boolean);
  if (!access || !refresh || !scopes.includes(GSC_SCOPE)) throw new Error("Google did not grant a refresh token with the required read-only scope");
  await pool.query(
    `INSERT INTO gsc_oauth_tokens
       (org_id, property_url, account_email, access_token, refresh_token, expires_at, scopes, updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW() + $6::int * INTERVAL '1 second',$7,NOW())
     ON CONFLICT (org_id) DO UPDATE SET property_url=$2, account_email=$3,
       access_token=$4, refresh_token=$5, expires_at=EXCLUDED.expires_at,
       scopes=$7, updated_at=NOW()`,
    [orgId, property, email, encryptGscToken(access), encryptGscToken(refresh), Number(tokens["expires_in"] ?? 3600), JSON.stringify(scopes)]
  );
}

export async function getGscValidToken(orgId: string): Promise<string> {
  const result = await pool.query(
    `SELECT access_token, refresh_token, expires_at FROM gsc_oauth_tokens WHERE org_id=$1`,
    [orgId]
  );
  const row = result.rows[0] as { access_token: string; refresh_token: string; expires_at: Date } | undefined;
  if (!row) throw new Error("GSC not connected");
  if (new Date(row.expires_at).getTime() > Date.now() + 60_000) return decryptGscToken(row.access_token);
  const refreshToken = decryptGscToken(row.refresh_token);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken, client_id: process.env["GOOGLE_GSC_CLIENT_ID"] ?? "",
      client_secret: process.env["GOOGLE_GSC_CLIENT_SECRET"] ?? "", grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GSC token refresh failed: ${response.status}`);
  const data = await response.json() as Record<string, unknown>;
  const token = String(data["access_token"] ?? "");
  if (!token) throw new Error("GSC refresh response did not contain an access token");
  await pool.query(
    `UPDATE gsc_oauth_tokens SET access_token=$2, expires_at=NOW() + $3::int * INTERVAL '1 second', updated_at=NOW() WHERE org_id=$1`,
    [orgId, encryptGscToken(token), Number(data["expires_in"] ?? 3600)]
  );
  return token;
}

export async function verifyGscProperty(token: string, property = gscPropertyUrl()): Promise<{ url: string; email: string; permissionLevel: string }> {
  const response = await fetch(SITES_URL, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error("Unable to verify Search Console property access");
  const data = await response.json() as { siteEntry?: Array<{ siteUrl: string; permissionLevel: string }> };
  const allowed = property ? new Set([property]) : new Set([DEFAULT_PROPERTY, "https://flowpoint.pro/"]);
  const entry = (data.siteEntry ?? []).find(site => allowed.has(site.siteUrl) && site.permissionLevel !== "siteUnverifiedUser");
  if (!entry) throw new Error("Authorized Google account does not have access to the configured Search Console property");
  const profileResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000),
  });
  if (!profileResponse.ok) throw new Error("Unable to verify Google account");
  const profile = await profileResponse.json() as { email?: string; email_verified?: boolean };
  if (!profile.email || profile.email_verified !== true) throw new Error("Google account email is not verified");
  return { url: entry.siteUrl, email: profile.email, permissionLevel: entry.permissionLevel };
}

export function safeStateEquals(_a: string, _b: string): boolean {
  const a = Buffer.from(_a); const b = Buffer.from(_b);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function logGscOAuthFailure(error: unknown): void {
  logger.warn({ message: error instanceof Error ? error.message : "unknown" }, "[gsc] OAuth flow failed");
}
