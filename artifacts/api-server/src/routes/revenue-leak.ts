import { Router, type Request, type Response } from "express";
import { requireAddon } from "../middlewares/planGate.js";
import { deriveConversionObservations } from "../services/conversion-observations.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const db = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

// Gate scoped to /revenue-leak/* only — path-less router.use() would intercept every route
// mounted after this router in index.ts (same catch-all pattern as behavioral.ts).
router.use("/revenue-leak", requireAddon("revenueLeak", "Revenue Leak AI"));

async function loadRevenueOpportunities(req: Request, siteUrl?: string) {
  const orgId = (req as OrgReq).orgId ?? "default";
  const params: unknown[] = [orgId];
  let siteClause = "";
  if (siteUrl) {
    params.push(siteUrl);
    siteClause = " AND site_url = $2";
  }
  const { rows } = await db(req)(
    `SELECT page, session_id, event_type, scroll_depth
       FROM behavior_events
      WHERE org_id = $1${siteClause}
        AND created_at >= now() - interval '30 days'
      ORDER BY created_at DESC
      LIMIT 20000`,
    params,
  );
  return deriveConversionObservations(rows).map((observation) => ({
    ...observation,
    kind: "conversion_opportunity",
    financialClassification: "unmeasured",
    observedRevenueLoss: null,
    estimatedRevenueLoss: null,
    note: "Événements observés; aucune donnée de revenu reliée à ces événements.",
  }));
}

async function assertSiteOwnership(req: OrgReq, siteUrl: string, res: Response): Promise<boolean> {
  const orgId = req.orgId ?? "default";
  try {
    const { rows } = await req.orgDb(
      `SELECT 1 FROM behavior_site_tokens WHERE org_id = $1 AND site_url = $2 LIMIT 1`,
      [orgId, siteUrl]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "Site not found" });
      return false;
    }
    return true;
  } catch {
    res.status(404).json({ error: "Site not found" });
    return false;
  }
}

router.get("/revenue-leak", async (req: Request, res: Response) => {
  try {
    const { siteUrl } = req.query as { siteUrl?: string };
    if (siteUrl) {
      const owned = await assertSiteOwnership(req as OrgReq, siteUrl, res);
      if (!owned) return;
    }
    const opportunities = await loadRevenueOpportunities(req, siteUrl);
    res.json({
      ok: true, source: "behavior_events", windowDays: 30, opportunities,
      observations: opportunities.map(({ page, eventType, observedEvents, affectedSessions, confidence }) =>
        ({ page, eventType, observedEvents, affectedSessions, confidence })),
      financial: { status: "unavailable", observedLoss: null, estimatedLoss: null, currency: null },
      noData: opportunities.length === 0,
    });
  } catch {
    res.status(503).json({ error: "Les événements comportementaux sont temporairement indisponibles.", opportunities: [], noData: true });
  }
});

router.post("/revenue-leak/detect", async (req: Request, res: Response) => {
  const { siteUrl } = req.body ?? {};
  if (!siteUrl) { res.status(400).json({ error: "siteUrl required" }); return; }
  const orgId = (req as OrgReq).orgId ?? "default";
  const owned = await assertSiteOwnership(req as OrgReq, siteUrl, res);
  if (!owned) return;
  try {
    const opportunities = await loadRevenueOpportunities(req, siteUrl);
    res.json({
      ok: true, source: "behavior_events", windowDays: 30, opportunities,
      financial: { status: "unavailable", observedLoss: null, estimatedLoss: null, currency: null },
      noData: opportunities.length === 0,
    });
  } catch {
    res.status(500).json({ error: "Failed to detect revenue leaks" });
  }
});

router.patch("/revenue-leak/:id/resolve", async (req: Request, res: Response) => {
  const { id } = req.params;
  const orgId = (req as OrgReq).orgId ?? "default";
  try {
    const result = await db(req)(
      `UPDATE revenue_leaks SET status='resolved', resolved_at=now() WHERE id=$1 AND org_id=$2 RETURNING id`,
      [id, orgId]
    );
    if (!result.rows.length) { res.status(404).json({ error: "Opportunity not found" }); return; }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to resolve leak" });
  }
});

export default router;
