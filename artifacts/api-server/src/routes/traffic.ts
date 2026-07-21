import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import {
  getTrafficStatus,
  getTrafficSources,
  getTrafficOrganicKeywords,
  getTrafficOrganicPages,
} from "../services/traffic-service.js";

const router = Router();

function getOrgId(req: Request): string {
  const id = (req as any).orgContext?.orgId;
  if (!id) throw Object.assign(new Error("orgContext.orgId missing"), { status: 500 });
  return id;
}

function parseDays(req: Request, def = 30): number {
  const d = parseInt((req.query.days as string) || "");
  return Number.isFinite(d) && d >= 1 && d <= 365 ? d : def;
}

router.use(requireAuth);

router.get("/status", async (req: Request, res: Response) => {
  try {
    const data = await getTrafficStatus(getOrgId(req));
    res.json({ ok: true, ...data });
  } catch (e: any) {
    res.status(e?.status ?? 502).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.get("/sources", async (req: Request, res: Response) => {
  try {
    const data = await getTrafficSources(getOrgId(req), parseDays(req));
    res.json({ ok: true, data, source: "ga4" });
  } catch (e: any) {
    res.status(e?.status ?? 502).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.get("/organic/keywords", async (req: Request, res: Response) => {
  try {
    const days = parseDays(req, 28);
    const data = await getTrafficOrganicKeywords(getOrgId(req), days);
    res.json({ ok: true, data, source: "gsc" });
  } catch (e: any) {
    res.status(e?.status ?? 502).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.get("/organic/pages", async (req: Request, res: Response) => {
  try {
    const days = parseDays(req, 28);
    const data = await getTrafficOrganicPages(getOrgId(req), days);
    res.json({ ok: true, data, source: "gsc" });
  } catch (e: any) {
    res.status(e?.status ?? 502).json({ ok: false, error: String(e?.message ?? e) });
  }
});

export default router;
