import { Router, type Request, type Response } from "express";
import { getRevenueLeakData, detectRevenueLeaks } from "../services/revenue-leak-service.js";
import { db, revenueLeaksTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

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
    await db.update(revenueLeaksTable)
      .set({ status: "resolved", resolvedAt: new Date() })
      .where(eq(revenueLeaksTable.id, id));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to resolve leak" });
  }
});

export default router;
