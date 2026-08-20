import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import {
  getClientStatus,
  getClientKPIs,
  getClientReports,
  getClientAudits,
} from "../services/client-mode-service.js";
import { pool } from "@workspace/db";
import { mailer } from "../services/mailer.js";
import { logger } from "../lib/logger.js";

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

// ── POST /reports/:reportId/send ─────────────────────────────────────────────
// Sends a client report by email using the centralised mailer.
// Requires: { to: string, clientName?: string } in request body.
router.post("/reports/:reportId/send", async (req: Request, res: Response) => {
  const orgId = org(req);
  const { reportId } = req.params as { reportId: string };
  const { to, clientName } = req.body as { to?: string; clientName?: string };

  if (!to || typeof to !== "string" || !to.includes("@")) {
    res.status(400).json({ error: "Adresse email invalide ou manquante." });
    return;
  }

  // Retrieve the report for this org so we know its name and can build a URL
  let reportName = "Rapport client";
  let reportUrl: string | undefined;
  try {
    const rr = await pool.query(
      `SELECT id, name, title FROM reports WHERE id=$1 AND org_id=$2 LIMIT 1`,
      [reportId, orgId]
    );
    if (rr.rows.length > 0) {
      const row = rr.rows[0] as { id: string; name?: string; title?: string };
      reportName = (row.name || row.title || "Rapport client").slice(0, 200);
      // Build a download URL pointing to the existing download endpoint
      const base = process.env["REPLIT_DEV_DOMAIN"]
        ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
        : "https://app.flowpoint.pro";
      reportUrl = `${base}/api/reports/${row.id}/download`;
    } else {
      // Accept synthetic/preview reports — still send the email without DB row
      logger.warn({ reportId, orgId }, "[client-mode] report not found in DB, sending generic email");
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, reportId }, "[client-mode] report lookup failed, continuing with generic email");
  }

  try {
    const result = await mailer.sendReportGenerated({
      to: to.trim(),
      name: (clientName ?? to.trim()).slice(0, 100),
      reportName,
      reportUrl,
    });

    if (!result.ok) {
      logger.warn({ error: result.error, to }, "[client-mode] mailer returned not-ok");
      res.status(502).json({ error: "Impossible d\u2019envoyer l\u2019email. V\u00e9rifiez la configuration SMTP." });
      return;
    }

    res.json({ ok: true, sent: true, to: to.trim(), reportName });
  } catch (err) {
    logger.error({ err: (err as Error).message, to, reportId }, "[client-mode] send email error");
    res.status(500).json({ error: "Erreur lors de l\u2019envoi du rapport." });
  }
});

export default router;
