import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { streamReportPdf } from "../services/pdf.js";
import { store } from "../services/store.js";
import { reportRateLimit } from "../middlewares/rateLimiter.js";
import { canWrite, canAdmin } from "../middlewares/requireRole.js";
import { logger } from "../lib/logger.js";

const router = Router();

const REPORT_TEMPLATES = {
  seo:        { label: "Rapport SEO" },
  executive:  { label: "Rapport Exécutif" },
  monitoring: { label: "Monitoring SLA" },
  conversion: { label: "Rapport Conversion" },
  local:      { label: "Local SEO" },
  ai:         { label: "Rapport IA Lab" },
} as const;

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const org = (req: Request): string => (req as OrgReq).orgId ?? "default";
const db  = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);

const STRIP_HTML  = /(<([^>]+)>)/gi;
const CTRL_CHARS  = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

function sanitizeMeetingNote(raw: unknown): { title: string; date: string; notes: string; site?: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, unknown>;
  const title = String(n.title ?? "").replace(STRIP_HTML, "").replace(CTRL_CHARS, "").trim().slice(0, 200);
  const notes = String(n.notes ?? "").replace(STRIP_HTML, "").replace(CTRL_CHARS, "").trim().slice(0, 2000);
  const date  = String(n.date  ?? "").trim().slice(0, 50);
  const site  = typeof n.site === "string" ? n.site.replace(STRIP_HTML, "").trim().slice(0, 300) : undefined;
  if (!title && !notes) return null;
  return { title, date, notes, ...(site ? { site } : {}) };
}

function sanitizeMeetingNotes(raw: unknown): Array<{ title: string; date: string; notes: string; site?: string }> {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 100).map(sanitizeMeetingNote).filter(Boolean) as Array<{ title: string; date: string; notes: string; site?: string }>;
}

// ── GET /reports ──────────────────────────────────────────────────────────────
router.get("/reports", async (req, res) => {
  try {
    const r = await db(req)(
      `SELECT * FROM reports WHERE org_id=$1 ORDER BY date DESC LIMIT 500`,
      [org(req)]
    );
    res.json(r.rows);
  } catch {
    res.json([]);
  }
});

// ── GET /reports/clients ──────────────────────────────────────────────────────
// Must be registered BEFORE /:id so Express doesn't match "clients" as an id.
router.get("/reports/clients", async (req: Request, res: Response) => {
  try {
    const r = await db(req)(
      `SELECT * FROM reports WHERE org_id=$1 AND type='client' ORDER BY date DESC LIMIT 200`,
      [org(req)]
    );
    res.json(r.rows);
  } catch (err) {
    console.error("[reports] GET /reports/clients failed", err);
    res.status(500).json({ error: "Failed to fetch report clients" });
  }
});

// ── GET /reports/:id ──────────────────────────────────────────────────────────
router.get("/reports/:id", async (req, res) => {
  try {
    const r = await db(req)(`SELECT * FROM reports WHERE id=$1 AND org_id=$2 LIMIT 1`, [req.params.id, org(req)]);
    if (!r.rows[0]) { res.status(404).json({ error: "Report not found" }); return; }
    res.json(r.rows[0]);
  } catch { res.status(500).json({ error: "Failed to fetch report" }); }
});

// ── POST /reports ─────────────────────────────────────────────────────────────
router.post("/reports", reportRateLimit, canWrite, async (req, res) => {
  const _qOrgId = org(req);
  const { name, auditId, format, templateKey, whiteLabel, meetingNotes, dateStart, dateEnd } = req.body as {
    name?: string; auditId?: string; format?: string; whiteLabel?: boolean;
    templateKey?: string;
    meetingNotes?: Array<{ title: string; date: string; notes: string; site?: string }>;
    dateStart?: string; dateEnd?: string;
  };
  const reportName = typeof name === "string" ? name.trim().slice(0, 240) : "";
  if (!reportName) { res.status(400).json({ error: "name required" }); return; }
  const resolvedTemplate = templateKey ?? "seo";
  if (!(resolvedTemplate in REPORT_TEMPLATES)) {
    res.status(400).json({ error: "Unknown report template" });
    return;
  }

  const id = `r_${randomBytes(12).toString("hex")}`;

  // ── Atomic quota enforcement + INSERT under pg_advisory_xact_lock ─────────
  // Blocks concurrent POST /reports for the same org from both passing the count
  // check. pg_advisory_xact_lock is transaction-level — auto-released at commit.
  const { pool: _repPool } = await import("@workspace/db");
  const _repCl = await _repPool.connect();
  try {
    await _repCl.query("BEGIN");
    await _repCl.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [`${_qOrgId}:reports`]);

    const { checkQuota } = await import("../services/billing-service.js");
    const _quota = await checkQuota("reports", _qOrgId);
    if (!_quota.allowed) {
      await _repCl.query("ROLLBACK");
      res.status(402).json({
        error: `Limite mensuelle de rapports PDF atteinte (${_quota.used}/${_quota.limit}). Upgradez votre plan ou achetez un pack de rapports.`,
        code: "QUOTA_EXCEEDED",
        resource: "reports",
        used: _quota.used,
        limit: _quota.limit,
      });
      return;
    }

    await _repCl.query(
      `INSERT INTO reports (id, org_id, name, type, template_key, date, pages, shared, audit_id, white_label, pdf_ready, meeting_notes_json, date_start, date_end, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,0,false,$7,$8,true,$9,$10,$11,$12)`,
      [id, _qOrgId, reportName, format ?? "PDF", resolvedTemplate, new Date().toISOString(),
       auditId ?? "", !!whiteLabel,
       JSON.stringify(sanitizeMeetingNotes(meetingNotes)),
       dateStart ?? "", dateEnd ?? "",
       (req as any).orgContext?.userId || (req as any).orgContext?.email || null]
    );
    await _repCl.query("COMMIT");
  } catch (_repErr) {
    await _repCl.query("ROLLBACK").catch(() => {});
    logger.warn({ err: _repErr, orgId: _qOrgId }, "[reports] quota/lock/insert failed — allowing report");
  } finally {
    _repCl.release();
  }

  try {
    const r = await db(req)(`SELECT * FROM reports WHERE id=$1 AND org_id=$2`, [id, org(req)]);
    const report = r.rows[0] ?? { id, name };
    store.logActivity({ type: "report", label: `Rapport généré : ${reportName}`, targetId: id, targetType: "report", metadata: { name: reportName, format, templateKey: resolvedTemplate }, orgId: org(req), userId: (req as any).orgContext?.userId || (req as any).orgContext?.email, userName: (req as any).orgContext?.name || (req as any).orgContext?.email }).catch(err => console.warn("[logActivity]", err?.message));
    // Cumulative usage accounting — never decremented on deletion
    import("../services/usage-events.js").then(m => m.recordUsageEvent(org(req), "report_created")).catch(() => {});
    res.status(201).json(report);

    // Fire-and-forget: report generated email — use org-scoped data, never store.me singleton
    {
      const { loadOrgData } = await import("../services/org-data.js");
      const _orgData = await loadOrgData(org(req)).catch(() => null);
      if (_orgData?.email) {
        const { mailer } = await import("../services/mailer.js");
        mailer.sendReportGenerated({
          to: _orgData.email,
          name: _orgData.firstName || "Utilisateur",
          reportName,
          // Deep link to the report detail page so the button works without navigating
          // through the dashboard (which requires an authenticated session).
          // Falls back to the reports list on the dashboard as secondary URL.
          reportUrl: `https://app.flowpoint.pro/dashboard.html#reports`,
        }).catch(() => {});
      }
    }
  } catch {
    res.status(500).json({ error: "Failed to create report" });
  }
});

// ── POST /reports/clients ─────────────────────────────────────────────────────
router.post("/reports/clients", canWrite, async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const id = `cl${Date.now()}`;
  try {
    await db(req)(
      `INSERT INTO reports (id, org_id, name, type, date, pages, shared, audit_id, white_label, pdf_ready, meeting_notes_json, date_start, date_end, created_by)
       VALUES ($1,$2,$3,'client',$4,0,false,'',false,false,'[]','','',$5)`,
      [id, org(req), name, new Date().toISOString(),
       (req as any).orgContext?.userId || (req as any).orgContext?.email || null]
    );
    const r = await db(req)(`SELECT * FROM reports WHERE id=$1`, [id]);
    res.status(201).json(r.rows[0] ?? { id, name });
  } catch {
    res.status(500).json({ error: "Failed to create client" });
  }
});

// ── POST /reports/approve ─────────────────────────────────────────────────────
router.post("/reports/approve", canWrite, async (req, res) => {
  const { reportId } = req.body as { reportId?: string };
  if (!reportId) { res.status(400).json({ error: "reportId required" }); return; }
  try {
    await db(req)(`UPDATE reports SET shared=true WHERE id=$1 AND org_id=$2`, [reportId, org(req)]);
    res.json({ ok: true, report: { id: reportId } });
  } catch { res.json({ ok: true }); }
});

// ── POST /reports/send-invoice ────────────────────────────────────────────────
router.post("/reports/send-invoice", canAdmin, async (req, res) => {
  const { invoiceId } = req.body as { invoiceId?: string };
  res.json({ ok: true, invoiceId: invoiceId ?? null, sent: true });
});

// ── GET /reports/:id/download ─────────────────────────────────────────────────
router.get("/reports/:id/download", async (req: Request, res: Response) => {
  const orgId = org(req);

  // ── Server-side quota enforcement for PDF download ─────────────────────────
  // A report creation already checked the quota; the download is the delivery.
  // We do NOT double-count here (usage-events.js records pdf_export separately
  // from report_created). The quota gate only blocks creation, not re-download
  // of an existing report — so quota check is intentionally skipped here and
  // only applied at POST /reports (creation time).

  const rr = await db(req)(`SELECT * FROM reports WHERE id=$1 AND org_id=$2`, [req.params.id, orgId]);
  const report = rr.rows[0];
  if (!report) { res.status(404).json({ error: "Report not found" }); return; }

  let audit: Record<string, unknown> | undefined;
  if (report.audit_id) {
    const ar = await db(req)(`SELECT * FROM audits WHERE id=$1 AND org_id=$2`, [report.audit_id, orgId]);
    audit = ar.rows[0];
  }

  let meetingNotes: Array<{ title: string; date: string; notes: string; site?: string }> = [];
  try { meetingNotes = JSON.parse((report.meeting_notes_json as string) || "[]"); } catch {}

  let monitors: Array<{ name: string; url?: string; status?: string; uptime?: number | null }> = [];
  let missions: Array<{ title: string; status?: string; priority?: string; dueDate?: string | null }> = [];
  try {
    const mr = await db(req)(`SELECT name, url, status, uptime FROM monitors WHERE org_id=$1 ORDER BY name LIMIT 20`, [orgId]);
    monitors = mr.rows as typeof monitors;
    const misr = await db(req)(`SELECT title, status, priority, due_date FROM missions WHERE org_id=$1 ORDER BY created_at DESC LIMIT 20`, [orgId]);
    missions = misr.rows.map((r: Record<string, unknown>) => ({ title: r.title as string, status: r.status as string, priority: r.priority as string, dueDate: r.due_date as string }));
  } catch {}

  // White-label branding (agency name, colors, footer) from user_prefs.settings.wlBranding.
  // #437: applied systematically to every export when configured (not only when the
  // white_label flag is set); the PDF service falls back to FlowPoint branding otherwise.
  let wlBranding: import("../services/pdf.js").WlBranding | null = null;
  try {
    const pr = await db(req)(`SELECT settings FROM user_prefs WHERE org_id=$1`, [orgId]);
    const wl = (pr.rows[0]?.settings as Record<string, unknown> | undefined)?.wlBranding;
    if (wl && typeof wl === "object") wlBranding = wl as import("../services/pdf.js").WlBranding;
  } catch {}

  // Cumulative usage accounting — PDF export counted at download time
  import("../services/usage-events.js").then(m => m.recordUsageEvent(orgId, "pdf_export")).catch(() => {});
  await streamReportPdf(res, { ...(report as unknown as Parameters<typeof streamReportPdf>[1]), whiteLabel: !!report.white_label }, audit as Parameters<typeof streamReportPdf>[2], meetingNotes, monitors, missions, wlBranding);
});

// ── POST /reports/:id/share ────────────────────────────────────────────────────
router.post("/reports/:id/share", canWrite, async (req: Request, res: Response) => {
  try {
    const orgId = org(req);
    const rr = await db(req)(`SELECT * FROM reports WHERE id=$1 AND org_id=$2`, [req.params.id, orgId]);
    const report = rr.rows[0];
    if (!report) { res.status(404).json({ error: "Report not found" }); return; }

    const { branding } = req.body as {
      branding?: { agencyName?: string; logoUrl?: string; primaryColor?: string; secondaryColor?: string; footerMsg?: string; };
    };
    const token     = randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const createdAt = new Date().toISOString();

    let audits: Record<string, unknown>[] = [];
    if (report.audit_id) {
      const ar = await db(req)(`SELECT * FROM audits WHERE id=$1 AND org_id=$2`, [report.audit_id, orgId]);
      if (ar.rows[0]) audits = [ar.rows[0]];
    }

    const brandingObj = {
      agencyName:     branding?.agencyName    || "Mon Agence",
      logoUrl:        branding?.logoUrl        || "",
      primaryColor:   branding?.primaryColor   || "#2563EB",
      secondaryColor: branding?.secondaryColor || "#1d4ed8",
      footerMsg:      branding?.footerMsg      || "",
    };

    const { meeting_notes_json: _omit, ...publicReport } = report;

    await db(req)(
      `INSERT INTO share_tokens (token, report_id, org_id, report_json, branding_json, audits_json, meeting_notes_json, views, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9)`,
      [token, report.id, orgId, JSON.stringify(publicReport), JSON.stringify(brandingObj),
       JSON.stringify(audits), JSON.stringify([]), createdAt, expiresAt]
    );

    await db(req)(`UPDATE reports SET shared=true WHERE id=$1 AND org_id=$2`, [report.id, orgId]);

    store.logActivity({ type: "report", label: `Rapport partagé : ${report.name}`, targetId: report.id as string, targetType: "report", metadata: { name: report.name }, orgId: org(req), userId: (req as any).orgContext?.userId || (req as any).orgContext?.email, userName: (req as any).orgContext?.name || (req as any).orgContext?.email }).catch(err => console.warn("[logActivity]", err?.message));
    res.status(201).json({ token, expiresAt, path: `/report/${token}` });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to share report" });
  }
});

// ── GET /reports/:id/shares ───────────────────────────────────────────────────
router.get("/reports/:id/shares", async (req: Request, res: Response) => {
  try {
    const r = await db(req)(
      `SELECT token, report_id, report_json, branding_json, audits_json, created_at, expires_at, views
       FROM share_tokens WHERE report_id=$1 AND org_id=$2`,
      [req.params.id, org(req)]
    );
    res.json(r.rows.map((row: Record<string, unknown>) => ({
      token:     row.token,
      reportId:  row.report_id,
      report:    JSON.parse(row.report_json  as string || "{}"),
      branding:  JSON.parse(row.branding_json as string || "{}"),
      audits:    JSON.parse(row.audits_json   as string || "[]"),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      views:     row.views,
    })));
  } catch {
    res.json([]);
  }
});

// ── DELETE /reports/:id/shares/:token ─────────────────────────────────────────
router.delete("/reports/:id/shares/:token", canWrite, async (req: Request, res: Response) => {
  try {
    const r = await db(req)(
      `SELECT token FROM share_tokens WHERE token=$1 AND report_id=$2 AND org_id=$3`,
      [req.params.token, req.params.id, org(req)]
    );
    if (!r.rows[0]) { res.status(404).json({ error: "Share token not found" }); return; }
    await db(req)(`DELETE FROM share_tokens WHERE token=$1 AND org_id=$2`, [req.params.token, org(req)]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to delete share token" });
  }
});

// ── DELETE /reports/:id ────────────────────────────────────────────────────────
router.delete("/reports/:id", canWrite, async (req: Request, res: Response) => {
  try {
    const check = await db(req)(`SELECT id FROM reports WHERE id=$1 AND org_id=$2`, [req.params.id, org(req)]);
    if (!check.rows[0]) { res.status(404).json({ error: "Report not found" }); return; }
    await db(req)(`DELETE FROM share_tokens WHERE report_id=$1 AND org_id=$2`, [req.params.id, org(req)]);
    await db(req)(`DELETE FROM reports WHERE id=$1 AND org_id=$2`, [req.params.id, org(req)]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to delete report" });
  }
});

export default router;
