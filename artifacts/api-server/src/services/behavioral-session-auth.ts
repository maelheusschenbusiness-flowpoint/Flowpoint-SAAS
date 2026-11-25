/**
 * Jetons de session et anti-rejeu de l'ingestion publique Behavioral, surs en multi-instances.
 *
 * Avant : deux Map en memoire (jetons de session, nonces) : un jeton emis par l'instance A
 * etait refuse par l'instance B (403 aleatoires) et un nonce rejoue sur B passait.
 *
 * Maintenant, sans nouvelle infrastructure :
 *  - jeton de session SANS ETAT : payload JSON signe en HMAC-SHA256 avec une cle derivee de
 *    JWT_SECRET (separation de domaine), verifiable par n'importe quelle instance ;
 *  - anti-rejeu des nonces : table PostgreSQL behavior_nonces a cle primaire (site_url, nonce) ;
 *    INSERT ... ON CONFLICT DO NOTHING : une seule instance gagne, les autres voient un rejeu.
 *    Les lignes expirees sont purgees (au plus une fois par minute et par instance).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export const MAX_TS_SKEW_MS = 5 * 60 * 1000;
export const SESSION_TOKEN_TTL_MS = 5 * 60 * 1000;
const NONCE_PURGE_EVERY_MS = 60 * 1000;

export interface SessionTokenClaims { siteUrl: string; allowedOrigin: string; orgId: string; exp: number }

function signingKey(): Buffer {
  const secret = process.env["JWT_SECRET"] ?? process.env["SESSION_SECRET"] ?? "dev-secret-change-me-in-prod-min32chars";
  return createHmac("sha256", secret).update("flowpoint:behavioral-session-token:v1").digest();
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function issueSessionToken(siteUrl: string, origin: string, orgId: string, now = Date.now()): { token: string; expiresAt: number } {
  const exp = now + SESSION_TOKEN_TTL_MS;
  const payload = b64(JSON.stringify({ s: siteUrl, o: origin, g: orgId, e: exp }));
  const sig = createHmac("sha256", signingKey()).update(payload).digest("base64url");
  return { token: `${payload}.${sig}`, expiresAt: exp };
}

/** Retourne les claims si le jeton est authentique, non expire et lie a ce site + cette origine. */
export function verifySessionToken(token: unknown, siteUrl: string, origin: string, now = Date.now()): SessionTokenClaims | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), "base64url");
  const expected = createHmac("sha256", signingKey()).update(payload).digest();
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { s?: unknown; o?: unknown; g?: unknown; e?: unknown };
    if (typeof c.s !== "string" || typeof c.o !== "string" || typeof c.g !== "string" || typeof c.e !== "number") return null;
    if (c.e < now || c.s !== siteUrl || c.o !== origin) return null;
    return { siteUrl: c.s, allowedOrigin: c.o, orgId: c.g, exp: c.e };
  } catch {
    return null;
  }
}

let lastPurge = 0;

/**
 * true = nonce neuf (consomme) ; false = rejeu. Lance en cas d'erreur de base : l'appelant
 * repond 503 (fail-closed, on n'accepte jamais un evenement dont l'unicite n'est pas garantie).
 */
export async function consumeNonce(siteUrl: string, nonce: unknown, tsMs: number): Promise<boolean> {
  if (typeof nonce !== "string" || nonce.length === 0 || nonce.length > 128) return false;
  const now = Date.now();
  const expiresAt = new Date(Math.max(tsMs, now) + MAX_TS_SKEW_MS);
  const r = await pool.query(
    `INSERT INTO behavior_nonces (site_url, nonce, expires_at) VALUES ($1,$2,$3)
     ON CONFLICT (site_url, nonce) DO NOTHING`,
    [siteUrl, nonce, expiresAt],
  );
  if (now - lastPurge > NONCE_PURGE_EVERY_MS) {
    lastPurge = now;
    pool.query(`DELETE FROM behavior_nonces WHERE expires_at < now()`)
      .catch(err => logger.warn({ err }, "[Behavioral] nonce purge failed"));
  }
  return (r.rowCount ?? 0) > 0;
}
