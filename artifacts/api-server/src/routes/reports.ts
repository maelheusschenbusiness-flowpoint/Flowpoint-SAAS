import { Router } from "express";
import { randomBytes } from "crypto";
import { db, reportsTable, auditsTable, shareTokensTable } from "@workspace/db";
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
    meetingNotes?: Array<{ title: string; date: string; notes: string; site?: string }>;
  };
  const token = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  const createdAt = new Date().toISOString();

  // Only include the audit that belongs to this specific report.
  // If the caller supplied auditIds, honour them only when they match the
  // report's own auditId so unrelated audit records can never be attached.
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

  // Meeting notes are internal — never expose them through a public share link.
  const shareMeetingNotes: Array<{ title: string; date: string; notes: string; site?: string }> = [];

  const brandingObj = {
    agencyName: branding?.agencyName || store.me.org.name || "Mon Agence",
    logoUrl:    branding?.logoUrl    || "",
    primaryColor:   branding?.primaryColor   || "#2563EB",
    secondaryColor: branding?.secondaryColor || "#1d4ed8",
    footerMsg:  branding?.footerMsg  || "",
  };

  // Strip internal-only fields before persisting the public report snapshot.
  const { meetingNotesJson: _omit, ...publicReport } = report;
  await db.insert(shareTokensTable).values({
    token,
    reportId: report.id,
    reportJson: JSON.stringify(publicReport),
    brandingJson: JSON.stringify(brandingObj),
    auditsJson: JSON.stringify(audits),
    meetingNotesJson: JSON.stringify(shareMeetingNotes),
    views: 0,
    createdAt,
    expiresAt,
  });

  await db.update(reportsTable).set({ shared: true }).where(eq(reportsTable.id, report.id));

  store.logActivity({
    type: "report",
    label: `Rapport partagé : ${report.name}`,
    targetId: report.id,
    targetType: "report",
    metadata: { name: report.name },
  }).catch(() => {});

  res.status(201).json({ token, expiresAt });
});

router.get("/reports/:id/shares", async (req, res) => {
  const rows = await db.select().from(shareTokensTable).where(eq(shareTokensTable.reportId, req.params.id));
  const tokens = rows.map((r) => ({
    token: r.token,
    reportId: r.reportId,
    report: JSON.parse(r.reportJson),
    branding: JSON.parse(r.brandingJson),
    audits: JSON.parse(r.auditsJson),
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    views: r.views,
  }));
  res.json(tokens);
});

router.delete("/reports/:id/shares/:token", async (req, res) => {
  const [row] = await db.select().from(shareTokensTable).where(eq(shareTokensTable.token, req.params.token));
  if (!row || row.reportId !== req.params.id) {
    res.status(404).json({ error: "Share token not found" });
    return;
  }
  await db.delete(shareTokensTable).where(eq(shareTokensTable.token, req.params.token));
  res.json({ ok: true });
});

router.delete("/reports/:id", async (req, res) => {
  await db.delete(shareTokensTable).where(eq(shareTokensTable.reportId, req.params.id));
  await db.delete(reportsTable).where(eq(reportsTable.id, req.params.id));
  res.json({ ok: true });
});

export default router;
