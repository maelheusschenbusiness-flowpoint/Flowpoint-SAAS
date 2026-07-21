import { Router, type Request, type Response } from "express";
import { getRevenueLeakData, detectRevenueLeaks } from "../services/revenue-leak-service.js";
import { requireFeature } from "../middlewares/planGate.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const db = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

router.use(requireFeature("cro", "Revenue Leak"));

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
    const orgId = (req as OrgReq).orgId ?? "default";
    if (siteUrl) {
      const owned = await assertSiteOwnership(req as OrgReq, siteUrl, res);
      if (!owned) return;
    }
    const data = await getRevenueLeakData(orgId, siteUrl);
    res.json(data);
  } catch {
    res.json({ leaks: [], totalLost: 0, currency: "EUR", detectedAt: null });
  }
});

router.post("/revenue-leak/detect", async (req: Request, res: Response) => {
  const { siteUrl } = req.body ?? {};
  if (!siteUrl) { res.status(400).json({ error: "siteUrl required" }); return; }
  const orgId = (req as OrgReq).orgId ?? "default";
  const owned = await assertSiteOwnership(req as OrgReq, siteUrl, res);
  if (!owned) return;
  try {
    await detectRevenueLeaks(orgId, siteUrl);
    const data = await getRevenueLeakData(orgId, siteUrl);
    res.json({ ok: true, ...data });
  } catch {
    res.status(500).json({ error: "Failed to detect revenue leaks" });
  }
});

router.patch("/revenue-leak/:id/resolve", async (req: Request, res: Response) => {
  const { id } = req.params;
  const orgId = (req as OrgReq).orgId ?? "default";
  try {
    await db(req)(
      `UPDATE revenue_leaks SET status='resolved', resolved_at=now() WHERE id=$1 AND org_id=$2`,
      [id, orgId]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to resolve leak" });
  }
});

export default router;
