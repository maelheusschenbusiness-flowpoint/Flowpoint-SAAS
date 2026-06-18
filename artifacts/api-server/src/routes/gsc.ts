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
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

const router = Router();
const ORG_ID = "default";

router.get("/gsc/status", async (_req: Request, res: Response) => {
  try {
    const status = await getGSCStatus(ORG_ID);
    res.json({ ok: true, ...status });
  } catch (e) {
    logger.error({ e }, "[GSC] /status failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.get("/gsc/sites", async (_req: Request, res: Response) => {
  try {
    const sites = await listGSCSites(ORG_ID);
    const activeSite = await getActiveSite(ORG_ID);
    res.json({ ok: true, sites, activeSite });
  } catch (e) {
    logger.error({ e }, "[GSC] /sites failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.post("/gsc/site", async (req: Request, res: Response) => {
  const { siteUrl, displayName } = req.body as { siteUrl?: string; displayName?: string };
  if (!siteUrl?.trim()) {
    res.status(400).json({ ok: false, error: "siteUrl is required" });
    return;
  }
  try {
    await setActiveSite(ORG_ID, siteUrl.trim(), displayName);
    syncGSCData(ORG_ID).catch(e => logger.warn({ e }, "[GSC] Background sync failed"));
    res.json({ ok: true, siteUrl: siteUrl.trim() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.get("/gsc/analytics", async (req: Request, res: Response) => {
  const days = Math.min(parseInt(req.query["days"] as string || "30"), 365);
  const { siteUrl: qSiteUrl } = req.query as { siteUrl?: string };

  try {
    const siteUrl = qSiteUrl || (await getActiveSite(ORG_ID));
    if (!siteUrl) {
      res.status(400).json({ ok: false, error: "No GSC site selected. POST /api/gsc/site first." });
      return;
    }

    const endDate = new Date().toISOString().split("T")[0]!;
    const startDate = new Date(Date.now() - days * 24 * 3600_000).toISOString().split("T")[0]!;

    const overview = await querySearchAnalytics(ORG_ID, siteUrl, {
      startDate,
      endDate,
      dimensions: ["date"],
      rowLimit: 200,
    });

    const byDevice = await querySearchAnalytics(ORG_ID, siteUrl, {
      startDate,
      endDate,
      dimensions: ["device"],
      rowLimit: 10,
    });

    const byCountry = await querySearchAnalytics(ORG_ID, siteUrl, {
      startDate,
      endDate,
      dimensions: ["country"],
      rowLimit: 20,
    });

    let totClicks = 0, totImpressions = 0, totPos = 0, posCount = 0;
    for (const row of overview as Array<{ clicks?: number; impressions?: number; position?: number }>) {
      totClicks += row.clicks ?? 0;
      totImpressions += row.impressions ?? 0;
      if (row.position) { totPos += row.position; posCount++; }
    }

    res.json({
      ok: true,
      siteUrl,
      days,
      summary: {
        clicks: Math.round(totClicks),
        impressions: Math.round(totImpressions),
        ctr: totImpressions > 0 ? parseFloat((totClicks / totImpressions * 100).toFixed(2)) : 0,
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
  const days = Math.min(parseInt(req.query["days"] as string || "30"), 365);
  const limit = Math.min(parseInt(req.query["limit"] as string || "100"), 1000);
  const { siteUrl: qSiteUrl } = req.query as { siteUrl?: string };

  try {
    const siteUrl = qSiteUrl || (await getActiveSite(ORG_ID));
    if (!siteUrl) {
      res.status(400).json({ ok: false, error: "No GSC site selected." });
      return;
    }

    const keywords = await getTopKeywords(ORG_ID, siteUrl, days, limit);
    res.json({ ok: true, siteUrl, days, keywords });
  } catch (e) {
    logger.error({ e }, "[GSC] /keywords failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.get("/gsc/pages", async (req: Request, res: Response) => {
  const days = Math.min(parseInt(req.query["days"] as string || "30"), 365);
  const limit = Math.min(parseInt(req.query["limit"] as string || "100"), 1000);
  const { siteUrl: qSiteUrl } = req.query as { siteUrl?: string };

  try {
    const siteUrl = qSiteUrl || (await getActiveSite(ORG_ID));
    if (!siteUrl) {
      res.status(400).json({ ok: false, error: "No GSC site selected." });
      return;
    }

    const pages = await getTopPages(ORG_ID, siteUrl, days, limit);
    res.json({ ok: true, siteUrl, days, pages });
  } catch (e) {
    logger.error({ e }, "[GSC] /pages failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.get("/gsc/impressions", async (req: Request, res: Response) => {
  const days = Math.min(parseInt(req.query["days"] as string || "90"), 365);
  const { siteUrl: qSiteUrl } = req.query as { siteUrl?: string };

  try {
    const siteUrl = qSiteUrl || (await getActiveSite(ORG_ID));
    if (!siteUrl) {
      res.status(400).json({ ok: false, error: "No GSC site selected." });
      return;
    }

    const timeSeries = await getImpressionsOverTime(ORG_ID, siteUrl, days);
    res.json({ ok: true, siteUrl, days, timeSeries });
  } catch (e) {
    logger.error({ e }, "[GSC] /impressions failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.post("/gsc/indexing", async (req: Request, res: Response) => {
  const { inspectionUrl, siteUrl: reqSiteUrl } = req.body as { inspectionUrl?: string; siteUrl?: string };
  if (!inspectionUrl?.trim()) {
    res.status(400).json({ ok: false, error: "inspectionUrl is required" });
    return;
  }

  try {
    const siteUrl = reqSiteUrl || (await getActiveSite(ORG_ID));
    if (!siteUrl) {
      res.status(400).json({ ok: false, error: "No GSC site selected." });
      return;
    }
    const result = await getIndexingStatus(ORG_ID, siteUrl, inspectionUrl);
    res.json({ ok: true, result });
  } catch (e) {
    logger.error({ e }, "[GSC] /indexing failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.get("/gsc/sitemaps", async (req: Request, res: Response) => {
  const { siteUrl: qSiteUrl } = req.query as { siteUrl?: string };
  try {
    const siteUrl = qSiteUrl || (await getActiveSite(ORG_ID));
    if (!siteUrl) {
      res.status(400).json({ ok: false, error: "No GSC site selected." });
      return;
    }
    const sitemaps = await getSitemaps(ORG_ID, siteUrl);
    res.json({ ok: true, siteUrl, sitemaps });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.post("/gsc/sync", async (_req: Request, res: Response) => {
  try {
    const result = await syncGSCData(ORG_ID);
    res.json({ ok: true, ...result });
  } catch (e) {
    logger.error({ e }, "[GSC] Manual sync failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.post("/gsc/disconnect", async (_req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query(`UPDATE gsc_sites SET is_active=false WHERE org_id=$1`, [ORG_ID]);
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
    const logs = await getSyncLogs(ORG_ID, limit);
    res.json({ ok: true, logs });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;
