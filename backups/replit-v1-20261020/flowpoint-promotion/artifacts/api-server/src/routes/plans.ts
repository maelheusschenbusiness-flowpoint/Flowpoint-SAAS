import { Router, type Request, type Response } from "express";
import {
  ADDON_DEFINITIONS,
  PLAN_DEFINITIONS,
  PLAN_INCLUDED_ADDONS,
  PLAN_ALLOWED_ADDONS,
  QTY_ADDONS,
  getAddonAvailability,
} from "../lib/plans.js";

const router = Router();

// ── GET /api/plans/definitions ──────────────────────────────────────────────────────────────
// Public endpoint — returns the canonical plan definitions without Stripe IDs.
// All frontend surfaces (dashboard, pricing.html) read from here.
router.get("/plans/definitions", (_req: Request, res: Response): void => {
  const defs = Object.fromEntries(
    Object.entries(PLAN_DEFINITIONS).map(([key, def]) => [
      key,
      {
        id:          def.id,
        name:        def.name,
        priceEur:    def.priceEur,
        badge:       def.badge,
        tagline:     def.tagline,
        limits:      def.limits,
        aiCredits:   def.aiCredits,
        aiTokens:    def.aiTokens,
        features:    def.features,
        locked:      def.locked,
      },
    ])
  );
  res.json(defs);
});

// ── GET /api/plans/catalog ───────────────────────────────────────────────────
// Public, canonical catalogue: every plan, every add-on, and the plan-inclusion
// matrix. This is the ONLY place a browser may learn a name, a price or whether
// an add-on is bundled. Amounts are in minor EUR units so no surface has to do
// float arithmetic; billable totals still come from POST /api/billing/quote.
router.get("/plans/catalog", (_req: Request, res: Response): void => {
  const plans = Object.values(PLAN_DEFINITIONS).map(def => ({
    id:              def.id,
    name:            def.name,
    priceEur:        def.priceEur,
    priceMinor:      Math.round(def.priceEur * 100),
    badge:           def.badge,
    tagline:         def.tagline,
    limits:          def.limits,
    aiCredits:       def.aiCredits,
    aiTokens:        def.aiTokens,
    features:        def.features,
    locked:          def.locked,
    includedAddons:  [...(PLAN_INCLUDED_ADDONS[def.id] ?? new Set<string>())],
  }));

  // Build allowedPlans lookup: for each addon, which plans permit purchasing it.
  const _addonAllowedPlans: Record<string, string[]> = {};
  for (const [planId, allowed] of Object.entries(PLAN_ALLOWED_ADDONS)) {
    if (!["standard", "pro", "ultra"].includes(planId)) continue;
    for (const addonKey of allowed) {
      if (!_addonAllowedPlans[addonKey]) _addonAllowedPlans[addonKey] = [];
      _addonAllowedPlans[addonKey]!.push(planId);
    }
  }

  const addons = Object.entries(ADDON_DEFINITIONS).map(([key, def]) => {
    const availability = getAddonAvailability(key);
    return {
      key,
      name:          def.name,
      category:      def.category,
      description:   def.description,
      priceEur:      def.priceEur,
      priceMinor:    Math.round(def.priceEur * 100),
      oneTime:       def.oneTime,
      quantity:      def.quantity || QTY_ADDONS.has(key),
      availability,
      status:        availability,
      comingSoon:    availability === "coming_soon",
      beta:          availability === "beta",
      allowedPlans:  availability === "coming_soon" ? [] : (_addonAllowedPlans[key] ?? []),
      includedByPlan: Object.fromEntries(
        Object.entries(PLAN_INCLUDED_ADDONS)
          .filter(([, set]) => set.has(key))
          .map(([planId]) => [planId, true])
      ),
    };
  });

  const includedByPlan = Object.fromEntries(
    Object.keys(PLAN_DEFINITIONS).map(planId => [
      planId,
      [...(PLAN_INCLUDED_ADDONS[planId] ?? new Set<string>())],
    ])
  );

  res.json({ catalogVersion: 1, currency: "EUR", plans, addons, includedByPlan });
});

export default router;
