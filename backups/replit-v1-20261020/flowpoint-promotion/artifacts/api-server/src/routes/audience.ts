/**
 * routes/audience.ts — Audience analytics from GA4
 * Mounted at /api/audience via router.use("/audience", audienceRouter)
 *
 * Security model:
 *  - requireAuth enforces Bearer token + org context on all endpoints
 *  - orgId ALWAYS from req.orgContext.orgId — never from query/body
 *  - propertyId ALWAYS resolved server-side by ga4-service
 *  - All responses real GA4 data only — no synthetic/fake values
 *
 * Endpoints:
 *  GET /api/audience/status   — GA4 connection status
 *  GET /api/audience/overview — devices + geo + newVsReturn + overview metrics
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getAudienceStatus, getAudienceData } from "../services/audience-service.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.use(requireAuth);

function getOrgId(req: Request): string {
  const orgId = (req as any).orgContext?.orgId;
  if (!orgId) throw Object.assign(new Error("orgContext.orgId missing"), { status: 500 });
  return orgId;
}

function parseDays(req: Request): number {
  const d = parseInt((req.query["days"] as string) || "");
  return Number.isFinite(d) && d >= 1 && d <= 365 ? d : 30;
}

function handleError(res: Response, e: unknown, label: string): void {
  const err = e as Error & { status?: number };
  const status = err.status ?? 500;
  if (status >= 500) logger.error({ e, label }, `[audience] ${label} failed`);
  res.status(status).json({ ok: false, error: err.message ?? String(e) });
}

// ── GET /api/audience/status ─────────────────────────────────────────────────

router.get("/status", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const data = await getAudienceStatus(orgId);
    res.json({ ok: true, ...data });
  } catch (e) {
    handleError(res, e, "GET /audience/status");
  }
});

// ── GET /api/audience/overview ───────────────────────────────────────────────

router.get("/overview", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const days = parseDays(req);
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const data = await getAudienceData(orgId, startDate, endDate);
    res.json({ ok: true, source: "ga4", days, data });
  } catch (e) {
    handleError(res, e, "GET /audience/overview");
  }
});

export default router;
