import { Router, type Request, type Response } from "express";
import {
  getGSCStatus,
  listGSCSites,
  getActiveSite,
  setActiveSite,
  syncGSCData,
  getTopKeywords,
  getTopPages,
  getImpressionsOverTime,
  querySearchAnalytics,
  getIndexingStatus,
  getSitemaps,
  getSyncLogs,
} from "../services/gsc-service.js";
import { hasGoogleConnection } from "../services/google-service.js";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

const router = Router();

function getOrgId(req: Request): string {
  return (req as unknown as Record<string, string>)["orgId"] ?? "default";
}

router.get("/gsc/status", async (req: Request, res: Response) => {
  try {
    const orgId  = getOrgId(req);
    const status = await getGSCStatus(orgId);
    // Also show as connected if Google tokens exist (site discovery in progress)
    const connected = status.connected || await hasGoogleConnection(orgId);
    res.json({ ok: true, ...status, connected, discovering: !status.connected && connected });
  } catch (e) {
    logger.error({ e }, "[GSC] /status failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.get("/gsc/sites", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const sites = await listGSCSites(orgId);
    const activeSite = await getActiveSite(orgId);
    res.json({ ok: true, sites, activeSite });
  } catch (e) {
    logger.error({ e }, "[GSC] /sites failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.post("/gsc/site", async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  const { siteUrl, displayName } = req.body as { siteUrl?: string; displayName?: string };
  if (!siteUrl?.trim()) {
    res.status(400).json({ ok: false, error: "siteUrl is required" });
    return;
  }
  try {
    await setActiveSite(orgId, siteUrl.trim(), displayName);
    syncGSCData(orgId).catch(e => logger.warn({ e }, "[GSC] Background sync failed"));
    res.json({ ok: true, siteUrl: siteUrl.trim() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.get("/gsc/analytics", async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  const days = Math.min(parseInt(req.query["days"] as string || "30"), 365);
  const { siteUrl: qSiteUrl } = req.query as { siteUrl?: string };

  try {
    const siteUrl = qSiteUrl || (await getActiveSite(orgId));
    if (!siteUrl) {
      res.status(400).json({ ok: false, error: "No GSC site selected. POST /api/gsc/site first." });
      return;
    }

    const endDate   = new Date().toISOString().split("T")[0]!;
    const startDate = new Date(Date.now() - days * 24 * 3_600_000).toISOString().split("T")[0]!;

    const [overview, byDevice, byCountry] = await Promise.all([
      querySearchAnalytics(orgId, siteUrl, { startDate, endDate, dimensions: ["date"],    rowLimit: 200 }),
      querySearchAnalytics(orgId, siteUrl, { startDate, endDate, dimensions: ["device"],  rowLimit: 10 }),
      querySearchAnalytics(orgId, siteUrl, { startDate, endDate, dimensions: ["country"], rowLimit: 20 }),
    ]);

    let totClicks = 0, totImpressions = 0, totPos = 0, posCount = 0;
    for (const row of overview as Array<{ clicks?: number; impressions?: number; position?: number }>) {
      totClicks      += row.clicks      ?? 0;
      totImpressions += row.impressions ?? 0;
      if (row.position) { totPos += row.position; posCount++; }
    }

    res.json({
      ok: true, siteUrl, days,
      summary: {
        clicks:      Math.round(totClicks),
        impressions: Math.round(totImpressions),
        ctr:         totImpressions > 0 ? parseFloat((totClicks / totImpressions * 100).toFixed(2)) : 0,
        avgPosition: posCount > 0 ? parseFloat((totPos / posCount).toFixed(1)) : 0,
      },
      timeSeries: overview,
      byDevice,
      byCountry,
    });
  } catch (e) {
    logger.error({ e }, "[GSC] /analytics failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.get("/gsc/keywords", async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  const days  = Math.min(parseInt(req.query["days"] as string || "30"), 365);
  const limit = Math.min(parseInt(req.query["limit"] as string || "100"), 1000);
  const { siteUrl: qSiteUrl } = req.query as { siteUrl?: string };

  try {
    const siteUrl = qSiteUrl || (await getActiveSite(orgId));
    if (!siteUrl) {
      res.status(400).json({ ok: false, error: "No GSC site selected." });
      return;
    }
    const keywords = await getTopKeywords(orgId, siteUrl, days, limit);
    res.json({ ok: true, siteUrl, days, keywords });
  } catch (e) {
    logger.error({ e }, "[GSC] /keywords failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.get("/gsc/pages", async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  const days  = Math.min(parseInt(req.query["days"] as string || "30"), 365);
  const limit = Math.min(parseInt(req.query["limit"] as string || "100"), 1000);
  const { siteUrl: qSiteUrl } = req.query as { siteUrl?: string };

  try {
    const siteUrl = qSiteUrl || (await getActiveSite(orgId));
    if (!siteUrl) {
      res.status(400).json({ ok: false, error: "No GSC site selected." });
      return;
    }
    const pages = await getTopPages(orgId, siteUrl, days, limit);
    res.json({ ok: true, siteUrl, days, pages });
  } catch (e) {
    logger.error({ e }, "[GSC] /pages failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.get("/gsc/impressions", async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  const days  = Math.min(parseInt(req.query["days"] as string || "90"), 365);
  const { siteUrl: qSiteUrl } = req.query as { siteUrl?: string };

  try {
    const siteUrl = qSiteUrl || (await getActiveSite(orgId));
    if (!siteUrl) {
      res.status(400).json({ ok: false, error: "No GSC site selected." });
      return;
    }
    const timeSeries = await getImpressionsOverTime(orgId, siteUrl, days);
    res.json({ ok: true, siteUrl, days, timeSeries });
  } catch (e) {
    logger.error({ e }, "[GSC] /impressions failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.post("/gsc/indexing", async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  const { inspectionUrl, siteUrl: reqSiteUrl } = req.body as { inspectionUrl?: string; siteUrl?: string };
  if (!inspectionUrl?.trim()) {
    res.status(400).json({ ok: false, error: "inspectionUrl is required" });
    return;
  }
  try {
    const siteUrl = reqSiteUrl || (await getActiveSite(orgId));
    if (!siteUrl) {
      res.status(400).json({ ok: false, error: "No GSC site selected." });
      return;
    }
    const result = await getIndexingStatus(orgId, siteUrl, inspectionUrl);
    res.json({ ok: true, result });
  } catch (e) {
    logger.error({ e }, "[GSC] /indexing failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.get("/gsc/sitemaps", async (req: Request, res: Response) => {
  const orgId = getOrgId(req);
  const { siteUrl: qSiteUrl } = req.query as { siteUrl?: string };
  try {
    const siteUrl = qSiteUrl || (await getActiveSite(orgId));
    if (!siteUrl) {
      res.status(400).json({ ok: false, error: "No GSC site selected." });
      return;
    }
    const sitemaps = await getSitemaps(orgId, siteUrl);
    res.json({ ok: true, siteUrl, sitemaps });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.post("/gsc/sync", async (req: Request, res: Response) => {
  try {
    const result = await syncGSCData(getOrgId(req));
    res.json({ ok: true, ...result });
  } catch (e) {
    logger.error({ e }, "[GSC] Manual sync failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.post("/gsc/disconnect", async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query(`UPDATE gsc_sites SET is_active=false WHERE org_id=$1`, [getOrgId(req)]);
    res.json({ ok: true, message: "GSC disconnected" });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  } finally {
    client.release();
  }
});

router.get("/gsc/logs", async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query["limit"] as string || "20"), 100);
  try {
    const logs = await getSyncLogs(getOrgId(req), limit);
    res.json({ ok: true, logs });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;
