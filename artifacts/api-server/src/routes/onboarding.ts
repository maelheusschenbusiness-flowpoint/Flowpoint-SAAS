/**
 * Onboarding routes — Beta guided-tour persistence
 *
 * POST /api/onboarding/complete   → marks the org as having completed/skipped the guided tour
 * GET  /api/onboarding/status     → returns { completed, completedAt }
 *
 * Stored inside user_prefs.settings JSONB (no ALTER TABLE required).
 * These endpoints never touch billing, subscriptions, plans, or auth.
 */
import { Router, type Request, type Response } from "express";
import { requireOrgId } from "../lib/require-org-id.js";
import { logger } from "../lib/logger.js";

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
};
const orgDb = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

const router = Router();

// ── GET /api/onboarding/status ─────────────────────────────────────────────
router.get("/onboarding/status", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  try {
    const r = await orgDb(req)(`SELECT settings->>'onboardingCompletedAt' AS cat FROM user_prefs WHERE org_id=$1`, [orgId]);
    const completedAt = (r.rows[0]?.["cat"] as string | null) ?? null;
    res.json({ completed: !!completedAt, completedAt });
  } catch (err) {
    logger.warn({ err }, "[onboarding] status check failed — returning not-completed");
    res.json({ completed: false, completedAt: null });
  }
});

// ── POST /api/onboarding/complete ──────────────────────────────────────────
router.post("/onboarding/complete", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  const now = new Date().toISOString();
  try {
    await orgDb(req)(`
      INSERT INTO user_prefs (org_id, settings, updated_at)
      VALUES ($1, jsonb_build_object('onboardingCompletedAt', $2::text), now())
      ON CONFLICT (org_id) DO UPDATE
        SET settings    = COALESCE(user_prefs.settings, '{}'::jsonb)
                          || jsonb_build_object('onboardingCompletedAt', $2::text),
            updated_at  = now()
    `, [orgId, now]);
    res.json({ ok: true, completedAt: now });
  } catch (err) {
    // Never block the user — graceful failure; client still closes the modal.
    logger.warn({ err }, "[onboarding] failed to persist completion — client continues");
    res.json({ ok: false });
  }
});

export default router;
