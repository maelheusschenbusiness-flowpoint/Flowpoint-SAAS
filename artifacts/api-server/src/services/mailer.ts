/**
 * Centralized transactional email service.
 *
 * Every sender resolves a customer locale, selects one complete translated
 * template, and sends both HTML and plain-text alternatives.
 */
import { Resend } from "resend";
import nodemailer from "nodemailer";
import { logger } from "../lib/logger.js";
import fs from "fs";
import path from "path";
import {
  emailLocaleForLanguage,
  resolveEmailLocale,
  type EmailLocale,
  type EmailLocaleHints,
} from "./email-localization.js";
import {
  EMAIL_TEMPLATE_IDS,
  formatCountUnit,
  getEmailPhrase,
  interpolateEmailCopy,
  selectEmailCopy,
  type EmailCopyField,
  type EmailTemplateId,
  type SelectedEmailCopy,
} from "./email-copy.js";

const APP_URL = (process.env["PUBLIC_URL"] || process.env["PUBLIC_BASE_URL"] || "https://app.flowpoint.pro").replace(/\/$/, "");
const APP_LINKS = {
  dashboard: `${APP_URL}/dashboard.html`,
  billing: `${APP_URL}/dashboard.html#billing`,
  monitors: `${APP_URL}/dashboard.html#monitors`,
  reports: `${APP_URL}/dashboard.html#reports`,
  alerts: `${APP_URL}/dashboard.html#settings`,
  pricing: `${APP_URL}/pricing.html`,
} as const;

function getResend(): Resend | null {
  const key = process.env["RESEND_API_KEY"];
  return key ? new Resend(key) : null;
}

function getFrom(): string {
  return process.env["RESEND_FROM"] || process.env["SMTP_FROM"] || "FlowPoint <noreply@flowpoint.pro>";
}

function getSmtpTransport(): ReturnType<typeof nodemailer.createTransport> | null {
  const host = process.env["SMTP_HOST"];
  const pass = process.env["SMTP_PASS"];
  if (!host || !pass) return null;
  const port = parseInt(process.env["SMTP_PORT"] || "465", 10);
  const secure = process.env["SMTP_SECURE"] !== "false";
  const user = process.env["SMTP_USER"] || "resend";
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

export interface MailResult {
  ok: boolean;
  id?: string;
  error?: string;
}

export interface MailContext extends EmailLocaleHints {
  to: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  language: string;
}

interface RenderOptions {
  accentColor?: string;
  eyebrowColor?: string;
  ctaUrl: string;
}

type SendOptions = {
  to: string;
  subject: string;
  html: string;
  text: string;
  tag?: string;
  from?: string;
};

type CaptureOptions = Omit<SendOptions, "text"> & { text?: string };

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlBody(plainBody: string): string {
  return plainBody
    .split(/\n\s*\n/)
    .map((paragraph) => {
      const lines = paragraph.split("\n").map((line) => escapeHtml(line));
      return `<p style="margin:0 0 16px;white-space:pre-line;">${lines.join("<br/>")}</p>`;
    })
    .join("");
}

function layout(opts: {
  language: string;
  eyebrow: string;
  title: string;
  body: string;
  cta: { label: string; url: string };
  note: string;
  footerDashboard: string;
  footerSupport: string;
  footerRights: string;
  accentColor?: string;
  eyebrowColor?: string;
}): string {
  const accent = opts.accentColor || "#2563EB";
  const eyebrowBg = opts.eyebrowColor || "#eff2ff";
  const eyebrowBorder = opts.eyebrowColor ? opts.eyebrowColor.replace("0.15", "0.4") : "#c7d0ff";
  const ctaBlock = `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin:32px 0 0;">
        <tr><td style="border-radius:10px;background:${escapeHtml(accent)};">
          <a href="${escapeHtml(opts.cta.url)}" style="display:inline-block;padding:15px 36px;border-radius:10px;color:#fff;font-size:15px;font-weight:700;text-decoration:none;">${escapeHtml(opts.cta.label)}</a>
        </td></tr>
      </table>`;
  const noteBlock = opts.note
    ? `<hr class="divider" style="border:none;border-top:1px solid #eaedf5;margin:28px 0;"/><p class="text-muted" style="margin:0;font-size:13px;color:#8891b8;line-height:1.6;">${escapeHtml(opts.note)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="${escapeHtml(opts.language)}" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="light dark"/>
  <meta name="supported-color-schemes" content="light dark"/>
  <style>
    :root { color-scheme: light dark; }
    @media (prefers-color-scheme: dark) {
      .email-body { background-color:#0d0f1a !important; }
      .email-card { background-color:#13162a !important; border-color:#252a45 !important; }
      .email-header,.email-footer { background-color:${escapeHtml(accent)} !important; }
      .text-main { color:#e8eeff !important; }
      .text-muted { color:#8891b8 !important; }
      .divider { border-color:#252a45 !important; }
    }
  </style>
</head>
<body class="email-body" style="margin:0;padding:0;background-color:#f0f2fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
    <tr><td align="center" style="padding:40px 16px;">
      <table class="email-card" width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation" style="max-width:560px;background:#fff;border-radius:16px;border:1px solid #dde1f0;overflow:hidden;">
        <tr><td class="email-header" style="background:${escapeHtml(accent)};padding:28px 40px;text-align:center;">
          <span style="font-size:24px;font-weight:800;color:#fff;letter-spacing:-.03em;">FlowPoint</span>
        </td></tr>
        <tr><td style="padding:36px 40px 32px;">
          <div style="display:inline-block;background:${escapeHtml(eyebrowBg)};border:1px solid ${escapeHtml(eyebrowBorder)};border-radius:6px;padding:4px 12px;font-size:11px;font-weight:700;color:${escapeHtml(accent)};letter-spacing:.06em;text-transform:uppercase;margin-bottom:18px;">${escapeHtml(opts.eyebrow)}</div>
          <h1 class="text-main" style="margin:0 0 14px;font-size:24px;font-weight:800;color:#0d0f1a;letter-spacing:-.03em;line-height:1.2;">${escapeHtml(opts.title)}</h1>
          <div class="text-muted" style="font-size:15px;color:#4a5280;line-height:1.65;">${htmlBody(opts.body)}</div>
          ${ctaBlock}${noteBlock}
        </td></tr>
        <tr><td class="email-footer" style="background:${escapeHtml(accent)};padding:20px 40px;text-align:center;">
          <p style="margin:0 0 6px;font-size:13px;color:rgba(255,255,255,.9);">
            <a href="https://flowpoint.pro" style="color:#fff;text-decoration:none;font-weight:700;">flowpoint.pro</a>
            &nbsp;·&nbsp;<a href="${escapeHtml(APP_LINKS.dashboard)}" style="color:rgba(255,255,255,.85);text-decoration:none;">${escapeHtml(opts.footerDashboard)}</a>
            &nbsp;·&nbsp;<a href="mailto:support@flowpoint.pro" style="color:rgba(255,255,255,.85);text-decoration:none;">${escapeHtml(opts.footerSupport)}</a>
          </p>
          <p style="margin:0;font-size:11px;color:rgba(255,255,255,.65);">© ${new Date().getFullYear()} FlowPoint. ${escapeHtml(opts.footerRights)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function renderSelectedEmail(
  selected: SelectedEmailCopy,
  locale: EmailLocale,
  values: Record<string, unknown>,
  options: RenderOptions,
): RenderedEmail {
  const fields: Record<EmailCopyField, string> = {
    subject: interpolateEmailCopy(selected.template.subject, values),
    eyebrow: interpolateEmailCopy(selected.template.eyebrow, values),
    title: interpolateEmailCopy(selected.template.title, values),
    body: interpolateEmailCopy(selected.template.body, values),
    cta: interpolateEmailCopy(selected.template.cta, values),
    note: interpolateEmailCopy(selected.template.note, values),
  };
  const footerDashboard = getEmailPhrase(selected, "footerDashboard");
  const footerSupport = getEmailPhrase(selected, "footerSupport");
  const footerRights = getEmailPhrase(selected, "footerRights");
  const html = layout({
    language: locale.htmlLang,
    eyebrow: fields.eyebrow,
    title: fields.title,
    body: fields.body,
    cta: { label: fields.cta, url: options.ctaUrl },
    note: fields.note,
    footerDashboard,
    footerSupport,
    footerRights,
    accentColor: options.accentColor,
    eyebrowColor: options.eyebrowColor,
  });
  const text = [
    fields.title,
    "",
    fields.body,
    "",
    `${fields.cta}: ${options.ctaUrl}`,
    fields.note,
    "",
    `flowpoint.pro | ${footerDashboard} | ${footerSupport}`,
    `© ${new Date().getFullYear()} FlowPoint. ${footerRights}`,
  ].filter((line) => line !== "").join("\n");
  return { subject: fields.subject.replace(/[\r\n]+/g, " ").trim(), html, text, language: selected.language };
}

/** Pure renderer used by senders and tests; it never sends or looks up an account. */
export function renderEmailForLocale(
  templateId: EmailTemplateId,
  locale: EmailLocale,
  values: Record<string, unknown>,
  ctaUrl: string,
  style: Omit<RenderOptions, "ctaUrl"> = {},
): RenderedEmail {
  const selected = selectEmailCopy(locale.language, templateId);
  const effectiveLocale = emailLocaleForLanguage(locale, selected.language);
  return renderSelectedEmail(selected, effectiveLocale, values, { ...style, ctaUrl });
}

function isTestMailerEnabled(): boolean {
  return !!process.env["TEST_MAIL_DIR"]
    && process.env["ENABLE_TEST_MAILER"] === "true"
    && process.env["NODE_ENV"] !== "production"
    && !process.env["RENDER"]
    && !process.env["FLY_APP_NAME"]
    && process.env["REPLIT_DEPLOYMENT"] !== "1";
}

function isHostedRuntime(): boolean {
  return !!process.env["RENDER"]
    || !!process.env["FLY_APP_NAME"]
    || process.env["REPLIT_DEPLOYMENT"] === "1";
}

function isAutomatedTestRun(): boolean {
  const ci = process.env["CI"]?.trim().toLowerCase();
  return process.env["FLOWPOINT_AUTOMATED_TESTS"] === "true"
    || process.env["VITEST"] === "true"
    || process.env["NODE_TEST_CONTEXT"] !== undefined
    || process.env["JEST_WORKER_ID"] !== undefined
    || ci === "true"
    || ci === "1";
}

function isTestRecipientAllowed(to: string): boolean {
  const allowed = process.env["TEST_EMAIL_RECIPIENT_ALLOWLIST"];
  if (!allowed) return false;
  const normalizedTo = to.trim().toLowerCase();
  return allowed
    .split(",")
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean)
    .includes(normalizedTo);
}

function isHostedTestResendEnabled(to: string): boolean {
  return process.env["NODE_ENV"] === "test"
    && isHostedRuntime()
    && process.env["ENABLE_HOSTED_TEST_EMAIL_DELIVERY"] === "true"
    && !!process.env["RESEND_API_KEY"]
    && !isAutomatedTestRun()
    && isTestRecipientAllowed(to);
}

export async function captureTestMail(opts: CaptureOptions): Promise<boolean> {
  if (!isTestMailerEnabled()) return false;
  const result = await send({ ...opts, text: opts.text ?? "" });
  if (!result.ok) throw new Error(result.error ?? "TEST_MAIL_CAPTURE_FAILED");
  return true;
}

async function send(opts: SendOptions): Promise<MailResult> {
  const testMailerEnabled = isTestMailerEnabled();
  const testEnvironment = process.env["NODE_ENV"] === "test";
  if (process.env["TEST_MAIL_DIR"] && !testMailerEnabled) {
    return { ok: false, error: "TEST_MAILER_NOT_ENABLED" };
  }
  if (testMailerEnabled) {
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
      // Keep a redacted copy of the agency-report email body for TEST
      // certification. The bearer portal token is never written to the capture.
      if (opts.tag === "report_generated") {
        payload["html"] = opts.html.replace(
          /(\/api\/agency-portal\/)[A-Za-z0-9_-]{40,50}/g,
          "$1[PORTAL_TOKEN_REDACTED]",
        );
      }
      const tokenMatch = `${opts.html}\n${opts.text}`.match(/[?&]token=([a-f0-9]{64})/i);
      if (tokenMatch) payload["token"] = tokenMatch[1];
      const inviteMatch = opts.text.match(/https?:\/\/\S*accept-invitation\S*/i);
      if (inviteMatch) payload["inviteUrl"] = inviteMatch[0];
      fs.writeFileSync(fname, JSON.stringify(payload, null, 2));
      logger.info({ fname, to: opts.to, tag: opts.tag }, "[Mailer] test email captured (not sent)");
      return { ok: true, id: `test-${timestamp}` };
    } catch (err: unknown) {
      logger.error({ err }, "[Mailer] test capture failed");
      return { ok: false, error: "TEST_MAIL_DIR_WRITE_FAILED" };
    }
  }

  if (isAutomatedTestRun() || (testEnvironment && !isHostedTestResendEnabled(opts.to))) {
    return { ok: false, error: "TEST_MAILER_NOT_ENABLED" };
  }

  const resend = getResend();
  if (testEnvironment && !resend) {
    return { ok: false, error: "TEST_MAILER_NOT_ENABLED" };
  }
  if (resend) {
    try {
      const result = await resend.emails.send({
        from: opts.from ?? getFrom(),
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
        tags: opts.tag ? [{ name: "type", value: opts.tag }] : undefined,
      });
      if (result.error) {
        if (testEnvironment) return { ok: false, error: result.error.message };
        logger.warn({ err: result.error, to: opts.to, tag: opts.tag }, "[Mailer] Resend error; trying SMTP fallback");
        const fallback = await sendViaSmtp(opts);
        return fallback ?? { ok: false, error: result.error.message };
      }
      logger.info({ id: result.data?.id, to: opts.to, tag: opts.tag }, "[Mailer] email sent via Resend");
      return { ok: true, id: result.data?.id };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, to: opts.to, tag: opts.tag }, "[Mailer] Resend send failed; trying SMTP fallback");
      if (testEnvironment) return { ok: false, error: message };
      return (await sendViaSmtp(opts)) ?? { ok: false, error: message };
    }
  }

  if (testEnvironment) return { ok: false, error: "TEST_MAILER_NOT_ENABLED" };
  const fallback = await sendViaSmtp(opts);
  if (fallback) return fallback;
  logger.warn({ to: opts.to, tag: opts.tag }, "[Mailer] no email transport configured");
  return { ok: false, error: "NO_EMAIL_TRANSPORT" };
}

async function sendViaSmtp(opts: SendOptions): Promise<MailResult | null> {
  const smtp = getSmtpTransport();
  if (!smtp) return null;
  try {
    const info = await smtp.sendMail({
      from: opts.from ?? getFrom(),
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    logger.info({ id: info.messageId, to: opts.to, tag: opts.tag }, "[Mailer] email sent via SMTP");
    return { ok: true, id: info.messageId };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, to: opts.to, tag: opts.tag }, "[Mailer] SMTP send failed");
    return { ok: false, error: `SMTP_SEND_FAILED: ${message}` };
  }
}

function formatPlan(plan: string): string {
  const lower = String(plan || "").toLowerCase();
  return ({ standard: "Standard", pro: "Pro", ultra: "Ultra" } as Record<string, string>)[lower] ?? plan;
}

export function formatEmailDate(value: string | Date, locale: EmailLocale, includeYear = true): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("EMAIL_INVALID_DATE");
  return new Intl.DateTimeFormat(locale.intlLocale, {
    day: "numeric",
    month: "long",
    ...(includeYear ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(date);
}

function formatTime(value: string | Date, locale: EmailLocale): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("EMAIL_INVALID_TIME");
  return new Intl.DateTimeFormat(locale.intlLocale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(date);
}

export function formatEmailCurrency(amount: number, locale: EmailLocale): string {
  if (!Number.isFinite(amount)) throw new Error("EMAIL_INVALID_AMOUNT");
  return new Intl.NumberFormat(locale.intlLocale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatEmailNumber(value: number, locale: EmailLocale): string {
  if (!Number.isFinite(value)) throw new Error("EMAIL_INVALID_NUMBER");
  return new Intl.NumberFormat(locale.intlLocale, { maximumFractionDigits: 2 }).format(value);
}

function unitCount(
  count: number,
  locale: EmailLocale,
  one: "dayOne" | "missionOne" | "minuteOne" | "hourOne",
  few: "dayFew" | "missionFew" | "minuteFew" | "hourFew",
  other: "dayOther" | "missionOther" | "minuteOther" | "hourOther",
  selected: SelectedEmailCopy,
): string {
  return formatCountUnit(count, locale.intlLocale, {
    one: selected.phrases[one],
    few: selected.phrases[few],
    other: selected.phrases[other],
  });
}

function roleLabel(role: string, selected: SelectedEmailCopy): string {
  const keys: Record<string, "roleViewer" | "roleMember" | "roleEditor" | "roleAdmin" | "roleOwner"> = {
    viewer: "roleViewer", member: "roleMember", editor: "roleEditor", admin: "roleAdmin", owner: "roleOwner",
  };
  const key = keys[String(role).toLowerCase()];
  return key ? getEmailPhrase(selected, key) : role;
}

function priorityLabel(priority: string, selected: SelectedEmailCopy): string {
  const keys: Record<string, "priorityCritical" | "priorityHigh" | "priorityMedium" | "priorityLow"> = {
    critical: "priorityCritical", high: "priorityHigh", medium: "priorityMedium", low: "priorityLow",
  };
  const key = keys[String(priority).toLowerCase()];
  return key ? getEmailPhrase(selected, key) : priority;
}

function durationText(minutes: number, locale: EmailLocale, selected: SelectedEmailCopy): string {
  const total = Math.max(0, Math.trunc(minutes));
  if (!total) return "";
  const hours = Math.floor(total / 60);
  const remaining = total % 60;
  const parts: string[] = [];
  if (hours) parts.push(unitCount(hours, locale, "hourOne", "hourFew", "hourOther", selected));
  if (remaining) parts.push(unitCount(remaining, locale, "minuteOne", "minuteFew", "minuteOther", selected));
  const localizedDuration = parts.join(" ");
  if (locale.language === "fr") return ` après ${localizedDuration} d'interruption`;
  if (locale.language === "es") return ` tras ${localizedDuration} de interrupción`;
  if (locale.language === "de") return ` nach ${localizedDuration} Ausfallzeit`;
  if (locale.language === "it") return ` dopo ${localizedDuration} di interruzione`;
  if (locale.language === "pt" || locale.language === "pt-br") return ` após ${localizedDuration} de interrupção`;
  if (locale.language === "nl") return ` na ${localizedDuration} uitval`;
  if (locale.language === "pl") return ` po ${localizedDuration} przerwy`;
  if (locale.language === "sv") return ` efter ${localizedDuration} avbrott`;
  if (locale.language === "ro") return ` după ${localizedDuration} de întrerupere`;
  if (locale.language === "cs") return ` po ${localizedDuration} výpadku`;
  return ` after ${localizedDuration} of downtime`;
}

interface PreparedEmail {
  values: Record<string, unknown>;
  ctaUrl: string;
  accentColor?: string;
  eyebrowColor?: string;
}

async function sendLocalized(
  opts: MailContext,
  templateId: EmailTemplateId,
  tag: string,
  prepare: (selected: SelectedEmailCopy, locale: EmailLocale) => PreparedEmail,
): Promise<MailResult> {
  try {
    const locale = await resolveEmailLocale(opts.to, opts);
    const selected = selectEmailCopy(locale.language, templateId);
    const effectiveLocale = emailLocaleForLanguage(locale, selected.language);
    const prepared = prepare(selected, effectiveLocale);
    const rendered = renderSelectedEmail(selected, effectiveLocale, prepared.values, {
      ctaUrl: prepared.ctaUrl,
      accentColor: prepared.accentColor,
      eyebrowColor: prepared.eyebrowColor,
    });
    return await send({
      to: opts.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      tag,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, to: opts.to, tag }, "[Mailer] localized template construction failed");
    return { ok: false, error: message };
  }
}

async function sendWelcome(opts: MailContext & { name: string }): Promise<MailResult> {
  return sendLocalized(opts, "welcome", "welcome", () => ({
    values: { name: opts.name },
    ctaUrl: APP_LINKS.dashboard,
  }));
}

async function sendTrialStarted(opts: MailContext & {
  name: string; plan: string; trialEndsAt: string; magicLinkUrl?: string;
}): Promise<MailResult> {
  return sendLocalized(opts, "trial_started", "trial_started", (_selected, locale) => ({
    values: { plan: formatPlan(opts.plan), endDate: formatEmailDate(opts.trialEndsAt, locale) },
    ctaUrl: opts.magicLinkUrl ?? APP_LINKS.dashboard,
    accentColor: "#7c3aed",
  }));
}

async function sendTrialEnding(opts: MailContext & {
  name: string; daysLeft: number; plan: string;
}): Promise<MailResult> {
  return sendLocalized(opts, "trial_ending", "trial_ending", (selected, locale) => ({
    values: {
      plan: formatPlan(opts.plan),
      daysPhrase: unitCount(opts.daysLeft, locale, "dayOne", "dayFew", "dayOther", selected),
    },
    ctaUrl: APP_LINKS.billing,
    accentColor: "#ea580c",
  }));
}

async function sendPaymentSucceeded(opts: MailContext & {
  name: string; plan: string; amountEur?: number; periodEnd?: string; isAddon?: boolean;
}): Promise<MailResult> {
  return sendLocalized(opts, "payment_succeeded", "payment_succeeded", (selected, locale) => {
    const amount = opts.amountEur ? formatEmailCurrency(opts.amountEur, locale) : "";
    const paymentDetails = opts.isAddon
      ? getEmailPhrase(selected, "paymentAddon")
      : getEmailPhrase(selected, "paymentRenewal", { plan: formatPlan(opts.plan) });
    return {
      values: {
        name: opts.name,
        plan: formatPlan(opts.plan),
        paymentDetails,
        amountSentence: amount ? getEmailPhrase(selected, "amountPaid", { amount }) : "",
        periodSentence: opts.periodEnd
          ? getEmailPhrase(selected, "nextBilling", { date: formatEmailDate(opts.periodEnd, locale) })
          : "",
      },
      ctaUrl: APP_LINKS.billing,
      accentColor: "#16a34a",
    };
  });
}

async function sendPlanChanged(opts: MailContext & {
  name: string; plan: string; amountEur?: number; periodEnd?: string; isTrial?: boolean;
}): Promise<MailResult> {
  return sendLocalized(opts, "plan_changed", "plan_changed", (selected, locale) => {
    const plan = formatPlan(opts.plan);
    const planDetails = opts.isTrial
      ? getEmailPhrase(selected, "planTrial", { plan })
      : getEmailPhrase(selected, "planPaid", { plan, amountClause: "" });
    const amountSentence = opts.amountEur && !opts.isTrial
      ? getEmailPhrase(selected, "amountPaid", { amount: formatEmailCurrency(opts.amountEur, locale) })
      : "";
    return {
      values: {
        name: opts.name,
        planDetails: [planDetails, amountSentence].filter(Boolean).join(" "),
        periodSentence: opts.periodEnd
          ? getEmailPhrase(selected, "nextBilling", { date: formatEmailDate(opts.periodEnd, locale) })
          : "",
      },
      ctaUrl: APP_LINKS.dashboard,
      accentColor: opts.isTrial ? "#7c3aed" : "#2563EB",
    };
  });
}

async function sendPaymentFailed(opts: MailContext & {
  name: string; plan: string; attemptCount?: number; retryDate?: string;
}): Promise<MailResult> {
  return sendLocalized(opts, "payment_failed", "payment_failed", (selected, locale) => ({
    values: {
      plan: formatPlan(opts.plan),
      attemptText: opts.attemptCount && opts.attemptCount > 1
        ? getEmailPhrase(selected, "attemptLabel", { count: opts.attemptCount })
        : "",
      retryText: opts.retryDate
        ? getEmailPhrase(selected, "retryOn", { date: formatEmailDate(opts.retryDate, locale, false) })
        : getEmailPhrase(selected, "retryMissing"),
    },
    ctaUrl: APP_LINKS.billing,
    accentColor: "#dc2626",
  }));
}

async function sendMonitorDown(opts: MailContext & {
  monitorName: string; url: string; since?: string; statusCode?: number;
}): Promise<MailResult> {
  return sendLocalized(opts, "monitor_down", "monitor_down", (selected, locale) => ({
    values: {
      monitorName: opts.monitorName,
      url: opts.url,
      since: formatTime(opts.since || new Date(), locale),
      statusCode: opts.statusCode != null ? getEmailPhrase(selected, "statusCode", { code: opts.statusCode }) : "",
    },
    ctaUrl: APP_LINKS.monitors,
    accentColor: "#dc2626",
  }));
}

async function sendMonitorUp(opts: MailContext & {
  monitorName: string; url: string; downDurationMin?: number;
}): Promise<MailResult> {
  return sendLocalized(opts, "monitor_up", "monitor_up", (selected, locale) => ({
    values: {
      monitorName: opts.monitorName,
      url: opts.url,
      durationText: opts.downDurationMin ? durationText(opts.downDurationMin, locale, selected) : "",
    },
    ctaUrl: APP_LINKS.monitors,
    accentColor: "#16a34a",
  }));
}

async function sendReportGenerated(opts: MailContext & {
  name: string; reportName: string; reportUrl?: string;
}): Promise<MailResult> {
  return sendLocalized(opts, "report_generated", "report_generated", () => ({
    values: { reportName: opts.reportName },
    ctaUrl: opts.reportUrl || APP_LINKS.reports,
  }));
}

async function sendTeamInvitation(opts: MailContext & {
  inviterName: string; orgName?: string; role: string; inviteUrl?: string;
}): Promise<MailResult> {
  return sendLocalized(opts, "team_invitation", "team_invitation", (selected) => ({
    values: {
      inviterName: opts.inviterName,
      orgName: opts.orgName || "FlowPoint",
      role: roleLabel(opts.role, selected),
    },
    ctaUrl: opts.inviteUrl || APP_LINKS.dashboard,
    accentColor: "#7c3aed",
  }));
}

async function sendInvitationAccepted(opts: MailContext & {
  memberEmail: string; memberName?: string; orgName?: string; role: string; dashboardUrl?: string;
}): Promise<MailResult> {
  return sendLocalized(opts, "invitation_accepted", "invitation_accepted", (selected) => ({
    values: {
      memberName: opts.memberName || opts.memberEmail,
      orgName: opts.orgName || "FlowPoint",
      role: roleLabel(opts.role, selected),
    },
    ctaUrl: opts.dashboardUrl || `${APP_URL}/dashboard.html#team`,
    accentColor: "#16a34a",
    eyebrowColor: "rgba(34,197,94,0.15)",
  }));
}

async function sendNewMissions(opts: MailContext & {
  name: string; missions: Array<{ title: string; priority: string; impact: string }>; siteUrl?: string;
}): Promise<MailResult> {
  return sendLocalized(opts, "new_missions", "new_missions", (selected, locale) => {
    const count = opts.missions.length;
    const missionCount = unitCount(count, locale, "missionOne", "missionFew", "missionOther", selected);
    const missionList = opts.missions.slice(0, 5).map((mission) =>
      `• ${mission.title} — ${priorityLabel(mission.priority, selected)} — ${mission.impact}`,
    ).join("\n");
    return {
      values: {
        missionCount,
        siteLabel: opts.siteUrl || getEmailPhrase(selected, "allSites"),
        missionList,
      },
      ctaUrl: `${APP_URL}/dashboard.html#missions`,
      accentColor: "#7c3aed",
    };
  });
}

async function sendSeoAlert(opts: MailContext & {
  ruleName: string; url: string; score: number; threshold: number; operator: string;
}): Promise<MailResult> {
  return sendLocalized(opts, "seo_alert", "seo_alert", (selected, locale) => {
    const operatorKey = ({ lt: "seoBelow", gt: "seoAbove", eq: "seoReached" } as const)[opts.operator as "lt" | "gt" | "eq"];
    return {
      values: {
        ruleName: opts.ruleName,
        url: opts.url,
        operatorPhrase: operatorKey ? getEmailPhrase(selected, operatorKey) : opts.operator,
        threshold: formatEmailNumber(opts.threshold, locale),
        score: formatEmailNumber(opts.score, locale),
      },
      ctaUrl: `${APP_URL}/dashboard.html#audits`,
      accentColor: "#ea580c",
    };
  });
}

async function sendSubscriptionCanceled(opts: MailContext & {
  name: string; plan: string; cancelDate: string | null;
}): Promise<MailResult> {
  return sendLocalized(opts, "subscription_canceled", "subscription_canceled", (selected, locale) => ({
    values: {
      plan: formatPlan(opts.plan),
      cancellationDetails: opts.cancelDate
        ? getEmailPhrase(selected, "subscriptionScheduled", { date: formatEmailDate(opts.cancelDate, locale) })
        : getEmailPhrase(selected, "subscriptionImmediate"),
    },
    ctaUrl: APP_LINKS.billing,
    accentColor: "#64748b",
  }));
}

async function sendSubscriptionReactivated(opts: MailContext & {
  name: string; plan: string;
}): Promise<MailResult> {
  return sendLocalized(opts, "subscription_reactivated", "subscription_reactivated", () => ({
    values: { plan: formatPlan(opts.plan) },
    ctaUrl: APP_LINKS.dashboard,
    accentColor: "#22c55e",
  }));
}

async function sendTrialCanceled(opts: MailContext & {
  name: string; plan: string; cancelDate: string | null;
}): Promise<MailResult> {
  return sendLocalized(opts, "trial_canceled", "trial_canceled", (selected, locale) => ({
    values: {
      plan: formatPlan(opts.plan),
      cancellationDetails: opts.cancelDate
        ? getEmailPhrase(selected, "trialScheduled", { date: formatEmailDate(opts.cancelDate, locale) })
        : getEmailPhrase(selected, "trialImmediate"),
    },
    ctaUrl: APP_LINKS.pricing,
    accentColor: "#f59e0b",
  }));
}

async function sendAccountDeleted(opts: MailContext & { name: string }): Promise<MailResult> {
  return sendLocalized(opts, "account_deleted", "account_deleted", () => ({
    values: { name: opts.name },
    ctaUrl: "https://flowpoint.pro",
    accentColor: "#64748b",
  }));
}

async function sendActivationMagicLink(opts: MailContext & {
  name: string; plan: string; magicLinkUrl: string; isTrial: boolean;
}): Promise<MailResult> {
  return sendLocalized(opts, "activation_magic_link", "activation_magic_link", (selected) => ({
    values: {
      name: opts.name,
      plan: formatPlan(opts.plan),
      activationDetails: getEmailPhrase(
        selected,
        opts.isTrial ? "activationTrial" : "activationPaid",
        { plan: formatPlan(opts.plan) },
      ),
    },
    ctaUrl: opts.magicLinkUrl,
    accentColor: opts.isTrial ? "#7c3aed" : "#2563EB",
  }));
}

async function sendAlertRule(opts: MailContext & {
  ruleName: string; type: string; metricValue?: number | null; threshold?: number | null;
  operator?: string | null; severity: string; message: string; siteUrl: string;
}): Promise<MailResult> {
  return sendLocalized(opts, "alert_rule", "alert_rule", (selected, locale) => {
    const severityKey = opts.severity === "critical"
      ? "alertSeverityCritical"
      : opts.severity === "high" ? "alertSeverityHigh" : "alertSeverityNormal";
    const typeKey = ({
      seo_score: "alertTypeSeo",
      latency: "alertTypeLatency",
      uptime: "alertTypeUptime",
      monitor_down: "alertTypeMonitorDown",
      keyword_ranking_drop: "alertTypeKeywordDrop",
    } as Record<string, "alertTypeSeo" | "alertTypeLatency" | "alertTypeUptime" | "alertTypeMonitorDown" | "alertTypeKeywordDrop">)[opts.type];
    const symbols: Record<string, string> = { lt: "<", lte: "≤", gt: ">", gte: "≥", eq: "=" };
    let metricLine = "";
    if (opts.metricValue != null) {
      metricLine = `${getEmailPhrase(selected, "labelValue")}: ${formatEmailNumber(opts.metricValue, locale)}`;
      if (opts.operator && opts.threshold != null) {
        metricLine += ` (${getEmailPhrase(selected, "labelThreshold")}: ${symbols[opts.operator] ?? opts.operator} ${formatEmailNumber(opts.threshold, locale)})`;
      }
    }
    return {
      values: {
        ruleName: opts.ruleName,
        severity: getEmailPhrase(selected, severityKey),
        message: opts.message,
        metricLine,
        typeLabel: `${getEmailPhrase(selected, "labelType")}: ${typeKey ? getEmailPhrase(selected, typeKey) : opts.type}`,
        siteLabel: `${getEmailPhrase(selected, "labelSite")}: ${opts.siteUrl || getEmailPhrase(selected, "allSites")}`,
        alertNote: getEmailPhrase(selected, "alertNote"),
      },
      ctaUrl: APP_LINKS.alerts,
      accentColor: opts.severity === "critical" ? "#dc2626" : opts.severity === "high" ? "#ea580c" : "#f59e0b",
    };
  });
}

async function sendLoginLink(opts: MailContext & {
  magicLinkUrl: string; expiresMinutes: number;
}): Promise<MailResult> {
  return sendLocalized(opts, "login_link", "login_link", (_selected, locale) => ({
    values: {
      magicLinkUrl: opts.magicLinkUrl,
      expiresMinutes: new Intl.NumberFormat(locale.intlLocale).format(opts.expiresMinutes),
    },
    ctaUrl: opts.magicLinkUrl,
  }));
}

export const mailer = {
  sendWelcome,
  sendTrialStarted,
  sendTrialEnding,
  sendPaymentSucceeded,
  sendPlanChanged,
  sendPaymentFailed,
  sendMonitorDown,
  sendMonitorUp,
  sendReportGenerated,
  sendTeamInvitation,
  sendInvitationAccepted,
  sendNewMissions,
  sendAlertRule,
  sendSeoAlert,
  sendSubscriptionCanceled,
  sendSubscriptionReactivated,
  sendTrialCanceled,
  sendAccountDeleted,
  sendActivationMagicLink,
  sendLoginLink,
};

export { EMAIL_TEMPLATE_IDS };
