import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import {
  getClientStatus,
  getClientKPIs,
  getClientReports,
  getClientAudits,
} from "../services/client-mode-service.js";

const router = Router();
router.use(requireAuth);

type OrgReq = Request & { orgId?: string };
const org = (req: Request): string => (req as OrgReq).orgId ?? "default";

// ── GET /status ────────────────────────────────────────────────────────────
router.get("/status", async (req: Request, res: Response) => {
  try {
    const status = await getClientStatus(org(req));
    res.json(status);
  } catch {
    res.status(500).json({ error: "Failed to fetch client mode status" });
  }
});

// ── GET /kpis ────────────────────────────────────────────────────────────────
router.get("/kpis", async (req: Request, res: Response) => {
  try {
    const kpis = await getClientKPIs(org(req));
    res.json(kpis);
  } catch {
    res.status(500).json({ error: "Failed to fetch KPIs" });
  }
});

// ── GET /reports ──────────────────────────────────────────────────────────
router.get("/reports", async (req: Request, res: Response) => {
  try {
    const reports = await getClientReports(org(req));
    res.json(reports);
  } catch {
    res.status(500).json({ error: "Failed to fetch client reports" });
  }
});

// ── GET /audits ───────────────────────────────────────────────────────────
router.get("/audits", async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? 20), 10) || 20, 50);
  try {
    const audits = await getClientAudits(org(req), limit);
    res.json(audits);
  } catch {
    res.status(500).json({ error: "Failed to fetch client audits" });
  }
});

export default router;
