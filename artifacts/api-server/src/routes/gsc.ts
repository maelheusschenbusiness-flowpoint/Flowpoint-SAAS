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
import { resolveOrgId } from "../lib/resolve-org-id.js";

const router = Router();

function getOrgId(req: Request): string {
  return resolveOrgId(req);
}

router.get("/gsc/status", async (req: Request, res: Response) => {
  let orgId: string;
  try { orgId = getOrgId(req); } catch { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
  try {
    const status = await getGSCStatus(orgId);
    const hasToken = await hasGoogleConnection(orgId);

    // Check per-product disconnect flag
    const productRow = await pool.query(
      `SELECT connected FROM google_product_connections WHERE org_id=$1 AND product='gsc' LIMIT 1`,
      [orgId]
    ).catch(() => ({ rows: [] as Array<{ connected: boolean }> }));
    const productFlag = productRow.rows[0];
    const productDisconnected = productFlag !== undefined && !productFlag.connected;

    // Connected = has active site AND not explicitly disconnected
    const connected = !productDisconnected && (status.connected || hasToken);
    const discovering = !productDisconnected && !status.connected && hasToken;

    res.json({ ok: true, ...status, connected, discovering });
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
  } catch (e: any) {
    if (e?.status === 401) { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
    logger.error({ e }, "[GSC] /sites failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.post("/gsc/site", async (req: Request, res: Response) => {
  let orgId: string;
  try { orgId = getOrgId(req); } catch { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
  const { siteUrl, displayName } = req.body as { siteUrl?: string; displayName?: string };
  if (!siteUrl?.trim()) {
    res.status(400).json({ ok: false, error: "siteUrl is required" });
    return;
  }
  try {
    await setActiveSite(orgId, siteUrl.trim(), displayName);
    // Re-enable product flag when user explicitly sets a site
    pool.query(
      `INSERT INTO google_product_connections (org_id, product, connected, updated_at)
       VALUES ($1,'gsc',true,NOW())
       ON CONFLICT (org_id, product) DO UPDATE SET connected=true, updated_at=NOW()`,
      [orgId]
    ).catch(() => {});
    syncGSCData(orgId).catch(e => logger.warn({ e }, "[GSC] Background sync failed"));
    res.json({ ok: true, siteUrl: siteUrl.trim() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.get("/gsc/analytics", async (req: Request, res: Response) => {
  let orgId: string;
  try { orgId = getOrgId(req); } catch { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
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
  let orgId: string;
  try { orgId = getOrgId(req); } catch { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
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
  let orgId: string;
  try { orgId = getOrgId(req); } catch { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
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
  let orgId: string;
  try { orgId = getOrgId(req); } catch { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
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
  let orgId: string;
  try { orgId = getOrgId(req); } catch { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
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
  let orgId: string;
  try { orgId = getOrgId(req); } catch { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
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
  let orgId: string;
  try { orgId = getOrgId(req); } catch { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
  try {
    const result = await syncGSCData(orgId);
    res.json({ ok: true, count: result });
  } catch (e) {
    logger.error({ e }, "[GSC] Manual sync failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

router.post("/gsc/disconnect", async (req: Request, res: Response) => {
  let orgId: string;
  try { orgId = getOrgId(req); } catch { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
  const client = await pool.connect();
  try {
    await client.query(`UPDATE gsc_sites SET is_active=false WHERE org_id=$1`, [orgId]);
    // Mark per-product flag so status endpoint reports disconnected even if shared token remains
    await client.query(
      `INSERT INTO google_product_connections (org_id, product, connected, updated_at)
       VALUES ($1,'gsc',false,NOW())
       ON CONFLICT (org_id, product) DO UPDATE SET connected=false, updated_at=NOW()`,
      [orgId]
    ).catch(() => {}); // table created at boot; ignore if not yet created (first boot race)
    res.json({ ok: true, message: "GSC disconnected" });
  } catch (e) {
    logger.error({ e, orgId }, "[GSC] disconnect failed");
    res.status(500).json({ ok: false, error: String(e) });
  } finally {
    client.release();
  }
});

router.get("/gsc/logs", async (req: Request, res: Response) => {
  let orgId: string;
  try { orgId = getOrgId(req); } catch { res.status(401).json({ ok: false, error: "Unauthorized" }); return; }
  const limit = Math.min(parseInt(req.query["limit"] as string || "20"), 100);
  try {
    const logs = await getSyncLogs(orgId, limit);
    res.json({ ok: true, logs });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;
