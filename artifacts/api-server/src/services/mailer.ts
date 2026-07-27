/**
 * mailer.ts — Centralized transactional email service (Resend)
 *
 * All 10 email types for FlowPoint:
 *   welcome, trialStarted, trialEnding, paymentSucceeded, paymentFailed,
 *   monitorDown, monitorUp, reportGenerated, teamInvitation, newMissions
 *
 * Design: same visual language as the magic-link email (responsive HTML,
 *   light/dark mode, FlowPoint blue branding, consistent header/footer).
 *
 * Usage:
 *   import { mailer } from "../services/mailer.js";
 *   await mailer.sendWelcome({ to: "alice@acme.fr", name: "Alice" });
 *   // All methods return { ok: boolean; id?: string; error?: string }
 *   // Errors are logged but NEVER thrown — callers should fire-and-forget.
 */

import { Resend } from "resend";
import { logger } from "../lib/logger.js";
import fs from "fs";
import path from "path";

// ── Resend client ─────────────────────────────────────────────────────────────

function getResend(): Resend | null {
  const key = process.env["RESEND_API_KEY"];
  if (!key) {
    logger.warn("[Mailer] RESEND_API_KEY not set — emails disabled");
    return null;
  }
  return new Resend(key);
}

function getFrom(): string {
  return process.env["RESEND_FROM"] || "FlowPoint <noreply@flowpoint.pro>";
}

export interface MailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

// ── HTML layout helper ───────────────────────────────────────────────────────

function layout(opts: {
  eyebrow: string;
  eyebrowColor?: string;
  title: string;
  body: string;
  cta?: { label: string; url: string };
  note?: string;
  accentColor?: string;
}): string {
  const accent = opts.accentColor || "#2563EB";
  const eyebrowBg = opts.eyebrowColor || "#eff2ff";
  const eyebrowBorder = opts.eyebrowColor ? opts.eyebrowColor.replace("0.15", "0.4") : "#c7d0ff";
  const eyebrowText = opts.accentColor || "#3d6bff";

  const ctaBlock = opts.cta
    ? `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:32px 0 0;">
        <tr>
          <td style="border-radius:10px;background:linear-gradient(135deg,${accent} 0%,${accent}cc 100%);">
            <a href="${opts.cta.url}"
               style="display:inline-block;padding:15px 36px;border-radius:10px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:-.01em;white-space:nowrap;">
              ${opts.cta.label}
            </a>
          </td>
        </tr>
      </table>`
    : "";

  const noteBlock = opts.note
    ? `<hr class="divider" style="border:none;border-top:1px solid #eaedf5;margin:28px 0;"/>
       <p class="text-muted" style="margin:0;font-size:13px;color:#8891b8;line-height:1.6;">${opts.note}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="light dark"/>
  <meta name="supported-color-schemes" content="light dark"/>
  <style>
    :root { color-scheme: light dark; }
    @media (prefers-color-scheme: dark) {
      .email-body   { background-color: #0d0f1a !important; }
      .email-card   { background-color: #13162a !important; border-color: #252a45 !important; }
      .email-header { background-color: ${accent} !important; }
      .email-footer { background-color: ${accent}cc !important; }
      .text-main    { color: #e8eeff !important; }
      .text-muted   { color: #8891b8 !important; }
      .divider      { border-color: #252a45 !important; }
    }
  </style>
</head>
<body class="email-body" style="margin:0;padding:0;background-color:#f0f2fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table class="email-card" width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation"
               style="max-width:560px;background-color:#ffffff;border-radius:16px;border:1px solid #dde1f0;overflow:hidden;">
          <!-- Header -->
          <tr>
            <td class="email-header" style="background-color:${accent};padding:28px 40px;text-align:center;">
              <div style="display:inline-flex;align-items:center;justify-content:center;gap:12px;">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="32" height="32" style="display:inline-block;vertical-align:middle;">
                  <rect x="0" y="0" width="48" height="48" rx="10" ry="10" fill="rgba(255,255,255,0.18)"/>
                  <g transform="translate(12,12)" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                  </g>
                </svg>
                <span style="font-size:24px;font-weight:800;color:#ffffff;letter-spacing:-.03em;vertical-align:middle;">FlowPoint</span>
              </div>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 40px 32px;">
              <div style="display:inline-block;background:${eyebrowBg};border:1px solid ${eyebrowBorder};border-radius:6px;padding:4px 12px;font-size:11px;font-weight:700;color:${eyebrowText};letter-spacing:.06em;text-transform:uppercase;margin-bottom:18px;">${opts.eyebrow}</div>
              <h1 class="text-main" style="margin:0 0 14px;font-size:24px;font-weight:800;color:#0d0f1a;letter-spacing:-.03em;line-height:1.2;">${opts.title}</h1>
              <div class="text-muted" style="font-size:15px;color:#4a5280;line-height:1.65;">${opts.body}</div>
              ${ctaBlock}
              ${noteBlock}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td class="email-footer" style="background-color:${accent};padding:20px 40px;text-align:center;">
              <p style="margin:0 0 6px;font-size:13px;color:rgba(255,255,255,0.9);">
                <a href="https://flowpoint.pro" style="color:#ffffff;text-decoration:none;font-weight:700;">flowpoint.pro</a>
                &nbsp;·&nbsp;
                <a href="https://app.flowpoint.pro" style="color:rgba(255,255,255,0.85);text-decoration:none;">Dashboard</a>
                &nbsp;·&nbsp;
                <a href="mailto:support@flowpoint.pro" style="color:rgba(255,255,255,0.85);text-decoration:none;">Support</a>
              </p>
              <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.55);">© ${new Date().getFullYear()} FlowPoint. Tous droits réservés.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * isTestMailerEnabled — strict guard for the disk-capture test transport.
 *
 * ALL conditions must hold simultaneously:
 *   1. TEST_MAIL_DIR is set        — explicit opt-in directory
 *   2. ENABLE_TEST_MAILER === "true" — second explicit opt-in (TEST_MAIL_DIR alone is NOT enough)
 *   3. RENDER is not set           — never on Render.com deployments
 *   4. FLY_APP_NAME is not set     — never on Fly.io deployments
 *   5. REPLIT_DEPLOYMENT !== "1"   — never on Replit published/deployed instances
 *
 * In every real production environment (Render, Fly, Replit deployed) this returns false
 * and the mailer falls through to Resend.  Tokens are never written to disk in production.
 */
function isTestMailerEnabled(): boolean {
  if (!process.env["TEST_MAIL_DIR"])                       return false;
  if (process.env["ENABLE_TEST_MAILER"] !== "true")        return false;
  if (process.env["RENDER"])                               return false;
  if (process.env["FLY_APP_NAME"])                         return false;
  if (process.env["REPLIT_DEPLOYMENT"] === "1")            return false;
  return true;
}

// ── Internal send helper ──────────────────────────────────────────────────────

async function send(opts: {
  to: string;
  subject: string;
  html: string;
  tag?: string;
  from?: string;
}): Promise<MailResult> {
  // ── Test transport: write to TEST_MAIL_DIR (requires ENABLE_TEST_MAILER=true) ──
  if (isTestMailerEnabled()) {
    const testMailDir = process.env["TEST_MAIL_DIR"]!;
    try {
      fs.mkdirSync(testMailDir, { recursive: true });
      const timestamp = Date.now();
      const fname = path.join(testMailDir, `${timestamp}_${opts.tag || "mail"}.json`);
      const payload: Record<string, unknown> = {
        to: opts.to,
        subject: opts.subject,
        tag: opts.tag || null,
        sentAt: new Date().toISOString(),
      };
      // Extract raw token from invitation URL (token is 64-char hex)
      const tokenMatch = opts.html.match(/[?&]token=([a-f0-9]{64})/i);
      if (tokenMatch) payload["token"] = tokenMatch[1];
      // Extract full invitation URL
      const urlMatch = opts.html.match(/href="([^"]*accept-invitation[^"]*)"/i);
      if (urlMatch) payload["inviteUrl"] = urlMatch[1];
      fs.writeFileSync(fname, JSON.stringify(payload, null, 2));
      logger.info({ fname, to: opts.to, tag: opts.tag }, "[Mailer] TEST_MAIL_DIR: email captured (not sent)");
      return { ok: true, id: `test-${timestamp}` };
    } catch (writeErr: unknown) {
      logger.error({ err: writeErr }, "[Mailer] TEST_MAIL_DIR write failed");
      return { ok: false, error: "TEST_MAIL_DIR write failed" };
    }
  }

  const resend = getResend();
  if (!resend) return { ok: false, error: "RESEND_API_KEY_MISSING" };

  try {
    const result = await resend.emails.send({
      from: opts.from ?? getFrom(),
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      tags: opts.tag ? [{ name: "type", value: opts.tag }] : undefined,
    });
    if (result.error) {
      logger.warn({ err: result.error, to: opts.to, subject: opts.subject }, "[Mailer] Resend error");
      return { ok: false, error: result.error.message };
    }
    logger.info({ id: result.data?.id, to: opts.to, tag: opts.tag }, "[Mailer] Email sent");
    return { ok: true, id: result.data?.id };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, to: opts.to, subject: opts.subject }, "[Mailer] Failed to send email");
    return { ok: false, error: msg };
  }
}

// ── 1. Welcome ────────────────────────────────────────────────────────────────

async function sendWelcome(opts: { to: string; name: string }): Promise<MailResult> {
  return send({
    to: opts.to,
    subject: "Bienvenue sur FlowPoint 🚀",
    tag: "welcome",
    html: layout({
      eyebrow: "Bienvenue",
      title: `Content de t'avoir, ${opts.name} !`,
      body: `<p style="margin:0 0 16px;">Ton compte FlowPoint est prêt. En quelques minutes, tu peux :</p>
             <ul style="margin:0 0 16px;padding-left:20px;color:#4a5280;">
               <li style="margin-bottom:8px;">Lancer un <strong>audit SEO</strong> sur ton site</li>
               <li style="margin-bottom:8px;">Configurer le <strong>monitoring de performance</strong></li>
               <li style="margin-bottom:8px;">Générer tes premières <strong>missions IA</strong></li>
               <li style="margin-bottom:8px;">Connecter <strong>Google Analytics & Search Console</strong></li>
             </ul>
             <p style="margin:0;">Commence dès maintenant — ton équipe FlowPoint est là si tu as besoin.</p>`,
      cta: { label: "Accéder au dashboard →", url: "https://app.flowpoint.pro" },
      note: "💡 Tu peux répondre à cet e-mail pour contacter notre équipe.",
    }),
  });
}

// ── 2. Trial Started ──────────────────────────────────────────────────────────

async function sendTrialStarted(opts: {
  to: string;
  name: string;
  plan: string;
  trialEndsAt: string;
}): Promise<MailResult> {
  const planLabel = { standard: "Standard", pro: "Pro", ultra: "Ultra" }[opts.plan.toLowerCase()] ?? opts.plan;
  const endDate = new Date(opts.trialEndsAt).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  return send({
    to: opts.to,
    subject: `Ton essai gratuit FlowPoint ${planLabel} est lancé`,
    tag: "trial_started",
    html: layout({
      eyebrow: "Essai gratuit",
      accentColor: "#7c3aed",
      title: `14 jours pour explorer FlowPoint ${planLabel}`,
      body: `<p style="margin:0 0 16px;">Ton essai <strong>FlowPoint ${planLabel}</strong> est actif jusqu'au <strong>${endDate}</strong>.</p>
             <p style="margin:0 0 16px;">Pendant ces 14 jours, tu as accès à toutes les fonctionnalités ${planLabel} :</p>
             <ul style="margin:0 0 16px;padding-left:20px;color:#4a5280;">
               <li style="margin-bottom:6px;">Audits SEO illimités</li>
               <li style="margin-bottom:6px;">Monitoring temps réel</li>
               <li style="margin-bottom:6px;">Missions IA personnalisées</li>
               <li style="margin-bottom:6px;">Rapports white-label</li>
             </ul>
             <p style="margin:0;">Tu seras notifié 3 jours avant la fin de l'essai.</p>`,
      cta: { label: "Explorer FlowPoint →", url: "https://app.flowpoint.pro" },
      note: "Aucune carte bancaire requise pendant l'essai. Tu peux upgrader à tout moment.",
    }),
  });
}

// ── 3. Trial Ending ───────────────────────────────────────────────────────────

async function sendTrialEnding(opts: {
  to: string;
  name: string;
  daysLeft: number;
  plan: string;
}): Promise<MailResult> {
  const planLabel = { standard: "Standard", pro: "Pro", ultra: "Ultra" }[opts.plan.toLowerCase()] ?? opts.plan;
  return send({
    to: opts.to,
    subject: `⏰ Ton essai FlowPoint se termine dans ${opts.daysLeft} jour${opts.daysLeft > 1 ? "s" : ""}`,
    tag: "trial_ending",
    html: layout({
      eyebrow: "Essai — fin proche",
      accentColor: "#ea580c",
      title: `Plus que ${opts.daysLeft} jour${opts.daysLeft > 1 ? "s" : ""} sur ton essai`,
      body: `<p style="margin:0 0 16px;">Ton essai <strong>FlowPoint ${planLabel}</strong> se termine bientôt.</p>
             <p style="margin:0 0 16px;">Pour continuer à bénéficier de toutes tes fonctionnalités sans interruption, active ton abonnement maintenant.</p>
             <p style="margin:0;">À la fin de l'essai, ton compte passera automatiquement en plan gratuit limité.</p>`,
      cta: { label: "Activer mon abonnement →", url: "https://app.flowpoint.pro/billing" },
      note: "Questions ? Réponds à cet e-mail, on te répond en quelques heures.",
    }),
  });
}

// ── 4. Payment Succeeded ──────────────────────────────────────────────────────

async function sendPaymentSucceeded(opts: {
  to: string;
  name: string;
  plan: string;
  amountEur?: number;
  periodEnd?: string;
}): Promise<MailResult> {
  const planLabel = { standard: "Standard", pro: "Pro", ultra: "Ultra" }[opts.plan.toLowerCase()] ?? opts.plan;
  const amount = opts.amountEur ? `${opts.amountEur}€` : "";
  const period = opts.periodEnd
    ? new Date(opts.periodEnd).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
    : "";
  return send({
    to: opts.to,
    subject: "✅ Paiement confirmé — FlowPoint",
    tag: "payment_succeeded",
    html: layout({
      eyebrow: "Paiement confirmé",
      accentColor: "#16a34a",
      title: "Ton paiement est accepté",
      body: `<p style="margin:0 0 16px;">Merci ${opts.name} ! Ton abonnement <strong>FlowPoint ${planLabel}</strong>${amount ? ` (${amount})` : ""} est actif.</p>
             ${period ? `<p style="margin:0 0 16px;">Prochaine facturation : <strong>${period}</strong>.</p>` : ""}
             <p style="margin:0;">Tu peux gérer ta facturation (factures, changement de moyen de paiement, annulation) depuis le portail client.</p>`,
      cta: { label: "Accéder au portail facturation →", url: "https://app.flowpoint.pro/billing" },
    }),
  });
}

// ── 5. Payment Failed ─────────────────────────────────────────────────────────

async function sendPaymentFailed(opts: {
  to: string;
  name: string;
  plan: string;
  attemptCount?: number;
  retryDate?: string;
}): Promise<MailResult> {
  const planLabel = { standard: "Standard", pro: "Pro", ultra: "Ultra" }[opts.plan.toLowerCase()] ?? opts.plan;
  const retry = opts.retryDate
    ? new Date(opts.retryDate).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })
    : "dans quelques jours";
  return send({
    to: opts.to,
    subject: "⚠️ Échec de paiement — action requise",
    tag: "payment_failed",
    html: layout({
      eyebrow: "Paiement échoué",
      accentColor: "#dc2626",
      title: "Ton paiement n'a pas abouti",
      body: `<p style="margin:0 0 16px;">Le prélèvement pour ton abonnement <strong>FlowPoint ${planLabel}</strong> a échoué${opts.attemptCount && opts.attemptCount > 1 ? ` (tentative ${opts.attemptCount})` : ""}.</p>
             <p style="margin:0 0 16px;">Pour éviter la suspension de ton compte, mets à jour ton moyen de paiement. Une nouvelle tentative sera effectuée <strong>${retry}</strong>.</p>
             <p style="margin:0;">Si tu ne mets pas à jour ta carte, ton abonnement sera suspendu après 3 échecs.</p>`,
      cta: { label: "Mettre à jour mon paiement →", url: "https://app.flowpoint.pro/billing" },
      note: "🔒 Tes données sont conservées pendant 30 jours après suspension.",
    }),
  });
}

// ── 6. Monitor Down ───────────────────────────────────────────────────────────

async function sendMonitorDown(opts: {
  to: string;
  monitorName: string;
  url: string;
  since?: string;
  statusCode?: number;
}): Promise<MailResult> {
  const since = opts.since
    ? new Date(opts.since).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  return send({
    to: opts.to,
    subject: `🔴 DOWN : ${opts.monitorName} ne répond plus`,
    tag: "monitor_down",
    html: layout({
      eyebrow: "Alerte Monitor",
      accentColor: "#dc2626",
      title: `${opts.monitorName} est DOWN`,
      body: `<p style="margin:0 0 16px;">Ton site <strong>${opts.url}</strong> ne répond plus depuis <strong>${since}</strong>${opts.statusCode ? ` (HTTP ${opts.statusCode})` : ""}.</p>
             <p style="margin:0 0 16px;">FlowPoint continue de surveiller et t'enverra une alerte dès le rétablissement.</p>
             <p style="margin:0;">Vérifie ton hébergeur, ton serveur, et tes logs de déploiement.</p>`,
      cta: { label: "Voir le monitor →", url: "https://app.flowpoint.pro/monitors" },
      note: "Pour désactiver ces alertes, modifie les règles d'alerte dans ton dashboard.",
    }),
  });
}

// ── 7. Monitor Up ─────────────────────────────────────────────────────────────

async function sendMonitorUp(opts: {
  to: string;
  monitorName: string;
  url: string;
  downDurationMin?: number;
}): Promise<MailResult> {
  const duration = opts.downDurationMin
    ? opts.downDurationMin < 60
      ? `${opts.downDurationMin} minute${opts.downDurationMin > 1 ? "s" : ""}`
      : `${Math.round(opts.downDurationMin / 60)}h${opts.downDurationMin % 60 > 0 ? ` ${opts.downDurationMin % 60}min` : ""}`
    : "";
  return send({
    to: opts.to,
    subject: `✅ RÉTABLI : ${opts.monitorName} est de nouveau en ligne`,
    tag: "monitor_up",
    html: layout({
      eyebrow: "Monitor rétabli",
      accentColor: "#16a34a",
      title: `${opts.monitorName} est de nouveau UP`,
      body: `<p style="margin:0 0 16px;"><strong>${opts.url}</strong> répond à nouveau correctement${duration ? ` après <strong>${duration} d'interruption</strong>` : ""}.</p>
             <p style="margin:0;">L'incident est clos. Consulte l'historique de disponibilité depuis ton dashboard.</p>`,
      cta: { label: "Voir l'historique →", url: "https://app.flowpoint.pro/monitors" },
    }),
  });
}

// ── 8. Report Generated ───────────────────────────────────────────────────────

async function sendReportGenerated(opts: {
  to: string;
  name: string;
  reportName: string;
  reportUrl?: string;
}): Promise<MailResult> {
  return send({
    to: opts.to,
    subject: `📊 Rapport prêt : ${opts.reportName}`,
    tag: "report_generated",
    html: layout({
      eyebrow: "Rapport disponible",
      title: `Ton rapport est prêt`,
      body: `<p style="margin:0 0 16px;">Le rapport <strong>${opts.reportName}</strong> a été généré avec succès.</p>
             <p style="margin:0;">Tu peux le télécharger, le partager avec un lien client, ou l'exporter en PDF depuis ton dashboard.</p>`,
      cta: { label: "Accéder au rapport →", url: opts.reportUrl || "https://app.flowpoint.pro/reports" },
    }),
  });
}

// ── 9. Team Invitation ────────────────────────────────────────────────────────

async function sendTeamInvitation(opts: {
  to: string;
  inviterName: string;
  orgName?: string;
  role: string;
  inviteUrl?: string;
}): Promise<MailResult> {
  const roleLabel: Record<string, string> = {
    viewer: "Lecteur", member: "Membre", editor: "Éditeur", admin: "Administrateur", owner: "Propriétaire",
  };
  const role = roleLabel[opts.role] || opts.role;
  const org = opts.orgName || "FlowPoint";
  return send({
    to: opts.to,
    subject: `${opts.inviterName} t'invite à rejoindre ${org} sur FlowPoint`,
    tag: "team_invitation",
    html: layout({
      eyebrow: "Invitation équipe",
      accentColor: "#7c3aed",
      title: `Tu es invité sur FlowPoint`,
      body: `<p style="margin:0 0 16px;"><strong>${opts.inviterName}</strong> t'invite à rejoindre l'espace <strong>${org}</strong> en tant que <strong>${role}</strong>.</p>
             <p style="margin:0 0 16px;">FlowPoint est une plateforme SEO, monitoring et IA pour les équipes digitales.</p>
             <p style="margin:0;">Clique ci-dessous pour accepter l'invitation et accéder au dashboard.</p>`,
      cta: { label: "Rejoindre l'équipe →", url: opts.inviteUrl || "https://app.flowpoint.pro" },
      note: "Si tu n'attendais pas cette invitation, ignore cet e-mail.",
    }),
  });
}

// ── 10. Invitation Accepted (notify inviter) ─────────────────────────────────

async function sendInvitationAccepted(opts: {
  to: string;
  memberEmail: string;
  memberName?: string;
  orgName?: string;
  role: string;
  dashboardUrl?: string;
}): Promise<MailResult> {
  const roleLabel: Record<string, string> = {
    viewer: "Lecteur", member: "Membre", editor: "Éditeur", admin: "Administrateur",
  };
  const role = roleLabel[opts.role] || opts.role;
  const org = opts.orgName || "FlowPoint";
  const memberName = opts.memberName || opts.memberEmail;
  return send({
    to: opts.to,
    subject: `${memberName} a rejoint ${org} sur FlowPoint`,
    tag: "invitation_accepted",
    html: layout({
      eyebrow: "Invitation acceptée",
      eyebrowColor: "rgba(34,197,94,0.15)",
      accentColor: "#16a34a",
      title: `Nouvelle recrue dans l'équipe`,
      body: `<p style="margin:0 0 16px;"><strong>${memberName}</strong> a accepté ton invitation et a rejoint l'espace <strong>${org}</strong> en tant que <strong>${role}</strong>.</p>
             <p style="margin:0;">Tu peux maintenant collaborer ensemble directement depuis ton dashboard FlowPoint.</p>`,
      cta: { label: "Voir l'équipe →", url: opts.dashboardUrl || "https://app.flowpoint.pro/dashboard.html#team" },
      note: "Cet e-mail t'a été envoyé car tu avais invité ce membre dans ton espace FlowPoint.",
    }),
  });
}

// ── 11. New AI Missions ───────────────────────────────────────────────────────

async function sendNewMissions(opts: {
  to: string;
  name: string;
  missions: Array<{ title: string; priority: string; impact: string }>;
  siteUrl?: string;
}): Promise<MailResult> {
  const missionRows = opts.missions
    .slice(0, 5)
    .map(m => {
      const priorityColor = m.priority === "critical" ? "#dc2626" : m.priority === "high" ? "#ea580c" : m.priority === "medium" ? "#ca8a04" : "#6b7280";
      const priorityLabel: Record<string, string> = { critical: "Critique", high: "Haute", medium: "Moyenne", low: "Faible" };
      return `<div style="padding:10px 0;border-bottom:1px solid #eaedf5;">
        <div style="font-size:13px;font-weight:700;color:#0d0f1a;">${m.title}</div>
        <div style="font-size:11px;margin-top:3px;">
          <span style="color:${priorityColor};font-weight:600;">${priorityLabel[m.priority] || m.priority}</span>
          <span style="color:#8891b8;margin-left:8px;">Impact : ${m.impact}</span>
        </div>
      </div>`;
    })
    .join("");

  return send({
    to: opts.to,
    subject: `🤖 ${opts.missions.length} nouvelle${opts.missions.length > 1 ? "s" : ""} mission${opts.missions.length > 1 ? "s" : ""} IA générée${opts.missions.length > 1 ? "s" : ""}`,
    tag: "new_missions",
    html: layout({
      eyebrow: "Missions IA",
      accentColor: "#7c3aed",
      title: `${opts.missions.length} mission${opts.missions.length > 1 ? "s" : ""} IA prête${opts.missions.length > 1 ? "s" : ""} pour toi`,
      body: `<p style="margin:0 0 16px;">FlowPoint a analysé ${opts.siteUrl ? `<strong>${opts.siteUrl}</strong>` : "tes sites"} et généré ${opts.missions.length} mission${opts.missions.length > 1 ? "s" : ""} SEO prioritaire${opts.missions.length > 1 ? "s" : ""} :</p>
             <div style="background:#f8f9ff;border:1px solid #dde1f0;border-radius:8px;padding:0 12px;margin-bottom:16px;">${missionRows}</div>
             <p style="margin:0;">Traite les missions prioritaires en premier pour maximiser ton impact SEO.</p>`,
      cta: { label: "Voir mes missions →", url: "https://app.flowpoint.pro/missions" },
    }),
  });
}

// ── 11. SEO Alert (bonus) ─────────────────────────────────────────────────────

async function sendSeoAlert(opts: {
  to: string;
  ruleName: string;
  url: string;
  score: number;
  threshold: number;
  operator: string;
}): Promise<MailResult> {
  const opLabel: Record<string, string> = { lt: "est tombé sous", gt: "a dépassé", eq: "a atteint" };
  const op = opLabel[opts.operator] || opts.operator;
  return send({
    to: opts.to,
    subject: `🔔 Alerte SEO : ${opts.ruleName}`,
    tag: "seo_alert",
    html: layout({
      eyebrow: "Alerte SEO",
      accentColor: "#ea580c",
      title: `Alerte déclenchée : ${opts.ruleName}`,
      body: `<p style="margin:0 0 16px;">Le score SEO de <strong>${opts.url}</strong> ${op} le seuil de <strong>${opts.threshold}/100</strong>.</p>
             <p style="margin:0 0 16px;">Score actuel : <strong style="font-size:18px;">${opts.score}/100</strong></p>
             <p style="margin:0;">Lance un audit complet pour identifier les problèmes et générer des missions correctives.</p>`,
      cta: { label: "Voir l'audit →", url: "https://app.flowpoint.pro/audits" },
    }),
  });
}

// ── 12. Subscription Canceled ─────────────────────────────────────────────────

async function sendSubscriptionCanceled(opts: {
  to: string;
  name: string;
  plan: string;
  cancelDate: string | null;
}): Promise<MailResult> {
  const planLabel = opts.plan.charAt(0).toUpperCase() + opts.plan.slice(1).toLowerCase();
  const body = opts.cancelDate
    ? `<p style="margin:0 0 16px;">Ton abonnement <strong>FlowPoint ${planLabel}</strong> a bien été programmé pour annulation. Tu conserves l'accès à toutes les fonctionnalités jusqu'au <strong>${opts.cancelDate}</strong>.</p>
       <p style="margin:0 0 16px;">À cette date, ton compte passera automatiquement en accès limité (plan Standard gratuit).</p>
       <p style="margin:0;">Tu peux réactiver ton abonnement à tout moment depuis le tableau de bord, sans perdre tes données.</p>`
    : `<p style="margin:0 0 16px;">Ton abonnement <strong>FlowPoint ${planLabel}</strong> a été annulé immédiatement. Ton compte est maintenant en accès limité.</p>
       <p style="margin:0;">Tu peux te réabonner à tout moment depuis la page de tarification.</p>`;
  return send({
    to: opts.to,
    subject: `Abonnement FlowPoint ${planLabel} annulé`,
    tag: "subscription_canceled",
    html: layout({
      eyebrow: "Abonnement annulé",
      accentColor: "#64748b",
      title: `Confirmation d'annulation`,
      body,
      cta: { label: "Voir mes options →", url: "https://app.flowpoint.pro/billing" },
      note: "Si tu as annulé par erreur, connecte-toi et clique sur \"Réactiver\" pour rétablir ton abonnement.",
    }),
  });
}

// ── 13. Subscription Reactivated ──────────────────────────────────────────────

async function sendSubscriptionReactivated(opts: {
  to: string;
  name: string;
  plan: string;
}): Promise<MailResult> {
  const planLabel = opts.plan.charAt(0).toUpperCase() + opts.plan.slice(1).toLowerCase();
  return send({
    to: opts.to,
    subject: `✅ Abonnement FlowPoint ${planLabel} réactivé`,
    tag: "subscription_reactivated",
    html: layout({
      eyebrow: "Abonnement réactivé",
      accentColor: "#22c55e",
      title: `Ton abonnement est de nouveau actif`,
      body: `<p style="margin:0 0 16px;">Bonne nouvelle ! Ton abonnement <strong>FlowPoint ${planLabel}</strong> a été réactivé avec succès. Le renouvellement automatique est rétabli.</p>
             <p style="margin:0;">Tu conserves toutes tes données, configurations et add-ons. Rien n'a changé.</p>`,
      cta: { label: "Retour au dashboard →", url: "https://app.flowpoint.pro" },
    }),
  });
}

// ── 14. Trial Canceled ────────────────────────────────────────────────────────

async function sendTrialCanceled(opts: {
  to: string;
  name: string;
  plan: string;
  cancelDate: string | null;
}): Promise<MailResult> {
  const planLabel = opts.plan.charAt(0).toUpperCase() + opts.plan.slice(1).toLowerCase();
  const body = opts.cancelDate
    ? `<p style="margin:0 0 16px;">Ton essai gratuit <strong>FlowPoint ${planLabel}</strong> se terminera le <strong>${opts.cancelDate}</strong>. Tu conserves l'accès complet jusqu'à cette date.</p>
       <p style="margin:0;">Si tu changes d'avis, tu peux te réabonner à tout moment depuis ton tableau de bord.</p>`
    : `<p style="margin:0 0 16px;">Ton essai gratuit <strong>FlowPoint ${planLabel}</strong> a été arrêté. Ton accès aux fonctionnalités payantes a été suspendu immédiatement.</p>
       <p style="margin:0;">Tu peux te réabonner à tout moment en choisissant un plan sur notre page de tarification.</p>`;
  return send({
    to: opts.to,
    subject: `Fin de l'essai FlowPoint ${planLabel}`,
    tag: "trial_canceled",
    html: layout({
      eyebrow: "Essai terminé",
      accentColor: "#f59e0b",
      title: `Ton essai a été arrêté`,
      body,
      cta: { label: "Voir les plans →", url: "https://app.flowpoint.pro/pricing.html" },
    }),
  });
}

// ── 15. Account Deleted ───────────────────────────────────────────────────────

async function sendAccountDeleted(opts: {
  to: string;
  name: string;
}): Promise<MailResult> {
  return send({
    to: opts.to,
    subject: "Votre compte FlowPoint a été supprimé",
    tag: "account_deleted",
    html: layout({
      eyebrow: "Compte supprimé",
      accentColor: "#64748b",
      title: "Suppression confirmée",
      body: `<p style="margin:0 0 16px;">Bonjour ${opts.name},</p>
             <p style="margin:0 0 16px;">La suppression définitive de votre compte FlowPoint a bien été effectuée. L'ensemble de vos données a été supprimé de nos serveurs :</p>
             <ul style="margin:0 0 16px;padding-left:20px;line-height:2;color:#64748b;font-size:13px">
               <li>Projets, audits et rapports</li>
               <li>Monitors, alertes et concurrents</li>
               <li>Données SEO et analytics</li>
               <li>Membres de l'équipe et intégrations</li>
               <li>Abonnement Stripe résilié</li>
             </ul>
             <p style="margin:0;">Si vous souhaitez revenir sur FlowPoint à l'avenir, vous pouvez créer un nouveau compte à tout moment sur notre site.</p>`,
      cta: { label: "Retour sur FlowPoint →", url: "https://flowpoint.pro" },
      note: "Cet email confirme la suppression définitive. Aucune autre action n'est requise de votre part.",
    }),
  });
}

// ── 12. Activation Magic Link (sent after Stripe validates new signup) ───────

async function sendActivationMagicLink(opts: {
  to: string;
  name: string;
  plan: string;
  magicLinkUrl: string;
  isTrial: boolean;
}): Promise<MailResult> {
  const planLabel = { standard: "Standard", pro: "Pro", ultra: "Ultra" }[opts.plan.toLowerCase()] ?? opts.plan;
  const subject = opts.isTrial
    ? `Ton essai FlowPoint ${planLabel} est prêt — accède à ton compte`
    : `Ton compte FlowPoint ${planLabel} est activé — connecte-toi`;

  const eyebrow = opts.isTrial ? "Essai gratuit 14 jours" : "Compte activé";
  const accentColor = opts.isTrial ? "#7c3aed" : "#2563EB";

  const body = opts.isTrial
    ? `<p style="margin:0 0 16px;">Ton paiement est confirmé. Ton essai gratuit <strong>FlowPoint ${planLabel}</strong> est maintenant actif.</p>
       <p style="margin:0 0 16px;">Clique sur le bouton ci-dessous pour accéder à ton compte. Ce lien est à usage unique et expire dans 24 heures.</p>
       <p style="margin:0;color:#64748b;font-size:13px;">Si tu n'as pas créé ce compte, ignore cet email.</p>`
    : `<p style="margin:0 0 16px;">Ton paiement est confirmé. Ton abonnement <strong>FlowPoint ${planLabel}</strong> est maintenant actif.</p>
       <p style="margin:0 0 16px;">Clique sur le bouton ci-dessous pour accéder à ton compte. Ce lien est à usage unique et expire dans 24 heures.</p>
       <p style="margin:0;color:#64748b;font-size:13px;">Si tu n'as pas créé ce compte, ignore cet email.</p>`;

  return send({
    to: opts.to,
    subject,
    tag: "activation_magic_link",
    html: layout({
      eyebrow,
      accentColor,
      title: `Bienvenue sur FlowPoint, ${opts.name} !`,
      body,
      cta: { label: "Accéder à mon compte →", url: opts.magicLinkUrl },
      note: "Ce lien de connexion est valable 24 heures et ne peut être utilisé qu'une seule fois. Si tu rencontres un problème, réponds à cet email.",
    }),
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export const mailer = {
  sendWelcome,
  sendTrialStarted,
  sendTrialEnding,
  sendPaymentSucceeded,
  sendPaymentFailed,
  sendMonitorDown,
  sendMonitorUp,
  sendReportGenerated,
  sendTeamInvitation,
  sendInvitationAccepted,
  sendNewMissions,
  sendSeoAlert,
  sendSubscriptionCanceled,
  sendSubscriptionReactivated,
  sendTrialCanceled,
  sendAccountDeleted,
  sendActivationMagicLink,
};
