import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { streamReportPdf } from "../services/pdf.js";
import { store } from "../services/store.js";
import { reportRateLimit } from "../middlewares/rateLimiter.js";

const router = Router();

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

// ── POST /reports ─────────────────────────────────────────────────────────────
router.post("/reports", reportRateLimit, async (req, res) => {
  const { name, auditId, format, whiteLabel, meetingNotes, dateStart, dateEnd } = req.body as {
    name?: string; auditId?: string; format?: string; whiteLabel?: boolean;
    meetingNotes?: Array<{ title: string; date: string; notes: string; site?: string }>;
    dateStart?: string; dateEnd?: string;
  };
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const id = `r${Date.now()}`;
  try {
    await db(req)(
      `INSERT INTO reports (id, org_id, name, type, date, pages, shared, audit_id, white_label, pdf_ready, meeting_notes_json, date_start, date_end)
       VALUES ($1,$2,$3,$4,$5,0,false,$6,$7,true,$8,$9,$10)`,
      [id, org(req), name, format ?? "PDF", new Date().toISOString(),
       auditId ?? "", !!whiteLabel,
       JSON.stringify(sanitizeMeetingNotes(meetingNotes)),
       dateStart ?? "", dateEnd ?? ""]
    );
    const r = await db(req)(`SELECT * FROM reports WHERE id=$1`, [id]);
    const report = r.rows[0] ?? { id, name };
    store.logActivity({ type: "report", label: `Rapport généré : ${name}`, targetId: id, targetType: "report", metadata: { name, format } }).catch(() => {});
    res.status(201).json(report);
  } catch {
    res.status(500).json({ error: "Failed to create report" });
  }
});

// ── GET /reports/clients ──────────────────────────────────────────────────────
router.get("/reports/clients", async (req: Request, res: Response) => {
  try {
    const r = await db(req)(
      `SELECT * FROM reports WHERE org_id=$1 AND type='client' ORDER BY date DESC LIMIT 200`,
      [org(req)]
    );
    res.json(r.rows);
  } catch { res.json([]); }
});

// ── POST /reports/clients ─────────────────────────────────────────────────────
router.post("/reports/clients", async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const id = `cl${Date.now()}`;
  try {
    await db(req)(
      `INSERT INTO reports (id, org_id, name, type, date, pages, shared, audit_id, white_label, pdf_ready, meeting_notes_json, date_start, date_end)
       VALUES ($1,$2,$3,'client',$4,0,false,'',false,false,'[]','','')`,
      [id, org(req), name, new Date().toISOString()]
    );
    const r = await db(req)(`SELECT * FROM reports WHERE id=$1`, [id]);
    res.status(201).json(r.rows[0] ?? { id, name });
  } catch {
    res.status(500).json({ error: "Failed to create client" });
  }
});

// ── POST /reports/approve ─────────────────────────────────────────────────────
router.post("/reports/approve", async (req, res) => {
  const { reportId } = req.body as { reportId?: string };
  if (!reportId) { res.status(400).json({ error: "reportId required" }); return; }
  try {
    await db(req)(`UPDATE reports SET shared=true WHERE id=$1 AND org_id=$2`, [reportId, org(req)]);
    res.json({ ok: true, report: { id: reportId } });
  } catch { res.json({ ok: true }); }
});

// ── POST /reports/send-invoice ────────────────────────────────────────────────
router.post("/reports/send-invoice", async (req, res) => {
  const { invoiceId } = req.body as { invoiceId?: string };
  res.json({ ok: true, invoiceId: invoiceId ?? null, sent: true });
});

// ── GET /reports/:id/download ─────────────────────────────────────────────────
router.get("/reports/:id/download", async (req: Request, res: Response) => {
  const orgId = org(req);
  const rr = await db(req)(`SELECT * FROM reports WHERE id=$1 AND org_id=$2`, [req.params.id, orgId]);
  const report = rr.rows[0];
  if (!report) { res.status(404).json({ error: "Report not found" }); return; }

  let audit: Record<string, unknown> | undefined;
  if (report.audit_id) {
    const ar = await db(req)(`SELECT * FROM audits WHERE id=$1`, [report.audit_id]);
    audit = ar.rows[0];
  }

  let meetingNotes: Array<{ title: string; date: string; notes: string; site?: string }> = [];
  try { meetingNotes = JSON.parse((report.meeting_notes_json as string) || "[]"); } catch {}

  let monitors: Array<{ name: string; url?: string; status?: string; uptime?: number | null }> = [];
  let missions: Array<{ title: string; status?: string; priority?: string; dueDate?: string | null }> = [];
  try {
    const mr = await db(req)(`SELECT name, url, status, uptime FROM monitors ORDER BY name LIMIT 20`);
    monitors = mr.rows as typeof monitors;
    const misr = await db(req)(`SELECT title, status, priority, due_date FROM missions ORDER BY created_at DESC LIMIT 20`);
    missions = misr.rows.map(r => ({ title: r.title as string, status: r.status as string, priority: r.priority as string, dueDate: r.due_date as string }));
  } catch {}

  await streamReportPdf(res, report as Parameters<typeof streamReportPdf>[1], audit as Parameters<typeof streamReportPdf>[2], meetingNotes, monitors, missions);
});

// ── POST /reports/:id/share ────────────────────────────────────────────────────
router.post("/reports/:id/share", async (req: Request, res: Response) => {
  try {
    const orgId = org(req);
    const rr = await db(req)(`SELECT * FROM reports WHERE id=$1 AND org_id=$2`, [req.params.id, orgId]);
    const report = rr.rows[0];
    if (!report) { res.status(404).json({ error: "Report not found" }); return; }

    const { branding, auditIds } = req.body as {
      branding?: { agencyName?: string; logoUrl?: string; primaryColor?: string; secondaryColor?: string; footerMsg?: string; };
      auditIds?: string[];
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
      agencyName:     branding?.agencyName    || store.me.org?.name || "Mon Agence",
      logoUrl:        branding?.logoUrl        || "",
      primaryColor:   branding?.primaryColor   || "#2563EB",
      secondaryColor: branding?.secondaryColor || "#1d4ed8",
      footerMsg:      branding?.footerMsg      || "",
    };

    const { meeting_notes_json: _omit, ...publicReport } = report;

    await db(req)(
      `INSERT INTO share_tokens (token, report_id, report_json, branding_json, audits_json, meeting_notes_json, views, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8)`,
      [token, report.id, JSON.stringify(publicReport), JSON.stringify(brandingObj),
       JSON.stringify(audits), JSON.stringify([]), createdAt, expiresAt]
    );

    await db(req)(`UPDATE reports SET shared=true WHERE id=$1 AND org_id=$2`, [report.id, orgId]);

    store.logActivity({ type: "report", label: `Rapport partagé : ${report.name}`, targetId: report.id as string, targetType: "report", metadata: { name: report.name } }).catch(() => {});
    res.status(201).json({ token, expiresAt });
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
    res.json(r.rows.map(row => ({
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
router.delete("/reports/:id/shares/:token", async (req: Request, res: Response) => {
  try {
    const r = await db(req)(
      `SELECT token FROM share_tokens WHERE token=$1 AND report_id=$2 AND org_id=$3`,
      [req.params.token, req.params.id, org(req)]
    );
    if (!r.rows[0]) { res.status(404).json({ error: "Share token not found" }); return; }
    await db(req)(`DELETE FROM share_tokens WHERE token=$1`, [req.params.token]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to delete share token" });
  }
});

// ── DELETE /reports/:id ────────────────────────────────────────────────────────
router.delete("/reports/:id", async (req: Request, res: Response) => {
  try {
    await db(req)(`DELETE FROM share_tokens WHERE report_id=$1`, [req.params.id]);
    await db(req)(`DELETE FROM reports WHERE id=$1 AND org_id=$2`, [req.params.id, org(req)]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to delete report" });
  }
});

export default router;
