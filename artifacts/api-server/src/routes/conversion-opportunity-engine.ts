import { Router } from "express";
import { getGA4ConversionPages } from "../services/ga4-service.js";
import {
  DEFAULT_CONVERSION_OPPORTUNITY_SETTINGS,
  findConversionOpportunities,
  normalizeConversionOpportunitySettings,
} from "../services/conversion-opportunity-engine.js";
import { requireAddon } from "../middlewares/planGate.js";
import { canWrite } from "../middlewares/requireRole.js";

const router = Router();
router.use("/conversion-opportunity-engine", requireAddon(
  "conversionOpportunityEngine",
  "Conversion Opportunity Engine",
));

router.get("/conversion-opportunity-engine", async (req, res) => {
  const orgId = req.orgContext?.orgId;
  if (!orgId) return res.status(500).json({ ok: false, error: "Organization context missing." });
  try {
    const settingsResult = await req.orgDb(
      "SELECT settings FROM conversion_opportunity_settings WHERE org_id=$1",
      [orgId],
    );
    const settings = normalizeConversionOpportunitySettings(settingsResult.rows[0]?.settings ?? DEFAULT_CONVERSION_OPPORTUNITY_SETTINGS);
    const report = await getGA4ConversionPages(orgId, "28daysAgo", "yesterday");
    return res.json({
      ok: true,
      settings,
      opportunities: findConversionOpportunities(report.rows, settings),
      source: "ga4",
      period: { startDate: "28daysAgo", endDate: "yesterday" },
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to load conversion data." });
  }
});

router.put("/conversion-opportunity-engine/settings", canWrite, async (req, res) => {
  const orgId = req.orgContext?.orgId;
  if (!orgId) return res.status(500).json({ ok: false, error: "Organization context missing." });
  const settings = normalizeConversionOpportunitySettings(req.body);
  try {
    await req.orgDb(
      `INSERT INTO conversion_opportunity_settings (org_id, settings, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (org_id) DO UPDATE SET settings=$2::jsonb, updated_at=NOW()`,
      [orgId, JSON.stringify(settings)],
    );
    return res.json({ ok: true, settings });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unable to save settings." });
  }
});

export default router;
