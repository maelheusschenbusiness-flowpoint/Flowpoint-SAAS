import { Router, type Request, type Response } from "express";
import { getOverviewMetrics } from "../services/overview-service.js";
import { pool } from "@workspace/db";

const router = Router();

// ── GET /overview — aggregate metrics for the Overview dashboard page ─────────
// ?range=N: filter time-based metrics to last N days (1 | 3 | 7 | 30, default 30)
router.get("/overview", async (req: Request, res: Response) => {
  try {
    const orgId = (req as unknown as { orgContext?: { orgId?: string }; orgId?: string })
      .orgContext?.orgId ?? (req as unknown as { orgId?: string }).orgId ?? "default";
    const rangeRaw = parseInt(req.query["range"] as string);
    const range = Number.isFinite(rangeRaw) ? Math.min(30, Math.max(1, rangeRaw)) : 30;
    const metrics = await getOverviewMetrics(orgId, range);
    res.setHeader("Cache-Control", "private, max-age=60, stale-while-revalidate=30");
    res.json(metrics);
  } catch {
    res.status(500).json({ error: "Failed to compute overview metrics" });
  }
});

// ── GET /overview/checklist — load persisted checklist + extra categories ─────
router.get("/overview/checklist", async (req: Request, res: Response) => {
  try {
    const orgId = (req as unknown as { orgContext?: { orgId?: string }; orgId?: string })
      .orgContext?.orgId ?? (req as unknown as { orgId?: string }).orgId ?? "default";
    const result = await pool.query(
      `SELECT items, extra FROM org_checklist WHERE org_id = $1`,
      [orgId]
    );
    if (result.rows.length === 0) {
      res.json({ items: null, extra: null });
    } else {
      res.json({ items: result.rows[0].items ?? null, extra: result.rows[0].extra ?? null });
    }
  } catch {
    res.status(500).json({ error: "Failed to fetch checklist" });
  }
});

// ── PUT /overview/checklist — persist checklist state server-side ─────────────
// Body: { items?: array, extra?: object }  — null fields are left unchanged
router.put("/overview/checklist", async (req: Request, res: Response) => {
  try {
    const orgId = (req as unknown as { orgContext?: { orgId?: string }; orgId?: string })
      .orgContext?.orgId ?? (req as unknown as { orgId?: string }).orgId ?? "default";
    const { items, extra } = req.body as {
      items?: unknown[] | null;
      extra?: Record<string, boolean> | null;
    };
    await pool.query(
      `INSERT INTO org_checklist (org_id, items, extra, updated_at)
       VALUES ($1, $2::jsonb, $3::jsonb, NOW())
       ON CONFLICT (org_id) DO UPDATE SET
         items      = CASE WHEN $2 IS NOT NULL THEN $2::jsonb ELSE org_checklist.items END,
         extra      = CASE WHEN $3 IS NOT NULL THEN $3::jsonb ELSE org_checklist.extra END,
         updated_at = NOW()`,
      [
        orgId,
        items != null ? JSON.stringify(items) : null,
        extra != null ? JSON.stringify(extra) : null,
      ]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to save checklist" });
  }
});

export default router;
