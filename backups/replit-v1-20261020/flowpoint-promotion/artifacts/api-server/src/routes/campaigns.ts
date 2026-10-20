import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getCampaignStatus, getCampaigns } from "../services/campaign-service.js";

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
    const data = await getCampaignStatus(getOrgId(req));
    res.json({ ok: true, ...data });
  } catch (e: any) {
    res.status(e?.status ?? 502).json({ ok: false, error: String(e?.message ?? e) });
  }
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const data = await getCampaigns(getOrgId(req), parseDays(req));
    res.json({ ok: true, data, source: "ga4" });
  } catch (e: any) {
    res.status(e?.status ?? 502).json({ ok: false, error: String(e?.message ?? e) });
  }
});

export default router;
