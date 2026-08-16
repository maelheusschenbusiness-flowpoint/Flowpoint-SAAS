import { randomBytes, createHmac, timingSafeEqual } from "crypto";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

// 7 days — long enough that Safari's tab-freeze / overnight laptop closure
// (both clear sessionStorage) can recover via the HttpOnly cookie without
// forcing a re-login.  24 h was too short: users whose tabs were idle
// overnight would be redirected to sign-in on the next morning reload.
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface SessionData {
  token: string;
  userId: string;
  orgId: string;
  email: string;
  role: string;
  createdAt: number;
  expiresAt: number;
  /** UUID from users.id — populated by Jalon 2 migration; may be undefined for pre-migration sessions */
  userUuid?: string;
}

const JWT_SECRET = process.env["JWT_SECRET"] ?? "dev-secret-change-me-in-prod-min32chars";

function signToken(payload: string): string {
  return createHmac("sha256", JWT_SECRET).update(payload).digest("hex");
}

function makeToken(userId: string, orgId: string): string {
  const rand = randomBytes(24).toString("hex");
  const ts   = Date.now().toString(36);
  const payload = `${userId}:${orgId}:${rand}:${ts}`;
  const sig = signToken(payload);
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

export async function createSession(opts: {
  userId: string;
  orgId: string;
  email: string;
  role?: string;
  /** UUID from users.id — Jalon 2: populate for all new sessions */
  userUuid?: string;
  /** Client IP address — stored for login history */
  ipAddress?: string;
  /** User-Agent string — stored for login history */
  userAgent?: string;
}): Promise<string> {
  const token = makeToken(opts.userId, opts.orgId);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  // Retry once on transient DB errors.  A session token written to a cookie
  // but not present in user_sessions creates an orphaned cookie: every hard
  // refresh calls session-restore, getSession returns null, and the user is
  // immediately logged out.  Throwing on persistent failure lets login-verify
  // return 503 (retryable) instead of setting a useless cookie.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const client = await pool.connect();
      try {
        const result = await client.query(
          `INSERT INTO user_sessions (token, user_id, org_id, email, role, expires_at, created_at, user_id_v2, ip_address, user_agent)
           VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,$8,$9)
           ON CONFLICT DO NOTHING
           RETURNING token`,
          [token, opts.userId, opts.orgId, opts.email, opts.role ?? "member", expiresAt,
           opts.userUuid ?? null, opts.ipAddress ?? null, opts.userAgent ?? null]
        );
        if ((result.rowCount ?? 0) === 0) {
          // ON CONFLICT DO NOTHING fired — token already exists; idempotent, still valid
          logger.warn({ tokenPrefix: token.slice(0, 8) }, "[sessions] INSERT conflict on token — session already exists (idempotent)");
        } else {
          logger.info({ tokenPrefix: token.slice(0, 8), orgId: opts.orgId }, "[sessions] Session row inserted successfully");
        }
        return token;
      } finally {
        client.release();
      }
    } catch (err) {
      lastErr = err;
      logger.warn({ err, attempt }, "[sessions] DB insert attempt failed — retrying");
      if (attempt === 0) await new Promise(r => setTimeout(r, 200));
    }
  }
  // Both attempts failed — propagate so the caller can return a retryable 503
  // instead of silently setting a cookie for a non-existent session.
  logger.error({ err: lastErr, orgId: opts.orgId }, "[sessions] createSession: persistent DB failure — throwing");
  throw lastErr;
}

export async function getSession(token: string): Promise<SessionData | null> {
  if (!token) return null;
  try {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT user_id, org_id, email, role, created_at, expires_at, user_id_v2
         FROM user_sessions WHERE token = $1 AND expires_at > NOW() LIMIT 1`,
        [token]
      );
      if (!res.rows[0]) return null;
      const row = res.rows[0];
      return {
        token,
        userId: row.user_id,
        orgId: row.org_id,
        email: row.email,
        role: row.role,
        createdAt: new Date(row.created_at).getTime(),
        expiresAt: new Date(row.expires_at).getTime(),
        userUuid: row.user_id_v2 ?? undefined,
      };
    } finally {
      client.release();
    }
  } catch {
    return null;
  }
}

export async function deleteSession(token: string): Promise<void> {
  try {
    const client = await pool.connect();
    try {
      await client.query(`DELETE FROM user_sessions WHERE token = $1`, [token]);
    } finally {
      client.release();
    }
  } catch { /* non-fatal */ }
}

export const invalidateSession = deleteSession;

export async function invalidateAllSessions(userId: string): Promise<void> {
  try {
    const client = await pool.connect();
    try {
      await client.query(`DELETE FROM user_sessions WHERE user_id = $1`, [userId]);
    } finally {
      client.release();
    }
  } catch { /* non-fatal */ }
}
