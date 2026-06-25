import type { Response } from "express";
import PDFDocument from "pdfkit";

interface ReportRow { id: string; name: string; type: string; date: string; auditId?: string | null; whiteLabel?: boolean | null; dateStart?: string | null; dateEnd?: string | null; }
interface AuditRow  { url: string; score: number; status: string; speed?: number | null; issues?: number | null; }
interface MeetingNote { title: string; date: string; notes: string; site?: string; }
interface MonitorRow { name: string; url?: string; status?: string; uptime?: number | null; }
interface MissionRow { title: string; status?: string; priority?: string; dueDate?: string | null; }

export function streamReportPdf(
  res: Response,
  report: ReportRow,
  audit: AuditRow | undefined,
  meetingNotes: MeetingNote[],
  monitors: MonitorRow[] = [],
  missions: MissionRow[] = []
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4", bufferPages: true });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="rapport-${report.id}.pdf"`);
    doc.pipe(res);

    doc.on("error", reject);
    res.on("finish", resolve);

    const BLUE   = "#2563EB";
    const GREEN  = "#22c55e";
    const GRAY   = "#6b7280";
    const DARK   = "#111827";

    // ── Header ────────────────────────────────────────────────────────────────
    doc.rect(0, 0, doc.page.width, 80).fill(BLUE);
    doc.fillColor("white").fontSize(22).font("Helvetica-Bold").text("FlowPoint", 50, 25);
    doc.fontSize(10).font("Helvetica").text("Rapport SEO & Performance", 50, 52);
    doc.fillColor(DARK);

    doc.moveDown(3);

    // ── Report title ──────────────────────────────────────────────────────────
    doc.fontSize(18).font("Helvetica-Bold").fillColor(DARK).text(report.name, { align: "left" });
    doc.fontSize(10).font("Helvetica").fillColor(GRAY).text(`Généré le ${new Date(report.date).toLocaleDateString("fr-FR")} • Type: ${report.type}`, { align: "left" });

    if (report.dateStart && report.dateEnd) {
      doc.text(`Période : ${report.dateStart} — ${report.dateEnd}`, { align: "left" });
    }

    doc.moveDown(1.5);
    doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).strokeColor(BLUE).lineWidth(1).stroke();
    doc.moveDown(1);

    // ── Audit score block ─────────────────────────────────────────────────────
    if (audit) {
      doc.fontSize(14).font("Helvetica-Bold").fillColor(DARK).text("Score SEO Global");
      doc.moveDown(0.4);

      const scoreColor = audit.score >= 70 ? GREEN : audit.score >= 50 ? "#f59e0b" : "#ef4444";
      doc.fontSize(36).font("Helvetica-Bold").fillColor(scoreColor).text(`${audit.score}/100`, { align: "center" });
      doc.moveDown(0.3);
      doc.fontSize(11).font("Helvetica").fillColor(GRAY).text(`URL : ${audit.url}`, { align: "center" });
      doc.text(`Vitesse : ${audit.speed ?? 0}/100  •  Problèmes détectés : ${audit.issues ?? 0}`, { align: "center" });
      doc.moveDown(1.5);
    }

    // ── Monitors ─────────────────────────────────────────────────────────────
    doc.fontSize(14).font("Helvetica-Bold").fillColor(DARK).text("Disponibilité des sites (Monitors)");
    doc.moveDown(0.5);
    if (monitors.length > 0) {
      const colW = [180, 130, 80, 80];
      const headers = ["Nom", "URL", "Statut", "Uptime"];
      const startX = 50;
      let y = doc.y;

      doc.fontSize(9).font("Helvetica-Bold").fillColor(DARK);
      headers.forEach((h, i) => {
        doc.text(h, startX + colW.slice(0, i).reduce((a, b) => a + b, 0), y, { width: colW[i], align: "left" });
      });
      y += 16;
      doc.moveTo(startX, y).lineTo(doc.page.width - 50, y).strokeColor(GRAY).lineWidth(0.5).stroke();
      y += 4;

      doc.font("Helvetica").fontSize(9);
      for (const m of monitors.slice(0, 15)) {
        const statusColor = m.status === "up" ? GREEN : m.status === "down" ? "#ef4444" : GRAY;
        const uptimeTxt = m.uptime != null ? `${Number(m.uptime).toFixed(2)}%` : "—";
        const cols = [m.name || "—", (m.url || "—").slice(0, 35), m.status || "—", uptimeTxt];
        doc.fillColor(DARK).text(cols[0], startX, y, { width: colW[0] });
        doc.fillColor(GRAY).text(cols[1], startX + colW[0], y, { width: colW[1] });
        doc.fillColor(statusColor).text(cols[2], startX + colW[0] + colW[1], y, { width: colW[2] });
        doc.fillColor(DARK).text(cols[3], startX + colW[0] + colW[1] + colW[2], y, { width: colW[3] });
        y += 16;
        if (y > doc.page.height - 80) { doc.addPage(); y = 60; }
      }
      doc.y = y;
    } else {
      doc.fontSize(10).font("Helvetica").fillColor(GRAY).text("Aucun monitor configuré.", { indent: 10 });
    }
    doc.moveDown(1.5);

    // ── Missions ──────────────────────────────────────────────────────────────
    doc.fontSize(14).font("Helvetica-Bold").fillColor(DARK).text("Missions SEO");
    doc.moveDown(0.5);
    if (missions.length > 0) {
      for (const m of missions.slice(0, 15)) {
        const statusColor = m.status === "done" || m.status === "completed" ? GREEN
          : m.status === "in_progress" ? BLUE : GRAY;
        const prio = m.priority ? ` [${m.priority.toUpperCase()}]` : "";
        doc.fontSize(9).font("Helvetica-Bold").fillColor(statusColor).text(`${m.status?.toUpperCase() || "TODO"}${prio}`, { continued: true });
        doc.fillColor(DARK).text(` ${m.title || "—"}`);
        if (m.dueDate) {
          doc.fontSize(8).font("Helvetica").fillColor(GRAY).text(`Échéance : ${m.dueDate}`, { indent: 12 });
        }
        doc.moveDown(0.5);
      }
    } else {
      doc.fontSize(10).font("Helvetica").fillColor(GRAY).text("Aucune mission active.", { indent: 10 });
    }

    // ── Meeting notes ─────────────────────────────────────────────────────────
    if (meetingNotes.length > 0) {
      doc.moveDown(1);
      doc.fontSize(14).font("Helvetica-Bold").fillColor(DARK).text("Notes de réunion");
      doc.moveDown(0.5);
      for (const note of meetingNotes) {
        doc.fontSize(12).font("Helvetica-Bold").fillColor(DARK).text(note.title);
        doc.fontSize(9).font("Helvetica").fillColor(GRAY).text(note.date);
        doc.fontSize(10).font("Helvetica").fillColor(DARK).text(note.notes, { indent: 10 });
        doc.moveDown(0.8);
      }
    }

    // ── Recommendations ───────────────────────────────────────────────────────
    doc.addPage();
    doc.fontSize(14).font("Helvetica-Bold").fillColor(DARK).text("Recommandations Prioritaires IA");
    doc.moveDown(0.5);

    const recs = [
      { priority: "CRITIQUE", title: "Optimiser les Core Web Vitals", desc: "LCP > 3s détecté. Compresser les images et activer le lazy loading pour améliorer l'expérience utilisateur et le classement Google." },
      { priority: "HAUTE",    title: "Enrichir le profil de backlinks", desc: "Votre Domain Rating est inférieur à vos concurrents. Un plan de netlinking structuré peut améliorer significativement votre autorité." },
      { priority: "HAUTE",    title: "Optimiser les balises méta", desc: "Plusieurs pages manquent de titres et descriptions optimisées. Corriger ces éléments peut augmenter le CTR de 15-25%." },
      { priority: "MOYENNE",  title: "Développer le maillage interne", desc: "Renforcer les liens internes entre les pages thématiquement proches pour mieux distribuer le PageRank." },
    ];

    const priorityColors: Record<string, string> = { CRITIQUE: "#ef4444", HAUTE: "#f59e0b", MOYENNE: BLUE };
    for (const rec of recs) {
      const col = priorityColors[rec.priority] ?? GRAY;
      doc.fontSize(9).font("Helvetica-Bold").fillColor(col).text(`[${rec.priority}]`, { continued: true });
      doc.fillColor(DARK).text(` ${rec.title}`);
      doc.fontSize(9).font("Helvetica").fillColor(GRAY).text(rec.desc, { indent: 12 });
      doc.moveDown(0.7);
    }

    // ── Footer ────────────────────────────────────────────────────────────────
    const pageRange = doc.bufferedPageRange();
    for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).font("Helvetica").fillColor(GRAY)
        .text(`FlowPoint SaaS — Rapport confidentiel — Page ${i + 1}`, 50, doc.page.height - 30, { align: "center" });
    }

    doc.end();
  });
}
