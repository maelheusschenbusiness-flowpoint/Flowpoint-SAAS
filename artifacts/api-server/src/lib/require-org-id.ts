import type { Request, Response } from "express";

/**
 * Extract and validate the authenticated org ID from a request.
 *
 * Returns the org ID string when it is non-empty and not the reserved
 * sentinel value "default".  Otherwise writes a 401 JSON response and
 * returns null so the caller can do:
 *
 *   const orgId = requireOrgId(req, res);
 *   if (!orgId) return;
 */
export function requireOrgId(req: Request, res: Response): string | null {
  const orgId = req.orgContext?.orgId;
  if (!orgId || orgId === "default") {
    res.status(401).json({ error: "Unauthorized: no valid organization context" });
    return null;
  }
  return orgId;
}
