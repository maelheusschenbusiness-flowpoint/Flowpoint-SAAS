import { randomBytes, createHmac, timingSafeEqual } from "crypto";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

  try {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO user_sessions (token, user_id, org_id, email, role, expires_at, created_at, user_id_v2, ip_address, user_agent)
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,$8,$9)
         ON CONFLICT DO NOTHING`,
        [token, opts.userId, opts.orgId, opts.email, opts.role ?? "member", expiresAt,
         opts.userUuid ?? null, opts.ipAddress ?? null, opts.userAgent ?? null]
      );
    } finally {
      client.release();
    }
  } catch (err) {
    logger.warn({ err }, "[sessions] DB insert failed — session may not persist across restarts");
  }

  return token;
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
