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
import { logger } from "../lib/logger.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function getOrgId(req: Request): string {
  return (req as unknown as Record<string, string>)["orgId"] ?? "default";
}

function daysToRange(days: number): { startDate: string; endDate: string } {
  const end   = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate:   end.toISOString().slice(0, 10),
  };
}

async function resolveProperty(req: Request): Promise<string | null> {
  const pid = (
    (req.query["propertyId"] as string | undefined) ??
    ((req.body as Record<string, unknown>)?.["propertyId"] as string | undefined)
  );
  if (pid?.trim()) return pid.trim();
  const stored = await getStoredProperty(getOrgId(req));
  return stored?.propertyId ?? null;
}

// ── GET /api/ga4/status ───────────────────────────────────────────────────────

router.get("/ga4/status", async (req: Request, res: Response) => {
  try {
    const orgId     = getOrgId(req);
    const connected = await isGA4Connected(orgId);
    const stored    = connected ? await getStoredProperty(orgId) : null;
    res.json({ ok: true, connected, propertyId: stored?.propertyId ?? null, propertyName: stored?.displayName ?? null });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── GET /api/ga4/accounts ─────────────────────────────────────────────────────

router.get("/ga4/accounts", async (req: Request, res: Response) => {
  try {
    const accounts = await listGA4Accounts(getOrgId(req));
    res.json({ ok: true, accounts });
  } catch (e) {
    logger.error({ e }, "[GA4] /accounts failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── GET /api/ga4/properties ───────────────────────────────────────────────────

router.get("/ga4/properties", async (req: Request, res: Response) => {
  try {
    const { accountId } = req.query as { accountId?: string };
    const properties = await listGA4Properties(accountId ?? "", getOrgId(req));
    res.json({ ok: true, properties });
  } catch (e) {
    logger.error({ e }, "[GA4] /properties failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── POST /api/ga4/property ────────────────────────────────────────────────────

router.post("/ga4/property", async (req: Request, res: Response) => {
  const { propertyId, propertyName } = req.body as { propertyId?: string; propertyName?: string };
  if (!propertyId?.trim()) {
    res.status(400).json({ ok: false, error: "propertyId is required" });
    return;
  }
  try {
    await setStoredProperty(getOrgId(req), propertyId.trim(), propertyName || propertyId.trim());
    res.json({ ok: true, propertyId: propertyId.trim() });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── GET /api/ga4/overview ─────────────────────────────────────────────────────

router.get("/ga4/overview", async (req: Request, res: Response) => {
  try {
    const pid = await resolveProperty(req);
    if (!pid) {
      res.status(400).json({ ok: false, error: "No GA4 property configured. POST /api/ga4/property first." });
      return;
    }
    const days = Math.min(parseInt(req.query["days"] as string || "30"), 365);
    const { startDate, endDate } = daysToRange(days);
    const data = await getGA4Overview(getOrgId(req), startDate, endDate);
    res.json({ ok: true, propertyId: pid, days, startDate, endDate, data });
  } catch (e) {
    logger.error({ e }, "[GA4] /overview failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── GET /api/ga4/realtime ─────────────────────────────────────────────────────

router.get("/ga4/realtime", async (req: Request, res: Response) => {
  try {
    const pid = await resolveProperty(req);
    if (!pid) {
      res.status(400).json({ ok: false, error: "No GA4 property configured." });
      return;
    }
    const data = await getGA4Realtime(getOrgId(req));
    res.json({ ok: true, propertyId: pid, data, ts: Date.now() });
  } catch (e) {
    logger.error({ e }, "[GA4] /realtime failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── GET /api/ga4/sources  &  /api/ga4/traffic-sources (alias) ────────────────

router.get(["/ga4/sources", "/ga4/traffic-sources"], async (req: Request, res: Response) => {
  try {
    const pid = await resolveProperty(req);
    if (!pid) { res.status(400).json({ ok: false, error: "No GA4 property configured." }); return; }
    const days = Math.min(parseInt(req.query["days"] as string || "30"), 365);
    const { startDate, endDate } = daysToRange(days);
    const data = await getGA4Sources(getOrgId(req), startDate, endDate);
    res.json({ ok: true, propertyId: pid, days, data });
  } catch (e) {
    logger.error({ e }, "[GA4] /sources failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── GET /api/ga4/pages ────────────────────────────────────────────────────────

router.get("/ga4/pages", async (req: Request, res: Response) => {
  try {
    const pid = await resolveProperty(req);
    if (!pid) { res.status(400).json({ ok: false, error: "No GA4 property configured." }); return; }
    const days = Math.min(parseInt(req.query["days"] as string || "30"), 365);
    const { startDate, endDate } = daysToRange(days);
    const data = await getGA4Pages(getOrgId(req), startDate, endDate);
    res.json({ ok: true, propertyId: pid, days, data });
  } catch (e) {
    logger.error({ e }, "[GA4] /pages failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── GET /api/ga4/funnels ──────────────────────────────────────────────────────

router.get("/ga4/funnels", async (req: Request, res: Response) => {
  try {
    const pid = await resolveProperty(req);
    if (!pid) { res.status(400).json({ ok: false, error: "No GA4 property configured." }); return; }
    const data = await getGA4Funnels(getOrgId(req));
    res.json({ ok: true, propertyId: pid, data });
  } catch (e) {
    logger.error({ e }, "[GA4] /funnels failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── GET /api/ga4/conversions ──────────────────────────────────────────────────

router.get("/ga4/conversions", async (req: Request, res: Response) => {
  try {
    const pid = await resolveProperty(req);
    if (!pid) { res.status(400).json({ ok: false, error: "No GA4 property configured." }); return; }
    const days = Math.min(parseInt(req.query["days"] as string || "30"), 365);
    const { startDate, endDate } = daysToRange(days);
    const data = await getGA4Conversions(getOrgId(req), startDate, endDate);
    res.json({ ok: true, propertyId: pid, days, data });
  } catch (e) {
    logger.error({ e }, "[GA4] /conversions failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── GET /api/ga4/audience ─────────────────────────────────────────────────────

router.get("/ga4/audience", async (req: Request, res: Response) => {
  try {
    const pid = await resolveProperty(req);
    if (!pid) { res.status(400).json({ ok: false, error: "No GA4 property configured." }); return; }
    const days = Math.min(parseInt(req.query["days"] as string || "30"), 365);
    const { startDate, endDate } = daysToRange(days);
    const data = await getGA4Audience(getOrgId(req), startDate, endDate);
    res.json({ ok: true, propertyId: pid, days, data });
  } catch (e) {
    logger.error({ e }, "[GA4] /audience failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── GET /api/ga4/campaigns ────────────────────────────────────────────────────

router.get("/ga4/campaigns", async (req: Request, res: Response) => {
  try {
    const pid = await resolveProperty(req);
    if (!pid) { res.status(400).json({ ok: false, error: "No GA4 property configured." }); return; }
    const days = Math.min(parseInt(req.query["days"] as string || "30"), 365);
    const { startDate, endDate } = daysToRange(days);
    const data = await getGA4Campaigns(getOrgId(req), startDate, endDate);
    res.json({ ok: true, propertyId: pid, days, data });
  } catch (e) {
    logger.error({ e }, "[GA4] /campaigns failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;
