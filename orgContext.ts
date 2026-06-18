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
import { getSession }                            from "../services/sessions.js";
import { logger }                                from "../lib/logger.js";

export interface OrgContext {
  orgId:   string;
  userId?: string;
  email?:  string;
  role?:   string;
  plan?:   string;
}

declare global {
  namespace Express {
    interface Request {
      id?:         string;
      orgId?:      string;
      userId?:     string;
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
  return undefined;
}

export function orgContext(req: Request, res: Response, next: NextFunction): void {
  _orgContext(req, res, next).catch(next);
}

async function _orgContext(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extractToken(req);

  if (token) {
    // 1. Per-session token — checks memory cache then DB (survives restarts)
    const session = await getSession(token);
    if (session) {
      req.orgId      = session.orgId;
      req.userId     = session.userId;
      req.orgContext = {
        orgId:  session.orgId,
        userId: session.userId,
        email:  session.email,
        role:   session.role,
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

    logger.debug({ url: req.url }, "[OrgContext] Unrecognised token — anonymous context");
  }

  // 3. Anonymous / unauthenticated
  req.orgId      = "default";
  req.userId     = undefined;
  req.orgContext = { orgId: "default" };
  next();
}
