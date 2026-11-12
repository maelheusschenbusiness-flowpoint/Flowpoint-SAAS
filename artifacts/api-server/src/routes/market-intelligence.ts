import { Router, type Request } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
import {
  getMarketDashboard, generateMarketReport, detectCompetitorMovements,
} from "../services/market-intel-service.js";
import { requireAddon } from "../middlewares/planGate.js";
import { canWrite } from "../middlewares/requireRole.js";

const router = Router();

// All market-intelligence endpoints require the marketIntelligence add-on
// (purchasable by any plan) OR plan inclusion.
router.use("/market-intelligence", requireAddon("marketIntelligence", "AI Market Intelligence"));

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const org = (req: Request): string => (req as OrgReq).orgId ?? "default";
const db  = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

router.get("/market-intelligence", async (req, res) => {
  try {
    const orgId = org(req);
    const data = await getMarketDashboard(orgId);
    res.json(data);
  } catch { res.json({ trends: [], opportunities: [], signals: [], competitor_movements: [], summary: null, stats: { avgOpportunityScore: 0, emergingTrends: 0 }, source: "no_data" }); }
});

router.get("/market-intelligence/trends", async (req, res) => {
  const { min_score, limit: lim = "20" } = req.query as Record<string, string>;
  try {
    const minScore = Number.isFinite(Number(min_score)) ? Number(min_score) : 0;
    const limit = Math.min(100, Math.max(1, Number.parseInt(lim, 10) || 20));
    const trends = (await getMarketDashboard(org(req))).trends
      .filter((trend) => trend.opportunity_score >= minScore).slice(0, limit);
    res.json({ trends, count: trends.length, source: trends.length ? "gsc" : "no_data" });
  } catch { res.json({ trends: [], count: 0 }); }
});

router.get("/market-intelligence/opportunities", async (req, res) => {
  const { type, limit: lim = "15" } = req.query as Record<string, string>;
  try {
    const limit = Math.min(100, Math.max(1, Number.parseInt(lim, 10) || 15));
    const opportunities = (await getMarketDashboard(org(req))).opportunities
      .filter((item) => !type || item.type === type).slice(0, limit);
    res.json({ opportunities, count: opportunities.length, source: opportunities.length ? "gsc" : "no_data" });
  } catch { res.json({ opportunities: [], count: 0 }); }
});

router.get("/market-intelligence/competitor-movements", async (req, res) => {
  const { limit: lim = "20", domain } = req.query as Record<string, string>;
  try {
    const limit = Math.min(100, Math.max(1, Number.parseInt(lim, 10) || 20));
    const movements = (await detectCompetitorMovements(org(req), domain)).slice(0, limit);
    res.json({ movements, count: movements.length, source: movements.length ? "competitor_rankings" : "no_data" });
  } catch { res.json({ movements: [], count: 0 }); }
});

router.get("/market-intelligence/signals", async (req, res) => {
  try {
    const orgId = org(req);
    const r = await db(req)(
      `SELECT * FROM industry_signals WHERE org_id=$1 AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC LIMIT 20`,
      [orgId]
    );
    res.json({ signals: r.rows, count: r.rows.length });
  } catch { res.json({ signals: [], count: 0 }); }
});

router.get("/market-intelligence/reports", async (req, res) => {
  try {
    const r = await db(req)(
      `SELECT id, title, summary, data, generated_at
         FROM ai_market_reports
        WHERE org_id=$1
        ORDER BY generated_at DESC, id DESC
        LIMIT 20`,
      [org(req)]
    );
    res.json({ reports: r.rows, count: r.rows.length, source: "saved_reports" });
  } catch (err) {
    res.status(503).json({ error: safeErrMsg(err), code: "MARKET_REPORTS_UNAVAILABLE" });
  }
});

router.get("/market-intelligence/reports/:id", async (req, res) => {
  try {
    const r = await db(req)(
      `SELECT id, title, summary, data, generated_at
         FROM ai_market_reports
        WHERE id=$1 AND org_id=$2
        LIMIT 1`,
      [req.params["id"], org(req)]
    );
    if (!r.rows[0]) { res.status(404).json({ error: "Rapport introuvable." }); return; }
    res.json({ report: r.rows[0] });
  } catch (err) {
    res.status(503).json({ error: safeErrMsg(err), code: "MARKET_REPORT_UNAVAILABLE" });
  }
});

router.post("/market-intelligence/report/generate", canWrite, async (req, res) => {
  try {
    const report = await generateMarketReport(org(req));
    res.json({ ok: true, report });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

router.post("/market-intelligence/competitor-movement", async (req, res) => {
  const { domain } = req.body as { domain?: string };
  if (!domain) { res.status(400).json({ error: "domain requis" }); return; }
  try {
    const movement = await detectCompetitorMovements(org(req), domain);
    res.json({ ok: true, movements: movement, count: movement.length, source: movement.length ? "competitor_rankings" : "no_data" });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

export default router;
