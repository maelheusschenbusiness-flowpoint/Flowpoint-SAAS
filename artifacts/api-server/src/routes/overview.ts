import { Router, type Request, type Response } from "express";
import { getOverviewMetrics } from "../services/overview-service.js";
import { pool } from "@workspace/db";

const router = Router();

// ── Range label parsing ─────────────────────────────────────────────────────
const RANGE_MAP: Record<string, number> = {
  today: 1,
  "1d":  1,
  "3d":  3,
  "7d":  7,
  "30d": 30,
};

/**
 * Parse ?range from query string.
 * Accepts string labels (today, 3d, 7d, 30d) or plain integers (1, 3, 7, 30).
 * Returns { days: number, label: string } or { error } for invalid input.
 */
function parseRange(raw: string | undefined): { days: number; label: string } | { error: true } {
  if (!raw) return { days: 30, label: "30d" };

  // String label (today, 3d, 7d, 30d)
  if (raw in RANGE_MAP) return { days: RANGE_MAP[raw]!, label: raw };

  // Pure integer fallback (legacy / direct API calls)
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 30) {
    const label = n === 1 ? "today" : `${n}d`;
    return { days: n, label };
  }

  return { error: true };
}

// ── GET /overview — aggregate metrics for the Overview dashboard page ─────────
router.get("/overview", async (req: Request, res: Response) => {
  try {
    const orgId = (req as unknown as { orgContext?: { orgId?: string }; orgId?: string })
      .orgContext?.orgId ?? (req as unknown as { orgId?: string }).orgId ?? "default";

    const parsed = parseRange(req.query["range"] as string | undefined);
    if ("error" in parsed) {
      res.status(400).json({
        error: "Invalid range parameter",
        code: "INVALID_RANGE",
        allowed: ["today", "3d", "7d", "30d"],
        received: req.query["range"],
      });
      return;
    }

    const metrics = await getOverviewMetrics(orgId, parsed.days, parsed.label);
    res.setHeader("Cache-Control", "private, max-age=60, stale-while-revalidate=30");
    res.json(metrics);
  } catch {
    res.status(500).json({ error: "Failed to compute overview metrics" });
  }
});

// ── GET /overview/checklist — load persisted checklist items and extra state ─
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
      res.json({
        items: result.rows[0].items ?? null,
        extra: result.rows[0].extra ?? null,
      });
    }
  } catch {
    res.status(500).json({ error: "Failed to fetch checklist" });
  }
});

// ── PUT /overview/checklist — persist checklist state server-side ─────────────
// Accepts either:
//   { completedItems: string[] }  — IDs of completed items (shorthand contract)
//   { items: any[], extra: object } — full checklist + extra categories state
router.put("/overview/checklist", async (req: Request, res: Response) => {
  try {
    const orgId = (req as unknown as { orgContext?: { orgId?: string }; orgId?: string })
      .orgContext?.orgId ?? (req as unknown as { orgId?: string }).orgId ?? "default";

    let { items, extra, completedItems } = req.body as {
      items?: unknown[] | null;
      extra?: Record<string, boolean> | null;
      completedItems?: string[] | null;
    };

    // Support shorthand: completedItems → extra map  { id → true }
    if (Array.isArray(completedItems) && items == null && extra == null) {
      extra = Object.fromEntries(completedItems.map((id) => [id, true]));
    }

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
