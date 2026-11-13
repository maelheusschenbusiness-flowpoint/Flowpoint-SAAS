import { randomUUID } from "node:crypto";
import { Router, type Request } from "express";
import { canWrite } from "../middlewares/requireRole.js";
import { requireAddon } from "../middlewares/planGate.js";
import { safeErrMsg } from "../lib/safe-error.js";
import { evaluateOrganicCampaignGoal, type OrganicCampaignObservation } from "../services/organic-campaign-tracker.js";

type DbResult = { rows: Record<string, unknown>[]; rowCount?: number };
type OrgRequest = Request & {
  orgId?: string;
  orgDb?: (sql: string, values?: unknown[]) => Promise<DbResult>;
};

const router = Router();
const getOrgId = (req: Request) => (req as OrgRequest).orgId;
const getOrgDb = (req: Request) => (req as OrgRequest).orgDb;
const normalizeKeyword = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();

router.use("/organic-campaign-tracker", requireAddon("organicCampaignTracker", "Organic Campaign Tracker"));

router.get("/organic-campaign-tracker", async (req, res) => {
  const orgId = getOrgId(req);
  const db = getOrgDb(req);
  if (!orgId || !db) { res.status(401).json({ error: "Contexte d’organisation requis." }); return; }
  try {
    const [goals, observations] = await Promise.all([
      db(
        `SELECT id, keyword, target_position, minimum_clicks, created_at, updated_at
         FROM organic_campaign_goals WHERE org_id=$1 ORDER BY keyword ASC`,
        [orgId],
      ),
      db(
        `SELECT keyword, SUM(clicks)::int AS clicks, SUM(impressions)::int AS impressions,
                AVG(position)::float AS average_position, MAX(date) AS observed_at
         FROM gsc_keyword_data
         WHERE org_id=$1 AND date >= to_char(CURRENT_DATE - INTERVAL '28 days', 'YYYY-MM-DD')
         GROUP BY keyword`,
        [orgId],
      ),
    ]);
    const byKeyword = new Map(observations.rows.map(row => [normalizeKeyword(String(row["keyword"] ?? "")), row]));
    const campaigns = goals.rows.map(row => {
      const keyword = String(row["keyword"] ?? "");
      const measured = byKeyword.get(normalizeKeyword(keyword));
      const observation: OrganicCampaignObservation | null = measured ? {
        keyword: String(measured["keyword"] ?? ""),
        clicks: Number(measured["clicks"]),
        impressions: Number(measured["impressions"]),
        averagePosition: Number(measured["average_position"]),
        observedAt: String(measured["observed_at"] ?? ""),
      } : null;
      const goal = {
        keyword,
        targetPosition: Number(row["target_position"]),
        minimumClicks: Number(row["minimum_clicks"]),
      };
      return { id: row["id"], ...goal, ...evaluateOrganicCampaignGoal(goal, observation) };
    });
    res.json({ ok: true, source: "gsc_keyword_data", windowDays: 28, campaigns, count: campaigns.length });
  } catch (error) {
    res.status(500).json({ error: safeErrMsg(error) });
  }
});

router.post("/organic-campaign-tracker", canWrite, async (req, res) => {
  const orgId = getOrgId(req);
  const db = getOrgDb(req);
  if (!orgId || !db) { res.status(401).json({ error: "Contexte d’organisation requis." }); return; }
  const keyword = typeof req.body?.keyword === "string"
    ? req.body.keyword.normalize("NFKC").trim().toLocaleLowerCase()
    : "";
  const targetPosition = Number(req.body?.targetPosition);
  const minimumClicks = Number(req.body?.minimumClicks);
  try {
    if (keyword.length > 160) throw new RangeError("Campaign keyword must not exceed 160 characters");
    evaluateOrganicCampaignGoal({ keyword, targetPosition, minimumClicks }, null);
  } catch (error) {
    res.status(400).json({ error: safeErrMsg(error), code: "INVALID_CAMPAIGN_GOAL" });
    return;
  }
  try {
    const result = await db(
      `INSERT INTO organic_campaign_goals (id, org_id, keyword, target_position, minimum_clicks, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
       ON CONFLICT (org_id, keyword)
       DO UPDATE SET target_position=$4, minimum_clicks=$5, updated_at=NOW()
       RETURNING id, keyword, target_position, minimum_clicks, created_at, updated_at`,
      [randomUUID(), orgId, keyword, targetPosition, minimumClicks],
    );
    res.status(200).json({ ok: true, campaign: result.rows[0] ?? null });
  } catch (error) {
    res.status(500).json({ error: safeErrMsg(error) });
  }
});

router.delete("/organic-campaign-tracker/:id", canWrite, async (req, res) => {
  const orgId = getOrgId(req);
  const db = getOrgDb(req);
  if (!orgId || !db) { res.status(401).json({ error: "Contexte d’organisation requis." }); return; }
  try {
    const result = await db("DELETE FROM organic_campaign_goals WHERE id=$1 AND org_id=$2", [req.params["id"], orgId]);
    if ((result.rowCount ?? result.rows.length) === 0) { res.status(404).json({ error: "Campagne introuvable.", code: "CAMPAIGN_NOT_FOUND" }); return; }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: safeErrMsg(error) });
  }
});

export default router;
