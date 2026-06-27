import { Router, type Request, type Response } from "express";
import { getRevenueLeakData, detectRevenueLeaks } from "../services/revenue-leak-service.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const db = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

router.get("/revenue-leak", async (req: Request, res: Response) => {
  try {
    const { siteUrl } = req.query as { siteUrl?: string };
    const data = await getRevenueLeakData(siteUrl);
    res.json(data);
  } catch {
    res.json({ leaks: [], totalLost: 0, currency: "EUR", detectedAt: null });
  }
});

router.post("/revenue-leak/detect", async (req: Request, res: Response) => {
  const { siteUrl } = req.body ?? {};
  if (!siteUrl) { res.status(400).json({ error: "siteUrl required" }); return; }
  try {
    await detectRevenueLeaks(siteUrl);
    const data = await getRevenueLeakData(siteUrl);
    res.json({ ok: true, ...data });
  } catch {
    res.status(500).json({ error: "Failed to detect revenue leaks" });
  }
});

router.patch("/revenue-leak/:id/resolve", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await db(req)(
      `UPDATE revenue_leaks SET status='resolved', resolved_at=now() WHERE id=$1`,
      [id]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to resolve leak" });
  }
});

export default router;
