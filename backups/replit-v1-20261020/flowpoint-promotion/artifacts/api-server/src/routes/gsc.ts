import { Router, type Request, type Response } from "express";
import {
  getGSCStatus,
  listGSCSites,
  getActiveSite,
  setActiveSite,
  verifySiteOwnership,
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

/**
 * Resolve the effective siteUrl for a request.
 * - No override → org's active site.
 * - Override    → must be a site the org owns (gsc_sites row), else "forbidden".
 * Prevents callers from querying arbitrary GSC properties through our tokens.
 */
/**
 * Resolves the effective GSC site for a request (override or active default)
 * and requires VERIFIED provenance for it:
 *  - a gsc_sites row whose permission_level was written from Google's own
 *    sites/list (discovery or a previous live verification), excluding
 *    'siteUnverifiedUser'; or
 *  - a live sites/list check against the org's Google token (which backfills
 *    permission_level on success).
 * Raw row presence is NOT ownership — legacy rows persisted before the
 * activation gate existed are live-verified, and quarantined (deactivated)
 * if the token cannot access them.
 */
async function resolveSiteForOrg(orgId: string, requested?: string): Promise<
  { ok: true; siteUrl: string | null } | { ok: false; error: "forbidden" }
> {
  const override = requested?.trim() || null;
  const target = override ?? (await getActiveSite(orgId));
  if (!target) return { ok: true, siteUrl: null };

  const r = await pool.query(
    `SELECT permission_level FROM gsc_sites WHERE org_id=$1 AND site_url=$2 LIMIT 1`,
    [orgId, target]
  ).catch(() => ({ rows: [] as Array<{ permission_level: string | null }> }));
  const row = r.rows[0] as { permission_level: string | null } | undefined;

  // An override must at minimum exist as an org row before we spend a live check on it.
  if (override && !row) return { ok: false, error: "forbidden" };

  const verifiedProvenance =
    row?.permission_level != null && row.permission_level !== "siteUnverifiedUser";
  if (verifiedProvenance) return { ok: true, siteUrl: target };

  // Legacy/unverified row: live-verify against Google's site list for this org's token.
  const owned = await verifySiteOwnership(orgId, target);
  if (owned) return { ok: true, siteUrl: target };

  // Quarantine: deactivate so it stops being the silent default, then reject.
  await pool.query(
    `UPDATE gsc_sites SET is_active=false WHERE org_id=$1 AND site_url=$2`,
    [orgId, target]
  ).catch(() => {});
  logger.warn({ orgId, siteUrl: target }, "[GSC] quarantined unverifiable site row");
  return { ok: false, error: "forbidden" };
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
    // Ownership gate: the site must be verified against this org's Google
    // token (discovered list or live sites/list check) before it can be
    // persisted or activated. Prevents poisoning gsc_sites with foreign sites.
    const owned = await verifySiteOwnership(orgId, siteUrl.trim());
    if (!owned) {
      res.status(403).json({ ok: false, error: "siteUrl is not accessible with this organization's Google account" });
      return;
    }
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
    const resolved = await resolveSiteForOrg(orgId, qSiteUrl);
    if (!resolved.ok) { res.status(403).json({ ok: false, error: "siteUrl does not belong to this organization" }); return; }
    const siteUrl = resolved.siteUrl;
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
    const resolved = await resolveSiteForOrg(orgId, qSiteUrl);
    if (!resolved.ok) { res.status(403).json({ ok: false, error: "siteUrl does not belong to this organization" }); return; }
    const siteUrl = resolved.siteUrl;
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
    const resolved = await resolveSiteForOrg(orgId, qSiteUrl);
    if (!resolved.ok) { res.status(403).json({ ok: false, error: "siteUrl does not belong to this organization" }); return; }
    const siteUrl = resolved.siteUrl;
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
    const resolved = await resolveSiteForOrg(orgId, qSiteUrl);
    if (!resolved.ok) { res.status(403).json({ ok: false, error: "siteUrl does not belong to this organization" }); return; }
    const siteUrl = resolved.siteUrl;
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
    const resolvedIdx = await resolveSiteForOrg(orgId, reqSiteUrl);
    if (!resolvedIdx.ok) { res.status(403).json({ ok: false, error: "siteUrl does not belong to this organization" }); return; }
    const siteUrl = resolvedIdx.siteUrl;
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
    const resolved = await resolveSiteForOrg(orgId, qSiteUrl);
    if (!resolved.ok) { res.status(403).json({ ok: false, error: "siteUrl does not belong to this organization" }); return; }
    const siteUrl = resolved.siteUrl;
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
