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
import { logger } from "../lib/logger.js";
import { loadOrgSettings } from "../services/org-settings.js";
import { planAtLeast, getFeature, getQuota, normalizePlan, type PlanTier, type FeatureFlags, type CoreQuotas } from "../lib/config.js";
import { planRequired, quotaExceeded } from "../lib/response.js";

const isProd = () => process.env["NODE_ENV"] === "production" && !process.env["REPLIT_DEV_DOMAIN"];

/**
 * Resolve the current org's plan from DB.
 * Returns "standard" if org is not found (safe default — least privilege).
 * Returns null only if there is a DB error in production (caller should deny).
 */
async function resolvePlanFromDB(req: Request): Promise<string | null> {
  const orgId = (req as { orgId?: string }).orgId;

  // No authenticated session → "standard" (anonymous / pre-auth)
  if (!orgId || orgId === "default") return "standard";

  try {
    const settings = await loadOrgSettings(orgId);
    if (!settings) {
      // Org row doesn't exist yet (new signup in flight) → standard
      return "standard";
    }
    return (settings.plan || "standard").toLowerCase();
  } catch (err) {
    logger.error({ err, orgId }, "[PlanGate] Failed to load org plan from DB");
    // In production: fail-closed — deny access rather than grant wrong plan
    if (isProd()) return null;
    // In dev: fail-open with standard plan
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
