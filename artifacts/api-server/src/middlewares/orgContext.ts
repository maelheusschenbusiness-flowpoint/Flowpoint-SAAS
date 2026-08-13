/**
 * FlowPoint — Org context middleware (async)
 *
 * Derives org/user identity from verified server-side session state.
 * Session lookup: memory cache first, then PostgreSQL (survives restarts).
 *
 * The caller cannot influence req.orgId, req.userId, or req.orgContext
 * through request headers, body fields, or unsigned JWT payloads.
 *
 * Identity resolution order:
 *   1. Per-session token issued at login (src/services/sessions.ts)
 *   2. API_SECRET_KEY used as a service-to-service credential (role: 'admin')
 *   3. No valid credential → anonymous context (orgId: 'default', no role)
 */

import type { Request, Response, NextFunction } from "express";
import { getSession, deleteSession }              from "../services/sessions.js";
import { logger }                                from "../lib/logger.js";
import { pool }                                  from "@workspace/db";

export interface OrgContext {
  orgId:    string;
  userId?:  string;
  /** UUID from users.id — Jalon 2: present for sessions created after migration */
  userUuid?: string;
  email?:   string;
  role?:    string;
  plan?:    string;
}

declare global {
  namespace Express {
    interface Request {
      id?:         string;
      orgId?:      string;
      userId?:     string;
      /** UUID from users.id — Jalon 2: present for sessions created after migration */
      userUuid?:   string;
      orgContext?: OrgContext;
    }
  }
}

function extractToken(req: Request): string | undefined {
  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }
  const apiKeyHeader = req.headers["x-api-key"];
  if (typeof apiKeyHeader === "string" && apiKeyHeader.trim()) {
    return apiKeyHeader.trim();
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cookieToken = (req as any).cookies?.fp_token;
  if (typeof cookieToken === "string" && cookieToken.trim()) {
    return cookieToken.trim();
  }
  // Query param — for SSE/EventSource which cannot send custom headers
  const queryToken = (req.query as Record<string, string>)["token"];
  if (typeof queryToken === "string" && queryToken.trim()) {
    return queryToken.trim();
  }
  return undefined;
}

export function orgContext(req: Request, res: Response, next: NextFunction): void {
  _orgContext(req, res, next).catch(next);
}

/** UUID v4 pattern — same as planGate.ts. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function _orgContext(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);

  if (token) {
    // 1. Per-session token — checks memory cache then DB (survives restarts)
    const session = await getSession(token);
    if (session) {
      // P0-6: Reject legacy email-as-orgId sessions that survived the auth v2 migration.
      // These sessions carry an email address as orgId, which breaks UUID columns.
      // Destroy the session so the client re-authenticates cleanly.
      if (session.orgId && !UUID_RE.test(session.orgId) && session.orgId.includes("@")) {
        logger.info(
          { url: req.url?.split("?")[0], orgIdShape: "email" },
          "[OrgContext] Destroying legacy email-as-orgId session — client will re-authenticate",
        );
        // Best-effort destroy (non-blocking)
        deleteSession(token).catch(() => {});

        // Clear the stale cookie so the browser does not re-send it on subsequent requests.
        res.clearCookie("fp_token", { httpOnly: true, secure: true, sameSite: "lax", path: "/" });

        // For API calls return structured JSON so the frontend JS can handle it.
        // For page/browser navigation redirect to signin so the user sees the login
        // form rather than raw JSON text.
        // Note: /dashboard serves dashboard HTML (not JSON) — treat as page navigation.
        const isDashboardPage = req.url?.startsWith("/dashboard");
        const isApiCall       = req.url?.startsWith("/api/") && !isDashboardPage;
        if (isApiCall) {
          res.status(401).json({ error: "session_expired", reason: "legacy_session" });
        } else {
          res.redirect(302, "/signin.html?reason=session_expired");
        }
        return;
      }

      req.orgId      = session.orgId;
      req.userId     = session.userId;
      req.userUuid   = session.userUuid;
      req.orgContext = {
        orgId:    session.orgId,
        userId:   session.userId,
        userUuid: session.userUuid,
        email:    session.email,
        role:     session.role,
      };
      next();
      return;
    }

    // 2. API_SECRET_KEY as service credential
    const serviceSecret = process.env["API_SECRET_KEY"];
    if (serviceSecret && token === serviceSecret) {
      req.orgId      = "default";
      req.userId     = "service";
      req.orgContext = { orgId: "default", userId: "service", role: "admin" };
      next();
      return;
    }

    // 3. FlowPoint API keys (fp_pub_ / fp_sec_) stored in user_prefs.settings
    if (token.startsWith("fp_pub_") || token.startsWith("fp_sec_")) {
      const isSecret = token.startsWith("fp_sec_");
      const field    = isSecret ? "secretApiKey" : "publicApiKey";
      try {
        const result = await pool.query<{ org_id: string }>(
          `SELECT org_id FROM user_prefs WHERE settings->>'${field}' = $1 LIMIT 1`,
          [token]
        );
        if (result.rows.length > 0) {
          const orgId = result.rows[0].org_id;
          req.orgId      = orgId;
          req.userId     = `apikey:${orgId}`;
          req.orgContext = {
            orgId,
            userId: `apikey:${orgId}`,
            role:   isSecret ? "owner" : "member",
          };
          next();
          return;
        }
      } catch (err) {
        logger.warn({ err }, "[OrgContext] fp_* key lookup failed");
      }
    }

    logger.debug({ url: req.url }, "[OrgContext] Unrecognised token — anonymous context");
  }

  // 3. Anonymous / unauthenticated
  req.orgId      = "default";
  req.userId     = undefined;
  req.orgContext = { orgId: "default" };
  next();
}
