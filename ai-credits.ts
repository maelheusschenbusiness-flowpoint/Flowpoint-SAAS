import { Router, type Request, type Response } from "express";
import { getAIUsageStats, consumeAICredits, type AIFeature } from "../services/ai-engine.js";

const router = Router();

router.get("/ai-credits", async (_req: Request, res: Response) => {
  try {
    const stats = await getAIUsageStats();
    res.json(stats);
  } catch {
    res.status(500).json({ error: "Failed to fetch AI credits" });
  }
});

router.get("/ai-credits/usage", async (_req: Request, res: Response) => {
  try {
    const stats = await getAIUsageStats();
    res.json({
      monthly: stats.monthly,
      byFeature: stats.byFeature,
      dailyHistory: stats.dailyHistory,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch usage stats" });
  }
});

router.get("/ai-credits/alerts", async (_req: Request, res: Response) => {
  try {
    const stats = await getAIUsageStats();
    res.json({ alerts: stats.alerts });
  } catch {
    res.status(500).json({ error: "Failed to fetch AI alerts" });
  }
});

router.post("/ai-credits/consume", async (req: Request, res: Response) => {
  const { feature, metadata } = req.body as { feature?: AIFeature; metadata?: Record<string, unknown> };
  if (!feature) { res.status(400).json({ error: "feature required" }); return; }
  try {
    const result = await consumeAICredits({ feature, metadata });
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to consume credits" });
  }
});

export default router;
