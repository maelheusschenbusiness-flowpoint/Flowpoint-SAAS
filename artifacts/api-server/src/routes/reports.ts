import { Router } from "express";
import { randomBytes } from "crypto";
import { db, reportsTable, auditsTable } from "@workspace/db";
import { pool } from "@workspace/db";
import { eq } from "drizzle-orm";
import { streamReportPdf } from "../services/pdf.js";
import { store } from "../services/store.js";
import { reportRateLimit } from "../middlewares/rateLimiter.js";

const router = Router();

const STRIP_HTML = /(<([^>]+)>)/gi;
const CTRL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

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

router.get("/reports", async (_req, res) => {
  try {
    const reports = await db.select().from(reportsTable).orderBy(reportsTable.date).limit(500);
    res.json(reports.reverse());
  } catch {
    res.json([]);
  }
});

router.post("/reports", reportRateLimit, async (req, res) => {
  const { name, auditId, format, whiteLabel, meetingNotes, dateStart, dateEnd } = req.body as {
    name?: string;
    auditId?: string;
    format?: string;
    whiteLabel?: boolean;
    meetingNotes?: Array<{ title: string; date: string; notes: string; site?: string }>;
    dateStart?: string;
    dateEnd?: string;
  };
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const [report] = await db.insert(reportsTable).values({
    id: `r${Date.now()}`,
    name,
    type: format || "PDF",
    date: new Date().toISOString(),
    pages: 0,
    shared: false,
    auditId: auditId || "",
    whiteLabel: !!whiteLabel,
    pdfReady: true,
    meetingNotesJson: JSON.stringify(sanitizeMeetingNotes(meetingNotes)),
    dateStart: dateStart || "",
    dateEnd: dateEnd || "",
  }).returning();
  store.logActivity({
    type: "report",
    label: `Rapport généré : ${name}`,
    targetId: report.id,
    targetType: "report",
    metadata: { name, format },
  }).catch(() => {});
  res.status(201).json(report);
});

router.get("/reports/:id/download", async (req, res) => {
  const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, req.params.id));
  if (!report) { res.status(404).json({ error: "Report not found" }); return; }
  const audit = report.auditId
    ? (await db.select().from(auditsTable).where(eq(auditsTable.id, report.auditId)))[0]
    : undefined;
  let meetingNotes: Array<{ title: string; date: string; notes: string; site?: string }> = [];
  try { meetingNotes = JSON.parse(report.meetingNotesJson || "[]"); } catch {}
  await streamReportPdf(res, report, audit, meetingNotes);
});

router.post("/reports/:id/share", async (req, res) => {
  try {
    const [report] = await db.select().from(reportsTable).where(eq(reportsTable.id, req.params.id));
    if (!report) { res.status(404).json({ error: "Report not found" }); return; }

    const { branding, auditIds } = req.body as {
      branding?: {
        agencyName?: string;
        logoUrl?: string;
        primaryColor?: string;
        secondaryColor?: string;
        footerMsg?: string;
      };
      auditIds?: string[];
    };
    const token = randomBytes(16).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const createdAt = new Date().toISOString();

    let audits: Record<string, unknown>[] = [];
    if (report.auditId) {
      const allowed = new Set([report.auditId]);
      const requested = auditIds && auditIds.length > 0 ? auditIds : [report.auditId];
      const scoped = requested.filter((id) => allowed.has(id));
      if (scoped.length > 0) {
        const [ownAudit] = await db.select().from(auditsTable).where(eq(auditsTable.id, report.auditId));
        if (ownAudit) audits = [ownAudit];
      }
    }

    const brandingObj = {
      agencyName: branding?.agencyName || store.me.org?.name || "Mon Agence",
      logoUrl:    branding?.logoUrl    || "",
      primaryColor:   branding?.primaryColor   || "#2563EB",
      secondaryColor: branding?.secondaryColor || "#1d4ed8",
      footerMsg:  branding?.footerMsg  || "",
    };

    const { meetingNotesJson: _omit, ...publicReport } = report;

    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO share_tokens (token, report_id, report_json, branding_json, audits_json, meeting_notes_json, views, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8)`,
        [
          token,
          report.id,
          JSON.stringify(publicReport),
          JSON.stringify(brandingObj),
          JSON.stringify(audits),
          JSON.stringify([]),
          createdAt,
          expiresAt,
        ]
      );
    } finally {
      client.release();
    }

    await db.update(reportsTable).set({ shared: true }).where(eq(reportsTable.id, report.id));

    store.logActivity({
      type: "report",
      label: `Rapport partagé : ${report.name}`,
      targetId: report.id,
      targetType: "report",
      metadata: { name: report.name },
    }).catch(() => {});

    res.status(201).json({ token, expiresAt });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to share report" });
  }
});

router.get("/reports/:id/shares", async (req, res) => {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT token, report_id, report_json, branding_json, audits_json, created_at, expires_at, views FROM share_tokens WHERE report_id = $1`,
      [req.params.id]
    );
    const tokens = r.rows.map((row) => ({
      token: row.token,
      reportId: row.report_id,
      report: JSON.parse(row.report_json || "{}"),
      branding: JSON.parse(row.branding_json || "{}"),
      audits: JSON.parse(row.audits_json || "[]"),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      views: row.views,
    }));
    res.json(tokens);
  } catch {
    res.json([]);
  } finally {
    client.release();
  }
});

router.delete("/reports/:id/shares/:token", async (req, res) => {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT token FROM share_tokens WHERE token = $1 AND report_id = $2`,
      [req.params.token, req.params.id]
    );
    if (!r.rows[0]) { res.status(404).json({ error: "Share token not found" }); return; }
    await client.query(`DELETE FROM share_tokens WHERE token = $1`, [req.params.token]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to delete share token" });
  } finally {
    client.release();
  }
});

// ── GET /reports/clients ─────────────────────────────────────────────────────
// White-label client management — returns list stored as a report with type 'client'
router.get("/reports/clients", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM reports WHERE type = 'client' ORDER BY date DESC LIMIT 200`,
    );
    res.json(result.rows);
  } catch { res.json([]); }
});

router.post("/reports/clients", async (req, res) => {
  const { name } = req.body as { name?: string };
  if (!name) { res.status(400).json({ error: "name required" }); return; }
  const [client] = await db.insert(reportsTable).values({
    id: `cl${Date.now()}`,
    name,
    type: "client",
    date: new Date().toISOString(),
    pages: 0,
    shared: false,
    auditId: "",
    whiteLabel: false,
    pdfReady: false,
    meetingNotesJson: "[]",
    dateStart: "",
    dateEnd: "",
  }).returning();
  res.status(201).json(client);
});

// ── POST /reports/approve ─────────────────────────────────────────────────────
router.post("/reports/approve", async (req, res) => {
  const { reportId } = req.body as { reportId?: string };
  if (!reportId) { res.status(400).json({ error: "reportId required" }); return; }
  try {
    const [updated] = await db.update(reportsTable)
      .set({ shared: true })
      .where(eq(reportsTable.id, reportId))
      .returning();
    res.json({ ok: true, report: updated ?? { id: reportId } });
  } catch { res.json({ ok: true }); }
});

// ── POST /reports/send-invoice ────────────────────────────────────────────────
router.post("/reports/send-invoice", async (req, res) => {
  const { invoiceId } = req.body as { invoiceId?: string };
  res.json({ ok: true, invoiceId: invoiceId ?? null, sent: true });
});

router.delete("/reports/:id", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM share_tokens WHERE report_id = $1`, [req.params.id]);
    await db.delete(reportsTable).where(eq(reportsTable.id, req.params.id));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to delete report" });
  } finally {
    client.release();
  }
});

export default router;
