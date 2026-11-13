import { Router, type Request } from "express";
import { canWrite } from "../middlewares/requireRole.js";
import { requireAddon } from "../middlewares/planGate.js";
import { safeErrMsg } from "../lib/safe-error.js";
import {
  DEFAULT_AGENCY_PORTFOLIO_SETTINGS,
  normalizeAgencyPortfolioSettings,
  rankAgencyPortfolioPriorities,
  validateAgencyPortfolioSettings,
  type PortfolioSiteSnapshot,
} from "../services/agency-portfolio-priorities.js";

type DbResult = { rows: Record<string, unknown>[] };
type OrgRequest = Request & {
  orgId?: string;
  orgDb?: (sql: string, values?: unknown[]) => Promise<DbResult>;
};
const router = Router();
const orgId = (req: Request) => (req as OrgRequest).orgId;
const orgDb = (req: Request) => (req as OrgRequest).orgDb;

function domainFromUrl(value: unknown): string {
  try {
    const raw = String(value ?? "");
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

router.use("/agency-portfolio-priorities", requireAddon("agencyPortfolioPriorities", "Agency Portfolio Priorities"));

router.get("/agency-portfolio-priorities", async (req, res) => {
  const tenantId = orgId(req);
  const db = orgDb(req);
  if (!tenantId || !db) { res.status(401).json({ error: "Contexte d’organisation requis." }); return; }
  try {
    const [saved, audits, clicks] = await Promise.all([
      db("SELECT settings FROM agency_portfolio_priority_settings WHERE org_id=$1", [tenantId]),
      db(
        `SELECT id, url, score, issues, created_at
           FROM audits
          WHERE org_id=$1 AND status IN ('ok','warn') AND url <> ''
            AND created_at >= NOW() - INTERVAL '180 days'
          ORDER BY created_at DESC LIMIT 4000`,
        [tenantId],
      ),
      db(
        `SELECT page, SUM(clicks)::bigint AS clicks
           FROM gsc_page_data
          WHERE org_id=$1
            AND date >= to_char(CURRENT_DATE - INTERVAL '30 days', 'YYYY-MM-DD')
          GROUP BY page LIMIT 10000`,
        [tenantId],
      ),
    ]);
    const settings = normalizeAgencyPortfolioSettings(saved.rows[0]?.["settings"] ?? DEFAULT_AGENCY_PORTFOLIO_SETTINGS);
    const byDomain = new Map<string, Record<string, unknown>[]>();
    for (const row of audits.rows) {
      const domain = domainFromUrl(row["url"]);
      if (!domain) continue;
      const rows = byDomain.get(domain) ?? [];
      rows.push(row);
      byDomain.set(domain, rows);
    }
    const clicksByDomain = new Map<string, number>();
    for (const row of clicks.rows) {
      const domain = domainFromUrl(row["page"]);
      if (domain) clicksByDomain.set(domain, (clicksByDomain.get(domain) ?? 0) + Number(row["clicks"] ?? 0));
    }
    const snapshots: PortfolioSiteSnapshot[] = [];
    for (const [domain, rows] of byDomain) {
      const current = rows[0];
      const previous = rows[1];
      snapshots.push({
        siteId: domain,
        domain,
        currentScore: Number(current["score"]),
        previousScore: previous ? Number(previous["score"]) : null,
        criticalIssues: Number(current["issues"] ?? 0),
        monthlyOrganicClicks: clicksByDomain.has(domain) ? clicksByDomain.get(domain)! : null,
        priorityWeight: settings.priorityWeights[domain] ?? 3,
      });
    }
    const priorities = rankAgencyPortfolioPriorities(snapshots);
    res.json({ ok: true, source: "audits+gsc_page_data", trafficMetric: "gsc_clicks_30d", settings, priorities, count: priorities.length });
  } catch (error) {
    res.status(500).json({ error: safeErrMsg(error) });
  }
});

router.put("/agency-portfolio-priorities/settings", canWrite, async (req, res) => {
  const tenantId = orgId(req);
  const db = orgDb(req);
  if (!tenantId || !db) { res.status(401).json({ error: "Contexte d’organisation requis." }); return; }
  const settings = validateAgencyPortfolioSettings(req.body);
  if (!settings) {
    res.status(400).json({ error: "Chaque domaine doit avoir un poids entier compris entre 1 et 5 (100 domaines maximum).", code: "INVALID_AGENCY_PORTFOLIO_SETTINGS" });
    return;
  }
  try {
    await db(
      `INSERT INTO agency_portfolio_priority_settings (org_id, settings, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (org_id) DO UPDATE SET settings=$2::jsonb, updated_at=NOW()`,
      [tenantId, JSON.stringify(settings)],
    );
    res.json({ ok: true, settings });
  } catch (error) {
    res.status(500).json({ error: safeErrMsg(error) });
  }
});

export default router;
