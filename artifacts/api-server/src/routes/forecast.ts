import { Router, type Request, type Response } from "express";
import { getForecastData, generateForecasts } from "../services/forecasting-service.js";
import { requireFeature } from "../middlewares/planGate.js";
import { withCache } from "../middlewares/cacheControl.js";

const router = Router();

// All forecast endpoints require the 'forecastingAI' feature flag (Pro plan and above)
router.use(requireFeature("forecastingAI", "AI Forecasting"));

router.get("/forecast", withCache(60), async (req: Request, res: Response) => {
  try {
    const { siteUrl } = req.query as { siteUrl?: string };
    const data = await getForecastData(siteUrl);
    res.json(data);
  } catch {
    res.status(500).json({ error: "Failed to fetch forecast data" });
  }
});

router.post("/forecast/generate", async (req: Request, res: Response) => {
  const { siteUrl } = req.body ?? {};
  if (!siteUrl) { res.status(400).json({ error: "siteUrl required" }); return; }
  try {
    await generateForecasts(siteUrl);
    const data = await getForecastData(siteUrl);
    res.json({ ok: true, ...data });
  } catch {
    res.status(500).json({ error: "Failed to generate forecasts" });
  }
});

export default router;
