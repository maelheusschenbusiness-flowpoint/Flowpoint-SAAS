import { Router, type Request } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
import {
  getMarketDashboard, generateMarketReport, detectCompetitorMovements, seedMarketData,
} from "../services/market-intel-service.js";
import { requireAddon } from "../middlewares/planGate.js";

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
    await seedMarketData(orgId);
    const data = await getMarketDashboard(orgId);
    res.json(data);
  } catch { res.json({ trends: [], opportunities: [], competitors: [], movements: [], summary: null }); }
});

router.get("/market-intelligence/trends", async (req, res) => {
  const { category, min_score, limit: lim = "20" } = req.query as Record<string, string>;
  try {
    const orgId = org(req);
    await seedMarketData(orgId);
    let q = `SELECT * FROM market_trends WHERE org_id=$1`;
    const params: unknown[] = [orgId];
    if (category)  { params.push(category);                    q += ` AND category=$${params.length}`; }
    if (min_score) { params.push(parseInt(min_score, 10));      q += ` AND opportunity_score>=$${params.length}`; }
    q += ` ORDER BY opportunity_score DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(lim, 10));
    const r = await db(req)(q, params);
    res.json({ trends: r.rows, count: r.rows.length });
  } catch { res.json({ trends: [], count: 0 }); }
});

router.get("/market-intelligence/opportunities", async (req, res) => {
  const { type, limit: lim = "15" } = req.query as Record<string, string>;
  try {
    const orgId = org(req);
    await seedMarketData(orgId);
    let q = `SELECT * FROM market_opportunities WHERE org_id=$1`;
    const params: unknown[] = [orgId];
    if (type) { params.push(type); q += ` AND type=$${params.length}`; }
    q += ` ORDER BY score DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(lim, 10));
    const r = await db(req)(q, params);
    res.json({ opportunities: r.rows, count: r.rows.length });
  } catch { res.json({ opportunities: [], count: 0 }); }
});

router.get("/market-intelligence/competitor-movements", async (req, res) => {
  const { limit: lim = "20" } = req.query as Record<string, string>;
  try {
    const r = await db(req)(
      `SELECT * FROM competitor_movements WHERE org_id=$1 ORDER BY detected_at DESC LIMIT $2`,
      [org(req), parseInt(lim, 10)]
    );
    res.json({ movements: r.rows, count: r.rows.length });
  } catch { res.json({ movements: [], count: 0 }); }
});

router.get("/market-intelligence/signals", async (req, res) => {
  try {
    const orgId = org(req);
    await seedMarketData(orgId);
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
      `SELECT * FROM ai_market_reports WHERE org_id=$1 ORDER BY generated_at DESC LIMIT 10`,
      [org(req)]
    );
    res.json({ reports: r.rows, count: r.rows.length });
  } catch { res.json({ reports: [], count: 0 }); }
});

router.post("/market-intelligence/report/generate", async (req, res) => {
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
    res.json({ ok: true, movement });
  } catch (err) { res.status(500).json({ error: safeErrMsg(err) }); }
});

export default router;
