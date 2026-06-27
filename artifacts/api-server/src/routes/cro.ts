import { Router, type Request, type Response } from "express";
import { getCROData, generateCRORecommendations, upsertCROScore } from "../services/cro-service.js";
import { requireFeature } from "../middlewares/planGate.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const db = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

router.use(requireFeature("cro", "CRO AI"));

router.get("/cro", async (req: Request, res: Response) => {
  try {
    const { siteUrl } = req.query as { siteUrl?: string };
    const data = await getCROData(siteUrl);
    res.json(data);
  } catch {
    res.json({ score: null, recommendations: [], heatmapData: null, funnelData: [], abTests: [] });
  }
});

router.post("/cro/generate", async (req: Request, res: Response) => {
  const { siteUrl } = req.body ?? {};
  if (!siteUrl) { res.status(400).json({ error: "siteUrl required" }); return; }
  try {
    await generateCRORecommendations(siteUrl);
    const data = await getCROData(siteUrl);
    res.json({ ok: true, ...data });
  } catch {
    res.status(500).json({ error: "Failed to generate CRO recommendations" });
  }
});

router.patch("/cro/recommendations/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body ?? {};
  if (!status) { res.status(400).json({ error: "status required" }); return; }
  try {
    await db(req)(
      `UPDATE cro_recommendations SET status=$1, updated_at=now() WHERE id=$2`,
      [status, id]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to update recommendation" });
  }
});

export default router;
