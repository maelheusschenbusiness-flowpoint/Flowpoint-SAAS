import type { Response } from "express";
import PDFDocument from "pdfkit";

interface ReportRow { id: string; name: string; type: string; template_key?: string | null; date: string; auditId?: string | null; whiteLabel?: boolean | null; dateStart?: string | null; dateEnd?: string | null; }
export interface WlBranding { agencyName?: string; primaryColor?: string; secondaryColor?: string; footerMsg?: string; logoUrl?: string; }
interface AuditRow  { url: string; score: number; status: string; speed?: number | null; issues?: number | null; }
interface MeetingNote { title: string; date: string; notes: string; site?: string; }
interface MonitorRow { name: string; url?: string; status?: string; uptime?: number | null; }
interface MissionRow { title: string; status?: string; priority?: string; dueDate?: string | null; }

// ── Logo fetch (http→buffer, SSRF-hardened) ──────────────────────────────────
// The logo URL is user-controlled config, so this fetch must never reach
// loopback/private/internal addresses (same rules as monitor URL validation),
// must not follow redirects (redirect-based rebinding), and is size/time capped.
const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

async function fetchLogoBuffer(logoUrl: string): Promise<Buffer | null> {
  if (!logoUrl || !/^https?:\/\//i.test(logoUrl)) return null;
  try {
    const parsed = new URL(logoUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    const { isPrivateHost, checkDnsResolution } = await import("../middlewares/validateMonitorUrl.js");
    if (isPrivateHost(parsed.hostname)) return null;
    if (await checkDnsResolution(parsed.hostname) !== null) return null;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    // redirect:"manual" — a redirect could point at an internal address after
    // the DNS check passed, so redirects are rejected outright.
    const res = await fetch(logoUrl, { signal: ctrl.signal, redirect: "manual" });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.startsWith("image/")) return null;
    const len = Number(res.headers.get("content-length") || 0);
    if (len > LOGO_MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > LOGO_MAX_BYTES) return null;
    return buf;
  } catch {
    return null;
  }
}

// ── Color helpers ─────────────────────────────────────────────────────────────
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function lighten(hex: string, amount = 0.85): string {
  const [r, g, b] = hexToRgb(hex);
  const l = (v: number) => Math.round(v + (255 - v) * amount);
  return `#${l(r).toString(16).padStart(2, "0")}${l(g).toString(16).padStart(2, "0")}${l(b).toString(16).padStart(2, "0")}`;
}

export async function streamReportPdf(
  res: Response,
  report: ReportRow,
  audit: AuditRow | undefined,
  meetingNotes: MeetingNote[],
  monitors: MonitorRow[] = [],
  missions: MissionRow[] = [],
  branding?: WlBranding | null
): Promise<void> {
  // Pre-fetch logo before streaming starts (avoids piping mid-stream issues)
  const logoBuffer = branding?.logoUrl ? await fetchLogoBuffer(branding.logoUrl) : null;
  const reportTemplate = ({
    seo:        { label: "Rapport SEO", intro: "Synthèse des mesures SEO, de disponibilité et des actions prioritaires." },
    executive:  { label: "Rapport Exécutif", intro: "Synthèse de direction fondée uniquement sur les mesures actuellement disponibles." },
    monitoring: { label: "Monitoring SLA", intro: "État de disponibilité et suivi des services monitorés." },
    conversion: { label: "Rapport Conversion", intro: "Analyse de conversion : les métriques ne sont affichées que lorsqu'une source Analytics est connectée." },
    local:      { label: "Local SEO", intro: "Synthèse de visibilité locale fondée sur les données connectées à ce workspace." },
    ai:         { label: "Rapport IA Lab", intro: "Synthèse des analyses et recommandations disponibles dans ce workspace." },
  } as const)[report.template_key ?? "seo"] ?? {
    label: "Rapport SEO",
    intro: "Synthèse des mesures actuellement disponibles.",
  };

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 0, size: "A4", bufferPages: true });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="rapport-${report.id}.pdf"`);
    doc.pipe(res);

    doc.on("error", reject);
    res.on("finish", resolve);

    // ── Brand colors ──────────────────────────────────────────────────────────
    // Always use branding when available (even without white_label flag for visual consistency)
    const wl = branding && branding.agencyName ? branding : null;
    const BRAND   = (wl?.primaryColor && /^#[0-9a-fA-F]{6}$/.test(wl.primaryColor)) ? wl.primaryColor : "#2563EB";
    const BRAND_L = lighten(BRAND, 0.88);
    const GREEN   = "#22c55e";
    const AMBER   = "#f59e0b";
    const RED     = "#ef4444";
    const GRAY    = "#6b7280";
    const DARK    = "#111827";
    const WHITE   = "#ffffff";
    const brandName = (wl?.agencyName || "").trim() || "FlowPoint";
    const footerMsg = (wl?.footerMsg || "").trim() || `${brandName} — Rapport confidentiel`;

    const MARGIN  = 45;
    const PAGE_W  = doc.page.width;
    const PAGE_H  = doc.page.height;
    const CONTENT_W = PAGE_W - MARGIN * 2;

    // ── Reusable header/footer renderer (used for every page) ─────────────────
    const HEADER_H = 72;
    const FOOTER_H = 28;

    function drawHeaderFooter(pageIdx: number) {
      // Header band
      doc.rect(0, 0, PAGE_W, HEADER_H).fill(BRAND);

      // Logo (left side)
      let textStartX = MARGIN;
      if (logoBuffer) {
        try {
          doc.image(logoBuffer, MARGIN, 14, { height: 44, fit: [120, 44] });
          textStartX = MARGIN + 130;
        } catch { /* ignore broken logo */ }
      }

      // Agency/brand name
      doc.fillColor(WHITE).fontSize(18).font("Helvetica-Bold")
        .text(brandName, textStartX, 18, { width: PAGE_W - textStartX - MARGIN, lineBreak: false });
      doc.fillColor(WHITE).fontSize(9).font("Helvetica")
        .text(reportTemplate.label, textStartX, 44, { width: PAGE_W - textStartX - MARGIN, lineBreak: false });

      // Report date (right-aligned in header)
      const dateStr = new Date(report.date).toLocaleDateString("fr-FR");
      doc.fillColor(WHITE).fontSize(8).font("Helvetica")
        .text(dateStr, PAGE_W - MARGIN - 80, 30, { width: 80, align: "right", lineBreak: false });

      // Footer band
      doc.rect(0, PAGE_H - FOOTER_H, PAGE_W, FOOTER_H).fill(BRAND_L);
      doc.rect(0, PAGE_H - FOOTER_H, PAGE_W, 1).fill(BRAND);

      const totalPages = doc.bufferedPageRange().count;
      doc.fillColor(GRAY).fontSize(7.5).font("Helvetica")
        .text(footerMsg, MARGIN, PAGE_H - FOOTER_H + 8, { width: CONTENT_W - 60, lineBreak: false });
      doc.fillColor(BRAND).fontSize(7.5).font("Helvetica-Bold")
        .text(`Page ${pageIdx + 1}`, PAGE_W - MARGIN - 60, PAGE_H - FOOTER_H + 8, { width: 60, align: "right", lineBreak: false });
    }

    // ── Section heading helper ────────────────────────────────────────────────
    function sectionHeading(title: string) {
      const y = doc.y;
      // Ensure not too close to footer
      if (y > PAGE_H - FOOTER_H - 80) {
        doc.addPage();
        doc.y = HEADER_H + 20;
      }
      const sY = doc.y;
      doc.rect(MARGIN, sY, 4, 18).fill(BRAND);
      doc.fillColor(DARK).fontSize(13).font("Helvetica-Bold")
        .text(title, MARGIN + 10, sY + 1, { width: CONTENT_W - 10 });
      doc.moveDown(0.6);
    }

    // ── KPI card helper ───────────────────────────────────────────────────────
    function kpiCard(label: string, value: string, color: string, x: number, y: number, w: number, h: number) {
      doc.rect(x, y, w, h).fill(lighten(color, 0.90));
      doc.rect(x, y, w, 3).fill(color);
      doc.fillColor(GRAY).fontSize(7.5).font("Helvetica")
        .text(label, x + 8, y + 10, { width: w - 16, align: "center", lineBreak: false });
      doc.fillColor(color).fontSize(20).font("Helvetica-Bold")
        .text(value, x + 8, y + 22, { width: w - 16, align: "center", lineBreak: false });
    }

    // ── Page 1 ────────────────────────────────────────────────────────────────
    doc.y = HEADER_H + 18;

    // Report title + period
    doc.fillColor(DARK).fontSize(20).font("Helvetica-Bold")
      .text(report.name, MARGIN, doc.y, { width: CONTENT_W });
    doc.moveDown(0.3);
    const subParts: string[] = [];
    subParts.push(`Template : ${reportTemplate.label}`);
    subParts.push(`Format : ${report.type}`);
    if (report.dateStart && report.dateEnd) subParts.push(`Période : ${report.dateStart} — ${report.dateEnd}`);
    doc.fillColor(GRAY).fontSize(9).font("Helvetica").text(subParts.join("  •  "), MARGIN, doc.y, { width: CONTENT_W });
    doc.moveDown(0.6);
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE_W - MARGIN, doc.y).strokeColor(BRAND).lineWidth(1).stroke();
    doc.moveDown(1.2);
    doc.fillColor(GRAY).fontSize(9).font("Helvetica")
      .text(reportTemplate.intro, MARGIN, doc.y, { width: CONTENT_W });
    doc.moveDown(1.1);

    // ── KPI summary cards ─────────────────────────────────────────────────────
    if (audit) {
      const cardW  = (CONTENT_W - 12) / 3;
      const cardH  = 56;
      const startY = doc.y;
      const scoreColor = audit.score >= 70 ? GREEN : audit.score >= 50 ? AMBER : RED;

      kpiCard("Score SEO Global", `${audit.score}/100`, scoreColor, MARGIN, startY, cardW, cardH);
      kpiCard("Vitesse Desktop", `${audit.speed ?? 0}/100`, audit.speed != null && audit.speed >= 70 ? GREEN : AMBER,
        MARGIN + cardW + 6, startY, cardW, cardH);
      kpiCard("Problèmes détectés", String(audit.issues ?? 0), (audit.issues ?? 0) === 0 ? GREEN : RED,
        MARGIN + (cardW + 6) * 2, startY, cardW, cardH);

      doc.y = startY + cardH + 12;
      doc.fillColor(GRAY).fontSize(8).font("Helvetica")
        .text(`URL analysée : ${audit.url}`, MARGIN, doc.y, { width: CONTENT_W });
      doc.moveDown(1.2);
    }

    // ── Monitors section ──────────────────────────────────────────────────────
    sectionHeading(reportTemplate.label === "Monitoring SLA" ? "Disponibilité et SLA (Monitors)" : "Disponibilité des sites (Monitors)");

    if (monitors.length > 0) {
      const COL_W = [165, 120, 70, 75];
      const HEADERS = ["Nom", "URL", "Statut", "Uptime"];
      const startX = MARGIN;
      let y = doc.y;

      // Table header row
      doc.rect(startX, y - 2, CONTENT_W, 18).fill(BRAND_L);
      doc.fontSize(8.5).font("Helvetica-Bold").fillColor(DARK);
      HEADERS.forEach((h, i) => {
        const x = startX + COL_W.slice(0, i).reduce((a, b) => a + b, 0);
        doc.text(h, x + 4, y, { width: COL_W[i] - 4, lineBreak: false });
      });
      y += 18;

      doc.font("Helvetica").fontSize(8.5);
      monitors.slice(0, 20).forEach((m, rowIdx) => {
        if (y > PAGE_H - FOOTER_H - 30) { doc.addPage(); y = HEADER_H + 20; }
        // Zebra stripe
        if (rowIdx % 2 === 1) doc.rect(startX, y - 2, CONTENT_W, 16).fill("#f9fafb");
        const statusColor = m.status === "up" ? GREEN : m.status === "down" ? RED : GRAY;
        const uptimeTxt = m.uptime != null ? `${Number(m.uptime).toFixed(2)}%` : "—";
        const cols = [m.name || "—", (m.url || "—").slice(0, 30), m.status || "—", uptimeTxt];
        cols.forEach((col, i) => {
          const cx = startX + COL_W.slice(0, i).reduce((a, b) => a + b, 0);
          doc.fillColor(i === 2 ? statusColor : i === 1 ? GRAY : DARK)
            .text(col, cx + 4, y, { width: COL_W[i] - 6, lineBreak: false });
        });
        y += 16;
      });
      doc.y = y;
      doc.moveDown(1.2);
    } else {
      doc.fillColor(GRAY).fontSize(9.5).font("Helvetica").text("Aucun monitor configuré.", MARGIN + 10, doc.y);
      doc.moveDown(1.2);
    }

    // ── Missions section ──────────────────────────────────────────────────────
    // Add new page if less than 100px left
    if (doc.y > PAGE_H - FOOTER_H - 100) { doc.addPage(); doc.y = HEADER_H + 20; }
    sectionHeading(reportTemplate.label === "Rapport Exécutif" ? "Actions et décisions" : "Missions SEO");

    if (missions.length > 0) {
      missions.slice(0, 15).forEach((m) => {
        if (doc.y > PAGE_H - FOOTER_H - 50) { doc.addPage(); doc.y = HEADER_H + 20; }
        const statusColor = m.status === "done" || m.status === "completed" ? GREEN
          : m.status === "in_progress" ? BRAND : GRAY;
        const prio = m.priority ? ` [${m.priority.toUpperCase()}]` : "";
        doc.fontSize(8.5).font("Helvetica-Bold").fillColor(statusColor)
          .text(`${(m.status ?? "todo").toUpperCase()}${prio}`, { continued: true });
        doc.fillColor(DARK).text(`  ${m.title || "—"}`);
        if (m.dueDate) {
          doc.fontSize(7.5).font("Helvetica").fillColor(GRAY)
            .text(`Échéance : ${m.dueDate}`, MARGIN + 14, doc.y);
        }
        doc.moveDown(0.5);
      });
    } else {
      doc.fillColor(GRAY).fontSize(9.5).font("Helvetica").text("Aucune mission active.", MARGIN + 10, doc.y);
    }
    doc.moveDown(1.2);

    // ── Meeting notes ─────────────────────────────────────────────────────────
    if (meetingNotes.length > 0) {
      if (doc.y > PAGE_H - FOOTER_H - 100) { doc.addPage(); doc.y = HEADER_H + 20; }
      sectionHeading("Notes de réunion");
      for (const note of meetingNotes) {
        if (doc.y > PAGE_H - FOOTER_H - 80) { doc.addPage(); doc.y = HEADER_H + 20; }
        doc.fontSize(11).font("Helvetica-Bold").fillColor(DARK).text(note.title, MARGIN, doc.y);
        doc.fontSize(8).font("Helvetica").fillColor(GRAY).text(note.date);
        doc.fontSize(9).font("Helvetica").fillColor(DARK)
          .text(note.notes, MARGIN, doc.y, { width: CONTENT_W, indent: 10 });
        doc.moveDown(0.8);
      }
      doc.moveDown(0.5);
    }

    // Recommendations derived from the audited data only — never fabricated claims (#437).
    const recs: Array<{ priority: string; title: string; desc: string }> = [];
    if (audit) {
      const speedScore = Number(audit.speed ?? 0);
      const globalScore = Number(audit.score ?? 0);
      const issueCount = Number(audit.issues ?? 0);
      if (speedScore > 0 && speedScore < 70) {
        recs.push({ priority: speedScore < 50 ? "CRITIQUE" : "HAUTE", title: "Améliorer la performance de chargement",
          desc: `Le score performance mesuré est de ${speedScore}/100 sur ${audit.url}. Compresser les images, activer le lazy loading et réduire le JavaScript bloquant amélioreront les Core Web Vitals.` });
      }
      if (globalScore > 0 && globalScore < 70) {
        recs.push({ priority: globalScore < 50 ? "CRITIQUE" : "HAUTE", title: "Corriger les fondamentaux SEO",
          desc: `Le score SEO global mesuré est de ${globalScore}/100. Prioriser les corrections listées dans l'audit pour repasser au-dessus de 70/100.` });
      }
      if (issueCount > 0) {
        recs.push({ priority: issueCount > 5 ? "HAUTE" : "MOYENNE", title: `Traiter les ${issueCount} problème${issueCount > 1 ? "s" : ""} détecté${issueCount > 1 ? "s" : ""}`,
          desc: `L'audit a détecté ${issueCount} problème${issueCount > 1 ? "s" : ""} critique${issueCount > 1 ? "s" : ""} (mobile + desktop). Le détail est disponible dans la page Audits du tableau de bord.` });
      }
      if (recs.length === 0 && globalScore >= 70) {
        recs.push({ priority: "MOYENNE", title: "Maintenir la trajectoire",
          desc: `Score SEO mesuré : ${globalScore}/100. Poursuivre le suivi planifié pour détecter toute régression (Core Web Vitals, indexation, contenu).` });
      }
    }
    if (recs.length > 0) {
    // Conditional page break — only when the section will actually render.
    if (doc.y > PAGE_H - FOOTER_H - 180) { doc.addPage(); doc.y = HEADER_H + 20; }
    else doc.moveDown(0.5);
    sectionHeading("Recommandations Prioritaires");

    const priorityColors: Record<string, string> = { CRITIQUE: RED, HAUTE: AMBER, MOYENNE: BRAND };
    for (const rec of recs) {
      if (doc.y > PAGE_H - FOOTER_H - 50) { doc.addPage(); doc.y = HEADER_H + 20; }
      const col = priorityColors[rec.priority] ?? GRAY;
      // Priority badge
      const badgeW = 58;
      const badgeY = doc.y;
      doc.rect(MARGIN, badgeY, badgeW, 14).fill(lighten(col, 0.80));
      doc.fillColor(col).fontSize(7.5).font("Helvetica-Bold")
        .text(rec.priority, MARGIN + 3, badgeY + 2, { width: badgeW - 6, align: "center", lineBreak: false });
      doc.fillColor(DARK).fontSize(9.5).font("Helvetica-Bold")
        .text(rec.title, MARGIN + badgeW + 6, badgeY, { width: CONTENT_W - badgeW - 6, lineBreak: false });
      doc.y = badgeY + 16;
      doc.fillColor(GRAY).fontSize(8.5).font("Helvetica")
        .text(rec.desc, MARGIN + 4, doc.y, { width: CONTENT_W - 4, indent: 8 });
      doc.moveDown(0.7);
    }
    } // end if (recs.length > 0)

    // ── Apply header/footer to every page ─────────────────────────────────────
    const pageRange = doc.bufferedPageRange();
    for (let i = pageRange.start; i < pageRange.start + pageRange.count; i++) {
      doc.switchToPage(i);
      drawHeaderFooter(i - pageRange.start);
    }

    doc.end();
  });
}
