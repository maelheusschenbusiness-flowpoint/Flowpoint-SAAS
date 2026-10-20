import { type Request, type Response, type NextFunction } from "express";
import { logger } from "../lib/logger.js";
import { resolveEnterprisePermission, requestPermission } from "../services/enterprise-permission-engine.js";

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
      // Owner/admin boundaries remain fixed. Enterprise roles refine access
      // only for member/viewer callers on resource routes covered by the matrix.
      if (role === "owner" || role === "admin") { next(); return; }
    }
    const permission = requestPermission(req.method, req.originalUrl || req.url);
    const identity = req.orgContext as (typeof req.orgContext & { userId?: string }) | undefined;
    const orgId = (req as Request & { orgId?: string }).orgId;
    const plan = (req as Request & { me?: { plan?: string } }).me?.plan;
    if (permission && (role === "member" || role === "viewer") && allowedRoles.includes("member")) {
      if (!orgId || !identity?.userId) {
        res.status(503).json({ error: "Permission identity unavailable. Please try again." });
        return;
      }
      void resolveEnterprisePermission(orgId, identity.userId, plan, permission.resource, permission.action)
        .then(decision => {
          if (decision === true) { next(); return; }
          if (decision === false) {
            res.status(403).json({ error: "Forbidden: enterprise role does not allow this action", resource: permission.resource, action: permission.action });
            return;
          }
          if (allowedRoles.includes(role)) { next(); return; }
          denyRole(req, res, role, allowedRoles);
        })
        .catch(err => {
          logger.error({ err, orgId, userId: identity.userId }, "[RBAC] Enterprise permission lookup failed");
          res.status(503).json({ error: "Permission status unavailable. Please try again." });
        });
      return;
    }
    if (role === "service" || allowedRoles.includes(role)) { next(); return; }
    denyRole(req, res, role, allowedRoles);
  };
}

function denyRole(req: Request, res: Response, role: string, allowedRoles: string[]): void {
    logger.warn(
      { method: req.method, url: req.url, role, required: allowedRoles },
      "[RBAC] Access denied — insufficient role"
    );
    res.status(403).json({
      error: `Forbidden: requires one of [${allowedRoles.join(", ")}]`,
      yourRole: role,
    });
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
