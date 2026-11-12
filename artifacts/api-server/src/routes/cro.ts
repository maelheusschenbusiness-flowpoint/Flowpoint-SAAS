import { Router, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { canWrite } from "../middlewares/requireRole.js";
import { requireAddon } from "../middlewares/planGate.js";
import { logger } from "../lib/logger.js";
import { deriveConversionObservations, type ConversionObservation } from "../services/conversion-observations.js";
import { analyzeCroPage, type CroPageAnalysis } from "../services/cro-service.js";

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

async function persistRecommendations(
  req: Request,
  observations: ConversionObservation[],
  pageAnalysis?: CroPageAnalysis,
  siteUrl?: string,
) {
  const orgId = (req as OrgReq).orgId ?? "default";
  const recommendations: Array<{
    id: string; org_id: string; site_url: string; page: string; type: string;
    title: string; description: string; source: string; metadata: Record<string, unknown>;
  }> = observations.map(item => ({
    id: `cro_${createHash("sha256").update(JSON.stringify(["events", orgId, item.siteUrl, item.page, item.eventType])).digest("hex")}`,
    org_id: orgId, site_url: item.siteUrl ?? "", page: item.page,
    type: item.eventType, title: item.recommendation,
    description: `${item.observedEvents} événements observés sur ${item.affectedSessions} sessions au cours des 30 derniers jours.`,
    source: "behavior_events",
    metadata: { observedEvents: item.observedEvents, affectedSessions: item.affectedSessions, confidence: item.confidence },
  }));
  if (pageAnalysis?.status === "ok") {
    const page = new URL(pageAnalysis.analyzedUrl).pathname || "/";
    for (const finding of pageAnalysis.findings) {
      recommendations.push({
        id: `cro_${createHash("sha256").update(JSON.stringify(["page", orgId, pageAnalysis.siteUrl, page, finding.type, finding.id, finding.source])).digest("hex")}`,
        org_id: orgId, site_url: pageAnalysis.siteUrl, page,
        type: finding.type, title: finding.title, description: finding.description,
        source: finding.source,
        metadata: {
          evidence: finding.evidence, implementation: finding.implementation,
          priority: finding.priority, analyzedAt: pageAnalysis.analyzedAt,
        },
      });
    }
  }
  if (recommendations.length) {
    const { rows } = await db(req)(
      `INSERT INTO cro_recommendations (id, org_id, site_url, page, type, title, description, source, metadata, status, ai_generated, updated_at)
       SELECT id, org_id, site_url, page, type, title, description, source, metadata,
              'pending', source='ai', now()
       FROM jsonb_to_recordset($1::jsonb) AS r(id text, org_id text, site_url text, page text, type text, title text, description text, source text, metadata jsonb)
       ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, description=EXCLUDED.description,
         source=EXCLUDED.source, metadata=EXCLUDED.metadata, updated_at=now()
       WHERE cro_recommendations.org_id=EXCLUDED.org_id
       RETURNING id`,
      [JSON.stringify(recommendations)],
    );
    if (new Set(rows.map(row => String(row.id))).size !== recommendations.length) {
      throw new Error("CRO recommendations were not persisted");
    }
  }

  const params: unknown[] = [orgId];
  const siteClause = siteUrl ? (params.push(siteUrl), " AND site_url=$2") : "";
  const { rows } = await db(req)(
    `SELECT id, site_url AS "siteUrl", page, type, title, description, source, status, metadata
       FROM cro_recommendations
      WHERE org_id=$1${siteClause}
      ORDER BY updated_at DESC NULLS LAST, id
      LIMIT 500`,
    params,
  );
  return rows.map(row => {
    const metadata = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata ?? {};
    return {
      ...metadata, id: row.id, siteUrl: row.siteUrl, page: row.page,
      type: row.type, title: row.title, description: row.description,
      source: row.source, status: row.status,
      frequency: metadata.observedEvents ?? null,
    };
  });
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
    res.status(503).json({ error: "Site ownership could not be verified" });
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
    const recommendations = await persistRecommendations(req, observations, undefined, siteUrl);
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
    const recommendations = await persistRecommendations(req, observations, pageAnalysis, siteUrl);
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
