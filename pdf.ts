import type { Response } from "express";
import { logger } from "../lib/logger.js";
import type { Report, Audit } from "@workspace/db";

interface MeetingNote {
  title: string;
  date: string;
  notes: string;
  site?: string;
}

export async function streamReportPdf(res: Response, report: Report, audit: Audit | undefined, meetingNotes: MeetingNote[] = []): Promise<void> {
  try {
    const PDFDocument = (await import("pdfkit")).default;
    const doc = new PDFDocument({ size: "A4", margin: 50 });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(report.name)}.pdf"`);
    doc.pipe(res);

    const blue = "#2563EB";
    const dark = "#0f172a";
    const muted = "#94a3b8";
    const success = "#22c55e";
    const warning = "#f59e0b";
    const danger = "#ef4444";

    doc.rect(0, 0, doc.page.width, 120).fill(blue);
    doc.fillColor("#fff").fontSize(22).font("Helvetica-Bold").text("FLOWPOINT", 50, 35);
    doc.fontSize(11).font("Helvetica").fillColor("rgba(255,255,255,0.8)").text("Dashboard SEO & Monitoring", 50, 62);
    doc.fontSize(9).fillColor("rgba(255,255,255,0.6)").text(`Rapport généré le ${new Date().toLocaleDateString("fr-FR")}`, 50, 80);

    const titleX = 50;
    let y = 140;

    doc.fillColor(dark).fontSize(18).font("Helvetica-Bold").text(report.name, titleX, y);
    y += 30;

    if (report.whiteLabel) {
      doc.fillColor(blue).fontSize(9).font("Helvetica").text("✓ White Label activé", titleX, y);
      y += 20;
    }

    doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor("#e2e8f0").stroke();
    y += 20;

    if (audit) {
      doc.fillColor(dark).fontSize(14).font("Helvetica-Bold").text("Résultats de l'audit", titleX, y);
      y += 20;

      doc.fillColor(muted).fontSize(10).font("Helvetica").text(`Site analysé : ${audit.url}`, titleX, y);
      y += 15;
      doc.fillColor(muted).fontSize(10).text(`Date de l'audit : ${new Date(audit.date).toLocaleDateString("fr-FR")}`, titleX, y);
      y += 25;

      const scoreColor = audit.score >= 70 ? success : audit.score >= 40 ? warning : danger;
      doc.fillColor(scoreColor).fontSize(40).font("Helvetica-Bold").text(`${audit.score}/100`, titleX, y);
      y += 55;

      const metrics = [
        { label: "Score SEO global", value: `${audit.score}/100`, color: scoreColor },
        { label: "Score vitesse",    value: `${audit.speed}/100`, color: audit.speed >= 70 ? success : warning },
        { label: "Problèmes détectés", value: String(audit.issues), color: audit.issues > 10 ? danger : audit.issues > 3 ? warning : success },
        { label: "Statut",           value: audit.status === "ok" ? "Bon" : audit.status === "warn" ? "À améliorer" : "Critique", color: audit.status === "ok" ? success : audit.status === "warn" ? warning : danger },
      ];

      const colW = (doc.page.width - 100) / 2;
      metrics.forEach((m, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const mx = titleX + col * colW;
        const my = y + row * 60;
        doc.rect(mx, my, colW - 10, 50).fillColor("#f8fafc").fill();
        doc.fillColor(muted).fontSize(9).font("Helvetica").text(m.label, mx + 10, my + 8);
        doc.fillColor(m.color).fontSize(16).font("Helvetica-Bold").text(m.value, mx + 10, my + 22);
      });
      y += Math.ceil(metrics.length / 2) * 60 + 20;
    }

    doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor("#e2e8f0").stroke();
    y += 20;

    doc.fillColor(dark).fontSize(14).font("Helvetica-Bold").text("Recommandations prioritaires", titleX, y);
    y += 20;

    const recommendations = [
      "Optimiser les balises title et meta description pour chaque page",
      "Améliorer le score de vitesse (compression, lazy loading, CDN)",
      "Corriger les liens brisés et les erreurs 404",
      "Mettre en place le balisage schema.org LocalBusiness",
      "Ajouter les pages locales pour les zones de chalandise cibles",
    ];

    recommendations.forEach((rec, idx) => {
      doc.fillColor(blue).fontSize(10).font("Helvetica-Bold").text(`${idx + 1}.`, titleX, y);
      doc.fillColor(dark).fontSize(10).font("Helvetica").text(rec, titleX + 20, y, { width: doc.page.width - 120 });
      y += 20;
    });

    if (meetingNotes.length > 0) {
      y += 10;
      doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor("#e2e8f0").stroke();
      y += 20;

      doc.fillColor(dark).fontSize(14).font("Helvetica-Bold").text("Notes de réunion", titleX, y);
      y += 8;
      doc.fillColor(muted).fontSize(9).font("Helvetica").text(`${meetingNotes.length} rendez-vous avec notes`, titleX, y);
      y += 20;

      for (const note of meetingNotes) {
        if (y > doc.page.height - 120) { doc.addPage(); y = 50; }
        const dateStr = new Date(note.date).toLocaleDateString("fr-FR");
        doc.rect(titleX, y, doc.page.width - 100, 1).fillColor("#8b5cf6").fill();
        y += 8;
        doc.fillColor("#8b5cf6").fontSize(10).font("Helvetica-Bold").text(note.title, titleX, y);
        doc.fillColor(muted).fontSize(9).font("Helvetica").text(dateStr, doc.page.width - 100, y, { align: "right", width: 50 });
        y += 15;
        if (note.site) {
          doc.fillColor(muted).fontSize(8).font("Helvetica").text(note.site.replace(/^https?:\/\//, ""), titleX, y);
          y += 12;
        }
        const noteLines = note.notes.slice(0, 800);
        doc.fillColor(dark).fontSize(9).font("Helvetica").text(noteLines, titleX + 10, y, { width: doc.page.width - 120 });
        y += doc.heightOfString(noteLines, { width: doc.page.width - 120, fontSize: 9 }) + 14;
      }
    }

    y += 10;
    doc.moveTo(50, y).lineTo(doc.page.width - 50, y).strokeColor("#e2e8f0").stroke();
    y += 15;

    doc.fillColor(muted).fontSize(8).font("Helvetica").text(
      `Ce rapport a été généré automatiquement par Flowpoint Dashboard. © ${new Date().getFullYear()} Flowpoint Agency.`,
      50, y, { align: "center", width: doc.page.width - 100 }
    );

    doc.end();
  } catch (err) {
    logger.error({ err }, "[PDF] Failed to generate PDF");
    if (!res.headersSent) {
      res.status(500).json({ error: "PDF generation failed" });
    }
  }
}
