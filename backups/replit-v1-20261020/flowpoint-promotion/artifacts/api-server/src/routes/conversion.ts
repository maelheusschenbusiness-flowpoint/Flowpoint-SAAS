/**
 * routes/conversion.ts — Conversion analytics from GA4
 * Mounted at /api/conversion via router.use("/conversion", conversionRouter)
 *
 * Security model:
 *  - requireAuth enforces Bearer token + org context on all endpoints
 *  - orgId ALWAYS from req.orgContext.orgId — never from query/body/path
 *  - All data real GA4 only — no synthetic/fake/preview values
 *  - Division-by-zero → null (never invented rates)
 *
 * Endpoints:
 *  GET /api/conversion/status        — GA4 connection status
 *  GET /api/conversion/overview      — KPIs + period-over-period comparison
 *  GET /api/conversion/events        — conversion events + revenue
 *  GET /api/conversion/landing-pages — landing pages with conversions
 *  GET /api/conversion/sources       — channel/source/medium breakdown
 *  GET /api/conversion/devices       — device breakdown
 *  GET /api/conversion/geo           — country/city breakdown
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import {
  getConversionStatus,
  getConversionOverview,
  getConversionEvents,
  getConversionLandingPages,
  getConversionSources,
  getConversionDevices,
  getConversionGeo,
} from "../services/conversion-service.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.use(requireAuth);

function getOrgId(req: Request): string {
  const orgId = (req as any).orgContext?.orgId;
  if (!orgId) throw Object.assign(new Error("orgContext.orgId missing"), { status: 500 });
  return orgId;
}

function parseDays(req: Request, def = 30): number {
  const d = parseInt((req.query["days"] as string) || "");
  return Number.isFinite(d) && d >= 1 && d <= 365 ? d : def;
}

function dateBounds(days: number): { startDate: string; endDate: string } {
  const endDate   = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  return { startDate, endDate };
}

function handleError(res: Response, e: unknown, label: string): void {
  const err = e as Error & { status?: number };
  const status = err.status ?? 500;
  if (status >= 500) logger.error({ e, label }, `[conversion] ${label} failed`);
  res.status(status).json({ ok: false, error: err.message ?? String(e) });
}

// ── GET /api/conversion/status ────────────────────────────────────────────────
router.get("/status", async (req: Request, res: Response) => {
  try {
    const data = await getConversionStatus(getOrgId(req));
    res.json({ ok: true, ...data });
  } catch (e) { handleError(res, e, "GET /conversion/status"); }
});

// ── GET /api/conversion/overview ──────────────────────────────────────────────
router.get("/overview", async (req: Request, res: Response) => {
  try {
    const days = parseDays(req);
    const { startDate, endDate } = dateBounds(days);
    const data = await getConversionOverview(getOrgId(req), startDate, endDate);
    res.json({ ok: true, days, ...data });
  } catch (e) { handleError(res, e, "GET /conversion/overview"); }
});

// ── GET /api/conversion/events ────────────────────────────────────────────────
router.get("/events", async (req: Request, res: Response) => {
  try {
    const days = parseDays(req);
    const { startDate, endDate } = dateBounds(days);
    const data = await getConversionEvents(getOrgId(req), startDate, endDate);
    res.json({ ok: true, days, ...data });
  } catch (e) { handleError(res, e, "GET /conversion/events"); }
});

// ── GET /api/conversion/landing-pages ─────────────────────────────────────────
router.get("/landing-pages", async (req: Request, res: Response) => {
  try {
    const days = parseDays(req);
    const { startDate, endDate } = dateBounds(days);
    const data = await getConversionLandingPages(getOrgId(req), startDate, endDate);
    res.json({ ok: true, days, ...data });
  } catch (e) { handleError(res, e, "GET /conversion/landing-pages"); }
});

// ── GET /api/conversion/sources ───────────────────────────────────────────────
router.get("/sources", async (req: Request, res: Response) => {
  try {
    const days = parseDays(req);
    const { startDate, endDate } = dateBounds(days);
    const data = await getConversionSources(getOrgId(req), startDate, endDate);
    res.json({ ok: true, days, ...data });
  } catch (e) { handleError(res, e, "GET /conversion/sources"); }
});

// ── GET /api/conversion/devices ───────────────────────────────────────────────
router.get("/devices", async (req: Request, res: Response) => {
  try {
    const days = parseDays(req);
    const { startDate, endDate } = dateBounds(days);
    const data = await getConversionDevices(getOrgId(req), startDate, endDate);
    res.json({ ok: true, days, ...data });
  } catch (e) { handleError(res, e, "GET /conversion/devices"); }
});

// ── GET /api/conversion/geo ───────────────────────────────────────────────────
router.get("/geo", async (req: Request, res: Response) => {
  try {
    const days = parseDays(req);
    const { startDate, endDate } = dateBounds(days);
    const data = await getConversionGeo(getOrgId(req), startDate, endDate);
    res.json({ ok: true, days, ...data });
  } catch (e) { handleError(res, e, "GET /conversion/geo"); }
});

export default router;
