import { Router, type Request } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
import {
  getMarketDashboard, generateMarketReport, detectCompetitorMovements,
} from "../services/market-intel-service.js";
import { marketLang, localizeReportTitle, type MarketLang } from "../services/market-intel-service.js";
import { resolveRequestLanguage } from "../lib/request-language.js";
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
// Langue d'affichage : option explicite, préférence utilisateur, langue de l'organisation, sinon anglais.
// Jamais déduite d'Accept-Language. Une panne de lecture retombe sur l'anglais, sans bloquer la route.
const langOf = async (req: Request): Promise<MarketLang> => {
  try { return marketLang(await resolveRequestLanguage(req, { explicit: req.query["lang"] })); }
  catch { return "en"; }
};

router.get("/market-intelligence", async (req, res) => {
  try {
    const orgId = org(req);
    const data = await getMarketDashboard(orgId, await langOf(req));
    res.json(data);
  } catch { res.status(503).json({ error: "Market data is temporarily unavailable.", code: "MARKET_DATA_UNAVAILABLE", trends: [], opportunities: [], signals: [], competitor_movements: [], summary: null, stats: { avgOpportunityScore: 0, emergingTrends: 0 } }); }
});

router.get("/market-intelligence/trends", async (req, res) => {
  const { min_score, limit: lim = "20" } = req.query as Record<string, string>;
  try {
    const minScore = Number.isFinite(Number(min_score)) ? Number(min_score) : 0;
    const limit = Math.min(100, Math.max(1, Number.parseInt(lim, 10) || 20));
    const trends = (await getMarketDashboard(org(req), await langOf(req))).trends
      .filter((trend) => trend.opportunity_score >= minScore).slice(0, limit);
    res.json({ trends, count: trends.length, source: trends.length ? "gsc" : "no_data" });
  } catch { res.status(503).json({ error: "Market data is temporarily unavailable.", code: "MARKET_DATA_UNAVAILABLE", trends: [], count: 0 }); }
});

router.get("/market-intelligence/opportunities", async (req, res) => {
  const { type, limit: lim = "15" } = req.query as Record<string, string>;
  try {
    const limit = Math.min(100, Math.max(1, Number.parseInt(lim, 10) || 15));
    const opportunities = (await getMarketDashboard(org(req), await langOf(req))).opportunities
      .filter((item) => !type || item.type === type).slice(0, limit);
    res.json({ opportunities, count: opportunities.length, source: opportunities.length ? "gsc" : "no_data" });
  } catch { res.status(503).json({ error: "Market data is temporarily unavailable.", code: "MARKET_DATA_UNAVAILABLE", opportunities: [], count: 0 }); }
});

router.get("/market-intelligence/competitor-movements", async (req, res) => {
  const { limit: lim = "20", domain } = req.query as Record<string, string>;
  try {
    const limit = Math.min(100, Math.max(1, Number.parseInt(lim, 10) || 20));
    const movements = (await detectCompetitorMovements(org(req), domain)).slice(0, limit);
    res.json({ movements, count: movements.length, source: movements.length ? "competitor_rankings" : "no_data" });
  } catch { res.status(503).json({ error: "Market data is temporarily unavailable.", code: "MARKET_DATA_UNAVAILABLE", movements: [], count: 0 }); }
});

router.get("/market-intelligence/signals", async (req, res) => {
  try {
    const orgId = org(req);
    const r = await db(req)(
      `SELECT * FROM industry_signals WHERE org_id=$1 AND (expires_at IS NULL OR expires_at > now()) ORDER BY created_at DESC LIMIT 20`,
      [orgId]
    );
    res.json({ signals: r.rows, count: r.rows.length });
  } catch { res.status(503).json({ error: "Market data is temporarily unavailable.", code: "MARKET_DATA_UNAVAILABLE", signals: [], count: 0 }); }
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
    const lang = await langOf(req);
    const reports = r.rows.map((row) => ({ ...row, title: localizeReportTitle(row["title"], row["generated_at"], lang) }));
    res.json({ reports, count: reports.length, source: "saved_reports" });
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
    const row = r.rows[0];
    res.json({ report: { ...row, title: localizeReportTitle(row["title"], row["generated_at"], await langOf(req)) } });
  } catch (err) {
    res.status(503).json({ error: safeErrMsg(err), code: "MARKET_REPORT_UNAVAILABLE" });
  }
});

router.post("/market-intelligence/report/generate", canWrite, async (req, res) => {
  try {
    const report = await generateMarketReport(org(req), await langOf(req));
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
