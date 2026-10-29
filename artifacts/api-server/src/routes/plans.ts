import { Router, type Request, type Response } from "express";
import {
  ADDON_DEFINITIONS,
  PLAN_DEFINITIONS,
  PLAN_INCLUDED_ADDONS,
  QTY_ADDONS,
  getAddonAvailability,
  getAddonPurchaseStatus,
  getAddonPurchasablePlans,
  REMOVED_ADDONS,
  RETIRED_ADDONS,
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
// Public, canonical catalogue: every sellable add-on and the plan-inclusion
// matrix. Some includedAddons are retired/internal entitlements and therefore
// intentionally have no matching entry in the commercial `addons` array.
// Amounts are in minor EUR units; billable totals come from POST /api/billing/quote.
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

  const addons = Object.entries(ADDON_DEFINITIONS)
    .filter(([key]) => !REMOVED_ADDONS.has(key) && !RETIRED_ADDONS.has(key))
    .map(([key, def]) => {
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
      purchaseStatus: getAddonPurchaseStatus(key),
      comingSoon:    availability === "coming_soon",
      beta:          availability === "beta",
      allowedPlans:  getAddonPurchasablePlans(key),
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
