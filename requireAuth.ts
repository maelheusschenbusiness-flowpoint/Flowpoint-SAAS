import { type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger.js";

const MISSING_KEY_WARNING_SHOWN = { shown: false };

/**
 * Authentication middleware that validates requests against a shared API secret.
 *
 * The secret is read from the API_SECRET_KEY environment variable.
 * Clients must supply it via one of:
 *   Authorization: Bearer <secret>
 *   X-Api-Key: <secret>
 *
 * If API_SECRET_KEY is not set, requests are blocked in production and allowed
 * through in development (with a one-time warning logged).
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env["API_SECRET_KEY"];
  const isProduction = process.env["NODE_ENV"] === "production";

  if (!secret) {
    if (isProduction) {
      logger.error("[Auth] API_SECRET_KEY is not set — all management requests are being rejected");
      res.status(503).json({ error: "Authentication unavailable: server is not configured" });
      return;
    }
    if (!MISSING_KEY_WARNING_SHOWN.shown) {
      logger.warn(
        "[Auth] API_SECRET_KEY is not set. Authentication is disabled in development mode. " +
        "Set API_SECRET_KEY to enable it.",
      );
      MISSING_KEY_WARNING_SHOWN.shown = true;
    }
    next();
    return;
  }

  const authHeader = req.headers["authorization"];
  const apiKeyHeader = req.headers["x-api-key"];

  let provided: string | undefined;

  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    provided = authHeader.slice(7).trim();
  } else if (typeof apiKeyHeader === "string") {
    provided = apiKeyHeader.trim();
  }

  if (!provided) {
    logger.warn({ method: req.method, url: req.url }, "[Auth] Request rejected: no credentials");
    res.status(401).json({ error: "Unauthorized: missing credentials" });
    return;
  }

  if (provided !== secret) {
    logger.warn({ method: req.method, url: req.url }, "[Auth] Request rejected: invalid credentials");
    res.status(401).json({ error: "Unauthorized: invalid credentials" });
    return;
  }

  next();
}
