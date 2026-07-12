import { Router, type Request, type Response } from "express";
import { PLAN_DEFINITIONS } from "../lib/plans.js";

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

export default router;
