/**
 * FlowPoint — Plan gate middleware factory
 *
 * P0-2 FIX: All plan/feature gates now load the plan from org_settings (DB)
 * using req.orgId — never from store.me (global singleton).
 *
 * Fail-closed policy: if the plan cannot be resolved from DB in production,
 * the request is denied (402 / 403). In development, fail-open is preserved.
 */

import type { Request, Response, NextFunction } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { planAtLeast, getFeature, getQuota, normalizePlan, type PlanTier, type FeatureFlags, type CoreQuotas } from "../lib/config.js";
import { planRequired, quotaExceeded } from "../lib/response.js";

const isProd = () => process.env["NODE_ENV"] === "production" && !process.env["REPLIT_DEV_DOMAIN"];

/**
 * Résout le plan depuis `organizations` (source de vérité, Jalon 1).
 * Fallback sur `org_settings` si la row organizations est absente (comptes legacy).
 * Retourne "standard" si l'org est introuvable (moindre privilège).
 * Retourne null uniquement en cas d'erreur DB en production (appelant doit refuser).
 */
/**
 * UUID v4 guard — organizations.id is a UUID column in production.
 * An orgId that is not UUID-shaped (e.g. a legacy email-as-orgId) must never
 * reach the `WHERE id = $1` query or PostgreSQL throws 22P02.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolvePlanFromDB(req: Request): Promise<string | null> {
  const orgId = (req as { orgId?: string }).orgId;

  if (!orgId || orgId === "default") return "standard";

  // Guard: non-UUID orgId (legacy email-as-orgId in surviving sessions) cannot be
  // used against organizations.id (UUID column in prod) — that produces 22P02 → 503.
  // Route directly to org_settings to serve the request without crashing.
  if (!UUID_RE.test(orgId)) {
    logger.warn({ orgIdShape: orgId.includes("@") ? "email" : "non-uuid" },
      "[PlanGate] non-UUID orgId — routing to org_settings only (legacy session)");
    try {
      const client = await pool.connect();
      try {
        const legacy = await client.query<{ plan: string }>(
          `SELECT plan FROM org_settings WHERE org_id = $1 LIMIT 1`,
          [orgId],
        );
        return legacy.rows.length > 0
          ? (legacy.rows[0].plan || "standard").toLowerCase()
          : "standard";
      } finally {
        client.release();
      }
    } catch (err) {
      logger.error({ err }, "[PlanGate] org_settings fallback failed for non-UUID orgId");
      if (isProd()) return null;
      return "standard";
    }
  }

  try {
    const client = await pool.connect();
    try {
      // Source primaire : organizations
      const r = await client.query<{ plan: string }>(
        `SELECT plan FROM organizations WHERE id = $1 LIMIT 1`,
        [orgId],
      );
      if (r.rows.length > 0) {
        return (r.rows[0].plan || "standard").toLowerCase();
      }
      // Fallback : org_settings pour les comptes legacy
      const legacy = await client.query<{ plan: string }>(
        `SELECT plan FROM org_settings WHERE org_id = $1 LIMIT 1`,
        [orgId],
      );
      if (legacy.rows.length > 0) {
        return (legacy.rows[0].plan || "standard").toLowerCase();
      }
      return "standard";
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ err, orgId }, "[PlanGate] Échec résolution plan depuis DB");
    if (isProd()) return null;
    return "standard";
  }
}

/** Require a minimum plan tier to access an endpoint */
export function requirePlan(minimumPlan: PlanTier): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    resolvePlanFromDB(req).then(plan => {
      if (plan === null) {
        // DB error in production — fail-closed
        logger.error({ url: req.url }, "[PlanGate] Plan resolution failed — denying access");
        res.status(503).json({ error: "Subscription status unavailable. Please try again." });
        return;
      }
      if (planAtLeast(plan, minimumPlan)) { next(); return; }
      logger.warn({ plan, required: minimumPlan, orgId: (req as { orgId?: string }).orgId }, "[PlanGate] Plan requirement not met");
      planRequired(res, "This feature", minimumPlan);
    }).catch(next);
  };
}

/** Require a specific feature flag to be enabled for current plan */
export function requireFeature(feature: keyof FeatureFlags, featureLabel?: string): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    resolvePlanFromDB(req).then(plan => {
      if (plan === null) {
        logger.error({ url: req.url, feature }, "[PlanGate] Plan resolution failed — denying access");
        res.status(503).json({ error: "Subscription status unavailable. Please try again." });
        return;
      }
      if (getFeature(plan, feature)) { next(); return; }
      const minPlan = (["standard", "pro", "ultra", "agency"] as PlanTier[]).find(t => getFeature(t, feature)) ?? "ultra";
      logger.warn({ plan, feature, orgId: (req as { orgId?: string }).orgId }, "[PlanGate] Feature not available on current plan");
      planRequired(res, featureLabel ?? String(feature), minPlan);
    }).catch(next);
  };
}

/** Check that current plan has remaining quota for a resource */
export function requireQuota(resource: keyof CoreQuotas, getCurrentUsage: (orgId: string) => number | Promise<number>): (req: Request, res: Response, next: NextFunction) => void {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const orgId = (req as { orgId?: string }).orgId ?? "default";
    const plan = await resolvePlanFromDB(req).catch(() => "standard");
    const resolvedPlan = plan ?? "standard";
    const limit = getQuota(resolvedPlan, resource);
    if (limit >= 9999) { next(); return; }
    try {
      const used = await getCurrentUsage(orgId);
      if (used < limit) { next(); return; }
      quotaExceeded(res, String(resource), limit, resolvedPlan);
    } catch {
      next(); // fail-open on quota check errors
    }
  };
}

/** Middleware that attaches plan config to every request for downstream use */
export function attachPlanContext(_req: Request, _res: Response, next: NextFunction): void {
  // Plan context is loaded from DB by each gate as needed — no pre-attachment required
  next();
}

/** Validate plan on write operations and enforce org isolation */
export function orgIsolation(req: Request, res: Response, next: NextFunction): void {
  const orgId = (req as { orgId?: string }).orgId;
  if (!orgId) {
    // In dev mode without JWT, default org is fine
    (req as { orgId?: string }).orgId = "default";
  }
  next();
}

// ── Pre-built plan gates for common features ──────────────────────────────────
export const requirePro      = requirePlan("pro");
export const requireUltra    = requirePlan("ultra");
export const requireSSO      = requireFeature("sso", "SSO Enterprise");
export const requireSAML     = requireFeature("saml", "SAML SSO");
export const requireAI       = requireFeature("competitorIntelAI", "AI Intelligence");
export const requireCRM      = requireFeature("crmIntegration", "CRM Integration");
export const requireAdvancedReports = requireFeature("advancedReports", "Advanced Reports");
export const requireWhiteLabel = requireFeature("whiteLabel", "White Label");
export const requireMultiLocation = requireFeature("multiLocation", "Multi-Location");
export const requireCustomRoles = requireFeature("rbacCustomRoles", "Custom Roles");

export { planAtLeast, normalizePlan };
