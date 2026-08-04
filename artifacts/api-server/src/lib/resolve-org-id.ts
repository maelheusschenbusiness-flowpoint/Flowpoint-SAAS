/**
 * resolve-org-id.ts — Single source of truth for extracting orgId from an
 * authenticated Express request.
 *
 * Rules:
 *   1. Prefer req.orgContext?.orgId (set by orgContext middleware from session).
 *   2. Fall back to req.orgId (set by orgContext middleware, same value, kept for compat).
 *   3. Never fall back to "default" — that would silently bucket all unauthenticated
 *      requests into the same org, corrupting multi-tenant data.
 *   4. Throw a tagged error (status 401) if no org can be resolved so callers return 401.
 *
 * Usage:
 *   import { resolveOrgId } from "../lib/resolve-org-id.js";
 *   const orgId = resolveOrgId(req);   // throws 401 if absent
 */

import { type Request } from "express";

export function resolveOrgId(req: Request): string {
  const orgId = req.orgContext?.orgId ?? req.orgId;
  if (!orgId || orgId === "default") {
    const err = new Error("Authenticated org context required");
    (err as Error & { status: number }).status = 401;
    throw err;
  }
  return orgId;
}
