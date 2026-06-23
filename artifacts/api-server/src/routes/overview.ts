import { Router } from "express";
import { getOverviewMetrics } from "../services/overview-service.js";
import { withCache } from "../middlewares/cacheControl.js";

const router = Router();

router.get("/overview", withCache(60), async (req, res) => {
  try {
    const orgId = (req as unknown as { orgId?: string }).orgId ?? "default";
    const metrics = await getOverviewMetrics(orgId);
    res.json(metrics);
  } catch {
    res.status(500).json({ error: "Failed to compute overview metrics" });
  }
});

export default router;
