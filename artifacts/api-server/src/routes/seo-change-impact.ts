import { Router, type Request } from "express";
import { canWrite } from "../middlewares/requireRole.js";
import { requireAddon } from "../middlewares/planGate.js";
import { safeErrMsg } from "../lib/safe-error.js";
import {
  buildSEOChangeImpacts,
  DEFAULT_SEO_CHANGE_IMPACT_SETTINGS,
  normalizeSEOChangeImpactSettings,
  validateSEOChangeImpactSettings,
  type SEOAuditSnapshot,
} from "../services/seo-change-impact.js";

type DbResult = { rows: Record<string, unknown>[] };
type OrgRequest = Request & {
  orgId?: string;
  orgDb?: (sql: string, values?: unknown[]) => Promise<DbResult>;
};

const router = Router();
const getOrgId = (req: Request) => (req as OrgRequest).orgId;
const getOrgDb = (req: Request) => (req as OrgRequest).orgDb;

router.use("/seo-change-impact", requireAddon("seoChangeImpact", "SEO Change Impact"));

router.get("/seo-change-impact", async (req, res) => {
  const orgId = getOrgId(req);
  const db = getOrgDb(req);
  if (!orgId || !db) { res.status(401).json({ error: "Contexte d’organisation requis." }); return; }

  try {
    const saved = await db("SELECT settings FROM seo_change_impact_settings WHERE org_id=$1", [orgId]);
    const settings = normalizeSEOChangeImpactSettings(saved.rows[0]?.["settings"] ?? DEFAULT_SEO_CHANGE_IMPACT_SETTINGS);
    const auditRows = await db(
      `SELECT id, url, score, issues, speed, status, created_at
       FROM audits
       WHERE org_id=$1
         AND created_at >= NOW() - ($2::int * INTERVAL '1 day')
         AND status IN ('ok', 'warn')
         AND url <> ''
       ORDER BY url ASC, created_at DESC
       LIMIT 2000`,
      [orgId, settings.lookbackDays],
    );
    const snapshots: SEOAuditSnapshot[] = auditRows.rows.map(row => ({
      auditId: String(row["id"]),
      siteUrl: String(row["url"]),
      capturedAt: new Date(String(row["created_at"])).toISOString(),
      score: Number(row["score"] ?? 0),
      criticalIssues: Number(row["issues"] ?? 0),
      speed: Number(row["speed"] ?? 0),
      status: String(row["status"] ?? ""),
    }));
    const comparisons = buildSEOChangeImpacts(snapshots, settings);
    res.json({ ok: true, source: "audits", settings, comparisons, count: comparisons.length });
  } catch (error) {
    res.status(500).json({ error: safeErrMsg(error) });
  }
});

router.put("/seo-change-impact/settings", canWrite, async (req, res) => {
  const orgId = getOrgId(req);
  const db = getOrgDb(req);
  if (!orgId || !db) { res.status(401).json({ error: "Contexte d’organisation requis." }); return; }
  const settings = validateSEOChangeImpactSettings(req.body);
  if (!settings) {
    res.status(400).json({
      error: "Paramètres invalides : la période doit être comprise entre 7 et 365 jours et le seuil de score entre 0 et 100.",
      code: "INVALID_SEO_CHANGE_IMPACT_SETTINGS",
    });
    return;
  }

  try {
    await db(
      `INSERT INTO seo_change_impact_settings (org_id, settings, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (org_id) DO UPDATE SET settings=$2::jsonb, updated_at=NOW()`,
      [orgId, JSON.stringify(settings)],
    );
    res.json({ ok: true, settings });
  } catch (error) {
    res.status(500).json({ error: safeErrMsg(error) });
  }
});

export default router;
