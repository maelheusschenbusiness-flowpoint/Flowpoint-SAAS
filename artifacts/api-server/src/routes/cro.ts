import { Router, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { canWrite } from "../middlewares/requireRole.js";
import { requireAddon } from "../middlewares/planGate.js";
import { logger } from "../lib/logger.js";
import { deriveConversionObservations, type ConversionObservation } from "../services/conversion-observations.js";
import { analyzeCroPage } from "../services/cro-service.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const db = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

// Gate scoped to /cro/* only — path-less router.use() would intercept every route
// mounted after this router in index.ts (same catch-all pattern as behavioral.ts).
router.use("/cro", requireAddon("aiCro", "AI CRO Strategist"));

async function loadObservedInsights(req: Request, siteUrl?: string) {
  const orgId = (req as OrgReq).orgId ?? "default";
  const params: unknown[] = [orgId];
  let siteClause = "";
  if (siteUrl) {
    params.push(siteUrl);
    siteClause = " AND site_url = $2";
  }
  const { rows } = await db(req)(
     `SELECT site_url AS "siteUrl", page, session_id AS "sessionId", event_type AS "eventType",
            scroll_depth AS "scrollDepth"
       FROM behavior_events
      WHERE org_id = $1${siteClause}
        AND created_at >= now() - interval '30 days'
      ORDER BY created_at DESC
      LIMIT 20000`,
    params,
  );
  return deriveConversionObservations(rows);
}

async function persistRecommendations(req: Request, observations: ConversionObservation[]) {
  if (!observations.length) return [];
  const orgId = (req as OrgReq).orgId ?? "default";
  const recommendations = observations.map(item => ({
    id: `cro_${createHash("sha256").update(JSON.stringify([orgId, item.siteUrl, item.page, item.eventType])).digest("hex")}`,
    org_id: orgId, site_url: item.siteUrl ?? "", page: item.page,
    type: item.eventType, title: item.recommendation,
    description: `${item.observedEvents} événements observés sur ${item.affectedSessions} sessions au cours des 30 derniers jours.`,
    metadata: { observedEvents: item.observedEvents, affectedSessions: item.affectedSessions, confidence: item.confidence },
  }));
  const { rows } = await db(req)(
    `INSERT INTO cro_recommendations (id, org_id, site_url, page, type, title, description, source, metadata, status, ai_generated, updated_at)
     SELECT id, org_id, site_url, page, type, title, description, 'behavior_events', metadata, 'pending', false, now()
     FROM jsonb_to_recordset($1::jsonb) AS r(id text, org_id text, site_url text, page text, type text, title text, description text, metadata jsonb)
     ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description,
       metadata=EXCLUDED.metadata, updated_at=now()
     WHERE cro_recommendations.org_id=EXCLUDED.org_id
     RETURNING id, status`,
    [JSON.stringify(recommendations)],
  );
  const statuses = new Map(rows.map(row => [String(row.id), String(row.status)]));
  if (statuses.size !== recommendations.length) throw new Error("CRO recommendations were not persisted");
  return recommendations.map(item => ({
    id: item.id, siteUrl: item.site_url, page: item.page, type: item.type,
    title: item.title, description: item.description,
    ...item.metadata, frequency: item.metadata.observedEvents,
    source: "behavior_events", status: statuses.get(item.id),
  }));
}

async function assertSiteOwnership(req: OrgReq, siteUrl: string, res: Response): Promise<boolean> {
  const orgId = req.orgId ?? "default";
  try {
    const { rows } = await req.orgDb(
      `SELECT 1 FROM behavior_site_tokens WHERE org_id = $1 AND site_url = $2 LIMIT 1`,
      [orgId, siteUrl]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: "Site not found" });
      return false;
    }
    return true;
  } catch {
    res.status(404).json({ error: "Site not found" });
    return false;
  }
}

router.get("/cro", async (req: Request, res: Response) => {
  try {
    const { siteUrl } = req.query as { siteUrl?: string };
    if (siteUrl) {
      const owned = await assertSiteOwnership(req as OrgReq, siteUrl, res);
      if (!owned) return;
    }
    const observations = await loadObservedInsights(req, siteUrl);
    const recommendations = await persistRecommendations(req, observations);
    res.json({
      ok: true, source: "behavior_events", windowDays: 30, observations,
      recommendations,
      experiments: [], score: null, noData: observations.length === 0,
    });
  } catch (err) {
    logger.error({ err }, "[CRO] observed-event analysis failed");
    res.status(503).json({ error: "Les événements comportementaux sont temporairement indisponibles.", observations: [], noData: true });
  }
});

router.post("/cro/generate", canWrite, async (req: Request, res: Response) => {
  const { siteUrl } = req.body ?? {};
  if (!siteUrl) { res.status(400).json({ error: "siteUrl required" }); return; }
  const orgId = (req as OrgReq).orgId ?? "default";
  const owned = await assertSiteOwnership(req as OrgReq, siteUrl, res);
  if (!owned) return;
  try {
    const observations = await loadObservedInsights(req, siteUrl);
    // Analyse réelle de la page (fetch SSRF-safe). Jamais d'exception : en cas
    // d'échec, `pageAnalysis.status === "unavailable"` + message explicite.
    const pageAnalysis = await analyzeCroPage(siteUrl);
    const recommendations = await persistRecommendations(req, observations);
    res.json({ ok: true, source: "behavior_events", windowDays: 30, observations, recommendations, pageAnalysis });
  } catch (err) {
    logger.warn({ err, siteUrl, orgId }, "[CRO] observed-event analysis failed");
    res.status(503).json({ error: "Impossible d'analyser les événements collectés.", observations: [] });
  }
});

router.patch("/cro/recommendations/:id", canWrite, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body ?? {};
  if (!["pending", "in_progress", "implemented", "dismissed"].includes(status)) {
    res.status(400).json({ error: "Invalid recommendation status" }); return;
  }
  const orgId = (req as OrgReq).orgId ?? "default";
  try {
    const { rows } = await db(req)(
      `UPDATE cro_recommendations SET status=$1, updated_at=now() WHERE id=$2 AND org_id=$3 RETURNING id, status`,
      [status, id, orgId]
    );
    if (!rows.length) { res.status(404).json({ error: "Recommendation not found" }); return; }
    res.json({ ok: true, recommendation: rows[0] });
  } catch {
    res.status(500).json({ error: "Failed to update recommendation" });
  }
});

export default router;
