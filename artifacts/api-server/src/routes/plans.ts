import { Router, type Request, type Response } from "express";
import {
  ADDON_DEFINITIONS,
  PLAN_DEFINITIONS,
  PLAN_INCLUDED_ADDONS,
  QTY_ADDONS,
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

  const addons = Object.entries(ADDON_DEFINITIONS).map(([key, def]) => ({
    key,
    name:        def.name,
    category:    def.category,
    description: def.description,
    priceEur:    def.priceEur,
    priceMinor:  Math.round(def.priceEur * 100),
    oneTime:     def.oneTime,
    quantity:    def.quantity || QTY_ADDONS.has(key),
  }));

  const includedByPlan = Object.fromEntries(
    Object.keys(PLAN_DEFINITIONS).map(planId => [
      planId,
      [...(PLAN_INCLUDED_ADDONS[planId] ?? new Set<string>())],
    ])
  );

  res.json({ catalogVersion: 1, currency: "EUR", plans, addons, includedByPlan });
});

export default router;
