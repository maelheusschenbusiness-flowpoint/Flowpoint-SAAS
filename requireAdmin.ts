import { type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger.js";

/**
 * Authorization middleware — requires the authenticated caller to hold an
 * admin-level role.
 *
 * Must be applied after requireAuth. The role is set by orgContext from the
 * verified session; callers who authenticated via:
 *   - A per-session token:  role is the value stored in the session
 *   - The API_SECRET_KEY:   role is 'admin' (service credential)
 *   - No valid credential:  role is undefined → this middleware rejects them
 *
 * Protected routes: SSO configuration, integrations, permissions management,
 * and connector write operations — all of which expose or modify sensitive
 * secrets, identity-provider settings, and cross-tenant data.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const role = req.orgContext?.role;
  if (role === "admin" || role === "owner" || role === "service") {
    next();
    return;
  }
  logger.warn({ method: req.method, url: req.url, role }, "[Auth] Admin access denied");
  res.status(403).json({ error: "Forbidden: admin access required" });
}
