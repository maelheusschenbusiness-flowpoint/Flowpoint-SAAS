import { Router, type Request, type Response } from "express";
import { getForecastData, generateForecasts } from "../services/forecasting-service.js";
import { requireFeature } from "../middlewares/planGate.js";
import { withCache } from "../middlewares/cacheControl.js";

const router = Router();

// All forecast endpoints require the 'forecastingAI' feature flag (Pro plan and above).
// Gate scoped to /forecast/* only — path-less router.use() would intercept every route
// mounted after this router in index.ts (same catch-all pattern as behavioral.ts).
router.use("/forecast", requireFeature("forecastingAI", "AI Forecasting"));

router.get("/forecast", withCache(60), async (req: Request, res: Response) => {
  // orgId is resolved server-side from the authenticated session — never trusted from client
  const orgId = (req as Request & { orgContext?: { orgId?: string } }).orgContext?.orgId;
  if (!orgId || orgId === "default") {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const { siteUrl } = req.query as { siteUrl?: string };
  if (siteUrl !== undefined && typeof siteUrl !== "string") {
    res.status(400).json({ error: "Invalid siteUrl parameter" });
    return;
  }
  try {
    const data = await getForecastData({ orgId, siteUrl });
    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed to fetch forecast data" });
  }
});

router.post("/forecast/generate", async (req: Request, res: Response) => {
  const orgId = (req as Request & { orgContext?: { orgId?: string } }).orgContext?.orgId;
  if (!orgId || orgId === "default") {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const { siteUrl } = req.body ?? {};
  if (!siteUrl || typeof siteUrl !== "string") {
    res.status(400).json({ error: "siteUrl required" });
    return;
  }
  try {
    await generateForecasts(orgId, siteUrl);
    const data = await getForecastData({ orgId, siteUrl });
    res.json({ ok: true, ...data });
  } catch {
    res.status(500).json({ error: "Failed to generate forecasts" });
  }
});

export default router;
