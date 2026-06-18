import { type Request, type Response, type NextFunction } from "express";
import { getSession } from "../services/sessions.js";
import { logger } from "../lib/logger.js";

const MISSING_KEY_WARNING_SHOWN = { shown: false };

/**
 * Authentication middleware (async — checks memory cache then DB).
 *
 * Accepts two kinds of credentials:
 *   1. A per-session token issued at login (src/services/sessions.ts).
 *      Unique per login, bound to a specific user, individually revocable.
 *      Survives server restarts (persisted in PostgreSQL).
 *   2. The API_SECRET_KEY, used as a server-to-server service credential.
 *      Never sent to browser clients.
 *
 * Credentials may be supplied via:
 *   Authorization: Bearer <token>
 *   X-Api-Key: <token>
 *   fp_token cookie (HttpOnly)
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  _requireAuth(req, res, next).catch(next);
}

async function _requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const serviceSecret = process.env["API_SECRET_KEY"];
  const isProduction  = process.env["NODE_ENV"] === "production";

  const authHeader   = req.headers["authorization"];
  const apiKeyHeader = req.headers["x-api-key"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cookieToken  = (req as any).cookies?.fp_token;

  let provided: string | undefined;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    provided = authHeader.slice(7).trim();
  } else if (typeof apiKeyHeader === "string") {
    provided = apiKeyHeader.trim();
  } else if (typeof cookieToken === "string") {
    provided = cookieToken.trim();
  }

  if (!provided) {
    if (!serviceSecret && !isProduction) {
      if (!MISSING_KEY_WARNING_SHOWN.shown) {
        logger.warn("[Auth] API_SECRET_KEY not set. Auth is disabled in development.");
        MISSING_KEY_WARNING_SHOWN.shown = true;
      }
      next();
      return;
    }
    logger.warn({ method: req.method, url: req.url }, "[Auth] Request rejected: no credentials");
    res.status(401).json({ error: "Unauthorized: missing credentials" });
    return;
  }

  // Accept a valid per-session token (checks memory cache, then DB)
  const session = await getSession(provided);
  if (session) {
    next();
    return;
  }

  // Accept the API_SECRET_KEY as a service credential
  if (serviceSecret && provided === serviceSecret) {
    next();
    return;
  }

  if (!serviceSecret) {
    if (isProduction) {
      logger.error("[Auth] API_SECRET_KEY is not set — all management requests are being rejected");
      res.status(503).json({ error: "Authentication unavailable: server is not configured" });
      return;
    }
    if (!MISSING_KEY_WARNING_SHOWN.shown) {
      logger.warn("[Auth] API_SECRET_KEY not set. Auth is disabled in development.");
      MISSING_KEY_WARNING_SHOWN.shown = true;
    }
    next();
    return;
  }

  logger.warn({ method: req.method, url: req.url }, "[Auth] Request rejected: invalid credentials");
  res.status(401).json({ error: "Unauthorized: invalid credentials" });
}
