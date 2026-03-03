// =======================
// FlowPoint — SaaS Backend (Pack A + Pack B)
// Plans: Standard / Pro / Ultra
// Pack A: SEO Audit + Cache + PDF + Monitoring + Logs + CSV + Magic Link + Admin
// Pack B: Orgs + Team Ultra (Invites) + Roles + Shared data per org
// + Fixes: SSRF protection, Monitor quota = active count, Cron concurrency,
//          /api/overview for dashboard, exports aliases, uptime endpoint.
// + Stripe Option B: stripe.js (central helpers + webhook + routes)
// + Add-ons: monitors +50, extra seat, retention 90/365, audits packs, pdf pack, exports pack, priority support, custom domain
// White label: GRATUIT (toujours activé)
// =======================

require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const dns = require("dns").promises;
const net = require("net");

const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const cheerio = require("cheerio");
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");

const { buildStripeModule } = require("./stripe");

const app = express();
app.set("trust proxy", 1);

const PORT = process.env.PORT || 5000;

// ✅ BRAND
const BRAND_NAME = "FlowPoint";

// ---------- ENV CHECK ----------
const REQUIRED = [
  "MONGO_URI",
  "JWT_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_PRICE_ID_STANDARD",
  "STRIPE_PRICE_ID_PRO",
  "STRIPE_PRICE_ID_ULTRA",
  "PUBLIC_BASE_URL",
];
for (const k of REQUIRED) {
  if (!process.env[k]) console.log("❌ ENV manquante:", k);
}

const STRIPE_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET_RENDER || process.env.STRIPE_WEBHOOK_SECRET;
if (!STRIPE_WEBHOOK_SECRET) console.log("⚠️ STRIPE_WEBHOOK_SECRET manquante (webhook non validable)");

const ADMIN_KEY = process.env.ADMIN_KEY || "";
const CRON_KEY = process.env.CRON_KEY || "";
if (!CRON_KEY) console.log("⚠️ CRON_KEY manquante (cron monitors non sécurisé)");

const LOGIN_LINK_TTL_MINUTES = Number(process.env.LOGIN_LINK_TTL_MINUTES || 30);
const AUDIT_CACHE_HOURS = Number(process.env.AUDIT_CACHE_HOURS || 24);

const MONITOR_HTTP_TIMEOUT_MS = Number(process.env.MONITOR_HTTP_TIMEOUT_MS || 8000);
const CRON_CONCURRENCY = Math.min(25, Math.max(2, Number(process.env.CRON_CONCURRENCY || 10)));

// ---------- SMTP / Resend ----------
const SMTP_READY =
  !!process.env.SMTP_HOST &&
  !!process.env.SMTP_PORT &&
  !!process.env.SMTP_USER &&
  !!process.env.SMTP_PASS &&
  !!process.env.ALERT_EMAIL_FROM;

function boolEnv(v) {
  return String(v || "").toLowerCase() === "true";
}

let _cachedTransport = null;
function getMailer() {
  if (!SMTP_READY) return null;
  if (_cachedTransport) return _cachedTransport;

  _cachedTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: boolEnv(process.env.SMTP_SECURE),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });

  return _cachedTransport;
}

/**
 * safeBaseUrl(req)
 * - Utilise PUBLIC_BASE_URL si présent (recommandé)
 * - Sinon reconstruit depuis req (proxy-friendly)
 * - Évite les valeurs foireuses (host vide / injections)
 */
function safeBaseUrl(req) {
  const env = String(process.env.PUBLIC_BASE_URL || "").trim();
  if (env) {
    // normalise sans trailing slash
    return env.replace(/\/+$/, "");
  }

  const protoRaw = String(req.headers["x-forwarded-proto"] || req.protocol || "https");
  const proto = protoRaw.split(",")[0].trim().toLowerCase();
  const safeProto = proto === "http" || proto === "https" ? proto : "https";

  const hostRaw = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const host = hostRaw.replace(/[\r\n]/g, ""); // anti header-injection
  if (!host) return "https://localhost";

  return `${safeProto}://${host}`.replace(/\/+$/, "");
}

/**
 * sendEmail
 * Priority:
 *  1) Resend API (HTTPS / port 443) if RESEND_API_KEY is set
 *  2) SMTP fallback
 */
async function sendEmail({ to, subject, text, html, attachments, bcc }) {
  try {
    const from = String(process.env.ALERT_EMAIL_FROM || "").trim();
    if (!from) {
      console.log("❌ ALERT_EMAIL_FROM manquant (email non envoyé)");
      return { ok: false, error: "ALERT_EMAIL_FROM missing" };
    }

    // normalise to/bcc (accept string "a,b,c" or array)
    const normalizeList = (v) => {
      if (!v) return [];
      if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
      return String(v)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    };

    const toList = normalizeList(to);
    const bccList = normalizeList(bcc);

    if (!toList.length) {
      console.log("❌ sendEmail: destinataire manquant:", subject);
      return { ok: false, error: "Recipient missing" };
    }

    // 1) Resend API
    if (process.env.RESEND_API_KEY) {
      const payload = {
        from,
        to: toList,
        subject: String(subject || ""),
        text: text ? String(text) : undefined,
        html: html ? String(html) : undefined,
        bcc: bccList.length ? bccList : undefined,
        attachments: attachments || undefined,
      };

      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        console.log("❌ Resend API error:", r.status, data);
        return { ok: false, error: data?.message || `Resend API ${r.status}` };
      }

      console.log("✅ Email envoyé (Resend):", data?.id, "=>", toList.join(","));
      return { ok: true, id: data?.id };
    }

    // 2) SMTP fallback
    const t = getMailer();
    if (!t) {
      console.log("⚠️ SMTP non configuré et RESEND_API_KEY absent => email ignoré:", subject);
      return { ok: false, skipped: true, error: "No email provider configured" };
    }

    const info = await t.sendMail({
      from,
      to: toList.join(","),
      bcc: bccList.length ? bccList.join(",") : undefined,
      subject,
      text,
      html,
      attachments,
    });

    console.log("✅ Email envoyé (SMTP):", info.messageId, "=>", toList.join(","));
    return { ok: true, id: info.messageId };
  } catch (e) {
    console.log("❌ Email error:", e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * buildDailyReportEmail
 * - Template premium
 * - Dark/Light auto via prefers-color-scheme
 */
function buildDailyReportEmail({ brandName, orgName, usersCount, monitorsDown, audits24hCount, logsDown24hCount }) {

  // ✅ Supprime "AI" automatiquement si présent
  const bn = String(brandName || BRAND_NAME || "FlowPoint")
    .replace(/\s*AI\s*$/i, "")
    .trim();

  const subject = `${bn} — Rapport quotidien — ${orgName}`;
  const text = `${brandName} — Rapport quotidien
Organisation: ${orgName}

• Users: ${usersCount}
• Monitors DOWN: ${monitorsDown}

Audits (24h): ${audits24hCount || 0}
Logs DOWN (24h): ${logsDown24hCount || 0}

Email envoyé automatiquement.
`;

  const dateLabel = new Date().toLocaleDateString("fr-FR", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${brandName} — Rapport quotidien</title>
  <style>
    :root{
      --bg:#f6f7fb;
      --card:#ffffff;
      --muted:#667085;
      --text:#0f172a;
      --border:rgba(15,23,42,.10);
      --brand:#2f5bff;
      --brand2:#2449ff;
      --chip:#eef2ff;
      --down:#b00020;
      --ok:#0a7a2f;
    }
    @media (prefers-color-scheme: dark){
      :root{
        --bg:#070b18;
        --card:#0c1228;
        --muted:rgba(234,240,255,.72);
        --text:#eaf0ff;
        --border:rgba(255,255,255,.10);
        --chip:rgba(132,102,255,.18);
      }
    }
    body{
      margin:0;
      background:var(--bg);
      font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif;
      color:var(--text);
    }
    .wrap{ padding:28px 14px; }
    .container{ max-width:620px; margin:0 auto; }
    .hero{
      background: linear-gradient(180deg, rgba(47,91,255,.22), transparent 55%);
      border:1px solid var(--border);
      border-radius:18px;
      padding:18px;
    }
    .brandRow{ display:flex; gap:12px; align-items:center; }
    .logo{
      width:44px;height:44px;border-radius:14px;
      background:linear-gradient(180deg,var(--brand),var(--brand2));
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 12px 30px rgba(47,91,255,.25);
      flex:0 0 auto;
    }
    h1{ margin:12px 0 2px; font-size:22px; letter-spacing:-.02em; }
    .sub{ color:var(--muted); font-size:13.5px; line-height:1.6; }
    .grid{ display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:14px; }
    .card{
      background:var(--card);
      border:1px solid var(--border);
      border-radius:16px;
      padding:14px;
    }
    .k{ color:var(--muted); font-size:12px; font-weight:800; }
    .v{ margin-top:6px; font-size:20px; font-weight:900; letter-spacing:-.02em; }
    .pill{
      display:inline-block;
      margin-top:10px;
      padding:6px 10px;
      border-radius:999px;
      background:var(--chip);
      color:var(--muted);
      font-weight:800;
      font-size:12px;
    }
    .section{
      margin-top:12px;
      background:var(--card);
      border:1px solid var(--border);
      border-radius:16px;
      padding:14px;
    }
    .sectionTitle{ font-weight:900; margin:0 0 8px; letter-spacing:-.01em; }
    ul{ margin:0; padding-left:18px; color:var(--muted); line-height:1.7; }
    .footer{
      margin-top:14px;
      color:var(--muted);
      font-size:12px;
      text-align:center;
      line-height:1.6;
    }
    @media (max-width:520px){
      .grid{ grid-template-columns:1fr; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="container">
      <div class="hero">
        <div class="brandRow">
          <div class="logo" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M13 2L4 14h7l-1 8 10-14h-7l0-6Z" stroke="#fff" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
            </svg>
          </div>
          <div>
            <div style="font-weight:900; font-size:16px; line-height:1">${brandName}</div>
            <div class="sub">Rapport quotidien (automatique)</div>
          </div>
        </div>

        <h1>${brandName} — Rapport quotidien</h1>
        <div class="sub">
          Organisation : <b>${orgName}</b>
          <span class="pill">${dateLabel}</span>
        </div>

        <div class="grid">
          <div class="card">
            <div class="k">Users</div>
            <div class="v">${usersCount}</div>
          </div>
          <div class="card">
            <div class="k">Monitors DOWN</div>
            <div class="v">${monitorsDown}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="sectionTitle">Audits (24h)</div>
        <ul>
          <li>${audits24hCount ? `${audits24hCount} audit(s) effectué(s)` : "Aucun"}</li>
        </ul>
      </div>

      <div class="section">
        <div class="sectionTitle">Logs DOWN (24h)</div>
        <ul>
          <li>${logsDown24hCount ? `${logsDown24hCount} incident(s) détecté(s)` : "Aucun"}</li>
        </ul>
      </div>

      <div class="footer">
        Email envoyé automatiquement par ${brandName}.<br>
        © ${new Date().getFullYear()} ${brandName}
      </div>
    </div>
  </div>
</body>
</html>`;

  return { subject, text, html };
}
// ---------- DB ----------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connecté"))
  .catch((e) => console.log("❌ MongoDB erreur:", e.message));

// ---------- PLANS / QUOTAS ----------
function planRank(plan) {
  const map = { standard: 1, pro: 2, ultra: 3 };
  return map[String(plan || "").toLowerCase()] || 0;
}

// Base quotas only (sans add-ons)
function baseQuotasForPlan(plan) {
  const p = String(plan || "").toLowerCase();
  if (p === "standard") return { audits: 30, monitors: 3, pdf: 30, exports: 30, teamSeats: 1 };
  if (p === "pro") return { audits: 300, monitors: 50, pdf: 300, exports: 300, teamSeats: 1 };
  if (p === "ultra") return { audits: 2000, monitors: 300, pdf: 2000, exports: 2000, teamSeats: 10 };
  return { audits: 0, monitors: 0, pdf: 0, exports: 0, teamSeats: 0 };
}

// Effective quotas = base + addons/credits (org)
function effectiveQuotas(user, org) {
  const base = baseQuotasForPlan(user?.plan);

  const monitorsExtra = Number(org?.billingAddons?.monitorsPack50 || 0) * 50;
  const seatsExtra = Number(org?.billingAddons?.extraSeats || 0);

  const auditsExtra = Number(org?.credits?.audits || 0);
  const pdfExtra = Number(org?.credits?.pdf || 0);
  const exportsExtra = Number(org?.credits?.exports || 0);

  return {
    audits: base.audits + auditsExtra,
    monitors: base.monitors + monitorsExtra,
    pdf: base.pdf + pdfExtra,
    exports: base.exports + exportsExtra,
    teamSeats: base.teamSeats + seatsExtra,
  };
}

function firstDayOfThisMonthUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
}

async function resetUsageIfNewMonth(user) {
  const month = firstDayOfThisMonthUTC();
  if (!user.usageMonth || new Date(user.usageMonth).getTime() !== month.getTime()) {
    user.usageMonth = month;
    user.usedAudits = 0;
    user.usedPdf = 0;
    user.usedExports = 0;
    await user.save();
  }
}

async function consume(user, org, key, amount = 1) {
  const q = effectiveQuotas(user, org);

  const map = {
    audits: ["usedAudits", q.audits],
    pdf: ["usedPdf", q.pdf],
    exports: ["usedExports", q.exports],
  };
  const item = map[key];
  if (!item) return false;
  const [field, limit] = item;
  if (limit <= 0) return false;
  if (user[field] + amount > limit) return false;
  user[field] += amount;
  await user.save();
  return true;
}

function priceIdForPlan(plan) {
  if (plan === "standard") return process.env.STRIPE_PRICE_ID_STANDARD;
  if (plan === "pro") return process.env.STRIPE_PRICE_ID_PRO;
  if (plan === "ultra") return process.env.STRIPE_PRICE_ID_ULTRA;
  return null;
}

// ---------- ANTI-ABUS ----------
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "msn.com",
]);

function normalizeEmail(emailRaw) {
  const email = String(emailRaw || "").trim().toLowerCase();
  const parts = email.split("@");
  if (parts.length !== 2) return email;
  let [local, domain] = parts;

  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") {
    const plusIndex = local.indexOf("+");
    if (plusIndex >= 0) local = local.slice(0, plusIndex);
    local = local.replace(/\./g, "");
  }
  return `${local}@${domain}`;
}

function normalizeCompanyName(s) {
  return (s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\s-]/g, "");
}

function domainFromEmail(emailNorm) {
  return String(emailNorm || "").split("@")[1] || "";
}

function ipuaHash(req) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString();
  const ua = (req.headers["user-agent"] || "").toString();
  return crypto.createHash("sha256").update(`${ip}||${ua}`).digest("hex");
}

// ---------- SSRF PROTECTION ----------
function isPrivateIp(ip) {
  if (!net.isIP(ip)) return true;

  if (net.isIPv4(ip)) {
    if (ip === "127.0.0.1") return true;
    if (ip.startsWith("10.")) return true;
    if (ip.startsWith("192.168.")) return true;
    if (ip.startsWith("169.254.")) return true;
    if (ip.startsWith("172.")) {
      const second = Number(ip.split(".")[1]);
      if (second >= 16 && second <= 31) return true;
    }
    return false;
  }

  const v = ip.toLowerCase();
  if (v === "::1") return true;
  if (v.startsWith("fc") || v.startsWith("fd")) return true;
  if (v.startsWith("fe80")) return true;
  return false;
}

async function assertSafePublicUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("URL invalide");
  }

  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Protocole interdit");
  if (!u.hostname) throw new Error("Hostname manquant");
  if (u.username || u.password) throw new Error("Credentials interdits dans l'URL");

  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) throw new Error("Hostname interdit");

  const res = await dns.lookup(host, { all: true, verbatim: true });
  if (!res?.length) throw new Error("DNS lookup failed");
  for (const r of res) {
    if (isPrivateIp(r.address)) throw new Error("Destination réseau privée interdite");
  }

  u.hash = "";
  return u.toString();
}

// ---------- MODELS ----------
const OrgSchema = new mongoose.Schema(
  {
    name: String,
    normalizedName: { type: String, unique: true, index: true },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, index: true },
    createdFromEmailDomain: String,

    alertRecipients: { type: String, default: "all" },
    alertExtraEmails: { type: [String], default: [] },

    // ✅ Add-ons (étendus)
    billingAddons: {
      monitorsPack50: { type: Number, default: 0 },
      extraSeats: { type: Number, default: 0 },

      retention90d: { type: Boolean, default: false },
      retention365d: { type: Boolean, default: false },

      auditsPack200: { type: Number, default: 0 },
      auditsPack1000: { type: Number, default: 0 },
      pdfPack200: { type: Number, default: 0 },
      exportsPack1000: { type: Number, default: 0 },

      prioritySupport: { type: Boolean, default: false },
      customDomain: { type: Boolean, default: false },

      // ✅ White label GRATUIT
      whiteLabel: { type: Boolean, default: true },
    },

    branding: {
      appName: { type: String, default: BRAND_NAME },
      supportEmail: { type: String, default: "" },
      logoUrl: { type: String, default: "" },
      primaryColor: { type: String, default: "#2563eb" },
      accentColor: { type: String, default: "#1d4ed8" },
      hideFlowPointBranding: { type: Boolean, default: false },
    },

    retentionDays: { type: Number, default: 30 },

    integrations: {
      slackWebhookUrl: { type: String, default: "" },
      discordWebhookUrl: { type: String, default: "" },
      zapierHookUrl: { type: String, default: "" },
    },

    credits: {
      audits: { type: Number, default: 0 },
      pdf: { type: Number, default: 0 },
      exports: { type: Number, default: 0 },
    },
  },
  { timestamps: true, collection: "orgs" }
);

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, unique: true, index: true },
    emailNormalized: { type: String, unique: true, index: true },

    name: String,
    companyName: String,
    companyNameNormalized: { type: String, index: true },
    companyDomain: { type: String, index: true },

    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    role: { type: String, enum: ["owner", "member"], default: "owner" },

    plan: { type: String, enum: ["standard", "pro", "ultra"], default: "standard" },

    stripeCustomerId: String,
    stripeSubscriptionId: String,
    subscriptionStatus: String,
    lastPaymentStatus: String,

    hasTrial: { type: Boolean, default: false },
    trialStartedAt: Date,
    trialEndsAt: Date,
    accessBlocked: { type: Boolean, default: false },

    usageMonth: { type: Date, default: firstDayOfThisMonthUTC },
    usedAudits: { type: Number, default: 0 },
    usedPdf: { type: Number, default: 0 },
    usedExports: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "users" }
);

const TrialRegistrySchema = new mongoose.Schema(
  {
    emailNormalized: { type: String, unique: true, index: true },
    companyNameNormalized: { type: String, index: true },
    companyDomain: { type: String, index: true },
    fingerprint: { type: String, index: true },
    ipua: { type: String, index: true },
    usedAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: "trialregistries" }
);

const LoginTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },
    tokenHash: { type: String, unique: true, index: true },
    expiresAt: { type: Date, index: true },
    usedAt: Date,
  },
  { timestamps: true, collection: "logintokens" }
);

const InviteSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    invitedEmail: { type: String, index: true },
    invitedEmailNormalized: { type: String, index: true },
    tokenHash: { type: String, unique: true, index: true },
    expiresAt: { type: Date, index: true },
    acceptedAt: Date,
    createdByUserId: { type: mongoose.Schema.Types.ObjectId, index: true },
  },
  { timestamps: true, collection: "invites" }
);

const AuditSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },
    url: { type: String, index: true },
    urlNormalized: { type: String, index: true },
    status: { type: String, enum: ["ok", "error"], default: "ok" },
    score: Number,
    summary: String,
    findings: Object,
    recommendations: [String],
    htmlSnapshot: String,
  },
  { timestamps: true, collection: "audits" }
);

const MonitorSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },
    url: String,
    active: { type: Boolean, default: true },
    intervalMinutes: { type: Number, default: 60 },
    lastCheckedAt: Date,
    lastStatus: { type: String, enum: ["up", "down", "unknown"], default: "unknown" },
    lastAlertStatus: { type: String, default: "unknown" },
    lastAlertAt: Date,
  },
  { timestamps: true, collection: "monitors" }
);

const MonitorLogSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },
    monitorId: { type: mongoose.Schema.Types.ObjectId, index: true },
    url: String,
    status: { type: String, enum: ["up", "down"], default: "down" },
    httpStatus: Number,
    responseTimeMs: Number,
    checkedAt: { type: Date, default: Date.now },
    error: String,
  },
  { timestamps: true, collection: "monitorlogs" }
);

const Org = mongoose.model("Org", OrgSchema);
const User = mongoose.model("User", UserSchema);
const TrialRegistry = mongoose.model("TrialRegistry", TrialRegistrySchema);
const LoginToken = mongoose.model("LoginToken", LoginTokenSchema);
const Invite = mongoose.model("Invite", InviteSchema);
const Audit = mongoose.model("Audit", AuditSchema);
const Monitor = mongoose.model("Monitor", MonitorSchema);
const MonitorLog = mongoose.model("MonitorLog", MonitorLogSchema);

// ---------- AUTH ----------
function signToken(user) {
  return jwt.sign({ uid: user._id.toString(), email: user.email }, process.env.JWT_SECRET, { expiresIn: "30d" });
}

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!tok) return res.status(401).json({ error: "Non autorisé" });
  try {
    req.user = jwt.verify(tok, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token invalide" });
  }
}

function clampInt(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, Math.floor(x)));
}

async function ensureOrgDefaults(org) {
  if (!org) return null;
  let changed = false;

  if (!org.billingAddons || typeof org.billingAddons !== "object") {
    org.billingAddons = {
      monitorsPack50: 0,
      extraSeats: 0,

      retention90d: false,
      retention365d: false,

      auditsPack200: 0,
      auditsPack1000: 0,
      pdfPack200: 0,
      exportsPack1000: 0,

      prioritySupport: false,
      customDomain: false,

      whiteLabel: true, // ✅ gratuit
    };
    changed = true;
  } else {
    const b = org.billingAddons;

    if (b.monitorsPack50 == null) { b.monitorsPack50 = 0; changed = true; }
    if (b.extraSeats == null) { b.extraSeats = 0; changed = true; }

    if (b.retention90d == null) { b.retention90d = false; changed = true; }
    if (b.retention365d == null) { b.retention365d = false; changed = true; }

    if (b.auditsPack200 == null) { b.auditsPack200 = 0; changed = true; }
    if (b.auditsPack1000 == null) { b.auditsPack1000 = 0; changed = true; }
    if (b.pdfPack200 == null) { b.pdfPack200 = 0; changed = true; }
    if (b.exportsPack1000 == null) { b.exportsPack1000 = 0; changed = true; }

    if (b.prioritySupport == null) { b.prioritySupport = false; changed = true; }
    if (b.customDomain == null) { b.customDomain = false; changed = true; }

    // ✅ gratuit
    if (b.whiteLabel == null) { b.whiteLabel = true; changed = true; }
    b.whiteLabel = true;

    b.monitorsPack50 = clampInt(b.monitorsPack50, 0, 200);
    b.extraSeats = clampInt(b.extraSeats, 0, 500);

    b.auditsPack200 = clampInt(b.auditsPack200, 0, 10000);
    b.auditsPack1000 = clampInt(b.auditsPack1000, 0, 10000);
    b.pdfPack200 = clampInt(b.pdfPack200, 0, 10000);
    b.exportsPack1000 = clampInt(b.exportsPack1000, 0, 10000);
  }

  if (!org.branding || typeof org.branding !== "object") {
    org.branding = {
      appName: BRAND_NAME,
      supportEmail: "",
      logoUrl: "",
      primaryColor: "#2563eb",
      accentColor: "#1d4ed8",
      hideFlowPointBranding: false,
    };
    changed = true;
  } else {
    const b = org.branding;
    if (b.appName == null) { b.appName = BRAND_NAME; changed = true; }
    if (b.supportEmail == null) { b.supportEmail = ""; changed = true; }
    if (b.logoUrl == null) { b.logoUrl = ""; changed = true; }
    if (b.primaryColor == null) { b.primaryColor = "#2563eb"; changed = true; }
    if (b.accentColor == null) { b.accentColor = "#1d4ed8"; changed = true; }
    if (b.hideFlowPointBranding == null) { b.hideFlowPointBranding = false; changed = true; }
  }

  if (org.retentionDays == null) { org.retentionDays = 30; changed = true; }
  org.retentionDays = clampInt(org.retentionDays, 7, 3650);

  if (!org.integrations || typeof org.integrations !== "object") {
    org.integrations = { slackWebhookUrl: "", discordWebhookUrl: "", zapierHookUrl: "" };
    changed = true;
  } else {
    if (org.integrations.slackWebhookUrl == null) { org.integrations.slackWebhookUrl = ""; changed = true; }
    if (org.integrations.discordWebhookUrl == null) { org.integrations.discordWebhookUrl = ""; changed = true; }
    if (org.integrations.zapierHookUrl == null) { org.integrations.zapierHookUrl = ""; changed = true; }
  }

  if (!org.credits || typeof org.credits !== "object") {
    org.credits = { audits: 0, pdf: 0, exports: 0 };
    changed = true;
  } else {
    if (org.credits.audits == null) { org.credits.audits = 0; changed = true; }
    if (org.credits.pdf == null) { org.credits.pdf = 0; changed = true; }
    if (org.credits.exports == null) { org.credits.exports = 0; changed = true; }

    org.credits.audits = clampInt(org.credits.audits, 0, 1000000);
    org.credits.pdf = clampInt(org.credits.pdf, 0, 1000000);
    org.credits.exports = clampInt(org.credits.exports, 0, 1000000);
  }

  if (changed) await org.save();
  return org;
}

// ✅ Single version
async function ensureOrgForUser(user) {
  if (user.orgId) {
    const existing = await Org.findById(user.orgId);
    if (existing) await ensureOrgDefaults(existing);
    return user;
  }

  const normalized = normalizeCompanyName(user.companyName || "Organisation");
  const domain = user.companyDomain || "";

  let org = await Org.findOne({ normalizedName: normalized });

  if (!org) {
    org = await Org.create({
      name: user.companyName || "Organisation",
      normalizedName: normalized,
      ownerUserId: user._id,
      createdFromEmailDomain: domain,
      alertRecipients: "all",
      alertExtraEmails: [],
    });
  }

  await ensureOrgDefaults(org);

  user.orgId = org._id;
  user.role = user.role || "owner";
  await user.save();
  return user;
}

async function requireActive(req, res, next) {
  const user = await User.findById(req.user.uid);
  if (!user) return res.status(404).json({ error: "User introuvable" });

  if (user.hasTrial && user.trialEndsAt && new Date(user.trialEndsAt).getTime() < Date.now()) {
    const st = String(user.subscriptionStatus || "").toLowerCase();
    const active = st === "active" || st === "trialing";
    if (!active) {
      user.accessBlocked = true;
      user.lastPaymentStatus = user.lastPaymentStatus || "trial_expired";
      await user.save();
    }
  }

  if (user.accessBlocked) return res.status(403).json({ error: "Accès bloqué (paiement échoué / essai terminé)" });

  await resetUsageIfNewMonth(user);
  await ensureOrgForUser(user);

  const org = user.orgId ? await Org.findById(user.orgId) : null;
  req.dbOrg = org ? await ensureOrgDefaults(org) : null;

  req.dbUser = user;
  next();
}

function requireOwner(req, res, next) {
  if (req.dbUser.role !== "owner") return res.status(403).json({ error: "Owner requis" });
  next();
}

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(500).json({ error: "ADMIN_KEY manquante" });
  const k = req.headers["x-admin-key"] || req.query.admin_key;
  if (k !== ADMIN_KEY) return res.status(401).json({ error: "Admin non autorisé" });
  next();
}

function requireCron(req, res, next) {
  if (!CRON_KEY) return res.status(500).json({ error: "CRON_KEY manquante" });
  const k = req.headers["x-cron-key"] || req.query.cron_key;
  if (k !== CRON_KEY) return res.status(401).json({ error: "Cron non autorisé" });
  next();
}

// ---------- Helpers alerting ----------
function uniqEmails(arr) {
  const out = [];
  const seen = new Set();
  for (const x of arr || []) {
    const e = String(x || "").trim().toLowerCase();
    if (!e) continue;
    if (seen.has(e)) continue;
    seen.add(e);
    out.push(e);
  }
  return out;
}

async function getOrgAlertEmails(orgId) {
  const org = await Org.findById(orgId).select("alertRecipients alertExtraEmails ownerUserId name");
  if (!org) return [];

  const recipientsMode = String(org.alertRecipients || "all").toLowerCase();
  const extra = Array.isArray(org.alertExtraEmails) ? org.alertExtraEmails : [];

  let base = [];
  if (recipientsMode === "owner") {
    const owner = org.ownerUserId ? await User.findById(org.ownerUserId).select("email") : null;
    if (owner?.email) base.push(owner.email);
  } else {
    const users = await User.find({ orgId }).select("email");
    base.push(...users.map((u) => u.email).filter(Boolean));
  }

  return uniqEmails([...base, ...extra]).slice(0, 60);
}

function formatMonitorEmail({ orgName, monitorUrl, status, httpStatus, responseTimeMs, checkedAt, error }) {
  const when = checkedAt ? new Date(checkedAt).toLocaleString("fr-FR") : new Date().toLocaleString("fr-FR");
  const statusLabel = status === "down" ? "DOWN" : "UP";
  const subject = `${BRAND_NAME} — ${statusLabel}: ${monitorUrl}`;
  const text = `Organisation: ${orgName}
URL: ${monitorUrl}
Status: ${statusLabel}
HTTP: ${httpStatus || "-"}
Temps: ${responseTimeMs ? `${responseTimeMs}ms` : "-"}
Date: ${when}
Erreur: ${error || "-"}`;

  const html = `
    <h2 style="margin:0">${BRAND_NAME} — <span style="color:${status === "down" ? "#B00020" : "#0A7A2F"}">${statusLabel}</span></h2>
    <p><b>Organisation</b>: ${orgName || "-"}</p>
    <p><b>URL</b>: ${monitorUrl}</p>
    <p><b>HTTP</b>: ${httpStatus || "-"}</p>
    <p><b>Temps</b>: ${responseTimeMs ? `${responseTimeMs}ms` : "-"}</p>
    <p><b>Date</b>: ${when}</p>
    ${error ? `<p><b>Erreur</b>: ${String(error).slice(0, 400)}</p>` : ""}
  `;
  return { subject, text, html };
}

async function maybeSendMonitorAlert(monitor, result) {
  const newStatus = String(result.status || "unknown").toLowerCase();
  const last = String(monitor.lastAlertStatus || "unknown").toLowerCase();

  if (newStatus !== "up" && newStatus !== "down") return { sent: false, reason: "unknown status" };
  if (newStatus === last) return { sent: false, reason: "no change" };

  const org = await Org.findById(monitor.orgId).select("name");
  const to = await getOrgAlertEmails(monitor.orgId);
  if (!to.length) return { sent: false, reason: "no recipients" };

  const payload = formatMonitorEmail({
    orgName: org?.name || "Organisation",
    monitorUrl: monitor.url,
    status: newStatus,
    httpStatus: result.httpStatus,
    responseTimeMs: result.responseTimeMs,
    checkedAt: new Date(),
    error: result.error,
  });

  await sendEmail({
    to: to.join(","),
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });

  monitor.lastAlertStatus = newStatus;
  monitor.lastAlertAt = new Date();
  await monitor.save();

  return { sent: true };
}

// ---------- Concurrency helper ----------
async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let idx = 0;

  const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (idx < items.length) {
      const cur = idx++;
      results[cur] = await worker(items[cur], cur);
    }
  });

  await Promise.all(runners);
  return results;
}

// ---------- MONITOR CHECK ----------
async function checkUrlOnce(url) {
  const safeUrl = await assertSafePublicUrl(url);

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), MONITOR_HTTP_TIMEOUT_MS);

  const t0 = Date.now();
  try {
    const r = await fetch(safeUrl, { redirect: "follow", signal: controller.signal });
    const ms = Date.now() - t0;
    clearTimeout(id);
    const up = r.status >= 200 && r.status < 400;
    return { status: up ? "up" : "down", httpStatus: r.status, responseTimeMs: ms, error: "" };
  } catch (e) {
    const ms = Date.now() - t0;
    clearTimeout(id);
    return { status: "down", httpStatus: 0, responseTimeMs: ms, error: e.message || "fetch failed" };
  }
}

// ---------- SEO AUDIT ----------
async function fetchWithTiming(url) {
  const safeUrl = await assertSafePublicUrl(url);

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), Math.min(15000, MONITOR_HTTP_TIMEOUT_MS * 2));

  const t0 = Date.now();
  const r = await fetch(safeUrl, { redirect: "follow", signal: controller.signal });
  const t1 = Date.now();
  const text = await r.text();
  clearTimeout(id);

  return { status: r.status, ok: r.ok, headers: r.headers, text, ms: t1 - t0, finalUrl: r.url };
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return String(url || "").trim();
  }
}

function scoreAudit(checks) {
  let score = 100;
  const penalize = (cond, points) => { if (cond) score -= points; };
  penalize(!checks.title.ok, 15);
  penalize(!checks.metaDescription.ok, 12);
  penalize(!checks.h1.ok, 10);
  penalize(!checks.canonical.ok, 8);
  penalize(!checks.robots.ok, 6);
  penalize(!checks.lang.ok, 4);
  penalize(!checks.https.ok, 12);
  penalize(!checks.viewport.ok, 6);
  penalize(!checks.og.ok, 4);
  penalize(!checks.responseTime.ok, 8);
  if (score < 0) score = 0;
  return score;
}

function buildRecommendations(checks) {
  const rec = [];
  const pri = (label, level) => `[${level}] ${label}`;

  if (!checks.title.ok) rec.push(pri("Ajouter un <title> unique (50–60 caractères).", "HIGH"));
  if (!checks.metaDescription.ok) rec.push(pri("Ajouter une meta description (140–160 caractères).", "HIGH"));
  if (!checks.h1.ok) rec.push(pri("Ajouter exactement 1 H1 pertinent (éviter 0 ou plusieurs).", "HIGH"));
  if (!checks.canonical.ok) rec.push(pri("Ajouter un lien canonical pour éviter le contenu dupliqué.", "MED"));
  if (!checks.robots.ok) rec.push(pri("Vérifier meta robots (index/follow) + robots.txt.", "MED"));
  if (!checks.lang.ok) rec.push(pri("Ajouter l’attribut lang sur <html> (ex: fr).", "LOW"));
  if (!checks.https.ok) rec.push(pri("Forcer HTTPS (redirections + HSTS).", "HIGH"));
  if (!checks.viewport.ok) rec.push(pri("Ajouter meta viewport pour mobile.", "MED"));
  if (!checks.og.ok) rec.push(pri("Ajouter Open Graph (og:title, og:description, og:image).", "LOW"));
  if (!checks.responseTime.ok) rec.push(pri("Améliorer la vitesse (TTFB < 3s).", "MED"));

  return rec;
}

async function runSeoAudit(url) {
  let fetched;
  try {
    fetched = await fetchWithTiming(url);
  } catch (e) {
    return { status: "error", score: 0, summary: "Impossible de charger l’URL.", findings: {}, recommendations: [], htmlSnapshot: "", error: e.message };
  }

  const $ = cheerio.load(fetched.text);

  const title = ($("title").first().text() || "").trim();
  const metaDesc = ($('meta[name="description"]').attr("content") || "").trim();
  const h1Count = $("h1").length;
  const canonical = ($('link[rel="canonical"]').attr("href") || "").trim();
  const robots = ($('meta[name="robots"]').attr("content") || "").trim();
  const lang = ($("html").attr("lang") || "").trim();
  const viewport = ($('meta[name="viewport"]').attr("content") || "").trim();

  const ogTitle = ($('meta[property="og:title"]').attr("content") || "").trim();
  const ogDesc = ($('meta[property="og:description"]').attr("content") || "").trim();
  const ogImg = ($('meta[property="og:image"]').attr("content") || "").trim();

  const httpsOk = String(fetched.finalUrl || url).startsWith("https://");

  const checks = {
    http: { ok: fetched.ok, value: fetched.status },
    responseTime: { ok: fetched.ms < 3000, value: fetched.ms },
    https: { ok: httpsOk, value: fetched.finalUrl },
    title: { ok: title.length >= 10 && title.length <= 70, value: title },
    metaDescription: { ok: metaDesc.length >= 80 && metaDesc.length <= 180, value: metaDesc },
    h1: { ok: h1Count === 1, value: h1Count },
    canonical: { ok: !!canonical, value: canonical },
    robots: { ok: robots.length === 0 || /index|follow/i.test(robots), value: robots || "(none)" },
    lang: { ok: !!lang, value: lang },
    viewport: { ok: !!viewport, value: viewport },
    og: { ok: !!(ogTitle && ogDesc && ogImg), value: { ogTitle, ogDesc, ogImg } },
  };

  const score = scoreAudit(checks);
  const recommendations = buildRecommendations(checks);

  const summary = fetched.ok
    ? `Audit OK. HTTP ${fetched.status} – ${fetched.ms}ms – Score ${score}/100.`
    : `Audit: page non OK. HTTP ${fetched.status} – Score ${score}/100.`;

  return {
    status: fetched.ok ? "ok" : "error",
    score,
    summary,
    findings: checks,
    recommendations,
    htmlSnapshot: fetched.text.slice(0, 20000),
  };
}

// ---------- Monitor quota = ACTIVE count (+ addons) ----------
async function canCreateActiveMonitor(user, org) {
  const q = effectiveQuotas(user, org);
  const countActive = await Monitor.countDocuments({ orgId: user.orgId, active: true });
  return countActive < q.monitors;
}

// =======================
// STRIPE (via stripe.js)
// =======================

const stripeModule = buildStripeModule({
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  BRAND_NAME,
  priceIdForPlan,
  safeBaseUrl,
  signToken,
  auth,
  requireActive,
  ensureOrgForUser,
  ensureOrgDefaults,
  User,
  Org,
  sendEmail,
});


// =======================
// 1️⃣ WEBHOOK (RAW BODY OBLIGATOIRE)
// =======================

app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeModule.webhookHandler
);


// =======================
// 2️⃣ SECURITY (GLOBAL)
// =======================

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: false }));
app.use("/api", rateLimit({ windowMs: 60 * 1000, max: 200 }));


// =======================
// 3️⃣ BODY PARSERS (APRES WEBHOOK)
// =======================

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));


// =======================
// 4️⃣ STRIPE ROUTES
// =======================

app.post("/api/stripe/checkout", auth, requireActive, stripeModule.checkoutPlan);

app.post(
  "/api/stripe/checkout-embedded",
  auth,
  requireActive,
  stripeModule.checkoutEmbedded
);

app.get("/api/stripe/verify", stripeModule.verifyCheckout);

app.post(
  "/api/stripe/portal",
  auth,
  requireActive,
  stripeModule.customerPortal
);
// ---------- SECURITY / PARSERS ----------
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: false }));
app.use("/api", rateLimit({ windowMs: 60 * 1000, max: 200 }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ---------- STATIC ----------
app.use(express.static(path.join(__dirname)));

// ---------- PAGES ----------
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/dashboard", (_, res) => res.sendFile(path.join(__dirname, "dashboard.html")));
app.get("/pricing", (_, res) => res.sendFile(path.join(__dirname, "pricing.html")));
app.get("/success", (_, res) => res.sendFile(path.join(__dirname, "success.html")));
app.get("/cancel", (_, res) => res.sendFile(path.join(__dirname, "cancel.html")));
app.get("/login", (_, res) => res.sendFile(path.join(__dirname, "login.html")));
app.get("/login-verify", (_, res) => res.sendFile(path.join(__dirname, "login-verify.html")));
app.get("/invite-accept", (_, res) => res.sendFile(path.join(__dirname, "invite-accept.html")));
app.get("/admin", (_, res) => res.sendFile(path.join(__dirname, "admin.html")));

// ---------- API ----------
app.get("/api/health", (_, res) => res.json({ ok: true }));

// ---------- AUTH: LEAD ----------
const leadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

app.post("/api/auth/lead", leadLimiter, async (req, res) => {
  try {
    const { firstName, email, companyName, plan } = req.body || {};
    if (!email || !companyName) return res.status(400).json({ error: "Email + entreprise requis" });

    const chosenPlan = String(plan || "").toLowerCase();
    if (!["standard", "pro", "ultra"].includes(chosenPlan)) return res.status(400).json({ error: "Plan invalide" });

    const emailNorm = normalizeEmail(email);
    const domain = domainFromEmail(emailNorm);
    const companyNorm = normalizeCompanyName(companyName);
    const ipua = ipuaHash(req);

    const adminBypass = ADMIN_KEY && req.headers["x-admin-key"] === ADMIN_KEY;

    if (!adminBypass) {
      if (await TrialRegistry.findOne({ emailNormalized: emailNorm }))
        return res.status(403).json({ error: "Essai déjà utilisé pour cet email." });

      if (await TrialRegistry.findOne({ companyNameNormalized: companyNorm }))
        return res.status(403).json({ error: "Essai déjà utilisé pour cette entreprise." });

      if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) {
        if (await TrialRegistry.findOne({ companyDomain: domain }))
          return res.status(403).json({ error: "Essai déjà utilisé pour ce domaine entreprise." });
      }

      if (await TrialRegistry.findOne({ ipua }))
        return res.status(403).json({ error: "Essai déjà utilisé (anti-abus navigateur/IP)." });
    }

    let user = await User.findOne({ emailNormalized: emailNorm });
    if (!user) {
      user = await User.create({
        email: String(email).toLowerCase(),
        emailNormalized: emailNorm,
        name: firstName || "",
        companyName,
        companyNameNormalized: companyNorm,
        companyDomain: domain,
        plan: chosenPlan,
        role: "owner",
      });
    } else {
      user.email = String(email).toLowerCase();
      user.name = firstName || user.name;
      user.companyName = companyName || user.companyName;
      user.companyNameNormalized = companyNorm || user.companyNameNormalized;
      user.companyDomain = domain || user.companyDomain;
      user.plan = chosenPlan;
      await user.save();
    }

    if (!adminBypass) {
      await TrialRegistry.create({
        emailNormalized: emailNorm,
        companyNameNormalized: companyNorm,
        companyDomain: domain,
        ipua,
        fingerprint: ipua,
      });
    }

    await ensureOrgForUser(user);
    return res.json({ ok: true, token: signToken(user) });
  } catch (e) {
    console.log("lead error:", e.message);
    if (String(e.message || "").includes("duplicate key"))
      return res.status(403).json({ error: "Essai déjà utilisé (anti-abus)." });
    return res.status(500).json({ error: "Erreur serveur lead" });
  }
});

// ---------- AUTH: LOGIN MAGIC LINK ----------
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

app.post("/api/auth/login-request", loginLimiter, async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();
    if (!email) return res.status(400).json({ error: "Email requis" });

    const emailNorm = normalizeEmail(email);
    const user = await User.findOne({ emailNormalized: emailNorm });
    if (!user) return res.status(404).json({ error: "Aucun compte pour cet email" });

    const raw = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
    const expiresAt = new Date(Date.now() + LOGIN_LINK_TTL_MINUTES * 60 * 1000);

    await LoginToken.create({ userId: user._id, tokenHash, expiresAt });

    const baseUrl = safeBaseUrl(req);
    const link = `${baseUrl}/login-verify.html?token=${raw}`;

    if (String(process.env.DEBUG_LOGIN_LINK || "").toLowerCase() === "true") {
      return res.json({ ok: true, debugLink: link });
    }

    const html = `
  <div style="background:#f6f7fb;padding:32px 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:18px;padding:24px;border:1px solid rgba(15,23,42,.08)">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
       <!-- FlowPoint logo (rounded square + lightning) -->
<div style="width:44px;height:44px;border-radius:14px;background:#2F6BFF;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 24px rgba(47,107,255,.22), inset 0 0 0 1px rgba(255,255,255,.18);">
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M13 2L4 14h7l-1 8 10-14h-7l0-6Z"
          stroke="#fff" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>
</div>
        <div>
          <div style="color:#0f172a;font-weight:800;font-size:18px;line-height:1">${BRAND_NAME}</div>
          <div style="color:#667085;font-size:13px">Connexion sécurisée (sans mot de passe)</div>
        </div>
      </div>

      <h2 style="margin:10px 0 8px;color:#0f172a;font-size:18px">Ton lien de connexion</h2>
      <p style="margin:0 0 16px;color:#667085;font-size:14px;line-height:1.55">
        Ce lien est valide <b>${LOGIN_LINK_TTL_MINUTES} minutes</b>. Si tu n’es pas à l’origine de cette demande, ignore cet email.
      </p>

      <a href="${link}"
         style="display:inline-block;background:#0052CC;color:white;text-decoration:none;padding:12px 16px;border-radius:12px;font-weight:800;">
        Se connecter
      </a>

      <p style="margin:16px 0 6px;color:#667085;font-size:12px">Bouton bloqué ? Copie-colle :</p>
      <p style="margin:0;color:#0f172a;font-size:12px;word-break:break-all">${link}</p>

      <div style="margin-top:18px;padding-top:14px;border-top:1px solid rgba(15,23,42,.08);color:#667085;font-size:12px">
        © ${new Date().getFullYear()} ${BRAND_NAME}
      </div>
    </div>
  </div>
`;

    const r = await sendEmail({
      to: user.email,
      subject: `${BRAND_NAME} — Ton lien de connexion`,
      text: `Lien (valide ${LOGIN_LINK_TTL_MINUTES} min): ${link}`,
      html,
    });

    if (!r.ok) {
      return res.status(502).json({
        ok: false,
        error: "Email non envoyé",
      });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.log("login-request error:", e.message);
    return res.status(500).json({ error: "Erreur login-request" });
  }
});

app.get("/api/auth/login-verify", async (req, res) => {
  try {
    const raw = String(req.query?.token || "");
    if (!raw) return res.status(400).json({ error: "Token manquant" });

    const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
    const lt = await LoginToken.findOne({ tokenHash });
    if (!lt) return res.status(400).json({ error: "Token invalide" });
    if (lt.usedAt) return res.status(400).json({ error: "Token déjà utilisé" });
    if (lt.expiresAt && new Date(lt.expiresAt).getTime() < Date.now()) return res.status(400).json({ error: "Token expiré" });

    const user = await User.findById(lt.userId);
    if (!user) return res.status(404).json({ error: "User introuvable" });

    lt.usedAt = new Date();
    await lt.save();

    await ensureOrgForUser(user);
    return res.json({ ok: true, token: signToken(user) });
  } catch (e) {
    console.log("login-verify error:", e.message);
    return res.status(500).json({ error: "Erreur login-verify" });
  }
});

// ---------- STRIPE ROUTES (via stripe.js) ----------
app.post("/api/stripe/checkout", auth, requireActive, stripeModule.checkoutPlan);
app.get("/api/stripe/verify", stripeModule.verifyCheckout);
app.post("/api/stripe/portal", auth, requireActive, stripeModule.customerPortal);

// ---------- ME ----------
app.get("/api/me", auth, requireActive, async (req, res) => {
  const u = req.dbUser;
  const org = req.dbOrg;
  const q = effectiveQuotas(u, org);

  return res.json({
    email: u.email,
    name: u.name,
    companyName: u.companyName,
    plan: u.plan,
    role: u.role,
    org: org ? { id: org._id, name: org.name } : null,
    hasTrial: u.hasTrial,
    trialEndsAt: u.trialEndsAt,
    accessBlocked: u.accessBlocked,
    lastPaymentStatus: u.lastPaymentStatus || "",
    subscriptionStatus: u.subscriptionStatus || "",
    addons: org?.billingAddons || {},
    retentionDays: org?.retentionDays ?? 30,
    credits: org?.credits || { audits: 0, pdf: 0, exports: 0 },
    usage: {
      month: u.usageMonth,
      audits: { used: u.usedAudits, limit: q.audits },
      monitors: { used: null, limit: q.monitors },
      pdf: { used: u.usedPdf, limit: q.pdf },
      exports: { used: u.usedExports, limit: q.exports },
      teamSeats: { used: null, limit: q.teamSeats },
    },
  });
});

// ---------- OVERVIEW ----------
app.get("/api/overview", auth, requireActive, async (req, res) => {
  const days = Math.min(30, Math.max(1, Number(req.query.days || 30)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const lastAudit = await Audit.findOne({ orgId: req.dbUser.orgId }).sort({ createdAt: -1 }).select("score createdAt url");
  const audits = await Audit.find({ orgId: req.dbUser.orgId, createdAt: { $gte: since } })
    .sort({ createdAt: 1 })
    .limit(120)
    .select("score createdAt");

  const chart = audits.map((a) => a.score ?? 0);

  const activeMonitors = await Monitor.countDocuments({ orgId: req.dbUser.orgId, active: true });
  const downMonitors = await Monitor.countDocuments({ orgId: req.dbUser.orgId, active: true, lastStatus: "down" });

  return res.json({
    ok: true,
    seoScore: lastAudit?.score ?? 0,
    lastAuditAt: lastAudit?.createdAt || null,
    lastAuditUrl: lastAudit?.url || null,
    localVis: "+0%",
    chart,
    monitors: { active: activeMonitors, down: downMonitors },
    rangeDays: days,
  });
});

// ---------- ORG SETTINGS ----------
app.get("/api/org/settings", auth, requireActive, async (req, res) => {
  const org = await Org.findById(req.dbUser.orgId).select("alertRecipients alertExtraEmails");
  return res.json({ ok: true, settings: org || { alertRecipients: "all", alertExtraEmails: [] } });
});

app.post("/api/org/settings", auth, requireActive, requireOwner, async (req, res) => {
  const recipients = String(req.body?.alertRecipients || "all").toLowerCase();
  const extra = Array.isArray(req.body?.alertExtraEmails) ? req.body.alertExtraEmails : [];

  await Org.updateOne(
    { _id: req.dbUser.orgId },
    { $set: { alertRecipients: recipients, alertExtraEmails: extra } }
  );

  return res.json({ ok: true });
});

// Aliases
app.get("/api/org/monitor-settings", auth, requireActive, async (req, res) => {
  const org = await Org.findById(req.dbUser.orgId).select("alertRecipients alertExtraEmails");
  return res.json({ ok: true, settings: org || { alertRecipients: "all", alertExtraEmails: [] } });
});
app.post("/api/org/monitor-settings", auth, requireActive, requireOwner, async (req, res) => {
  const recipients = String(req.body?.alertRecipients || "all").toLowerCase();
  const extra = Array.isArray(req.body?.alertExtraEmails) ? req.body.alertExtraEmails : [];

  await Org.updateOne(
    { _id: req.dbUser.orgId },
    { $set: { alertRecipients: recipients, alertExtraEmails: extra } }
  );

  return res.json({ ok: true });
});

// ---------- AUDITS ----------
app.post("/api/audits/run", auth, requireActive, async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: "URL invalide (http/https)" });

    const urlNorm = normalizeUrl(url);
    const cutoff = new Date(Date.now() - AUDIT_CACHE_HOURS * 60 * 60 * 1000);

    const cached = await Audit.findOne({
      orgId: req.dbUser.orgId,
      urlNormalized: urlNorm,
      createdAt: { $gte: cutoff },
    }).sort({ createdAt: -1 });

    if (cached) {
      return res.json({
        ok: true,
        cached: true,
        auditId: cached._id,
        score: cached.score,
        summary: `Cache (${AUDIT_CACHE_HOURS}h) — ` + (cached.summary || ""),
      });
    }

    const ok = await consume(req.dbUser, req.dbOrg, "audits", 1);
    if (!ok) return res.status(429).json({ error: "Quota audits dépassé" });

    const out = await runSeoAudit(urlNorm);

    const audit = await Audit.create({
      orgId: req.dbUser.orgId,
      userId: req.dbUser._id,
      url: urlNorm,
      urlNormalized: urlNorm,
      status: out.status,
      score: out.score,
      summary: out.summary,
      findings: out.findings,
      recommendations: out.recommendations,
      htmlSnapshot: out.htmlSnapshot,
    });

    return res.json({ ok: true, cached: false, auditId: audit._id, score: audit.score, summary: audit.summary });
  } catch (e) {
    return res.status(400).json({ error: e.message || "Erreur audit" });
  }
});

app.get("/api/audits", auth, requireActive, async (req, res) => {
  const list = await Audit.find({ orgId: req.dbUser.orgId }).sort({ createdAt: -1 }).limit(50);
  return res.json({ ok: true, audits: list });
});

app.get("/api/audits/:id", auth, requireActive, async (req, res) => {
  const a = await Audit.findOne({ _id: req.params.id, orgId: req.dbUser.orgId });
  if (!a) return res.status(404).json({ error: "Audit introuvable" });
  return res.json({ ok: true, audit: a });
});

app.get("/api/audits/:id/pdf", auth, requireActive, async (req, res) => {
  const a = await Audit.findOne({ _id: req.params.id, orgId: req.dbUser.orgId });
  if (!a) return res.status(404).json({ error: "Audit introuvable" });

  const ok = await consume(req.dbUser, req.dbOrg, "pdf", 1);
  if (!ok) return res.status(429).json({ error: "Quota PDF dépassé" });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="flowpoint-audit-${a._id}.pdf"`);

  const doc = new PDFDocument({ margin: 48 });
  doc.pipe(res);

  doc.fontSize(22).text(BRAND_NAME, { continued: true }).fontSize(22).text("  — Rapport SEO");
  doc.moveDown(0.5);
  doc.fontSize(12).text(`URL: ${a.url}`);
  doc.text(`Date: ${new Date(a.createdAt).toLocaleString("fr-FR")}`);
  doc.text(`Score: ${a.score}/100`);
  doc.moveDown();

  doc.fontSize(14).text("Résumé", { underline: true });
  doc.fontSize(12).text(a.summary || "-");
  doc.moveDown();

  doc.fontSize(14).text("Recommandations (priorisées)", { underline: true });
  doc.moveDown(0.25);
  const rec = Array.isArray(a.recommendations) ? a.recommendations : [];
  if (!rec.length) doc.fontSize(12).text("Aucune recommandation.");
  for (const r of rec) doc.fontSize(12).text("• " + r);
  doc.moveDown();

  doc.fontSize(14).text("Checks", { underline: true });
  doc.moveDown(0.25);
  const f = a.findings || {};
  for (const [k, v] of Object.entries(f)) {
    const vv = typeof v?.value === "object" ? JSON.stringify(v.value) : String(v?.value ?? "");
    doc.fontSize(12).text(`${k}: ${v?.ok ? "OK" : "À corriger"} — ${vv}`);
  }

  doc.end();
});

// ---------- MONITORS ----------
app.post("/api/monitors", auth, requireActive, async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim();
    const intervalMinutes = Number(req.body?.intervalMinutes || 60);

    if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: "URL invalide" });
    if (!Number.isFinite(intervalMinutes) || intervalMinutes < 5) return res.status(400).json({ error: "intervalMinutes min = 5" });

    await assertSafePublicUrl(url);

    const allowed = await canCreateActiveMonitor(req.dbUser, req.dbOrg);
    if (!allowed) return res.status(429).json({ error: "Quota monitors actifs dépassé" });

    const m = await Monitor.create({
      orgId: req.dbUser.orgId,
      userId: req.dbUser._id,
      url,
      intervalMinutes,
      active: true,
    });

    return res.json({ ok: true, monitor: m });
  } catch (e) {
    return res.status(400).json({ error: e.message || "Erreur monitor" });
  }
});

app.get("/api/monitors", auth, requireActive, async (req, res) => {
  const list = await Monitor.find({ orgId: req.dbUser.orgId }).sort({ createdAt: -1 }).limit(50);
  return res.json({ ok: true, monitors: list });
});

app.patch("/api/monitors/:id", auth, requireActive, async (req, res) => {
  const m = await Monitor.findOne({ _id: req.params.id, orgId: req.dbUser.orgId });
  if (!m) return res.status(404).json({ error: "Monitor introuvable" });

  if (typeof req.body?.active === "boolean") m.active = req.body.active;

  if (req.body?.intervalMinutes) {
    const im = Number(req.body.intervalMinutes);
    if (!Number.isFinite(im) || im < 5) return res.status(400).json({ error: "intervalMinutes min = 5" });
    m.intervalMinutes = im;
  }

  if (m.active === true) {
    const q = effectiveQuotas(req.dbUser, req.dbOrg);
    const countActive = await Monitor.countDocuments({ orgId: req.dbUser.orgId, active: true, _id: { $ne: m._id } });
    if (countActive + 1 > q.monitors) return res.status(429).json({ error: "Quota monitors actifs dépassé" });
  }

  await m.save();
  return res.json({ ok: true, monitor: m });
});

app.delete("/api/monitors/:id", auth, requireActive, async (req, res) => {
  const m = await Monitor.findOneAndDelete({ _id: req.params.id, orgId: req.dbUser.orgId });
  if (!m) return res.status(404).json({ error: "Monitor introuvable" });

  await MonitorLog.deleteMany({ orgId: req.dbUser.orgId, monitorId: m._id }).catch(() => {});
  return res.json({ ok: true });
});

app.post("/api/monitors/:id/run", auth, requireActive, async (req, res) => {
  const m = await Monitor.findOne({ _id: req.params.id, orgId: req.dbUser.orgId });
  if (!m) return res.status(404).json({ error: "Monitor introuvable" });
  if (!m.active) return res.status(400).json({ error: "Monitor inactif" });

  const r = await checkUrlOnce(m.url);

  m.lastCheckedAt = new Date();
  m.lastStatus = r.status;
  await m.save();

  await MonitorLog.create({
    orgId: req.dbUser.orgId,
    userId: req.dbUser._id,
    monitorId: m._id,
    url: m.url,
    status: r.status,
    httpStatus: r.httpStatus,
    responseTimeMs: r.responseTimeMs,
    error: r.error,
  });

  await maybeSendMonitorAlert(m, r);

  return res.json({ ok: true, result: r });
});

app.get("/api/monitors/:id/logs", auth, requireActive, async (req, res) => {
  const m = await Monitor.findOne({ _id: req.params.id, orgId: req.dbUser.orgId });
  if (!m) return res.status(404).json({ error: "Monitor introuvable" });

  const logs = await MonitorLog.find({ orgId: req.dbUser.orgId, monitorId: m._id })
    .sort({ checkedAt: -1 })
    .limit(200);

  return res.json({ ok: true, logs });
});

app.get("/api/monitors/:id/uptime", auth, requireActive, async (req, res) => {
  const m = await Monitor.findOne({ _id: req.params.id, orgId: req.dbUser.orgId });
  if (!m) return res.status(404).json({ error: "Monitor introuvable" });

  const days = Math.min(30, Math.max(1, Number(req.query.days || 7)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const logs = await MonitorLog.find({ orgId: req.dbUser.orgId, monitorId: m._id, checkedAt: { $gte: since } })
    .select("status checkedAt")
    .sort({ checkedAt: 1 });

  const total = logs.length;
  const up = logs.filter((l) => l.status === "up").length;
  const uptime = total ? Math.round((up / total) * 10000) / 100 : null;

  return res.json({ ok: true, days, totalChecks: total, upChecks: up, uptimePercent: uptime });
});

// ---------- CRON ----------
app.post("/api/cron/monitors-run", requireCron, async (req, res) => {
  try {
    const now = Date.now();
    const limit = Math.min(500, Math.max(1, Number(req.body?.limit || req.query.limit || 200)));

    const activeMonitors = await Monitor.find({ active: true }).sort({ updatedAt: 1 }).limit(limit);

    let checked = 0;
    let alertsSent = 0;

    await runWithConcurrency(activeMonitors, CRON_CONCURRENCY, async (m) => {
      const last = m.lastCheckedAt ? new Date(m.lastCheckedAt).getTime() : 0;
      const dueMs = Number(m.intervalMinutes || 60) * 60 * 1000;
      const due = !last || now - last >= dueMs;
      if (!due) return;

      const r = await checkUrlOnce(m.url);

      m.lastCheckedAt = new Date();
      m.lastStatus = r.status;
      await m.save();

      await MonitorLog.create({
        orgId: m.orgId,
        userId: m.userId,
        monitorId: m._id,
        url: m.url,
        status: r.status,
        httpStatus: r.httpStatus,
        responseTimeMs: r.responseTimeMs,
        error: r.error,
      });

      const a = await maybeSendMonitorAlert(m, r);
      if (a.sent) alertsSent += 1;

      checked += 1;
    });

    return res.json({ ok: true, checked, alertsSent, scanned: activeMonitors.length, concurrency: CRON_CONCURRENCY });
  } catch (e) {
    console.log("cron monitors-run error:", e.message);
    return res.status(500).json({ error: "Erreur cron monitors-run" });
  }
});

// ---------- EXPORTS ----------
function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

app.get("/api/export/audits.csv", auth, requireActive, async (req, res) => {
  const ok = await consume(req.dbUser, req.dbOrg, "exports", 1);
  if (!ok) return res.status(429).json({ error: "Quota exports dépassé" });

  const list = await Audit.find({ orgId: req.dbUser.orgId }).sort({ createdAt: -1 }).limit(500);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="flowpoint-audits.csv"`);

  const header = ["createdAt", "url", "status", "score", "summary"].join(",") + "\n";
  const rows = list
    .map((a) =>
      [a.createdAt?.toISOString?.() || "", a.url || "", a.status || "", a.score ?? "", a.summary || ""]
        .map(csvEscape)
        .join(",")
    )
    .join("\n");

  res.send(header + rows + "\n");
});

app.get("/api/export/monitors.csv", auth, requireActive, async (req, res) => {
  const ok = await consume(req.dbUser, req.dbOrg, "exports", 1);
  if (!ok) return res.status(429).json({ error: "Quota exports dépassé" });

  const list = await Monitor.find({ orgId: req.dbUser.orgId }).sort({ createdAt: -1 }).limit(500);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="flowpoint-monitors.csv"`);

  const header = ["createdAt", "url", "active", "intervalMinutes", "lastStatus", "lastCheckedAt"].join(",") + "\n";
  const rows = list
    .map((m) =>
      [
        m.createdAt?.toISOString?.() || "",
        m.url || "",
        m.active ? "true" : "false",
        m.intervalMinutes ?? "",
        m.lastStatus || "",
        m.lastCheckedAt ? new Date(m.lastCheckedAt).toISOString() : "",
      ]
        .map(csvEscape)
        .join(",")
    )
    .join("\n");

  res.send(header + rows + "\n");
});

// aliases
app.get("/api/exports/audits.csv", auth, requireActive, (req, res) => {
  req.url = "/api/export/audits.csv";
  app.handle(req, res);
});
app.get("/api/exports/monitors.csv", auth, requireActive, (req, res) => {
  req.url = "/api/export/monitors.csv";
  app.handle(req, res);
});

// ---------- ADMIN ----------
app.get("/api/admin/users", requireAdmin, async (req, res) => {
  const list = await User.find({}).sort({ createdAt: -1 }).limit(200);
  res.json({ ok: true, users: list });
});

app.post("/api/admin/user/block", requireAdmin, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const blocked = !!req.body?.blocked;
  if (!email) return res.status(400).json({ error: "email manquant" });
  await User.updateOne({ email }, { $set: { accessBlocked: blocked } });
  res.json({ ok: true });
});

app.post("/api/admin/user/reset-usage", requireAdmin, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "email manquant" });
  await User.updateOne(
    { email },
    { $set: { usageMonth: firstDayOfThisMonthUTC(), usedAudits: 0, usedPdf: 0, usedExports: 0 } }
  );
  res.json({ ok: true });
});

// ---------- KEEP ALIVE (empêche le cold start Render) ----------
if (process.env.RENDER) {
  const SELF_URL = process.env.PUBLIC_BASE_URL;

  if (SELF_URL) {
    setInterval(async () => {
      try {
        await fetch(`${SELF_URL}/api/health`);
        console.log("🔁 Keep alive ping");
      } catch (e) {
        console.log("Keep alive failed:", e.message);
      }
    }, 1000 * 60 * 5); // toutes les 5 minutes
  }
}

// ---------- START ----------
app.listen(PORT, () => console.log(`✅ ${BRAND_NAME} lancé sur port ${PORT}`));
