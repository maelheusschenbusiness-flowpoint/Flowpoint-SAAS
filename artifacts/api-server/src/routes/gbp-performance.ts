import { Router, type Request } from "express";
import { pool } from "@workspace/db";
import { canWrite } from "../middlewares/requireRole.js";
import { requireAddon } from "../middlewares/planGate.js";
import { getPerformance, getValidToken } from "../services/google-service.js";
import { requireOrgId } from "../lib/require-org-id.js";
import {
  DEFAULT_GBP_PERFORMANCE_SETTINGS,
  GBP_PERFORMANCE_METRICS,
  calculateDropPercent,
  parseGbpPerformanceSettings,
  summarizeGbpMetrics,
  type GbpPerformanceMetric,
} from "../services/gbp-performance-addon.js";
import { safeErrMsg } from "../lib/safe-error.js";

const router = Router();

// Scope the gate to this router's own endpoint. A bare router.use() here also
// intercepts later root-mounted routers (for example Conversion Opportunity
// Engine) before Express gets a chance to reach their own authorization gate.
router.use("/gbp-performance", requireAddon("gbpPerformanceLeads", "GBP Performance & Leads"));

async function readSettings(tenantId: string) {
  const result = await pool.query(
    `SELECT settings FROM gbp_performance_settings WHERE org_id=$1 LIMIT 1`,
    [tenantId],
  );
  if (!result.rows[0]) return DEFAULT_GBP_PERFORMANCE_SETTINGS;
  return parseGbpPerformanceSettings(result.rows[0].settings) ?? DEFAULT_GBP_PERFORMANCE_SETTINGS;
}

router.get("/gbp-performance", async (req, res) => {
  const tenantId = requireOrgId(req, res);
  if (!tenantId) return;
  try {
    const [settings, locationResult] = await Promise.all([
      readSettings(tenantId),
      pool.query(
        `SELECT id, name, raw_data
         FROM google_locations WHERE org_id=$1 ORDER BY name`,
        [tenantId],
      ),
    ]);
    const locations = locationResult.rows.map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ""),
      resourceName: String((row.raw_data as { name?: string } | null)?.name ?? ""),
    }));
    const selected = locations.find((location) => location.id === settings.locationId) ?? locations[0];
    if (!selected) {
      res.json({ ok: true, configured: false, settings, locations: [], current: {}, previous: {}, drops: {} });
      return;
    }
    if (!selected.resourceName) {
      res.status(409).json({ ok: false, code: "GBP_LOCATION_RESOURCE_MISSING", error: "Synchronisez les fiches Google avant de charger leurs performances." });
      return;
    }
    const token = await getValidToken(tenantId).catch(() => null);
    if (!token) {
      res.json({
        ok: true,
        configured: false,
        connectionRequired: true,
        message: "Connectez Google Business Profile puis synchronisez vos fiches pour consulter les données réelles.",
        settings,
        locations: locations.map(({ id, name }) => ({ id, name })),
        current: {},
        previous: {},
        drops: {},
      });
      return;
    }

    const now = new Date();
    const currentStart = new Date(now.getTime() - settings.periodDays * 86_400_000);
    const previousStart = new Date(currentStart.getTime() - settings.periodDays * 86_400_000);
    const [currentRaw, previousRaw] = await Promise.all([
      getPerformance(tenantId, selected.resourceName, {
        startTime: currentStart.toISOString(),
        endTime: now.toISOString(),
      }),
      getPerformance(tenantId, selected.resourceName, {
        startTime: previousStart.toISOString(),
        endTime: currentStart.toISOString(),
      }),
    ]);
    const current = summarizeGbpMetrics(currentRaw);
    const previous = summarizeGbpMetrics(previousRaw);
    const drops: Partial<Record<GbpPerformanceMetric, number>> = {};
    for (const metric of GBP_PERFORMANCE_METRICS) {
      const drop = calculateDropPercent(current[metric] ?? 0, previous[metric] ?? 0);
      if (drop !== null && drop >= settings.alertDropPercent) drops[metric] = drop;
    }
    res.json({
      ok: true,
      configured: true,
      settings: { ...settings, locationId: selected.id },
      locations: locations.map(({ id, name }) => ({ id, name })),
      location: { id: selected.id, name: selected.name },
      period: { days: settings.periodDays, start: currentStart.toISOString(), end: now.toISOString() },
      current,
      previous,
      goals: settings.goals,
      drops,
    });
  } catch (error) {
    res.status(502).json({ ok: false, error: safeErrMsg(error) });
  }
});

router.put("/gbp-performance/settings", canWrite, async (req, res) => {
  const tenantId = requireOrgId(req, res);
  if (!tenantId) return;
  const settings = parseGbpPerformanceSettings(req.body);
  if (!settings) {
    res.status(400).json({ ok: false, code: "INVALID_SETTINGS", error: "Paramètres de performance GBP invalides." });
    return;
  }
  try {
    if (settings.locationId) {
      const ownedLocation = await pool.query(
        `SELECT id FROM google_locations WHERE id=$1 AND org_id=$2 LIMIT 1`,
        [settings.locationId, tenantId],
      );
      if (!ownedLocation.rows.length) {
        res.status(404).json({ ok: false, code: "GBP_LOCATION_NOT_FOUND", error: "Cette fiche Google n’appartient pas à votre organisation." });
        return;
      }
    }
    const saved = await pool.query(
      `INSERT INTO gbp_performance_settings (org_id, settings, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (org_id) DO UPDATE
         SET settings=EXCLUDED.settings, updated_at=NOW()
       RETURNING settings, updated_at`,
      [tenantId, JSON.stringify(settings)],
    );
    res.json({ ok: true, settings: saved.rows[0].settings, updatedAt: saved.rows[0].updated_at });
  } catch (error) {
    res.status(500).json({ ok: false, error: safeErrMsg(error) });
  }
});

export default router;
