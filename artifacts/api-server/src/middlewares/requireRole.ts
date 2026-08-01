import { type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger.js";

/**
 * Role hierarchy (higher = more privileged).
 * service is the internal API_SECRET_KEY credential — always allowed.
 */
const ROLE_RANK: Record<string, number> = {
  service: 100,
  owner:    80,
  admin:    60,
  member:   40,
  viewer:   20,
};

/**
 * Returns a middleware that allows only callers whose role is in `allowedRoles`.
 *
 * Must be applied after requireAuth + orgContext (so req.orgContext.role is set).
 *
 * - 401 if the caller has no role (unauthenticated / no session).
 * - 403 if the caller's role is not in the allowed list.
 *
 * @example
 *   router.post("/monitors", requireRole(["owner","admin","member"]), handler);
 *   router.post("/billing/portal", requireRole(["owner"]), handler);
 */
export function requireRole(allowedRoles: string[]): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = req.orgContext?.role;
    if (!role) {
      res.status(401).json({ error: "Unauthorized: authentication required" });
      return;
    }
    // service credential bypasses all role checks
    if (role === "service" || allowedRoles.includes(role)) {
      next();
      return;
    }
    logger.warn(
      { method: req.method, url: req.url, role, required: allowedRoles },
      "[RBAC] Access denied — insufficient role"
    );
    res.status(403).json({
      error: `Forbidden: requires one of [${allowedRoles.join(", ")}]`,
      yourRole: role,
    });
  };
}

// ── Convenience role guards aligned with the spec permission matrix ────────────

/** owner · admin · member — can create/edit regular resources (monitors, alerts, reports…) */
export const canWrite  = requireRole(["owner", "admin", "member"]);

/** owner · admin — can manage sensitive resources (team, integrations, SSO…) */
export const canAdmin  = requireRole(["owner", "admin"]);

/** owner only — billing management, org deletion */
export const ownerOnly = requireRole(["owner"]);

/** owner · admin — can delete calendar events (calendar.delete permission) */
export const canDelete = requireRole(["owner", "admin"]);
