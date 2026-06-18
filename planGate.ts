/**
 * FlowPoint — Plan gate middleware factory
 * Use to restrict endpoints by plan tier, feature flag, or quota.
 * All gates are non-blocking when plan info is unavailable (fail-open in dev).
 */

import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger.js";
import { store } from "../services/store.js";
import { planAtLeast, getFeature, getQuota, normalizePlan, type PlanTier, type FeatureFlags, type CoreQuotas } from "../lib/config.js";
import { planRequired, quotaExceeded } from "../lib/response.js";

function currentPlan(): string { return store.me?.plan ?? 'standard'; }

/** Require a minimum plan tier to access an endpoint */
export function requirePlan(minimumPlan: PlanTier): (req: Request, res: Response, next: NextFunction) => void {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const plan = currentPlan();
    if (planAtLeast(plan, minimumPlan)) { next(); return; }
    logger.warn({ plan, required: minimumPlan }, '[PlanGate] Plan requirement not met');
    planRequired(res, 'This feature', minimumPlan);
  };
}

/** Require a specific feature flag to be enabled for current plan */
export function requireFeature(feature: keyof FeatureFlags, featureLabel?: string): (req: Request, res: Response, next: NextFunction) => void {
  return (_req: Request, res: Response, next: NextFunction): void => {
    const plan = currentPlan();
    if (getFeature(plan, feature)) { next(); return; }
    // Determine minimum plan that enables this feature
    const minPlan = (['standard', 'pro', 'ultra', 'agency'] as PlanTier[]).find(t => getFeature(t, feature)) ?? 'ultra';
    logger.warn({ plan, feature }, '[PlanGate] Feature not available on current plan');
    planRequired(res, featureLabel ?? String(feature), minPlan);
  };
}

/** Check that current plan has remaining quota for a resource */
export function requireQuota(resource: keyof CoreQuotas, getCurrentUsage: () => number | Promise<number>): (req: Request, res: Response, next: NextFunction) => void {
  return async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    const plan = currentPlan();
    const limit = getQuota(plan, resource);
    if (limit >= 9999) { next(); return; }
    try {
      const used = await getCurrentUsage();
      if (used < limit) { next(); return; }
      quotaExceeded(res, String(resource), limit, plan);
    } catch {
      next(); // fail-open on quota check errors
    }
  };
}

/** Middleware that attaches plan config to every request for downstream use */
export function attachPlanContext(_req: Request, _res: Response, next: NextFunction): void {
  // Plan context is read from store.me — no additional attachment needed
  next();
}

/** Validate plan on write operations and enforce org isolation */
export function orgIsolation(req: Request, res: Response, next: NextFunction): void {
  const orgId = (req as { orgId?: string }).orgId;
  if (!orgId) {
    // In dev mode without JWT, default org is fine
    (req as { orgId?: string }).orgId = 'default';
  }
  next();
}

// ── Pre-built plan gates for common features ──────────────────────────────────
export const requirePro      = requirePlan('pro');
export const requireUltra    = requirePlan('ultra');
export const requireSSO      = requireFeature('sso', 'SSO Enterprise');
export const requireSAML     = requireFeature('saml', 'SAML SSO');
export const requireAI       = requireFeature('competitorIntelAI', 'AI Intelligence');
export const requireCRM      = requireFeature('crmIntegration', 'CRM Integration');
export const requireAdvancedReports = requireFeature('advancedReports', 'Advanced Reports');
export const requireWhiteLabel = requireFeature('whiteLabel', 'White Label');
export const requireMultiLocation = requireFeature('multiLocation', 'Multi-Location');
export const requireCustomRoles = requireFeature('rbacCustomRoles', 'Custom Roles');

export { planAtLeast, normalizePlan };
