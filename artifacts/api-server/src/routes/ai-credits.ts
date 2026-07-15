import { Router, type Request, type Response } from "express";
import { getAIUsageStats, consumeAICredits, type AIFeature } from "../services/ai-engine.js";

const router = Router();

router.get("/ai-credits", async (req: Request, res: Response) => {
  const orgId = req.orgId ?? "default";
  try {
    const stats = await getAIUsageStats(orgId);
    res.json(stats);
  } catch {
    res.status(500).json({ error: "Failed to fetch AI credits" });
  }
});

// Alias: /api/ai/credits → same handler (spec compatibility)
router.get("/ai/credits", async (req: Request, res: Response) => {
  const orgId = req.orgId ?? "default";
  try {
    const stats = await getAIUsageStats(orgId);
    res.json(stats);
  } catch {
    res.status(500).json({ error: "Failed to fetch AI credits" });
  }
});

router.get("/ai-credits/usage", async (req: Request, res: Response) => {
  const orgId = req.orgId ?? "default";
  try {
    const stats = await getAIUsageStats(orgId);
    const totalAvailable = stats.monthly.creditsLimit + stats.monthly.creditsExtra;
    res.json({
      monthly: stats.monthly,
      byFeature: stats.byFeature,
      byProvider: stats.byProvider,
      byModel: stats.byModel,
      dailyHistory: stats.dailyHistory,
      estimatedCostEur: stats.estimatedCostEur,
      remaining: Math.max(0, totalAvailable - stats.monthly.creditsUsed),
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch usage stats" });
  }
});

router.get("/ai-credits/alerts", async (req: Request, res: Response) => {
  const orgId = req.orgId ?? "default";
  try {
    const stats = await getAIUsageStats(orgId);
    res.json({ alerts: stats.alerts });
  } catch {
    res.status(500).json({ error: "Failed to fetch AI alerts" });
  }
});

router.post("/ai-credits/consume", async (req: Request, res: Response) => {
  const orgId  = req.orgId  ?? "default";
  const userId = req.userId ?? "system";
  const { feature, metadata } = req.body as { feature?: AIFeature; metadata?: Record<string, unknown> };
  if (!feature) { res.status(400).json({ error: "feature required" }); return; }
  try {
    const result = await consumeAICredits({ feature, metadata, orgId, userId });
    res.json(result);
  } catch {
    res.status(500).json({ error: "Failed to consume credits" });
  }
});

export default router;
