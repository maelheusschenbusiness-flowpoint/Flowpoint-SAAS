import { Router, type Request, type Response } from "express";
import { getCROData, generateCRORecommendations, upsertCROScore } from "../services/cro-service.js";
import { canWrite } from "../middlewares/requireRole.js";
import { requireFeature } from "../middlewares/planGate.js";
import { logger } from "../lib/logger.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const db = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

router.use(requireFeature("cro", "CRO AI"));

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
    const orgId = (req as OrgReq).orgId ?? "default";
    if (siteUrl) {
      const owned = await assertSiteOwnership(req as OrgReq, siteUrl, res);
      if (!owned) return;
    }
    const data = await getCROData(orgId, siteUrl);
    const recs = data.recommendations;
    const latestScore = data.scores.length > 0
      ? Math.round(data.scores.reduce((s, r) => s + Number((r as Record<string, unknown>).score ?? 0), 0) / data.scores.length)
      : null;
    const derivedScore = recs.length > 0
      ? Math.max(20, Math.min(95,
          100
          - recs.filter(r => r.priority === "high").length * 12
          - recs.filter(r => r.priority === "medium").length * 5
        ))
      : null;
    const score = latestScore ?? derivedScore;
    res.json({ ...data, score, heatmapData: null, funnelData: [], abTests: [] });
  } catch {
    res.json({ score: null, recommendations: [], heatmapData: null, funnelData: [], abTests: [] });
  }
});

router.post("/cro/generate", canWrite, async (req: Request, res: Response) => {
  const { siteUrl } = req.body ?? {};
  if (!siteUrl) { res.status(400).json({ error: "siteUrl required" }); return; }
  const orgId = (req as OrgReq).orgId ?? "default";
  const owned = await assertSiteOwnership(req as OrgReq, siteUrl, res);
  if (!owned) return;
  try {
    await generateCRORecommendations(orgId, siteUrl);
  } catch {
    // generateCRORecommendations has its own error handling; ignore re-throw
  }
  try {
    const data = await getCROData(orgId, siteUrl);
    res.json({ ok: true, ...data });
  } catch (err) {
    logger.warn({ err, siteUrl }, "[CRO] getCROData failed, returning empty response");
    res.json({ ok: true, recommendations: [], scores: [], experiments: [], summary: { totalRecs: 0, highPriority: 0, estimatedUpliftTotal: 0, implementedCount: 0 } });
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

void upsertCROScore;

export default router;
