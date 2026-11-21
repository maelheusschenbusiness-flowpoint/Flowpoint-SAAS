import { Router, type Request } from "express";
import { canWrite } from "../middlewares/requireRole.js";
import { requireAddon } from "../middlewares/planGate.js";
import { safeErrMsg } from "../lib/safe-error.js";
import {
  DEFAULT_LOCAL_LANDING_SETTINGS,
  normalizeLocalLandingSettings,
  findLocalLandingOpportunities,
  type SearchQuerySignal,
} from "../services/local-landing-opportunities.js";

type DbResult = { rows: Record<string, unknown>[] };
type OrgRequest = Request & {
  orgId?: string;
  orgDb?: (sql: string, values?: unknown[]) => Promise<DbResult>;
};

const router = Router();
const orgId = (req: Request) => (req as OrgRequest).orgId;
const query = (req: Request) => (req as OrgRequest).orgDb;

router.use("/local-landing-opportunities", requireAddon("localLandingOpportunities", "Local Landing Opportunities"));

router.get("/local-landing-opportunities", async (req, res) => {
  const id = orgId(req);
  const db = query(req);
  if (!id || !db) { res.status(401).json({ error: "Contexte d’organisation requis." }); return; }
  try {
    const [saved, searchData] = await Promise.all([
      db("SELECT settings FROM local_landing_opportunity_settings WHERE org_id=$1", [id]),
      db(
        `SELECT keyword, SUM(impressions)::int AS impressions, SUM(clicks)::int AS clicks,
                CASE WHEN SUM(impressions)=0 THEN 0 ELSE SUM(clicks)::float/SUM(impressions) END AS ctr,
                AVG(position)::float AS position, MAX(date) AS latest_date
         FROM gsc_keyword_data
         WHERE org_id=$1 AND date >= to_char(CURRENT_DATE - INTERVAL '28 days', 'YYYY-MM-DD')
         GROUP BY keyword
         ORDER BY SUM(impressions) DESC
         LIMIT 5000`,
        [id],
      ),
    ]);
    const settings = normalizeLocalLandingSettings(saved.rows[0]?.["settings"] ?? DEFAULT_LOCAL_LANDING_SETTINGS);
    const rows: SearchQuerySignal[] = searchData.rows.map(row => ({
      keyword: String(row["keyword"] ?? ""),
      impressions: Number(row["impressions"] ?? 0),
      clicks: Number(row["clicks"] ?? 0),
      ctr: Number(row["ctr"] ?? 0),
      position: Number(row["position"] ?? 0),
      latestDate: String(row["latest_date"] ?? ""),
    }));
    const opportunities = findLocalLandingOpportunities(rows, settings);
    res.json({ ok: true, settings, source: "google-search-console", periodDays: 28, opportunities, count: opportunities.length });
  } catch (error) {
    res.status(500).json({ error: safeErrMsg(error) });
  }
});

router.put("/local-landing-opportunities/settings", canWrite, async (req, res) => {
  const id = orgId(req);
  const db = query(req);
  if (!id || !db) { res.status(401).json({ error: "Contexte d’organisation requis." }); return; }
  const settings = normalizeLocalLandingSettings(req.body);
  if (settings.services.length === 0 || settings.locations.length === 0) {
    res.status(400).json({ error: "Ajoutez au moins un service et une zone géographique." }); return;
  }
  try {
    await db(
      `INSERT INTO local_landing_opportunity_settings (org_id, settings, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (org_id) DO UPDATE SET settings=$2::jsonb, updated_at=NOW()`,
      [id, JSON.stringify(settings)],
    );
    res.json({ ok: true, settings });
  } catch (error) {
    res.status(500).json({ error: safeErrMsg(error) });
  }
});

export default router;
