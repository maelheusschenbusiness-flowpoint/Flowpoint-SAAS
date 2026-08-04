import { Router, type Request, type Response } from "express";
import {
  listGA4Accounts,
  listGA4Properties,
  getGA4Overview,
  getGA4Realtime,
  getGA4Sources,
  getGA4Pages,
  getGA4Funnels,
  getGA4Conversions,
  getGA4Audience,
  getGA4Campaigns,
  getStoredProperty,
  setStoredProperty,
  isGA4Connected,
} from "../services/ga4-service.js";
import { hasGoogleConnection } from "../services/google-service.js";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract orgId from the authenticated request context.
 * NEVER falls back to "default" for authenticated routes.
 * Throws a 500-tagged error if orgContext is absent (middleware configuration bug).
 */
function getOrgId(req: Request): string {
  const orgId = req.orgContext?.orgId;
  if (!orgId) {
    const err = new Error("orgContext.orgId missing — requireAuth middleware must run first");
    (err as Error & { status: number }).status = 500;
    throw err;
  }
  return orgId;
}

/**
 * Validate the `days` query parameter.
 * Accepts integers in [1, 365]. Returns 30 when the parameter is absent.
 * Throws a 400-tagged error for any invalid value (non-integer, out of range, non-numeric).
 */
function validateDays(req: Request): number {
  const raw = req.query["days"] as string | undefined;
  if (raw === undefined || raw === null || raw === "") return 30;
  const trimmed = raw.trim();
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > 365 || trimmed === "" || trimmed !== String(n)) {
    const err = new Error("days must be an integer between 1 and 365");
    (err as Error & { status: number }).status = 400;
    throw err;
  }
  return n;
}

function daysToRange(days: number): { startDate: string; endDate: string } {
  const end   = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate:   end.toISOString().slice(0, 10),
  };
}

/**
 * Resolve the GA4 property for this org with ownership validation.
 *
 * Security rules:
 *   - Always load the property stored for the authenticated org from DB.
 *   - If the client omits ?propertyId → use the stored property.
 *   - If the client sends ?propertyId that MATCHES the stored one → accepted.
 *   - If the client sends ?propertyId that DIFFERS → 403 property_not_owned.
 *     (Never reveal whether the requested propertyId belongs to another org.)
 *   - If no property is stored for the org → returns null (caller decides: 400).
 */
async function resolveProperty(
  req: Request,
  orgId: string
): Promise<string | null> {
  const stored    = await getStoredProperty(orgId);
  const storedPid = stored?.propertyId ?? null;

  const clientPid = (req.query["propertyId"] as string | undefined)?.trim() ||
                    ((req.body as Record<string, unknown>)?.["propertyId"] as string | undefined)?.trim();

  if (clientPid) {
    if (storedPid && clientPid === storedPid) return storedPid;
    const err = new Error("property_not_owned");
    (err as Error & { status: number; code: string }).status = 403;
    (err as Error & { status: number; code: string }).code   = "property_not_owned";
    throw err;
  }

  return storedPid;
}

/** Build a standard meta envelope. Compatible with existing consumers — added at the top level. */
function buildMeta(opts: {
  source?: string;
  days?: number;
  startDate?: string;
  endDate?: string;
  cached?: boolean;
  isEmpty?: boolean;
}): Record<string, unknown> {
  return {
    source:      opts.source      ?? "ga4",
    days:        opts.days        ?? null,
    startDate:   opts.startDate   ?? null,
    endDate:     opts.endDate     ?? null,
    generatedAt: new Date().toISOString(),
    cached:      opts.cached      ?? false,
    isEmpty:     opts.isEmpty     ?? false,
  };
}

/** Unified error handler for route-level try/catch. */
function handleRouteError(res: Response, e: unknown, label: string): void {
  const err    = e as Error & { status?: number; code?: string };
  const status = err.status ?? 500;
  if (status !== 400 && status !== 403) {
    logger.error({ e, label }, `[GA4] ${label} failed`);
  }
  if (status === 403) {
    res.status(403).json({ ok: false, error: err.code ?? "property_not_owned" });
    return;
  }
  if (status === 400) {
    res.status(400).json({ ok: false, error: err.message });
    return;
  }
  res.status(status).json({ ok: false, error: String(e) });
}

// ── GET /api/ga4/status ───────────────────────────────────────────────────────

router.get("/ga4/status", async (req: Request, res: Response) => {
  try {
    const orgId        = getOrgId(req);
    const hasProperty  = await isGA4Connected(orgId);
    const stored       = hasProperty ? await getStoredProperty(orgId) : null;
    const hasTokens    = hasProperty ? true : await hasGoogleConnection(orgId);

    // Check per-product disconnect flag
    const productRow = await pool.query(
      `SELECT connected FROM google_product_connections WHERE org_id=$1 AND product='ga4' LIMIT 1`,
      [orgId]
    ).catch(() => ({ rows: [] as Array<{ connected: boolean }> }));
    const productFlag = productRow.rows[0];
    const productDisconnected = productFlag !== undefined && !productFlag.connected;

    const connected = !productDisconnected && (hasProperty || hasTokens);
    res.json({
      ok: true,
      connected,
      discovering: !productDisconnected && !hasProperty && hasTokens,
      propertyId:   stored?.propertyId   ?? null,
      propertyName: stored?.displayName  ?? null,
    });
  } catch (e) {
    handleRouteError(res, e, "/ga4/status");
  }
});

// ── GET /api/ga4/accounts ─────────────────────────────────────────────────────

router.get("/ga4/accounts", async (req: Request, res: Response) => {
  try {
    const orgId    = getOrgId(req);
    const accounts = await listGA4Accounts(orgId);
    res.json({ ok: true, accounts });
  } catch (e) {
    handleRouteError(res, e, "/ga4/accounts");
  }
});

// ── GET /api/ga4/properties ───────────────────────────────────────────────────

router.get("/ga4/properties", async (req: Request, res: Response) => {
  try {
    const orgId      = getOrgId(req);
    const { accountId } = req.query as { accountId?: string };
    const properties = await listGA4Properties(accountId ?? "", orgId);
    res.json({ ok: true, properties });
  } catch (e) {
    handleRouteError(res, e, "/ga4/properties");
  }
});

// ── POST /api/ga4/property ────────────────────────────────────────────────────

router.post("/ga4/property", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const { propertyId, propertyName } = req.body as { propertyId?: string; propertyName?: string };
    if (!propertyId?.trim()) {
      res.status(400).json({ ok: false, error: "propertyId is required" });
      return;
    }
    await setStoredProperty(orgId, propertyId.trim(), propertyName || propertyId.trim());
    // Re-enable product flag when user explicitly sets a property
    pool.query(
      `INSERT INTO google_product_connections (org_id, product, connected, updated_at)
       VALUES ($1,'ga4',true,NOW())
       ON CONFLICT (org_id, product) DO UPDATE SET connected=true, updated_at=NOW()`,
      [orgId]
    ).catch(() => {});
    res.json({ ok: true, propertyId: propertyId.trim() });
  } catch (e) {
    handleRouteError(res, e, "/ga4/property");
  }
});

// ── GET /api/ga4/overview ─────────────────────────────────────────────────────

router.get("/ga4/overview", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const days  = validateDays(req);
    const pid   = await resolveProperty(req, orgId);
    if (!pid) {
      res.status(400).json({ ok: false, error: "No GA4 property configured. POST /api/ga4/property first." });
      return;
    }
    const { startDate, endDate } = daysToRange(days);
    const data = await getGA4Overview(orgId, startDate, endDate);
    const isEmpty = !data.rows?.length && !data.totals?.length;
    res.json({
      ok: true,
      propertyId: pid,
      days,
      startDate,
      endDate,
      data,
      meta: buildMeta({ days, startDate, endDate, isEmpty }),
    });
  } catch (e) {
    handleRouteError(res, e, "/ga4/overview");
  }
});

// ── GET /api/ga4/realtime ─────────────────────────────────────────────────────

router.get("/ga4/realtime", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const pid   = await resolveProperty(req, orgId);
    if (!pid) {
      res.status(400).json({ ok: false, error: "No GA4 property configured." });
      return;
    }
    const data = await getGA4Realtime(orgId);
    res.json({
      ok: true,
      propertyId: pid,
      data,
      meta: buildMeta({ isEmpty: !data.rows?.length }),
      ts: Date.now(),
    });
  } catch (e) {
    handleRouteError(res, e, "/ga4/realtime");
  }
});

// ── GET /api/ga4/sources  &  /api/ga4/traffic-sources (alias) ────────────────

router.get(["/ga4/sources", "/ga4/traffic-sources"], async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const days  = validateDays(req);
    const pid   = await resolveProperty(req, orgId);
    if (!pid) { res.status(400).json({ ok: false, error: "No GA4 property configured." }); return; }
    const { startDate, endDate } = daysToRange(days);
    const data = await getGA4Sources(orgId, startDate, endDate);
    const isEmpty = !data.rows?.length;
    res.json({
      ok: true,
      propertyId: pid,
      days,
      data,
      meta: buildMeta({ days, startDate, endDate, isEmpty }),
    });
  } catch (e) {
    handleRouteError(res, e, "/ga4/sources");
  }
});

// ── GET /api/ga4/pages  &  /api/ga4/top-pages (canonical alias) ──────────────

async function handlePagesRequest(req: Request, res: Response): Promise<void> {
  try {
    const orgId = getOrgId(req);
    const days  = validateDays(req);
    const pid   = await resolveProperty(req, orgId);
    if (!pid) { res.status(400).json({ ok: false, error: "No GA4 property configured." }); return; }
    const { startDate, endDate } = daysToRange(days);
    const data = await getGA4Pages(orgId, startDate, endDate);
    const isEmpty = !data.rows?.length;
    res.json({
      ok: true,
      propertyId: pid,
      days,
      data,
      meta: buildMeta({ days, startDate, endDate, isEmpty }),
    });
  } catch (e) {
    handleRouteError(res, e, "/ga4/pages");
  }
}

router.get("/ga4/pages",     handlePagesRequest);
router.get("/ga4/top-pages", handlePagesRequest);

// ── GET /api/ga4/funnels  &  /api/ga4/funnel (canonical alias) ───────────────

async function handleFunnelsRequest(req: Request, res: Response): Promise<void> {
  try {
    const orgId = getOrgId(req);
    const pid   = await resolveProperty(req, orgId);
    if (!pid) { res.status(400).json({ ok: false, error: "No GA4 property configured." }); return; }
    const data = await getGA4Funnels(orgId);
    const isEmpty = !data.landingPages?.rows?.length && !data.conversionPaths?.rows?.length;
    res.json({
      ok: true,
      propertyId: pid,
      data,
      meta: buildMeta({ isEmpty }),
    });
  } catch (e) {
    handleRouteError(res, e, "/ga4/funnels");
  }
}

router.get("/ga4/funnels", handleFunnelsRequest);
router.get("/ga4/funnel",  handleFunnelsRequest);

// ── GET /api/ga4/conversions ──────────────────────────────────────────────────

router.get("/ga4/conversions", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const days  = validateDays(req);
    const pid   = await resolveProperty(req, orgId);
    if (!pid) { res.status(400).json({ ok: false, error: "No GA4 property configured." }); return; }
    const { startDate, endDate } = daysToRange(days);
    const data = await getGA4Conversions(orgId, startDate, endDate);
    const isEmpty = !data.rows?.length;
    res.json({
      ok: true,
      propertyId: pid,
      days,
      data,
      meta: buildMeta({ days, startDate, endDate, isEmpty }),
    });
  } catch (e) {
    handleRouteError(res, e, "/ga4/conversions");
  }
});

// ── GET /api/ga4/audience ─────────────────────────────────────────────────────

router.get("/ga4/audience", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const days  = validateDays(req);
    const pid   = await resolveProperty(req, orgId);
    if (!pid) { res.status(400).json({ ok: false, error: "No GA4 property configured." }); return; }
    const { startDate, endDate } = daysToRange(days);
    const data = await getGA4Audience(orgId, startDate, endDate);
    const isEmpty = !data.devices?.rows?.length;
    res.json({
      ok: true,
      propertyId: pid,
      days,
      data,
      meta: buildMeta({ days, startDate, endDate, isEmpty }),
    });
  } catch (e) {
    handleRouteError(res, e, "/ga4/audience");
  }
});

// ── GET /api/ga4/campaigns ────────────────────────────────────────────────────

router.get("/ga4/campaigns", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const days  = validateDays(req);
    const pid   = await resolveProperty(req, orgId);
    if (!pid) { res.status(400).json({ ok: false, error: "No GA4 property configured." }); return; }
    const { startDate, endDate } = daysToRange(days);
    const data = await getGA4Campaigns(orgId, startDate, endDate);
    res.json({
      ok: true,
      propertyId: pid,
      days,
      data,
      meta: buildMeta({ days, startDate, endDate }),
    });
  } catch (e) {
    handleRouteError(res, e, "/ga4/campaigns");
  }
});

// ── GET /api/ga4/export ───────────────────────────────────────────────────────

router.get("/ga4/export", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const days  = validateDays(req);
    const pid   = await resolveProperty(req, orgId);
    if (!pid) {
      res.status(400).json({ ok: false, error: "No GA4 property configured." });
      return;
    }
    const { startDate, endDate } = daysToRange(days);

    const [overview, sources, pages] = await Promise.all([
      getGA4Overview(orgId, startDate, endDate),
      getGA4Sources(orgId, startDate, endDate),
      getGA4Pages(orgId, startDate, endDate),
    ]);

    const isEmpty =
      !overview.rows?.length &&
      !sources.rows?.length &&
      !pages.rows?.length;

    res.json({
      ok: true,
      propertyId: pid,
      days,
      startDate,
      endDate,
      data: { overview, sources, pages },
      meta: buildMeta({ days, startDate, endDate, isEmpty }),
    });
  } catch (e) {
    handleRouteError(res, e, "/ga4/export");
  }
});

// ── POST /api/ga4/disconnect ──────────────────────────────────────────────────

router.post("/ga4/disconnect", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    // Deactivate stored property for this org
    await pool.query(`UPDATE ga4_properties SET is_active=false WHERE org_id=$1`, [orgId]);
    // Mark per-product disconnect flag so status endpoint reports disconnected
    // even while the shared Google token remains valid for GBP/GSC.
    await pool.query(
      `INSERT INTO google_product_connections (org_id, product, connected, updated_at)
       VALUES ($1,'ga4',false,NOW())
       ON CONFLICT (org_id, product) DO UPDATE SET connected=false, updated_at=NOW()`,
      [orgId]
    ).catch(() => {}); // table created at boot; ignore if not yet created (first boot race)
    res.json({ ok: true, message: "GA4 disconnected" });
  } catch (e) {
    handleRouteError(res, e, "/ga4/disconnect");
  }
});

export default router;
