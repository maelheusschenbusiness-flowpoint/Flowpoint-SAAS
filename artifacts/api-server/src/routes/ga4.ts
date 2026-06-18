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
const ORG_ID = "default";

// ── Helper: resolve property ID ───────────────────────────────────────────────

async function resolveProperty(req: Request): Promise<string | null> {
  const pid = (req.query["propertyId"] ?? (req.body as Record<string, unknown>)?.["propertyId"]) as string | undefined;
  if (pid) return pid;
  return getStoredProperty(ORG_ID);
}

// ── GET /api/ga4/status ───────────────────────────────────────────────────────

router.get("/ga4/status", async (_req: Request, res: Response) => {
  try {
    const connected = await isGA4Connected(ORG_ID);
    const propertyId = connected ? await getStoredProperty(ORG_ID) : null;
    res.json({ ok: true, connected, propertyId });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── GET /api/ga4/accounts ─────────────────────────────────────────────────────

router.get("/ga4/accounts", async (_req: Request, res: Response) => {
  try {
    const accounts = await listGA4Accounts(ORG_ID);
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
    const properties = await listGA4Properties(ORG_ID, accountId);
    res.json({ ok: true, properties });
  } catch (e) {
    logger.error({ e }, "[GA4] /properties failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── POST /api/ga4/property ────────────────────────────────────────────────────

router.post("/ga4/property", async (req: Request, res: Response) => {
  const { propertyId, propertyName } = req.body as { propertyId: string; propertyName?: string };
  if (!propertyId?.trim()) {
    res.status(400).json({ ok: false, error: "propertyId is required" });
    return;
  }
  try {
    await setStoredProperty(ORG_ID, propertyId.trim(), propertyName || propertyId.trim());
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
    const data = await getGA4Overview(ORG_ID, pid, days);
    res.json({ ok: true, propertyId: pid, data });
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
    const data = await getGA4Realtime(ORG_ID, pid);
    res.json({ ok: true, propertyId: pid, data, ts: Date.now() });
  } catch (e) {
    logger.error({ e }, "[GA4] /realtime failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

// ── GET /api/ga4/sources ──────────────────────────────────────────────────────

router.get("/ga4/sources", async (req: Request, res: Response) => {
  try {
    const pid = await resolveProperty(req);
    if (!pid) { res.status(400).json({ ok: false, error: "No GA4 property configured." }); return; }
    const days = Math.min(parseInt(req.query["days"] as string || "30"), 365);
    const data = await getGA4Sources(ORG_ID, pid, days);
    res.json({ ok: true, data });
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
    const data = await getGA4Pages(ORG_ID, pid, days);
    res.json({ ok: true, data });
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
    const days = Math.min(parseInt(req.query["days"] as string || "30"), 365);
    const data = await getGA4Funnels(ORG_ID, pid, days);
    res.json({ ok: true, data });
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
    const data = await getGA4Conversions(ORG_ID, pid, days);
    res.json({ ok: true, data });
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
    const data = await getGA4Audience(ORG_ID, pid, days);
    res.json({ ok: true, data });
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
    const data = await getGA4Campaigns(ORG_ID, pid, days);
    res.json({ ok: true, data });
  } catch (e) {
    logger.error({ e }, "[GA4] /campaigns failed");
    res.status(500).json({ ok: false, error: String(e) });
  }
});

export default router;
