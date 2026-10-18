import { Router, type Request, type Response } from "express";
import { canWrite } from "../middlewares/requireRole.js";
import { requireAddon } from "../middlewares/planGate.js";
import { logger } from "../lib/logger.js";
import { deriveConversionObservations } from "../services/conversion-observations.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const db = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

// Gate scoped to /cro/* only — path-less router.use() would intercept every route
// mounted after this router in index.ts (same catch-all pattern as behavioral.ts).
router.use("/cro", requireAddon("aiCro", "AI CRO Strategist"));

async function loadObservedInsights(req: Request, siteUrl?: string) {
  const orgId = (req as OrgReq).orgId ?? "default";
  const params: unknown[] = [orgId];
  let siteClause = "";
  if (siteUrl) {
    params.push(siteUrl);
    siteClause = " AND site_url = $2";
  }
  const { rows } = await db(req)(
    `SELECT page, session_id AS "sessionId", event_type AS "eventType",
            scroll_depth AS "scrollDepth"
       FROM behavior_events
      WHERE org_id = $1${siteClause}
        AND created_at >= now() - interval '30 days'
      ORDER BY created_at DESC
      LIMIT 20000`,
    params,
  );
  return deriveConversionObservations(rows);
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

router.get("/cro", async (req: Request, res: Response) => {
  try {
    const { siteUrl } = req.query as { siteUrl?: string };
    if (siteUrl) {
      const owned = await assertSiteOwnership(req as OrgReq, siteUrl, res);
      if (!owned) return;
    }
    const observations = await loadObservedInsights(req, siteUrl);
    res.json({
      ok: true, source: "behavior_events", windowDays: 30, observations,
      recommendations: observations.map((item, index) => ({
        id: `${item.page}:${item.eventType}:${index}`,
        page: item.page, type: item.eventType, title: item.recommendation,
        description: `${item.observedEvents} événements observés sur ${item.affectedSessions} sessions au cours des 30 derniers jours.`,
        observedEvents: item.observedEvents, affectedSessions: item.affectedSessions,
        source: item.source, frequency: item.observedEvents,
        confidence: item.confidence, status: "pending",
      })),
      experiments: [], score: null, noData: observations.length === 0,
    });
  } catch (err) {
    logger.error({ err }, "[CRO] observed-event analysis failed");
    res.status(503).json({ error: "Les événements comportementaux sont temporairement indisponibles.", observations: [], noData: true });
  }
});

router.post("/cro/generate", canWrite, async (req: Request, res: Response) => {
  const { siteUrl } = req.body ?? {};
  if (!siteUrl) { res.status(400).json({ error: "siteUrl required" }); return; }
  const orgId = (req as OrgReq).orgId ?? "default";
  const owned = await assertSiteOwnership(req as OrgReq, siteUrl, res);
  if (!owned) return;
  try {
    const observations = await loadObservedInsights(req, siteUrl);
    res.json({ ok: true, source: "behavior_events", windowDays: 30, observations });
  } catch (err) {
    logger.warn({ err, siteUrl, orgId }, "[CRO] observed-event analysis failed");
    res.status(503).json({ error: "Impossible d'analyser les événements collectés.", observations: [] });
  }
});

router.patch("/cro/recommendations/:id", canWrite, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body ?? {};
  if (!status) { res.status(400).json({ error: "status required" }); return; }
  const orgId = (req as OrgReq).orgId ?? "default";
  try {
    await db(req)(
      `UPDATE cro_recommendations SET status=$1, updated_at=now() WHERE id=$2 AND org_id=$3`,
      [status, id, orgId]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to update recommendation" });
  }
});

export default router;
