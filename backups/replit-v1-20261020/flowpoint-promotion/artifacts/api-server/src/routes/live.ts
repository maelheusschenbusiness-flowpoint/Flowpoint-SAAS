/**
 * routes/live.ts — Live / Realtime analytics from GA4
 * Mounted at /api/live via router.use("/live", liveRouter)
 *
 * Security model:
 *  - requireAuth enforces Bearer token + org context on all endpoints
 *  - orgId ALWAYS from req.orgContext.orgId — never from query/body
 *  - propertyId ALWAYS resolved server-side by ga4-service
 *  - All responses real GA4 data only — no synthetic/fake values
 *
 * Endpoints:
 *  GET /api/live/status   — GA4 connection status
 *  GET /api/live/realtime — realtime active users + active pages/cities
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getLiveStatus, getLiveRealtime } from "../services/live-service.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.use(requireAuth);

function getOrgId(req: Request): string {
  const orgId = (req as any).orgContext?.orgId;
  if (!orgId) throw Object.assign(new Error("orgContext.orgId missing"), { status: 500 });
  return orgId;
}

function handleError(res: Response, e: unknown, label: string): void {
  const err = e as Error & { status?: number };
  const status = err.status ?? 500;
  if (status >= 500) logger.error({ e, label }, `[live] ${label} failed`);
  res.status(status).json({ ok: false, error: err.message ?? String(e) });
}

// ── GET /api/live/status ─────────────────────────────────────────────────────

router.get("/status", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const data = await getLiveStatus(orgId);
    res.json({ ok: true, ...data });
  } catch (e) {
    handleError(res, e, "GET /live/status");
  }
});

// ── GET /api/live/realtime ───────────────────────────────────────────────────

router.get("/realtime", async (req: Request, res: Response) => {
  try {
    const orgId = getOrgId(req);
    const data = await getLiveRealtime(orgId);
    res.json({ ok: true, ...data, source: "ga4" });
  } catch (e) {
    handleError(res, e, "GET /live/realtime");
  }
});

export default router;
