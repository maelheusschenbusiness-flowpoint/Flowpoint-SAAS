// =======================
// FlowPoint — SaaS Backend
// Plans: Standard / Pro / Ultra
// Core: SEO Audit + PDF + Monitoring + Logs + CSV + Magic Link + Orgs + Team + Stripe
// Clean version:
// - routes mortes supprimées
// - refresh token ajouté
// - invite accept ajouté
// - pages actives uniquement
// - cron monitors conservé
// - refresh/session renforcés pour dashboard mobile
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
const BRAND_NAME = "FlowPoint";

const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || "30d";
const REFRESH_TOKEN_TTL = process.env.REFRESH_TOKEN_TTL || "90d";
const REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ||
  `${process.env.JWT_SECRET || "flowpoint"}_refresh`;

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

if (!STRIPE_WEBHOOK_SECRET) {
  console.log("⚠️ STRIPE_WEBHOOK_SECRET manquante (webhook non validable)");
}

const ADMIN_KEY = process.env.ADMIN_KEY || "";
const CRON_KEY = process.env.CRON_KEY || "";

if (!CRON_KEY) {
  console.log("⚠️ CRON_KEY manquante (cron monitors non sécurisé)");
}

const LOGIN_LINK_TTL_MINUTES = Number(process.env.LOGIN_LINK_TTL_MINUTES || 30);
const AUDIT_CACHE_HOURS = Number(process.env.AUDIT_CACHE_HOURS || 24);
const MONITOR_HTTP_TIMEOUT_MS = Number(process.env.MONITOR_HTTP_TIMEOUT_MS || 8000);
const CRON_CONCURRENCY = Math.min(
  25,
  Math.max(2, Number(process.env.CRON_CONCURRENCY || 10))
);

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
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });

  return _cachedTransport;
}

function safeBaseUrl(req) {
  const env = String(process.env.PUBLIC_BASE_URL || "").trim();
  if (env) return env.replace(/\/+$/, "");

  const protoRaw = String(
    req.headers["x-forwarded-proto"] || req.protocol || "https"
  );
  const proto = protoRaw.split(",")[0].trim().toLowerCase();
  const safeProto = proto === "http" || proto === "https" ? proto : "https";

  const hostRaw = String(
    req.headers["x-forwarded-host"] || req.headers.host || ""
  )
    .split(",")[0]
    .trim();

  const host = hostRaw.replace(/[\r\n]/g, "");
  if (!host) return "https://localhost";

  return `${safeProto}://${host}`.replace(/\/+$/, "");
}

async function sendEmail({ to, subject, text, html, attachments, bcc }) {
  try {
    const from = String(process.env.ALERT_EMAIL_FROM || "").trim();
    if (!from) {
      console.log("❌ ALERT_EMAIL_FROM manquant (email non envoyé)");
      return { ok: false, error: "ALERT_EMAIL_FROM missing" };
    }

    const normalizeList = (v) => {
      if (!v) return [];
      if (Array.isArray(v)) {
        return v.map(String).map((s) => s.trim()).filter(Boolean);
      }
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

function buildDailyReportEmail({
  brandName,
  orgName,
  usersCount,
  monitorsDown,
  audits24hCount,
  logsDown24hCount,
}) {
  const subject = `${brandName} — Rapport quotidien — ${orgName}`;

  const text = `${brandName} — Rapport quotidien
Organisation: ${orgName}

• Users: ${usersCount}
• Monitors DOWN: ${monitorsDown}
• Audits (24h): ${audits24hCount || 0}
• Logs DOWN (24h): ${logsDown24hCount || 0}

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
  <title>${brandName} — Rapport quotidien</title>
  <style>
    :root{
      --bg:#f6f7fb;
      --card:#ffffff;
      --muted:#667085;
      --text:#0f172a;
      --border:rgba(15,23,42,.10);
      --brand:#2f5bff;
      --chip:#eef2ff;
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
      font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
      color:var(--text);
    }
    .wrap{padding:28px 14px}
    .container{max-width:620px;margin:0 auto}
    .hero{
      background:linear-gradient(180deg, rgba(47,91,255,.22), transparent 55%);
      border:1px solid var(--border);
      border-radius:18px;
      padding:18px;
    }
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
    .card,.section{
      background:var(--card);
      border:1px solid var(--border);
      border-radius:16px;
      padding:14px;
    }
    .sub,.footer,ul{color:var(--muted)}
    .footer{margin-top:14px;font-size:12px;text-align:center;line-height:1.6}
    .pill{
      display:inline-block;
      margin-top:10px;
      padding:6px 10px;
      border-radius:999px;
      background:var(--chip);
      font-weight:800;
      font-size:12px;
    }
    @media (max-width:520px){.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="container">
      <div class="hero">
        <h1 style="margin:0 0 8px 0">${brandName} — Rapport quotidien</h1>
        <div class="sub">
          Organisation : <b>${orgName}</b><br>
          <span class="pill">${dateLabel}</span>
        </div>

        <div class="grid">
          <div class="card"><b>Users</b><div style="margin-top:8px;font-size:22px;font-weight:900">${usersCount}</div></div>
          <div class="card"><b>Monitors DOWN</b><div style="margin-top:8px;font-size:22px;font-weight:900">${monitorsDown}</div></div>
        </div>
      </div>

      <div class="section" style="margin-top:12px">
        <b>Audits (24h)</b>
        <ul><li>${audits24hCount ? `${audits24hCount} audit(s) effectué(s)` : "Aucun"}</li></ul>
      </div>

      <div class="section" style="margin-top:12px">
        <b>Logs DOWN (24h)</b>
        <ul><li>${logsDown24hCount ? `${logsDown24hCount} incident(s) détecté(s)` : "Aucun"}</li></ul>
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

function baseQuotasForPlan(plan) {
  const p = String(plan || "").toLowerCase();
  if (p === "standard") return { audits: 30, monitors: 3, pdf: 30, exports: 30, teamSeats: 1 };
  if (p === "pro") return { audits: 300, monitors: 50, pdf: 300, exports: 300, teamSeats: 1 };
  if (p === "ultra") return { audits: 2000, monitors: 300, pdf: 2000, exports: 2000, teamSeats: 10 };
  return { audits: 0, monitors: 0, pdf: 0, exports: 0, teamSeats: 0 };
}

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
  if ((user[field] || 0) + amount > limit) return false;

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
  return String(s || "")
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

  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error("Protocole interdit");
  }
  if (!u.hostname) {
    throw new Error("Hostname manquant");
  }
  if (u.username || u.password) {
    throw new Error("Credentials interdits dans l'URL");
  }

  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) {
    throw new Error("Hostname interdit");
  }

  const res = await dns.lookup(host, { all: true, verbatim: true });
  if (!res?.length) throw new Error("DNS lookup failed");

  for (const r of res) {
    if (isPrivateIp(r.address)) {
      throw new Error("Destination réseau privée interdite");
    }
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
function signAccessToken(user) {
  return jwt.sign(
    { uid: user._id.toString(), email: user.email, type: "access" },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    { uid: user._id.toString(), email: user.email, type: "refresh" },
    REFRESH_SECRET,
    { expiresIn: REFRESH_TOKEN_TTL }
  );
}

// compat stripe.js
function signToken(user) {
  return signAccessToken(user);
}

function issueAuthPayload(user) {
  const token = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  return {
    token,
    refreshToken,
  };
}

function auth(req, res, next) {
  const h = String(req.headers.authorization || "");
  const tok = h.startsWith("Bearer ") ? h.slice(7).trim() : "";

  if (!tok) {
    return res.status(401).json({ error: "Non autorisé" });
  }

  try {
    const decoded = jwt.verify(tok, process.env.JWT_SECRET);
    if (!decoded?.uid) {
      return res.status(401).json({ error: "Token invalide" });
    }

    req.user = decoded;
    next();
  } catch (e) {
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
      whiteLabel: true,
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
    org.integrations = {
      slackWebhookUrl: "",
      discordWebhookUrl: "",
      zapierHookUrl: "",
    };
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

  if (user.accessBlocked) {
    return res.status(403).json({ error: "Accès bloqué (paiement échoué / essai terminé)" });
  }

  await resetUsageIfNewMonth(user);
  await ensureOrgForUser(user);

  const org = user.orgId ? await Org.findById(user.orgId) : null;
  req.dbOrg = org ? await ensureOrgDefaults(org) : null;
  req.dbUser = user;

  next();
}

function requireOwner(req, res, next) {
  if (req.dbUser.role !== "owner") {
    return res.status(403).json({ error: "Owner requis" });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(500).json({ error: "ADMIN_KEY manquante" });

  const k = req.headers["x-admin-key"] || req.query.admin_key;
  if (k !== ADMIN_KEY) {
    return res.status(401).json({ error: "Admin non autorisé" });
  }

  next();
}

function requireCron(req, res, next) {
  if (!CRON_KEY) return res.status(500).json({ error: "CRON_KEY manquante" });

  const k = req.headers["x-cron-key"] || req.query.cron_key;
  if (k !== CRON_KEY) {
    return res.status(401).json({ error: "Cron non autorisé" });
  }

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
  const org = await Org.findById(orgId).select("alertRecipients alertExtraEmails ownerUserId");
  if (!org) return [];

  const recipientsMode = String(org.alertRecipients || "all").toLowerCase();
  const extra = Array.isArray(org.alertExtraEmails) ? org.alertExtraEmails : [];

  let base = [];

  if (recipientsMode === "owner") {
    const owner = org.ownerUserId
      ? await User.findById(org.ownerUserId).select("email")
      : null;

    if (owner?.email) base.push(owner.email);
  } else {
    const users = await User.find({ orgId }).select("email");
    base.push(...users.map((u) => u.email).filter(Boolean));
  }

  return uniqEmails([...base, ...extra]).slice(0, 60);
}

function formatMonitorEmail({
  orgName,
  monitorUrl,
  status,
  httpStatus,
  responseTimeMs,
  checkedAt,
  error,
}) {
  const when = checkedAt
    ? new Date(checkedAt).toLocaleString("fr-FR")
    : new Date().toLocaleString("fr-FR");

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

  if (newStatus !== "up" && newStatus !== "down") {
    return { sent: false, reason: "unknown status" };
  }

  if (newStatus === last) {
    return { sent: false, reason: "no change" };
  }

  const org = await Org.findById(monitor.orgId).select("name");
  const to = await getOrgAlertEmails(monitor.orgId);

  if (!to.length) {
    return { sent: false, reason: "no recipients" };
  }

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

  const runners = new Array(Math.min(limit, items.length))
    .fill(0)
    .map(async () => {
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
    const r = await fetch(safeUrl, {
      redirect: "follow",
      signal: controller.signal,
    });

    const ms = Date.now() - t0;
    clearTimeout(id);

    const up = r.status >= 200 && r.status < 400;
    return {
      status: up ? "up" : "down",
      httpStatus: r.status,
      responseTimeMs: ms,
      error: "",
    };
  } catch (e) {
    const ms = Date.now() - t0;
    clearTimeout(id);

    return {
      status: "down",
      httpStatus: 0,
      responseTimeMs: ms,
      error: e.message || "fetch failed",
    };
  }
}

// ---------- SEO AUDIT ----------
async function fetchWithTiming(url) {
  const safeUrl = await assertSafePublicUrl(url);

  const controller = new AbortController();
  const id = setTimeout(
    () => controller.abort(),
    Math.min(15000, MONITOR_HTTP_TIMEOUT_MS * 2)
  );

  const t0 = Date.now();
  const r = await fetch(safeUrl, {
    redirect: "follow",
    signal: controller.signal,
  });
  const t1 = Date.now();
  const text = await r.text();
  clearTimeout(id);

  return {
    status: r.status,
    ok: r.ok,
    headers: r.headers,
    text,
    ms: t1 - t0,
    finalUrl: r.url,
  };
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
    return {
      status: "error",
      score: 0,
      summary: "Impossible de charger l’URL.",
      findings: {},
      recommendations: [],
      htmlSnapshot: "",
      error: e.message,
    };
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

// ---------- Monitor quota = ACTIVE count ----------
async function canCreateActiveMonitor(user, org) {
  const q = effectiveQuotas(user, org);
  const countActive = await Monitor.countDocuments({
    orgId: user.orgId,
    active: true,
  });

  return countActive < q.monitors;
}
// =======================
// FLOWPOINT FULL ENGINE v1
// Overview war room + Libraries + Personalization + Local/Maps
// Team discussions + Calendar + Notes + Packs + Risk/Opportunity
// =======================

// ---------- MODELS ----------

const MissionSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },

    title: String,
    description: String,

    category: {
      type: String,
      enum: ["seo", "content", "local", "conversion", "monitor", "reporting", "ops", "team"],
      default: "seo",
      index: true,
    },

    sourceType: {
      type: String,
      enum: ["manual", "audit", "monitor", "system", "calendar", "note", "local", "team"],
      default: "system",
      index: true,
    },

    sourceId: { type: mongoose.Schema.Types.ObjectId, index: true },

    priority: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
      index: true,
    },

    impact: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
      index: true,
    },

    status: {
      type: String,
      enum: ["todo", "in_progress", "blocked", "done", "ignored", "postponed"],
      default: "todo",
      index: true,
    },

    sector: { type: String, default: "" },
    pageType: { type: String, default: "" },
    pageUrl: { type: String, default: "" },
    siteUrl: { type: String, default: "" },

    dueDate: Date,
    completedAt: Date,

    assignedToUserId: { type: mongoose.Schema.Types.ObjectId, index: true },

    isAutomated: { type: Boolean, default: false, index: true },
    isQuickWin: { type: Boolean, default: false, index: true },

    tags: { type: [String], default: [] },
  },
  { timestamps: true, collection: "missions" }
);

const IssueSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },

    sourceType: {
      type: String,
      enum: ["audit", "monitor", "local", "system"],
      default: "audit",
      index: true,
    },

    sourceId: { type: mongoose.Schema.Types.ObjectId, index: true },

    type: { type: String, index: true },
    title: String,
    description: String,

    category: {
      type: String,
      enum: ["seo", "content", "local", "conversion", "monitor", "reporting", "ops", "team"],
      default: "seo",
      index: true,
    },

    severity: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
      index: true,
    },

    impactBusiness: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
      index: true,
    },

    priorityScore: { type: Number, default: 50, index: true },

    pageUrl: { type: String, default: "" },
    siteUrl: { type: String, default: "" },

    sector: { type: String, default: "" },
    pageType: { type: String, default: "" },

    recommendationKey: { type: String, default: "" },
    missionTemplateKey: { type: String, default: "" },
    packKey: { type: String, default: "" },

    status: {
      type: String,
      enum: ["open", "accepted", "ignored", "resolved"],
      default: "open",
      index: true,
    },

    metadata: { type: Object, default: {} },
  },
  { timestamps: true, collection: "issues" }
);

const PackRunSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },

    packKey: { type: String, index: true },
    name: String,
    category: String,
    summary: String,

    sourceType: String,
    sourceId: { type: mongoose.Schema.Types.ObjectId, index: true },

    impactExpected: { type: String, default: "medium" },
    difficulty: { type: String, default: "medium" },
    estimatedTime: { type: String, default: "" },

    previewItems: { type: [String], default: [] },

    createdMissionIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
  },
  { timestamps: true, collection: "packruns" }
);

const TimelineEventSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },

    type: { type: String, index: true },
    entityType: { type: String, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId, index: true },

    title: String,
    message: String,

    metadata: { type: Object, default: {} },
  },
  { timestamps: true, collection: "timelineevents" }
);

const TeamThreadSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },

    contextType: {
      type: String,
      enum: ["mission", "audit", "monitor", "report", "note", "general"],
      default: "general",
      index: true,
    },

    contextId: { type: mongoose.Schema.Types.ObjectId, index: true },

    title: String,
    isResolved: { type: Boolean, default: false, index: true },
    lastActivityAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true, collection: "teamthreads" }
);

const TeamMessageSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    threadId: { type: mongoose.Schema.Types.ObjectId, index: true },

    userId: { type: mongoose.Schema.Types.ObjectId, index: true },
    authorName: String,

    content: String,
    mentions: { type: [String], default: [] },

    isSystemSummary: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "teammessages" }
);

const CalendarEventSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },

    title: String,
    description: String,

    type: {
      type: String,
      enum: ["mission_due", "audit_review", "monitor_review", "report_deadline", "team_meeting", "client_reminder", "recurring_task", "custom"],
      default: "custom",
      index: true,
    },

    linkedEntityType: { type: String, default: "" },
    linkedEntityId: { type: mongoose.Schema.Types.ObjectId, index: true },

    startAt: { type: Date, index: true },
    endAt: { type: Date, index: true },

    priority: {
      type: String,
      enum: ["low", "medium", "high", "critical"],
      default: "medium",
      index: true,
    },

    alertMode: {
      type: String,
      enum: ["none", "standard", "smart"],
      default: "none",
      index: true,
    },

    recurrence: {
      type: String,
      enum: ["none", "daily", "weekly", "monthly"],
      default: "none",
    },

    isDone: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, collection: "calendarevents" }
);

const NoteSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },

    title: String,
    content: String,

    type: {
      type: String,
      enum: ["free", "mission", "audit", "incident", "client", "strategy"],
      default: "free",
      index: true,
    },

    linkedEntityType: { type: String, default: "" },
    linkedEntityId: { type: mongoose.Schema.Types.ObjectId, index: true },

    tags: { type: [String], default: [] },
    isPinned: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, collection: "notes" }
);

const Mission = mongoose.models.Mission || mongoose.model("Mission", MissionSchema);
const Issue = mongoose.models.Issue || mongoose.model("Issue", IssueSchema);
const PackRun = mongoose.models.PackRun || mongoose.model("PackRun", PackRunSchema);
const TimelineEvent = mongoose.models.TimelineEvent || mongoose.model("TimelineEvent", TimelineEventSchema);
const TeamThread = mongoose.models.TeamThread || mongoose.model("TeamThread", TeamThreadSchema);
const TeamMessage = mongoose.models.TeamMessage || mongoose.model("TeamMessage", TeamMessageSchema);
const CalendarEvent = mongoose.models.CalendarEvent || mongoose.model("CalendarEvent", CalendarEventSchema);
const Note = mongoose.models.Note || mongoose.model("Note", NoteSchema);

// ---------- LIBRARIES / TAXONOMY ----------

const FP_SECTORS = [
  "garage",
  "restaurant",
  "ecommerce",
  "saas",
  "independant",
  "artisan",
  "immobilier",
  "beaute",
  "juridique",
  "agence",
];

const FP_PAGE_TYPES = [
  "homepage",
  "service",
  "contact",
  "city",
  "pricing",
  "about",
  "booking",
  "faq",
  "product",
  "landing",
];

const FP_CITIES = [
  "Liège",
  "Verviers",
  "Bruxelles",
  "Namur",
  "Charleroi",
  "Mons",
  "Anvers",
  "Gand",
  "Louvain",
  "Waterloo",
];

const ISSUE_LIBRARY = {
  missing_title: {
    title: "Title manquant",
    category: "seo",
    severity: "high",
    impactBusiness: "high",
    recommendationKey: "title_rewrite",
    missionTemplateKey: "fix_title",
    packKey: "seo_technical_recovery",
    baseScore: 82,
  },
  weak_title: {
    title: "Title trop faible",
    category: "seo",
    severity: "medium",
    impactBusiness: "medium",
    recommendationKey: "title_strengthen",
    missionTemplateKey: "strengthen_title",
    packKey: "fast_seo_wins",
    baseScore: 68,
  },
  missing_meta_description: {
    title: "Meta description manquante",
    category: "seo",
    severity: "high",
    impactBusiness: "high",
    recommendationKey: "meta_add",
    missionTemplateKey: "add_meta",
    packKey: "fast_seo_wins",
    baseScore: 78,
  },
  slow_mobile: {
    title: "Performance mobile faible",
    category: "conversion",
    severity: "high",
    impactBusiness: "critical",
    recommendationKey: "mobile_speed",
    missionTemplateKey: "fix_mobile_speed",
    packKey: "mobile_emergency_cleanup",
    baseScore: 92,
  },
  missing_h1: {
    title: "H1 manquant",
    category: "content",
    severity: "high",
    impactBusiness: "high",
    recommendationKey: "h1_add",
    missionTemplateKey: "add_h1",
    packKey: "seo_technical_recovery",
    baseScore: 76,
  },
  duplicate_structure: {
    title: "Structure trop dupliquée",
    category: "content",
    severity: "medium",
    impactBusiness: "medium",
    recommendationKey: "content_differentiate",
    missionTemplateKey: "differentiate_page",
    packKey: "service_pages_authority",
    baseScore: 66,
  },
  weak_contact_visibility: {
    title: "Contact peu visible",
    category: "conversion",
    severity: "high",
    impactBusiness: "critical",
    recommendationKey: "contact_visibility",
    missionTemplateKey: "improve_contact_visibility",
    packKey: "trust_and_conversion",
    baseScore: 88,
  },
  no_local_pages: {
    title: "Pages locales absentes",
    category: "local",
    severity: "high",
    impactBusiness: "high",
    recommendationKey: "create_city_pages",
    missionTemplateKey: "create_city_page",
    packKey: "local_city_expansion",
    baseScore: 86,
  },
  weak_cta: {
    title: "CTA faibles",
    category: "conversion",
    severity: "medium",
    impactBusiness: "high",
    recommendationKey: "cta_strengthen",
    missionTemplateKey: "improve_cta",
    packKey: "homepage_conversion_lift",
    baseScore: 73,
  },
  weak_trust_signals: {
    title: "Trust signals insuffisants",
    category: "conversion",
    severity: "medium",
    impactBusiness: "high",
    recommendationKey: "trust_signals",
    missionTemplateKey: "add_trust_signals",
    packKey: "trust_and_conversion",
    baseScore: 74,
  },
  missing_schema: {
    title: "Schema manquant",
    category: "seo",
    severity: "medium",
    impactBusiness: "medium",
    recommendationKey: "schema_add",
    missionTemplateKey: "add_schema",
    packKey: "seo_technical_recovery",
    baseScore: 63,
  },
  low_content_depth: {
    title: "Contenu trop léger",
    category: "content",
    severity: "medium",
    impactBusiness: "high",
    recommendationKey: "content_expand",
    missionTemplateKey: "expand_content",
    packKey: "service_pages_authority",
    baseScore: 71,
  },
  missing_google_map_block: {
    title: "Bloc Google Maps absent",
    category: "local",
    severity: "medium",
    impactBusiness: "high",
    recommendationKey: "map_embed",
    missionTemplateKey: "add_map_block",
    packKey: "map_trust_signals",
    baseScore: 69,
  },
  page_not_monitored: {
    title: "Page business non monitorée",
    category: "monitor",
    severity: "medium",
    impactBusiness: "high",
    recommendationKey: "monitor_add",
    missionTemplateKey: "add_monitor_to_page",
    packKey: "critical_pages_monitoring",
    baseScore: 72,
  },
};

function generateMissionLibrary() {
  const out = [];
  const categories = [
    { key: "seo", base: ["Corriger title", "Corriger meta description", "Ajouter canonical", "Ajouter schema", "Améliorer headings"] },
    { key: "content", base: ["Renforcer homepage", "Développer page service", "Créer FAQ", "Différencier contenu", "Ajouter preuves"] },
    { key: "local", base: ["Créer page ville", "Ajouter NAP", "Ajouter map", "Renforcer signaux locaux", "Étendre couverture géographique"] },
    { key: "conversion", base: ["Renforcer CTA", "Améliorer contact", "Ajouter trust signals", "Structurer hero", "Réduire friction mobile"] },
    { key: "monitor", base: ["Créer monitor homepage", "Créer monitor contact", "Surveiller parcours business", "Réagir aux incidents", "Prioriser pages critiques"] },
    { key: "reporting", base: ["Préparer rapport client", "Ajouter quick wins au rapport", "Résumer progrès mensuel", "Mettre en avant incidents", "Préparer lecture dirigeant"] },
    { key: "ops", base: ["Revoir backlog", "Nettoyer priorités", "Préparer sprint mensuel", "Planifier revue", "Vérifier cohérence quotas"] },
    { key: "team", base: ["Assigner mission", "Créer discussion contexte", "Rédiger note d’équipe", "Préparer réunion", "Suivre charge membre"] },
  ];

  for (const sector of FP_SECTORS) {
    for (const pageType of FP_PAGE_TYPES) {
      for (const cat of categories) {
        for (const base of cat.base) {
          out.push({
            key: `${cat.key}_${sector}_${pageType}_${out.length + 1}`,
            category: cat.key,
            sector,
            pageType,
            title: `${base} · ${sector} · ${pageType}`,
            description: `Template ${cat.key} pour ${sector} sur page ${pageType}.`,
          });
        }
      }
    }
  }

  return out.slice(0, 220);
}

function generatePackLibrary() {
  return [
    {
      key: "seo_technical_recovery",
      name: "Pack SEO technical recovery",
      category: "seo",
      summary: "Corriger les points techniques qui freinent le score et la lisibilité SEO.",
      difficulty: "medium",
      impactExpected: "high",
      estimatedTime: "2 à 4 jours",
      previewItems: ["Titles", "Meta descriptions", "H1", "Schema", "Canonical"],
    },
    {
      key: "homepage_conversion_lift",
      name: "Pack homepage conversion lift",
      category: "conversion",
      summary: "Améliorer la clarté commerciale et la conversion de la homepage.",
      difficulty: "medium",
      impactExpected: "high",
      estimatedTime: "1 à 3 jours",
      previewItems: ["Hero", "CTA", "Trust", "Contact", "Mobile"],
    },
    {
      key: "local_city_expansion",
      name: "Pack local city expansion",
      category: "local",
      summary: "Déployer la couverture locale sur plusieurs villes à potentiel.",
      difficulty: "high",
      impactExpected: "high",
      estimatedTime: "3 à 6 jours",
      previewItems: ["Pages villes", "NAP", "Map", "Zones", "Preuves locales"],
    },
    {
      key: "trust_and_conversion",
      name: "Pack trust & conversion",
      category: "conversion",
      summary: "Renforcer confiance, preuve et contact pour augmenter les leads.",
      difficulty: "medium",
      impactExpected: "high",
      estimatedTime: "1 à 2 jours",
      previewItems: ["Avis", "Preuves", "Contact", "CTA", "FAQ"],
    },
    {
      key: "critical_pages_monitoring",
      name: "Pack critical pages monitoring",
      category: "monitor",
      summary: "Surveiller les pages business à enjeu élevé et créer les alertes nécessaires.",
      difficulty: "low",
      impactExpected: "high",
      estimatedTime: "1 jour",
      previewItems: ["Homepage", "Contact", "Booking", "Service pages", "Checks"],
    },
    {
      key: "service_pages_authority",
      name: "Pack service pages authority",
      category: "content",
      summary: "Renforcer profondeur, autorité et différenciation des pages service.",
      difficulty: "high",
      impactExpected: "high",
      estimatedTime: "3 à 5 jours",
      previewItems: ["Contenu", "Structure", "Preuves", "FAQ", "Intent"],
    },
    {
      key: "mobile_emergency_cleanup",
      name: "Pack mobile emergency cleanup",
      category: "conversion",
      summary: "Réduire les frictions mobiles les plus urgentes sur les pages clés.",
      difficulty: "medium",
      impactExpected: "critical",
      estimatedTime: "1 à 3 jours",
      previewItems: ["Speed", "CTA", "Header", "Contact", "UX"],
    },
    {
      key: "end_of_trial_wins",
      name: "Pack end-of-trial wins",
      category: "ops",
      summary: "Sortir les meilleurs gains visibles avant la fin de l’essai.",
      difficulty: "low",
      impactExpected: "high",
      estimatedTime: "1 à 2 jours",
      previewItems: ["Quick wins", "Report", "Proof", "Cleanup", "Next steps"],
    },
    {
      key: "monthly_growth_sprint",
      name: "Pack monthly growth sprint",
      category: "ops",
      summary: "Structurer un sprint mensuel SEO / local / conversion / monitoring.",
      difficulty: "medium",
      impactExpected: "high",
      estimatedTime: "1 mois",
      previewItems: ["Backlog", "Priorités", "KPIs", "Calendar", "Review"],
    },
    {
      key: "map_trust_signals",
      name: "Pack map trust signals",
      category: "local",
      summary: "Améliorer la crédibilité locale autour de la page contact et des pages géographiques.",
      difficulty: "low",
      impactExpected: "medium",
      estimatedTime: "1 jour",
      previewItems: ["Map block", "NAP", "Horaires", "Directions", "Zone coverage"],
    },
  ];
}

const MISSION_LIBRARY = generateMissionLibrary();
const PACK_LIBRARY = generatePackLibrary();

// ---------- HELPERS ----------

function lowerText(v) {
  return String(v || "").toLowerCase();
}

function uniqueStrings(arr) {
  return [...new Set((arr || []).map((x) => String(x || "").trim()).filter(Boolean))];
}

function capText(str) {
  const s = String(str || "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pushTimeline(orgId, userId, type, entityType, entityId, title, message, metadata = {}) {
  return TimelineEvent.create({
    orgId,
    userId,
    type,
    entityType,
    entityId,
    title,
    message,
    metadata,
  }).catch(() => null);
}

function inferSectorFromUser(user) {
  const source = lowerText(user?.companyName || "");
  if (source.includes("garage") || source.includes("auto") || source.includes("car")) return "garage";
  if (source.includes("restaurant") || source.includes("snack") || source.includes("pizza")) return "restaurant";
  if (source.includes("immo")) return "immobilier";
  if (source.includes("beaut") || source.includes("salon")) return "beaute";
  if (source.includes("law") || source.includes("avocat") || source.includes("legal")) return "juridique";
  if (source.includes("agency") || source.includes("agence")) return "agence";
  if (source.includes("shop") || source.includes("store") || source.includes("boutique")) return "ecommerce";
  if (source.includes("saas") || source.includes("software")) return "saas";
  if (source.includes("artisan") || source.includes("plomb") || source.includes("chauff")) return "artisan";
  return "independant";
}

function inferPlanFeatures(plan) {
  const p = lowerText(plan);
  return {
    standard: p === "standard",
    pro: p === "pro" || p === "ultra",
    ultra: p === "ultra",
  };
}

function inferSiteProfileFromAudits(audits, fallbackUrl = "") {
  const urls = uniqueStrings((audits || []).map((a) => a.url).filter(Boolean));
  const host = (() => {
    try {
      return urls[0] ? new URL(urls[0]).host : (fallbackUrl ? new URL(fallbackUrl).host : "");
    } catch {
      return "";
    }
  })();

  const pageUrls = urls.map((u) => {
    try {
      return new URL(u).pathname || "/";
    } catch {
      return "/";
    }
  });

  const hasContact = pageUrls.some((p) => /contact|devis|quote|book|booking/i.test(p));
  const hasServicePages = pageUrls.some((p) => /service|services|prestations|solutions/i.test(p));
  const hasCityPages = pageUrls.some((p) => FP_CITIES.some((city) => lowerText(p).includes(lowerText(city))));
  const hasPricing = pageUrls.some((p) => /pricing|tarif|tarifs|price/i.test(p));

  return {
    host,
    urls,
    pageUrls,
    hasContact,
    hasServicePages,
    hasCityPages,
    hasPricing,
  };
}

function inferMaturity(audits) {
  const scores = (audits || []).map((a) => Number(a.score || 0)).filter(Number.isFinite);
  const avg = scores.length ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length) : 0;

  if (avg < 40) return "site_tres_faible";
  if (avg < 60) return "site_moyen";
  if (avg < 75) return "site_deja_solide";
  return "site_techniquement_solide";
}

function calcConversionReadiness(siteProfile, audits, monitors) {
  const latest = [...(audits || [])].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0];
  const findings = latest?.findings || {};

  let score = 50;

  if (siteProfile.hasContact) score += 10;
  if (siteProfile.hasServicePages) score += 8;
  if (siteProfile.hasPricing) score += 5;
  if (findings.viewport?.ok) score += 8;
  if (findings.responseTime?.ok) score += 8;
  if (findings.og?.ok) score += 4;
  if (findings.metaDescription?.ok) score += 4;
  if ((monitors || []).some((m) => lowerText(m.url).includes("contact"))) score += 3;

  return Math.max(0, Math.min(100, Math.round(score)));
}

function calcUptimeHealth(monitors, monitorLogs) {
  if (!monitors.length) return 60;

  const down = monitors.filter((m) => m.lastStatus === "down").length;
  const total = monitors.length;
  let score = Math.round(((total - down) / Math.max(1, total)) * 100);

  const latestLogs = (monitorLogs || []).slice(-30);
  const upChecks = latestLogs.filter((l) => l.status === "up").length;
  if (latestLogs.length) {
    score = Math.round((score + Math.round((upChecks / latestLogs.length) * 100)) / 2);
  }

  return Math.max(0, Math.min(100, score));
}

function calcExecutionMomentum(missions) {
  const total = missions.length;
  if (!total) return 40;

  const done = missions.filter((m) => m.status === "done").length;
  const recentDone = missions.filter((m) => m.completedAt && new Date(m.completedAt).getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000).length;
  const automated = missions.filter((m) => m.isAutomated).length;

  let score = Math.round((done / total) * 70);
  score += Math.min(20, recentDone * 4);
  score += Math.min(10, automated >= 3 ? 10 : automated * 2);

  return Math.max(0, Math.min(100, score));
}

function calcLocalDominance(siteProfile, localIssuesCount, localMissionCount) {
  let score = 35;
  if (siteProfile.hasCityPages) score += 20;
  if (siteProfile.hasContact) score += 10;
  score += Math.min(20, localMissionCount * 2);
  score -= Math.min(20, localIssuesCount * 3);
  return Math.max(0, Math.min(100, score));
}

function calcClientReadiness(missions, notes, reportsLikeCount) {
  const done = missions.filter((m) => m.status === "done").length;
  const clientNotes = notes.filter((n) => n.type === "client").length;
  let score = 35 + Math.min(25, done * 2) + Math.min(20, clientNotes * 3) + Math.min(20, reportsLikeCount * 5);
  return Math.max(0, Math.min(100, score));
}

function calcLeadRiskScore(conversionReadiness, uptimeHealth, criticalIssues) {
  let score = 100 - Math.round((conversionReadiness + uptimeHealth) / 2);
  score += Math.min(20, criticalIssues * 4);
  return Math.max(0, Math.min(100, score));
}

function calcRevenueProxyImpact(opportunities, executionMomentum) {
  const opp = opportunities.reduce((sum, o) => sum + Number(o.score || 0), 0);
  let score = Math.round(Math.min(100, opp / Math.max(1, opportunities.length || 1)));
  score = Math.round((score + executionMomentum) / 2);
  return Math.max(0, Math.min(100, score));
}

function classifyPageType(url) {
  const p = lowerText(url);
  if (/contact|devis|quote|booking|book/.test(p)) return "contact";
  if (/service|services|prestations|solutions/.test(p)) return "service";
  if (/pricing|tarif|price/.test(p)) return "pricing";
  if (/faq/.test(p)) return "faq";
  if (/about|a-propos|apropos/.test(p)) return "about";
  if (/product|produit/.test(p)) return "product";
  if (/landing/.test(p)) return "landing";
  if (p === "/" || p === "") return "homepage";
  return "generic";
}

function buildIssuePayload({ orgId, userId, sourceType, sourceId, type, pageUrl, siteUrl, sector, pageType, metadata = {} }) {
  const def = ISSUE_LIBRARY[type];
  if (!def) return null;

  return {
    orgId,
    userId,
    sourceType,
    sourceId,
    type,
    title: def.title,
    description: `${def.title} détecté sur ${pageUrl || siteUrl || "le site"}.`,
    category: def.category,
    severity: def.severity,
    impactBusiness: def.impactBusiness,
    priorityScore: def.baseScore,
    pageUrl: pageUrl || "",
    siteUrl: siteUrl || "",
    sector: sector || "",
    pageType: pageType || "",
    recommendationKey: def.recommendationKey,
    missionTemplateKey: def.missionTemplateKey,
    packKey: def.packKey,
    status: "open",
    metadata,
  };
}

function buildIssuesFromAudit(audit, siteProfile, sector) {
  const findings = audit?.findings || {};
  const pageType = classifyPageType(audit?.url || "");
  const items = [];

  if (!findings.title?.ok) items.push("missing_title");
  else if (String(findings.title?.value || "").length < 20) items.push("weak_title");

  if (!findings.metaDescription?.ok) items.push("missing_meta_description");
  if (!findings.h1?.ok) items.push("missing_h1");
  if (!findings.responseTime?.ok) items.push("slow_mobile");
  if (!findings.canonical?.ok || !findings.robots?.ok) items.push("duplicate_structure");
  if (!findings.og?.ok) items.push("weak_trust_signals");
  if (!findings.viewport?.ok) items.push("weak_cta");
  if (audit?.score != null && Number(audit.score) < 55) items.push("low_content_depth");

  if (!siteProfile.hasContact) items.push("weak_contact_visibility");
  if (!siteProfile.hasCityPages) items.push("no_local_pages");
  if (!siteProfile.hasContact) items.push("missing_google_map_block");

  return uniqueStrings(items)
    .map((type) =>
      buildIssuePayload({
        orgId: audit.orgId,
        userId: audit.userId,
        sourceType: "audit",
        sourceId: audit._id,
        type,
        pageUrl: audit.url,
        siteUrl: audit.url,
        sector,
        pageType,
        metadata: {
          score: audit.score,
          summary: audit.summary,
        },
      })
    )
    .filter(Boolean);
}

function buildIssuesFromMonitor(monitor, sector) {
  if (!monitor || monitor.lastStatus !== "down") return [];

  const pageType = classifyPageType(monitor.url);

  return [
    buildIssuePayload({
      orgId: monitor.orgId,
      userId: monitor.userId,
      sourceType: "monitor",
      sourceId: monitor._id,
      type: "page_not_monitored",
      pageUrl: monitor.url,
      siteUrl: monitor.url,
      sector,
      pageType,
      metadata: {
        lastStatus: monitor.lastStatus,
        lastCheckedAt: monitor.lastCheckedAt,
      },
    }),
  ].filter(Boolean);
}

function buildRecommendations({ issues, sector, siteProfile, maturity, planFeatures, history }) {
  const out = [];

  const hasType = (type) => issues.some((i) => i.type === type);
  const countCategory = (cat) => issues.filter((i) => i.category === cat).length;

  if (hasType("slow_mobile")) {
    out.push({
      type: "quick_win",
      title: "Le site semble trop faible sur mobile",
      text: "La performance mobile freine à la fois visibilité et conversion. Un pack mobile prioritaire est recommandé.",
      category: "conversion",
      score: 92,
    });
  }

  if (hasType("no_local_pages")) {
    out.push({
      type: "local_opportunity",
      title: "Le site est sous-exploité localement",
      text: "Les pages service sont présentes ou implicites, mais la couverture ville / zone reste insuffisante.",
      category: "local",
      score: 88,
    });
  }

  if (hasType("weak_contact_visibility")) {
    out.push({
      type: "business_opportunity",
      title: "Le contact business est trop peu visible",
      text: "Le site semble risquer de perdre des leads sur les pages à enjeu commercial.",
      category: "conversion",
      score: 84,
    });
  }

  if (countCategory("seo") >= 3) {
    out.push({
      type: "strategic",
      title: "Le socle SEO a besoin d’un cleanup structuré",
      text: "Plusieurs signaux techniques ou sémantiques méritent une exécution groupée au lieu de corrections isolées.",
      category: "seo",
      score: 79,
    });
  }

  if (maturity === "site_tres_faible") {
    out.push({
      type: "urgency",
      title: "Le site demande une remise à niveau prioritaire",
      text: "Les fondations SEO / conversion ne sont pas encore assez solides pour une croissance stable.",
      category: "ops",
      score: 90,
    });
  }

  if (sector === "garage" || sector === "artisan" || sector === "independant") {
    out.push({
      type: "local_opportunity",
      title: "Le secteur se prête fortement au Local SEO",
      text: "Un déploiement villes + contact + map + preuves locales peut créer un effet visible rapidement.",
      category: "local",
      score: 85,
    });
  }

  if (planFeatures.ultra) {
    out.push({
      type: "strategic",
      title: "Le plan Ultra permet une logique portefeuille",
      text: "Les recommandations peuvent être transformées en workflows, calendrier, team threads et plan mensuel.",
      category: "ops",
      score: 75,
    });
  } else if (planFeatures.pro) {
    out.push({
      type: "strategic",
      title: "Le plan Pro peut accélérer l’exécution",
      text: "Des packs plus riches et des recommandations regroupées peuvent rendre la progression plus visible.",
      category: "ops",
      score: 68,
    });
  }

  if ((history?.ignoredIssueTypes || []).includes("no_local_pages")) {
    out.push({
      type: "history_signal",
      title: "Le local revient comme sujet récurrent",
      text: "Les signaux locaux ont déjà été laissés de côté, ce qui peut ralentir la progression visible.",
      category: "local",
      score: 72,
    });
  }

  return out.sort((a, b) => b.score - a.score);
}

function createMissionFromIssue(issue, user) {
  const priority =
    issue.severity === "critical" ? "critical"
      : issue.severity === "high" ? "high"
      : issue.severity === "medium" ? "medium"
      : "low";

  const impact =
    issue.impactBusiness === "critical" ? "critical"
      : issue.impactBusiness === "high" ? "high"
      : issue.impactBusiness === "medium" ? "medium"
      : "low";

  const isQuickWin = ["missing_meta_description", "missing_h1", "weak_title", "missing_google_map_block"].includes(issue.type);

  return {
    orgId: user.orgId,
    userId: user._id,
    title: issue.title,
    description: issue.description,
    category: issue.category,
    sourceType: issue.sourceType,
    sourceId: issue.sourceId,
    priority,
    impact,
    status: "todo",
    pageUrl: issue.pageUrl,
    siteUrl: issue.siteUrl,
    sector: issue.sector,
    pageType: issue.pageType,
    isAutomated: true,
    isQuickWin,
    tags: uniqueStrings([issue.type, issue.category, issue.packKey, issue.recommendationKey]),
  };
}

function createPackMissions(pack, context, user) {
  const siteUrl = context?.siteUrl || "";
  const sector = context?.sector || "";
  const targetCities = context?.targetCities || [];

  const items = [];

  const add = (title, description, category, priority = "medium", impact = "medium", pageType = "") => {
    items.push({
      orgId: user.orgId,
      userId: user._id,
      title,
      description,
      category,
      sourceType: "system",
      priority,
      impact,
      status: "todo",
      pageUrl: "",
      siteUrl,
      sector,
      pageType,
      isAutomated: true,
      isQuickWin: false,
      tags: uniqueStrings([pack.key, category, sector, pageType]),
    });
  };

  if (pack.key === "seo_technical_recovery") {
    add("Corriger les titles clés", "Renforcer les balises title sur les pages principales.", "seo", "high", "high", "homepage");
    add("Ajouter les meta descriptions manquantes", "Rendre les snippets plus forts et plus cliquables.", "seo", "high", "high", "service");
    add("Revoir la hiérarchie H1 / headings", "Assainir la structure des pages critiques.", "content", "high", "high", "service");
    add("Ajouter les données structurées pertinentes", "Améliorer le contexte sémantique.", "seo", "medium", "medium", "homepage");
  }

  if (pack.key === "homepage_conversion_lift") {
    add("Renforcer le hero principal", "Clarifier la proposition de valeur et le bénéfice immédiat.", "conversion", "high", "high", "homepage");
    add("Renforcer les CTA homepage", "Rendre l’action principale plus visible.", "conversion", "high", "high", "homepage");
    add("Ajouter preuves / trust signals", "Améliorer la confiance sur les premières secondes.", "conversion", "medium", "high", "homepage");
  }

  if (pack.key === "local_city_expansion") {
    const cities = targetCities.length ? targetCities : ["Liège", "Verviers", "Bruxelles"];
    for (const city of cities.slice(0, 5)) {
      add(`Créer une page locale ${city}`, `Déployer une page ciblée pour ${city}.`, "local", "high", "high", "city");
    }
    add("Ajouter signaux locaux sur la page contact", "Renforcer la cohérence locale et la conversion.", "local", "medium", "high", "contact");
  }

  if (pack.key === "trust_and_conversion") {
    add("Ajouter bloc avis / preuves", "Renforcer la confiance perçue.", "conversion", "medium", "high", "homepage");
    add("Rendre le contact plus visible", "Réduire la friction sur les pages business.", "conversion", "high", "critical", "contact");
    add("Ajouter FAQ de réassurance", "Lever les doutes avant prise de contact.", "content", "medium", "medium", "faq");
  }

  if (pack.key === "critical_pages_monitoring") {
    add("Créer monitor sur homepage", "Surveiller la page la plus exposée.", "monitor", "high", "high", "homepage");
    add("Créer monitor sur contact", "Protéger la page de conversion la plus sensible.", "monitor", "high", "critical", "contact");
    add("Créer monitor sur service principal", "Sécuriser la page business principale.", "monitor", "medium", "high", "service");
  }

  if (pack.key === "service_pages_authority") {
    add("Étendre la profondeur de contenu des pages service", "Améliorer utilité, clarté et autorité.", "content", "high", "high", "service");
    add("Ajouter FAQ et preuves par service", "Renforcer la différenciation et la conversion.", "content", "medium", "high", "service");
    add("Structurer intent / bénéfices / CTA", "Rendre chaque page service plus convaincante.", "conversion", "medium", "high", "service");
  }

  if (pack.key === "mobile_emergency_cleanup") {
    add("Réduire la friction mobile critique", "Cibler les blocages les plus visibles sur mobile.", "conversion", "critical", "critical", "homepage");
    add("Alléger les points lourds des pages clés", "Améliorer vitesse et expérience mobile.", "seo", "high", "high", "service");
  }

  if (pack.key === "end_of_trial_wins") {
    add("Sortir les 3 quick wins les plus visibles", "Mettre en avant de la progression avant fin d’essai.", "ops", "high", "high");
    add("Préparer un mini rapport de valeur", "Montrer ce qui a été débloqué et ce qui reste.", "reporting", "medium", "high");
    add("Créer le prochain sprint prioritaire", "Rendre la continuité naturelle après le trial.", "ops", "high", "high");
  }

  if (pack.key === "monthly_growth_sprint") {
    add("Fixer les priorités du mois", "Structurer les missions du prochain cycle.", "ops", "high", "high");
    add("Planifier revue audits / monitors", "Créer les événements calendrier pertinents.", "ops", "medium", "medium");
    add("Préparer restitution mensuelle", "Faciliter la lecture client et la valeur perçue.", "reporting", "medium", "high");
  }

  if (pack.key === "map_trust_signals") {
    add("Ajouter carte Google sur contact", "Améliorer confiance et repères locaux.", "local", "medium", "medium", "contact");
    add("Afficher horaires / téléphone / itinéraire", "Rendre la page contact plus complète.", "local", "medium", "high", "contact");
    add("Renforcer les preuves locales", "Ancrer la crédibilité territoriale.", "local", "medium", "medium", "contact");
  }

  return items;
}

function buildLocalOpportunities(siteProfile, sector) {
  const uncoveredCities = FP_CITIES.filter((city) => {
    return !siteProfile.pageUrls.some((p) => lowerText(p).includes(lowerText(city)));
  }).slice(0, 6);

  return uncoveredCities.map((city, idx) => ({
    city,
    type: "city_expansion",
    label: `${city} n’est pas encore couverte`,
    score: 90 - idx * 5,
    sector,
  }));
}

function buildRiskEngine({ issues, monitors, siteProfile, missions }) {
  const openIssues = issues.filter((i) => i.status === "open");
  const criticalIssues = openIssues.filter((i) => i.severity === "critical" || i.impactBusiness === "critical");
  const downMonitors = monitors.filter((m) => m.lastStatus === "down");
  const pagesBusinessWithoutMonitor = siteProfile.hasContact && !monitors.some((m) => lowerText(m.url).includes("contact")) ? 1 : 0;
  const localDeficit = siteProfile.hasCityPages ? 0 : 1;
  const weakExecution = missions.length ? missions.filter((m) => m.status !== "done").length > missions.filter((m) => m.status === "done").length * 2 : true;

  return {
    criticalPagesUnhandled: criticalIssues.length,
    monitorsDownUnhandled: downMonitors.length,
    pagesBusinessWithoutMonitor,
    localCoverageDeficit: localDeficit,
    weakExecution: weakExecution ? 1 : 0,
    currentRiskLevel:
      downMonitors.length > 0 || criticalIssues.length >= 3 ? "high"
        : criticalIssues.length > 0 ? "medium"
        : "low",
  };
}

function buildOpportunityEngine({ recommendations, localOpportunities, issues }) {
  const out = [];

  for (const r of recommendations.slice(0, 6)) {
    out.push({
      type: r.category,
      label: r.title,
      score: r.score,
    });
  }

  for (const loc of localOpportunities.slice(0, 4)) {
    out.push({
      type: "local",
      label: loc.label,
      score: loc.score,
    });
  }

  if (issues.some((i) => i.type === "weak_cta")) {
    out.push({
      type: "conversion",
      label: "Les CTA peuvent être renforcés sur les pages business",
      score: 82,
    });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 10);
}

function buildOverviewNarrative({ seoScore, localDominanceScore, uptimeHealth, conversionReadiness, riskEngine, opportunityEngine }) {
  const parts = [];

  if (seoScore >= 70 && localDominanceScore < 55) {
    parts.push("Le site est relativement stable techniquement mais reste sous-exploité localement.");
  } else if (seoScore < 60) {
    parts.push("Le site demande encore un renforcement SEO clair avant de viser une progression plus visible.");
  } else {
    parts.push("Le site a une base correcte mais plusieurs leviers visibles restent sous-exploités.");
  }

  if (conversionReadiness < 60) {
    parts.push("La couche conversion semble trop faible pour capter tout le potentiel du trafic.");
  }

  if (riskEngine.monitorsDownUnhandled > 0) {
    parts.push(`${riskEngine.monitorsDownUnhandled} incident(s) monitor peuvent menacer des pages à enjeu business.`);
  }

  if (opportunityEngine.length) {
    parts.push(`${Math.min(3, opportunityEngine.length)} opportunité(s) peuvent améliorer visibilité et exécution rapidement.`);
  }

  return parts.join(" ");
}

function buildTrialRetentionBlock({ missions, opportunities, plan }) {
  const pending = missions.filter((m) => m.status !== "done").length;
  const quickWins = missions.filter((m) => m.isQuickWin && m.status !== "done").length;

  return {
    progressionUnlocked: missions.filter((m) => m.status === "done").length,
    missionsReady: pending,
    packsAvailable: PACK_LIBRARY.length,
    potentialStillOpen: opportunities.length,
    whatYouLoseIfYouStop:
      plan === "ultra"
        ? "La génération proactive, la logique portefeuille et les workflows reliés."
        : plan === "pro"
          ? "Les packs riches, les recommandations regroupées et les analytics avancés."
          : "La continuité d’exécution, les quick wins et la progression structurée.",
    quickWinsRemaining: quickWins,
  };
}

function buildMonthlyOperatingSystem({ missions, calendarEvents }) {
  const todo = missions.filter((m) => m.status !== "done").length;
  const done = missions.filter((m) => m.status === "done").length;
  const nextEvents = [...calendarEvents]
    .filter((e) => e.startAt && new Date(e.startAt).getTime() >= Date.now())
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))
    .slice(0, 5);

  return {
    todo,
    done,
    remaining: todo,
    nextPriorities: missions
      .filter((m) => m.status !== "done")
      .sort((a, b) => {
        const rank = { critical: 4, high: 3, medium: 2, low: 1 };
        return (rank[b.priority] || 0) - (rank[a.priority] || 0);
      })
      .slice(0, 5)
      .map((m) => m.title),
    nextEvents: nextEvents.map((e) => ({
      title: e.title,
      startAt: e.startAt,
      type: e.type,
      priority: e.priority,
    })),
  };
}

async function getUserEngineContext(user, org, days = 30) {
  const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);

  const [audits, monitors, monitorLogs, missions, notes, calendarEvents] = await Promise.all([
    Audit.find({ orgId: user.orgId }).sort({ createdAt: -1 }).limit(250),
    Monitor.find({ orgId: user.orgId }).sort({ createdAt: -1 }).limit(200),
    MonitorLog.find({ orgId: user.orgId, checkedAt: { $gte: since } }).sort({ checkedAt: 1 }).limit(800),
    Mission.find({ orgId: user.orgId }).sort({ createdAt: -1 }).limit(500),
    Note.find({ orgId: user.orgId }).sort({ createdAt: -1 }).limit(200),
    CalendarEvent.find({ orgId: user.orgId }).sort({ startAt: 1 }).limit(300),
  ]);

  const sector = inferSectorFromUser(user);
  const siteProfile = inferSiteProfileFromAudits(audits);
  const maturity = inferMaturity(audits);
  const planFeatures = inferPlanFeatures(user.plan);

  const existingIssues = await Issue.find({ orgId: user.orgId }).sort({ createdAt: -1 }).limit(500);
  const ignoredIssueTypes = existingIssues.filter((i) => i.status === "ignored").map((i) => i.type);

  return {
    org,
    user,
    sector,
    siteProfile,
    maturity,
    planFeatures,
    audits,
    monitors,
    monitorLogs,
    missions,
    notes,
    calendarEvents,
    existingIssues,
    history: { ignoredIssueTypes },
  };
}

// ---------- SEED / SYNC ENGINE ----------

async function syncIssuesForOrg(user, org) {
  const ctx = await getUserEngineContext(user, org, 30);

  const generated = [];

  for (const audit of ctx.audits.slice(0, 80)) {
    const issues = buildIssuesFromAudit(audit, ctx.siteProfile, ctx.sector);
    generated.push(...issues);
  }

  for (const monitor of ctx.monitors.slice(0, 60)) {
    const issues = buildIssuesFromMonitor(monitor, ctx.sector);
    generated.push(...issues);
  }

  const dedupeKey = (i) => [
    String(i.orgId || ""),
    i.sourceType,
    String(i.sourceId || ""),
    i.type,
    i.pageUrl || "",
  ].join("::");

  const existing = await Issue.find({ orgId: user.orgId }).select("sourceType sourceId type pageUrl orgId");
  const existingKeys = new Set(existing.map(dedupeKey));

  const toInsert = generated.filter((i) => !existingKeys.has(dedupeKey(i)));

  if (toInsert.length) {
    await Issue.insertMany(toInsert, { ordered: false }).catch(() => {});
    await pushTimeline(
      user.orgId,
      user._id,
      "issues_synced",
      "issue",
      null,
      "Issues synchronisées",
      `${toInsert.length} nouvelle(s) issue(s) ajoutée(s).`,
      { count: toInsert.length }
    );
  }

  return {
    inserted: toInsert.length,
    totalGenerated: generated.length,
  };
}

async function generateMissionsFromOpenIssues(user) {
  const openIssues = await Issue.find({
    orgId: user.orgId,
    status: "open",
  }).sort({ priorityScore: -1, createdAt: -1 }).limit(120);

  const existingMissions = await Mission.find({ orgId: user.orgId }).select("sourceType sourceId title");
  const existingKeys = new Set(
    existingMissions.map((m) => [m.sourceType, String(m.sourceId || ""), m.title].join("::"))
  );

  const toCreate = [];

  for (const issue of openIssues) {
    const mission = createMissionFromIssue(issue, user);
    const k = [mission.sourceType, String(mission.sourceId || ""), mission.title].join("::");
    if (!existingKeys.has(k)) {
      toCreate.push(mission);
      existingKeys.add(k);
    }
  }

  if (toCreate.length) {
    const created = await Mission.insertMany(toCreate, { ordered: false }).catch(() => []);
    await pushTimeline(
      user.orgId,
      user._id,
      "missions_generated_from_issues",
      "mission",
      null,
      "Missions générées",
      `${created.length} mission(s) générée(s) depuis les issues ouvertes.`,
      { count: created.length }
    );
    return created;
  }

  return [];
}

// ---------- ROUTES: LIBRARIES ----------

app.get("/api/engine/libraries", auth, requireActive, async (req, res) => {
  const sector = inferSectorFromUser(req.dbUser);
  const planFeatures = inferPlanFeatures(req.dbUser.plan);

  return res.json({
    ok: true,
    libraries: {
      missions: MISSION_LIBRARY,
      issues: ISSUE_LIBRARY,
      packs: PACK_LIBRARY,
      sectors: FP_SECTORS,
      pageTypes: FP_PAGE_TYPES,
      cities: FP_CITIES,
    },
    personalization: {
      sector,
      plan: req.dbUser.plan,
      features: planFeatures,
    },
  });
});

// ---------- ROUTES: ISSUES ----------

app.post("/api/issues/sync", auth, requireActive, async (req, res) => {
  const out = await syncIssuesForOrg(req.dbUser, req.dbOrg);
  return res.json({ ok: true, ...out });
});

app.get("/api/issues", auth, requireActive, async (req, res) => {
  const status = String(req.query.status || "").trim();
  const category = String(req.query.category || "").trim();

  const q = { orgId: req.dbUser.orgId };
  if (status) q.status = status;
  if (category) q.category = category;

  const issues = await Issue.find(q).sort({ priorityScore: -1, createdAt: -1 }).limit(300);
  return res.json({ ok: true, issues });
});

app.patch("/api/issues/:id", auth, requireActive, async (req, res) => {
  const issue = await Issue.findOne({
    _id: req.params.id,
    orgId: req.dbUser.orgId,
  });

  if (!issue) return res.status(404).json({ error: "Issue introuvable" });

  if (req.body?.status) issue.status = req.body.status;
  await issue.save();

  await pushTimeline(
    req.dbUser.orgId,
    req.dbUser._id,
    "issue_updated",
    "issue",
    issue._id,
    issue.title,
    `Issue mise à jour (${issue.status}).`,
    { status: issue.status }
  );

  return res.json({ ok: true, issue });
});

// ---------- ROUTES: MISSIONS ----------

app.get("/api/missions", auth, requireActive, async (req, res) => {
  const status = String(req.query.status || "").trim();
  const category = String(req.query.category || "").trim();
  const sourceType = String(req.query.sourceType || "").trim();

  const q = { orgId: req.dbUser.orgId };
  if (status) q.status = status;
  if (category) q.category = category;
  if (sourceType) q.sourceType = sourceType;

  const missions = await Mission.find(q).sort({ createdAt: -1 }).limit(500);
  return res.json({ ok: true, missions });
});

app.post("/api/missions", auth, requireActive, async (req, res) => {
  const body = req.body || {};
  if (!String(body.title || "").trim()) {
    return res.status(400).json({ error: "Titre requis" });
  }

  const mission = await Mission.create({
    orgId: req.dbUser.orgId,
    userId: req.dbUser._id,
    title: String(body.title || "").trim(),
    description: String(body.description || "").trim(),
    category: body.category || "ops",
    sourceType: body.sourceType || "manual",
    sourceId: body.sourceId || undefined,
    priority: body.priority || "medium",
    impact: body.impact || "medium",
    status: body.status || "todo",
    pageUrl: body.pageUrl || "",
    siteUrl: body.siteUrl || "",
    dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
    assignedToUserId: body.assignedToUserId || undefined,
    isAutomated: !!body.isAutomated,
    isQuickWin: !!body.isQuickWin,
    tags: Array.isArray(body.tags) ? body.tags : [],
  });

  await pushTimeline(
    req.dbUser.orgId,
    req.dbUser._id,
    "mission_created",
    "mission",
    mission._id,
    mission.title,
    "Mission créée.",
    { category: mission.category, priority: mission.priority }
  );

  return res.json({ ok: true, mission });
});

app.patch("/api/missions/:id", auth, requireActive, async (req, res) => {
  const mission = await Mission.findOne({
    _id: req.params.id,
    orgId: req.dbUser.orgId,
  });

  if (!mission) return res.status(404).json({ error: "Mission introuvable" });

  const prevStatus = mission.status;

  const allowed = [
    "title",
    "description",
    "category",
    "priority",
    "impact",
    "status",
    "pageUrl",
    "siteUrl",
    "dueDate",
    "assignedToUserId",
    "isQuickWin",
    "tags",
  ];

  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
      mission[key] = req.body[key];
    }
  }

  if (req.body?.status === "done" && prevStatus !== "done") {
    mission.completedAt = new Date();
  }

  await mission.save();

  await pushTimeline(
    req.dbUser.orgId,
    req.dbUser._id,
    "mission_updated",
    "mission",
    mission._id,
    mission.title,
    `Mission mise à jour (${mission.status}).`,
    { prevStatus, nextStatus: mission.status }
  );

  return res.json({ ok: true, mission });
});

app.delete("/api/missions/:id", auth, requireActive, async (req, res) => {
  const mission = await Mission.findOne({
    _id: req.params.id,
    orgId: req.dbUser.orgId,
  });

  if (!mission) return res.status(404).json({ error: "Mission introuvable" });

  await Mission.deleteOne({ _id: mission._id });

  await pushTimeline(
    req.dbUser.orgId,
    req.dbUser._id,
    "mission_deleted",
    "mission",
    mission._id,
    mission.title,
    "Mission supprimée."
  );

  return res.json({ ok: true });
});

app.post("/api/missions/generate-from-issues", auth, requireActive, async (req, res) => {
  const created = await generateMissionsFromOpenIssues(req.dbUser);
  return res.json({ ok: true, createdCount: created.length, missions: created });
});

app.post("/api/missions/generate-pack", auth, requireActive, async (req, res) => {
  const packKey = String(req.body?.packKey || "").trim();
  const pack = PACK_LIBRARY.find((p) => p.key === packKey);
  if (!pack) return res.status(404).json({ error: "Pack introuvable" });

  const ctx = await getUserEngineContext(req.dbUser, req.dbOrg, 30);
  const localOpportunities = buildLocalOpportunities(ctx.siteProfile, ctx.sector);
  const targetCities = localOpportunities.map((x) => x.city).slice(0, 5);

  const missionsPayload = createPackMissions(pack, {
    sector: ctx.sector,
    siteUrl: ctx.siteProfile.urls[0] || "",
    targetCities,
  }, req.dbUser);

  const created = missionsPayload.length
    ? await Mission.insertMany(missionsPayload, { ordered: false }).catch(() => [])
    : [];

  const packRun = await PackRun.create({
    orgId: req.dbUser.orgId,
    userId: req.dbUser._id,
    packKey: pack.key,
    name: pack.name,
    category: pack.category,
    summary: pack.summary,
    sourceType: "system",
    impactExpected: pack.impactExpected,
    difficulty: pack.difficulty,
    estimatedTime: pack.estimatedTime,
    previewItems: pack.previewItems,
    createdMissionIds: created.map((m) => m._id),
  });

  await pushTimeline(
    req.dbUser.orgId,
    req.dbUser._id,
    "pack_generated",
    "pack",
    packRun._id,
    pack.name,
    `${created.length} mission(s) créées depuis le pack.`,
    { packKey: pack.key, createdCount: created.length }
  );

  return res.json({ ok: true, packRun, createdCount: created.length, missions: created });
});

app.get("/api/missions/stats", auth, requireActive, async (req, res) => {
  const missions = await Mission.find({ orgId: req.dbUser.orgId }).limit(1000);

  const stats = {
    total: missions.length,
    todo: missions.filter((m) => m.status === "todo").length,
    inProgress: missions.filter((m) => m.status === "in_progress").length,
    blocked: missions.filter((m) => m.status === "blocked").length,
    done: missions.filter((m) => m.status === "done").length,
    critical: missions.filter((m) => m.priority === "critical" || m.impact === "critical").length,
    automated: missions.filter((m) => m.isAutomated).length,
    quickWins: missions.filter((m) => m.isQuickWin).length,
    byCategory: {
      seo: missions.filter((m) => m.category === "seo").length,
      content: missions.filter((m) => m.category === "content").length,
      local: missions.filter((m) => m.category === "local").length,
      conversion: missions.filter((m) => m.category === "conversion").length,
      monitor: missions.filter((m) => m.category === "monitor").length,
      reporting: missions.filter((m) => m.category === "reporting").length,
      ops: missions.filter((m) => m.category === "ops").length,
      team: missions.filter((m) => m.category === "team").length,
    },
    bySource: {
      manual: missions.filter((m) => m.sourceType === "manual").length,
      audit: missions.filter((m) => m.sourceType === "audit").length,
      monitor: missions.filter((m) => m.sourceType === "monitor").length,
      system: missions.filter((m) => m.sourceType === "system").length,
      local: missions.filter((m) => m.sourceType === "local").length,
      team: missions.filter((m) => m.sourceType === "team").length,
    },
  };

  return res.json({ ok: true, stats });
});

// ---------- ROUTES: LOCAL / MAPS ----------

app.get("/api/local/summary", auth, requireActive, async (req, res) => {
  const ctx = await getUserEngineContext(req.dbUser, req.dbOrg, 30);

  const localIssues = ctx.existingIssues.filter((i) => i.category === "local" && i.status === "open");
  const localMissions = ctx.missions.filter((m) => m.category === "local");
  const opportunities = buildLocalOpportunities(ctx.siteProfile, ctx.sector);

  return res.json({
    ok: true,
    local: {
      sector: ctx.sector,
      host: ctx.siteProfile.host,
      hasCityPages: ctx.siteProfile.hasCityPages,
      hasContact: ctx.siteProfile.hasContact,
      coveredCities: FP_CITIES.filter((city) =>
        ctx.siteProfile.pageUrls.some((p) => lowerText(p).includes(lowerText(city)))
      ),
      uncoveredCities: opportunities.map((o) => o.city),
      localIssuesCount: localIssues.length,
      localMissionCount: localMissions.length,
      opportunities,
      zones: FP_CITIES.map((city) => ({
        city,
        covered: ctx.siteProfile.pageUrls.some((p) => lowerText(p).includes(lowerText(city))),
      })),
      mapReadiness: {
        hasGoogleMapBlockIssue: localIssues.some((i) => i.type === "missing_google_map_block"),
        hasNearbyCoverageGap: opportunities.length > 0,
      },
    },
  });
});

// ---------- ROUTES: TEAM DISCUSSION ----------

app.get("/api/team/threads", auth, requireActive, async (req, res) => {
  const threads = await TeamThread.find({ orgId: req.dbUser.orgId })
    .sort({ lastActivityAt: -1 })
    .limit(200);

  return res.json({ ok: true, threads });
});

app.post("/api/team/threads", auth, requireActive, async (req, res) => {
  const title = String(req.body?.title || "").trim();
  if (!title) return res.status(400).json({ error: "Titre requis" });

  const thread = await TeamThread.create({
    orgId: req.dbUser.orgId,
    contextType: req.body?.contextType || "general",
    contextId: req.body?.contextId || undefined,
    title,
    lastActivityAt: new Date(),
  });

  await pushTimeline(
    req.dbUser.orgId,
    req.dbUser._id,
    "thread_created",
    "thread",
    thread._id,
    thread.title,
    "Discussion créée."
  );

  return res.json({ ok: true, thread });
});

app.get("/api/team/threads/:id/messages", auth, requireActive, async (req, res) => {
  const thread = await TeamThread.findOne({
    _id: req.params.id,
    orgId: req.dbUser.orgId,
  });

  if (!thread) return res.status(404).json({ error: "Thread introuvable" });

  const messages = await TeamMessage.find({
    orgId: req.dbUser.orgId,
    threadId: thread._id,
  }).sort({ createdAt: 1 }).limit(500);

  return res.json({ ok: true, thread, messages });
});

app.post("/api/team/threads/:id/messages", auth, requireActive, async (req, res) => {
  const thread = await TeamThread.findOne({
    _id: req.params.id,
    orgId: req.dbUser.orgId,
  });

  if (!thread) return res.status(404).json({ error: "Thread introuvable" });

  const content = String(req.body?.content || "").trim();
  if (!content) return res.status(400).json({ error: "Message requis" });

  const mentions = uniqueStrings((content.match(/@\w+/g) || []).map((m) => m.slice(1)));

  const msg = await TeamMessage.create({
    orgId: req.dbUser.orgId,
    threadId: thread._id,
    userId: req.dbUser._id,
    authorName: req.dbUser.name || req.dbUser.email,
    content,
    mentions,
  });

  thread.lastActivityAt = new Date();
  await thread.save();

  await pushTimeline(
    req.dbUser.orgId,
    req.dbUser._id,
    "thread_message",
    "thread",
    thread._id,
    thread.title,
    "Nouveau message de discussion."
  );

  return res.json({ ok: true, message: msg });
});

app.post("/api/team/threads/:id/resolve", auth, requireActive, async (req, res) => {
  const thread = await TeamThread.findOne({
    _id: req.params.id,
    orgId: req.dbUser.orgId,
  });

  if (!thread) return res.status(404).json({ error: "Thread introuvable" });

  thread.isResolved = true;
  thread.lastActivityAt = new Date();
  await thread.save();

  return res.json({ ok: true, thread });
});

// ---------- ROUTES: CALENDAR ----------

app.get("/api/calendar", auth, requireActive, async (req, res) => {
  const view = String(req.query.view || "month");
  const start = req.query.start ? new Date(req.query.start) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const end = req.query.end ? new Date(req.query.end) : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

  const events = await CalendarEvent.find({
    orgId: req.dbUser.orgId,
    startAt: { $gte: start, $lte: end },
  }).sort({ startAt: 1 }).limit(500);

  const alerts = [];
  const missions = await Mission.find({ orgId: req.dbUser.orgId }).limit(300);

  for (const m of missions) {
    if (m.status !== "done" && m.dueDate && new Date(m.dueDate).getTime() < Date.now()) {
      alerts.push({
        type: "mission_overdue",
        priority: m.priority || "medium",
        title: m.title,
        dueDate: m.dueDate,
      });
    }
  }

  return res.json({
    ok: true,
    view,
    events,
    alerts,
    todayFocus: missions
      .filter((m) => m.status !== "done")
      .sort((a, b) => {
        const rank = { critical: 4, high: 3, medium: 2, low: 1 };
        return (rank[b.priority] || 0) - (rank[a.priority] || 0);
      })
      .slice(0, 5),
  });
});

app.post("/api/calendar", auth, requireActive, async (req, res) => {
  const body = req.body || {};
  if (!body.title || !body.startAt) {
    return res.status(400).json({ error: "title + startAt requis" });
  }

  const event = await CalendarEvent.create({
    orgId: req.dbUser.orgId,
    userId: req.dbUser._id,
    title: String(body.title || "").trim(),
    description: String(body.description || "").trim(),
    type: body.type || "custom",
    linkedEntityType: body.linkedEntityType || "",
    linkedEntityId: body.linkedEntityId || undefined,
    startAt: new Date(body.startAt),
    endAt: body.endAt ? new Date(body.endAt) : undefined,
    priority: body.priority || "medium",
    alertMode: body.alertMode || "none",
    recurrence: body.recurrence || "none",
    isDone: !!body.isDone,
  });

  await pushTimeline(
    req.dbUser.orgId,
    req.dbUser._id,
    "calendar_event_created",
    "calendar",
    event._id,
    event.title,
    "Événement calendrier créé."
  );

  return res.json({ ok: true, event });
});

app.patch("/api/calendar/:id", auth, requireActive, async (req, res) => {
  const event = await CalendarEvent.findOne({
    _id: req.params.id,
    orgId: req.dbUser.orgId,
  });

  if (!event) return res.status(404).json({ error: "Événement introuvable" });

  const allowed = ["title", "description", "type", "startAt", "endAt", "priority", "alertMode", "recurrence", "isDone"];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
      event[key] = key.includes("At") && req.body[key] ? new Date(req.body[key]) : req.body[key];
    }
  }

  await event.save();
  return res.json({ ok: true, event });
});

// ---------- ROUTES: NOTES ----------

app.get("/api/notes", auth, requireActive, async (req, res) => {
  const type = String(req.query.type || "").trim();
  const q = { orgId: req.dbUser.orgId };
  if (type) q.type = type;

  const notes = await Note.find(q).sort({ isPinned: -1, createdAt: -1 }).limit(500);
  return res.json({ ok: true, notes });
});

app.post("/api/notes", auth, requireActive, async (req, res) => {
  const body = req.body || {};
  if (!String(body.title || "").trim()) {
    return res.status(400).json({ error: "Titre requis" });
  }

  const note = await Note.create({
    orgId: req.dbUser.orgId,
    userId: req.dbUser._id,
    title: String(body.title || "").trim(),
    content: String(body.content || "").trim(),
    type: body.type || "free",
    linkedEntityType: body.linkedEntityType || "",
    linkedEntityId: body.linkedEntityId || undefined,
    tags: Array.isArray(body.tags) ? body.tags : [],
    isPinned: !!body.isPinned,
  });

  await pushTimeline(
    req.dbUser.orgId,
    req.dbUser._id,
    "note_created",
    "note",
    note._id,
    note.title,
    "Note créée."
  );

  return res.json({ ok: true, note });
});

app.patch("/api/notes/:id", auth, requireActive, async (req, res) => {
  const note = await Note.findOne({
    _id: req.params.id,
    orgId: req.dbUser.orgId,
  });

  if (!note) return res.status(404).json({ error: "Note introuvable" });

  const allowed = ["title", "content", "type", "tags", "isPinned"];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
      note[key] = req.body[key];
    }
  }

  await note.save();
  return res.json({ ok: true, note });
});

app.post("/api/notes/:id/to-mission", auth, requireActive, async (req, res) => {
  const note = await Note.findOne({
    _id: req.params.id,
    orgId: req.dbUser.orgId,
  });

  if (!note) return res.status(404).json({ error: "Note introuvable" });

  const mission = await Mission.create({
    orgId: req.dbUser.orgId,
    userId: req.dbUser._id,
    title: note.title,
    description: note.content,
    category: "ops",
    sourceType: "note",
    sourceId: note._id,
    priority: "medium",
    impact: "medium",
    status: "todo",
    isAutomated: false,
    isQuickWin: false,
    tags: uniqueStrings(["from_note", ...(note.tags || [])]),
  });

  await pushTimeline(
    req.dbUser.orgId,
    req.dbUser._id,
    "note_to_mission",
    "mission",
    mission._id,
    mission.title,
    "Mission créée depuis une note."
  );

  return res.json({ ok: true, mission });
});

app.post("/api/notes/:id/to-calendar", auth, requireActive, async (req, res) => {
  const note = await Note.findOne({
    _id: req.params.id,
    orgId: req.dbUser.orgId,
  });

  if (!note) return res.status(404).json({ error: "Note introuvable" });

  const startAt = req.body?.startAt ? new Date(req.body.startAt) : new Date(Date.now() + 24 * 60 * 60 * 1000);

  const event = await CalendarEvent.create({
    orgId: req.dbUser.orgId,
    userId: req.dbUser._id,
    title: note.title,
    description: note.content,
    type: "custom",
    linkedEntityType: "note",
    linkedEntityId: note._id,
    startAt,
    priority: "medium",
    alertMode: "standard",
    recurrence: "none",
    isDone: false,
  });

  await pushTimeline(
    req.dbUser.orgId,
    req.dbUser._id,
    "note_to_calendar",
    "calendar",
    event._id,
    event.title,
    "Événement calendrier créé depuis une note."
  );

  return res.json({ ok: true, event });
});

// ---------- ROUTES: TIMELINE ----------

app.get("/api/timeline", auth, requireActive, async (req, res) => {
  const events = await TimelineEvent.find({ orgId: req.dbUser.orgId })
    .sort({ createdAt: -1 })
    .limit(300);

  return res.json({ ok: true, events });
});

// ---------- ROUTES: OVERVIEW WAR ROOM ----------

app.get("/api/overview/war-room", auth, requireActive, async (req, res) => {
  const days = Math.min(90, Math.max(7, Number(req.query.days || 30)));
  const ctx = await getUserEngineContext(req.dbUser, req.dbOrg, days);

  const seoScores = [...ctx.audits]
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-90)
    .map((a) => ({
      x: a.createdAt,
      y: Number(a.score || 0),
      url: a.url,
    }));

  const openIssues = ctx.existingIssues.filter((i) => i.status === "open");
  const issueTrend = [...ctx.existingIssues]
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-90)
    .map((i, idx) => ({
      x: i.createdAt,
      y: idx + 1,
      type: i.type,
      status: i.status,
    }));

  const missionCompletionTrend = [...ctx.missions]
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-120)
    .map((m, idx) => ({
      x: m.createdAt,
      createdCount: idx + 1,
      done: m.status === "done" ? 1 : 0,
    }));

  const monitorHealthTrend = [...ctx.monitorLogs]
    .sort((a, b) => new Date(a.checkedAt) - new Date(b.checkedAt))
    .slice(-180)
    .map((l) => ({
      x: l.checkedAt,
      status: l.status,
      responseTimeMs: l.responseTimeMs || 0,
      httpStatus: l.httpStatus || 0,
    }));

  const localOpportunities = buildLocalOpportunities(ctx.siteProfile, ctx.sector);
  const localOpportunityTrend = localOpportunities.map((o, idx) => ({
    x: idx + 1,
    city: o.city,
    score: o.score,
  }));

  const conversionReadiness = calcConversionReadiness(ctx.siteProfile, ctx.audits, ctx.monitors);
  const uptimeHealth = calcUptimeHealth(ctx.monitors, ctx.monitorLogs);
  const executionMomentum = calcExecutionMomentum(ctx.missions);
  const localDominanceScore = calcLocalDominance(
    ctx.siteProfile,
    openIssues.filter((i) => i.category === "local").length,
    ctx.missions.filter((m) => m.category === "local").length
  );

  const riskEngine = buildRiskEngine({
    issues: openIssues,
    monitors: ctx.monitors,
    siteProfile: ctx.siteProfile,
    missions: ctx.missions,
  });

  const recommendations = buildRecommendations({
    issues: openIssues,
    sector: ctx.sector,
    siteProfile: ctx.siteProfile,
    maturity: ctx.maturity,
    planFeatures: ctx.planFeatures,
    history: ctx.history,
  });

  const opportunityEngine = buildOpportunityEngine({
    recommendations,
    localOpportunities,
    issues: openIssues,
  });

  const revenueProxyImpact = calcRevenueProxyImpact(opportunityEngine, executionMomentum);
  const leadRiskScore = calcLeadRiskScore(conversionReadiness, uptimeHealth, riskEngine.criticalPagesUnhandled);
  const clientReadinessScore = calcClientReadiness(ctx.missions, ctx.notes, 1);

  const seoScore = seoScores.length ? seoScores[seoScores.length - 1].y : 0;
  const healthScore = Math.round((seoScore + uptimeHealth + executionMomentum + conversionReadiness) / 4);

  const overviewNarrative = buildOverviewNarrative({
    seoScore,
    localDominanceScore,
    uptimeHealth,
    conversionReadiness,
    riskEngine,
    opportunityEngine,
  });

  const topUrgencies = openIssues
    .filter((i) => i.severity === "critical" || i.impactBusiness === "critical")
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, 3);

  const topQuickWins = ctx.missions
    .filter((m) => m.isQuickWin && m.status !== "done")
    .slice(0, 3);

  const topBusinessOpportunities = opportunityEngine.slice(0, 3);

  const teamWaiting = await TeamThread.find({
    orgId: req.dbUser.orgId,
    isResolved: false,
  }).sort({ lastActivityAt: -1 }).limit(3);

  const portfolio = {
    mostRiskyPages: openIssues
      .filter((i) => i.pageUrl)
      .sort((a, b) => b.priorityScore - a.priorityScore)
      .slice(0, 5)
      .map((i) => ({ pageUrl: i.pageUrl, title: i.title, score: i.priorityScore })),
    mostPromisingPages: localOpportunities.slice(0, 5).map((o) => ({ pageUrl: "", title: o.label, score: o.score })),
    mostCriticalPages: topUrgencies.map((i) => ({ pageUrl: i.pageUrl, title: i.title, score: i.priorityScore })),
    mostProfitableCandidates: topBusinessOpportunities.map((o) => ({ pageUrl: "", title: o.label, score: o.score })),
  };

  const trialRetention = buildTrialRetentionBlock({
    missions: ctx.missions,
    opportunities: opportunityEngine,
    plan: req.dbUser.plan,
  });

  const monthlyOS = buildMonthlyOperatingSystem({
    missions: ctx.missions,
    calendarEvents: ctx.calendarEvents,
  });

  return res.json({
    ok: true,
    warRoom: {
      hero: {
        healthScore,
        seoScore,
        localDominanceScore,
        uptimeHealth,
        conversionReadiness,
        criticalMissions: ctx.missions.filter((m) => m.priority === "critical" && m.status !== "done").length,
        progress7d: ctx.missions.filter((m) => m.completedAt && new Date(m.completedAt).getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000).length,
        progress30d: ctx.missions.filter((m) => m.completedAt && new Date(m.completedAt).getTime() >= Date.now() - 30 * 24 * 60 * 60 * 1000).length,
        currentRisk: riskEngine.currentRiskLevel,
        bestOpportunity: opportunityEngine[0] || null,
        narrative: overviewNarrative,
      },
      analytics: {
        scoreTrend: seoScores,
        issueTrend,
        missionCompletionTrend,
        monitorHealthTrend,
        localOpportunityTrend,
        conversionReadinessSignals: {
          score: conversionReadiness,
          hasContact: ctx.siteProfile.hasContact,
          hasServicePages: ctx.siteProfile.hasServicePages,
          hasPricing: ctx.siteProfile.hasPricing,
          latestAuditUrl: ctx.audits[0]?.url || "",
        },
      },
      widgets: {
        topUrgencies,
        topQuickWins,
        topBusinessOpportunities,
        teamWaiting,
      },
      portfolio,
      premiumScores: {
        revenueProxyImpact,
        leadRiskScore,
        localDominanceScore,
        executionMomentum,
        clientReadinessScore,
      },
      retention: trialRetention,
      monthlyOperatingSystem: monthlyOS,
      recommendations,
      sector: ctx.sector,
      maturity: ctx.maturity,
      planFeatures: ctx.planFeatures,
    },
  });
});

// ---------- ROUTES: RECOMMENDATIONS ----------

app.get("/api/recommendations", auth, requireActive, async (req, res) => {
  const ctx = await getUserEngineContext(req.dbUser, req.dbOrg, 30);

  const recommendations = buildRecommendations({
    issues: ctx.existingIssues.filter((i) => i.status === "open"),
    sector: ctx.sector,
    siteProfile: ctx.siteProfile,
    maturity: ctx.maturity,
    planFeatures: ctx.planFeatures,
    history: ctx.history,
  });

  return res.json({
    ok: true,
    recommendations,
    context: {
      sector: ctx.sector,
      maturity: ctx.maturity,
      plan: req.dbUser.plan,
      host: ctx.siteProfile.host,
    },
  });
});
// =======================
// STRIPE (via stripe.js)
// IMPORTANT: webhook RAW avant express.json()
// =======================
const stripeModule = buildStripeModule({
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  BRAND_NAME,
  priceIdForPlan,
  safeBaseUrl,
  signToken,
  issueAuthPayload, // ✅ AJOUT IMPORTANT
  auth,
  requireActive,
  ensureOrgForUser,
  ensureOrgDefaults,
  User,
  Org,
  sendEmail,
});
// 1) WEBHOOK RAW AVANT JSON
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeModule.webhookHandler
);

// 2) SECURITY
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use("/api", rateLimit({ windowMs: 60 * 1000, max: 200 }));

// 2.5) NO CACHE FOR AUTH / SESSION-SENSITIVE ROUTES
app.use((req, res, next) => {
  if (
    req.path.startsWith("/api/auth/") ||
    req.path === "/api/me" ||
    req.path === "/api/overview"
  ) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
  }
  next();
});

// 3) BODY PARSERS APRES WEBHOOK
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ---------- STATIC ----------
app.use(express.static(path.join(__dirname)));

function sendPage(res, file) {
  return res.sendFile(path.join(__dirname, file));
}

// ---------- PAGES ----------
app.get("/", (_, res) => sendPage(res, "index.html"));
app.get("/index.html", (_, res) => sendPage(res, "index.html"));

app.get("/dashboard", (_, res) => sendPage(res, "dashboard.html"));
app.get("/dashboard.html", (_, res) => sendPage(res, "dashboard.html"));

app.get("/pricing", (_, res) => sendPage(res, "pricing.html"));
app.get("/pricing.html", (_, res) => sendPage(res, "pricing.html"));

app.get("/success", (_, res) => sendPage(res, "success.html"));
app.get("/success.html", (_, res) => sendPage(res, "success.html"));

app.get("/cancel", (_, res) => sendPage(res, "cancel.html"));
app.get("/cancel.html", (_, res) => sendPage(res, "cancel.html"));

app.get("/login", (_, res) => sendPage(res, "login.html"));
app.get("/login.html", (_, res) => sendPage(res, "login.html"));

app.get("/login-verify", (_, res) => sendPage(res, "login-verify.html"));
app.get("/login-verify.html", (_, res) => sendPage(res, "login-verify.html"));

app.get("/invite-accept", (_, res) => sendPage(res, "invite-accept.html"));
app.get("/invite-accept.html", (_, res) => sendPage(res, "invite-accept.html"));

app.get("/admin", (_, res) => sendPage(res, "admin.html"));
app.get("/admin.html", (_, res) => sendPage(res, "admin.html"));

app.get("/checkout.html", (_, res) => sendPage(res, "checkout.html"));
app.get("/checkout-embedded.html", (_, res) => sendPage(res, "checkout-embedded.html"));
app.get("/checkout-return.html", (_, res) => sendPage(res, "checkout-return.html"));

app.get("/billing.html", (_, res) => sendPage(res, "billing.html"));
app.get("/addons.html", (_, res) => sendPage(res, "addons.html"));

// ---------- API ----------
app.get("/api/health", (_, res) => {
  return res.json({
    ok: true,
    brand: BRAND_NAME,
    uptimeSec: Math.round(process.uptime()),
    now: new Date().toISOString(),
  });
});

// ---------- STRIPE ROUTES ----------
app.post("/api/stripe/checkout", auth, requireActive, stripeModule.checkoutPlan);
app.post("/api/stripe/checkout-embedded", auth, requireActive, stripeModule.checkoutEmbedded);
app.get("/api/stripe/verify", stripeModule.verifyCheckout);
app.post("/api/stripe/portal", auth, requireActive, stripeModule.customerPortal);

// ---------- AUTH: LEAD ----------
const leadLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

app.post("/api/auth/lead", leadLimiter, async (req, res) => {
  try {
    const { firstName, email, companyName, plan } = req.body || {};

    if (!email || !companyName) {
      return res.status(400).json({ error: "Email + entreprise requis" });
    }

    const chosenPlan = String(plan || "").toLowerCase();
    if (!["standard", "pro", "ultra"].includes(chosenPlan)) {
      return res.status(400).json({ error: "Plan invalide" });
    }

    const emailNorm = normalizeEmail(email);
    const domain = domainFromEmail(emailNorm);
    const companyNorm = normalizeCompanyName(companyName);
    const ipua = ipuaHash(req);

    const adminBypass = ADMIN_KEY && req.headers["x-admin-key"] === ADMIN_KEY;

    if (!adminBypass) {
      if (await TrialRegistry.findOne({ emailNormalized: emailNorm })) {
        return res.status(403).json({ error: "Essai déjà utilisé pour cet email." });
      }

      if (await TrialRegistry.findOne({ companyNameNormalized: companyNorm })) {
        return res.status(403).json({ error: "Essai déjà utilisé pour cette entreprise." });
      }

      if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) {
        if (await TrialRegistry.findOne({ companyDomain: domain })) {
          return res.status(403).json({ error: "Essai déjà utilisé pour ce domaine entreprise." });
        }
      }

      if (await TrialRegistry.findOne({ ipua })) {
        return res.status(403).json({ error: "Essai déjà utilisé (anti-abus navigateur/IP)." });
      }
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

    return res.json({
      ok: true,
      ...issueAuthPayload(user),
    });
  } catch (e) {
    console.log("lead error:", e.message);

    if (String(e.message || "").includes("duplicate key")) {
      return res.status(403).json({ error: "Essai déjà utilisé (anti-abus)." });
    }

    return res.status(500).json({ error: "Erreur serveur lead" });
  }
});

// ---------- AUTH: REFRESH ----------
app.post("/api/auth/refresh", async (req, res) => {
  try {
    const refreshToken =
      String(req.body?.refreshToken || "").trim() ||
      String(req.headers["x-refresh-token"] || "").trim() ||
      String(req.headers["x-refresh"] || "").trim();

    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token manquant" });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, REFRESH_SECRET);
    } catch {
      return res.status(401).json({ error: "Refresh token invalide" });
    }

    if (!decoded?.uid) {
      return res.status(401).json({ error: "Refresh token invalide" });
    }

    const user = await User.findById(decoded.uid);
    if (!user) {
      return res.status(404).json({ error: "User introuvable" });
    }

    await ensureOrgForUser(user);
    await resetUsageIfNewMonth(user);

    const payload = issueAuthPayload(user);

    return res.json({
      ok: true,
      token: payload.token,
      refreshToken: payload.refreshToken,
    });
  } catch (e) {
    console.log("refresh error:", e.message);
    return res.status(401).json({ error: "Refresh token invalide" });
  }
});

app.get("/api/auth/session", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.uid);
    if (!user) return res.status(404).json({ error: "User introuvable" });

    return res.json({
      ok: true,
      authenticated: true,
      userId: user._id,
      email: user.email,
    });
  } catch (e) {
    return res.status(401).json({ error: "Session invalide" });
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

    await LoginToken.create({
      userId: user._id,
      tokenHash,
      expiresAt,
    });

    const baseUrl = safeBaseUrl(req);
    const link = `${baseUrl}/login-verify.html?token=${raw}`;

    if (String(process.env.DEBUG_LOGIN_LINK || "").toLowerCase() === "true") {
      return res.json({ ok: true, debugLink: link });
    }

    const html = `
<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FlowPoint</title>
</head>
<body style="margin:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:620px;margin:auto;padding:40px 20px">
<div style="background:#ffffff;border-radius:24px;padding:32px;border:1px solid rgba(0,0,0,.06);box-shadow:0 10px 30px rgba(29,41,57,.08);">
<div style="margin-bottom:24px">
<div style="font-size:22px;font-weight:800">FlowPoint</div>
<div style="font-size:14px;color:#6b7280">Connexion sécurisée (sans mot de passe)</div>
</div>

<div style="font-size:20px;font-weight:800;margin-bottom:12px">Ton lien de connexion</div>

<div style="color:#6b7280;font-size:15px;margin-bottom:22px">
Ce lien est valide <b>${LOGIN_LINK_TTL_MINUTES} minutes</b>.<br>
Si tu n’es pas à l’origine de cette demande, ignore cet email.
</div>

<a href="${link}" style="display:inline-block;padding:14px 26px;background:#2f5bff;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;">
Se connecter
</a>

<div style="margin-top:24px;padding:16px;border-radius:14px;background:#f3f4f6;font-size:13px;color:#6b7280;word-break:break-all;">
<b>Bouton bloqué ? Copie-colle :</b><br><br>${link}
</div>

<div style="margin-top:28px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#9ca3af;">
© ${new Date().getFullYear()} FlowPoint
</div>
</div>
</div>
</body>
</html>`;

    const r = await sendEmail({
      to: user.email,
      subject: `${BRAND_NAME} — Ton lien de connexion`,
      text: `Lien de connexion (valide ${LOGIN_LINK_TTL_MINUTES} minutes): ${link}`,
      html,
    });

    if (!r.ok) {
      return res.status(502).json({ ok: false, error: "Email non envoyé" });
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
    if (lt.expiresAt && new Date(lt.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ error: "Token expiré" });
    }

    const user = await User.findById(lt.userId);
    if (!user) return res.status(404).json({ error: "User introuvable" });

    lt.usedAt = new Date();
    await lt.save();

    await ensureOrgForUser(user);

    return res.json({
      ok: true,
      ...issueAuthPayload(user),
    });
  } catch (e) {
    console.log("login-verify error:", e.message);
    return res.status(500).json({ error: "Erreur login-verify" });
  }
});

// ---------- INVITE ACCEPT ----------
app.post("/api/org/invite/accept", async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const email = String(req.body?.email || "").trim();
    const name = String(req.body?.name || "").trim();

    if (!token) return res.status(400).json({ error: "Token manquant" });
    if (!email) return res.status(400).json({ error: "Email requis" });

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const invite = await Invite.findOne({ tokenHash });

    if (!invite) return res.status(404).json({ error: "Invitation introuvable" });
    if (invite.acceptedAt) return res.status(400).json({ error: "Invitation déjà utilisée" });
    if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
      return res.status(400).json({ error: "Invitation expirée" });
    }

    const emailNorm = normalizeEmail(email);
    if (invite.invitedEmailNormalized && invite.invitedEmailNormalized !== emailNorm) {
      return res.status(403).json({ error: "Cet email ne correspond pas à l’invitation" });
    }

    const org = await Org.findById(invite.orgId);
    if (!org) return res.status(404).json({ error: "Organisation introuvable" });

    let user = await User.findOne({ emailNormalized: emailNorm });

    if (!user) {
      user = await User.create({
        email: email.toLowerCase(),
        emailNormalized: emailNorm,
        name: name || "",
        companyName: org.name,
        companyNameNormalized: org.normalizedName,
        companyDomain: org.createdFromEmailDomain || "",
        orgId: org._id,
        role: "member",
        plan: "standard",
      });
    } else {
      if (user.orgId && String(user.orgId) !== String(org._id)) {
        return res.status(409).json({ error: "Cet utilisateur appartient déjà à une autre organisation" });
      }

      user.name = name || user.name;
      user.orgId = org._id;
      user.role = "member";
      if (!user.companyName) user.companyName = org.name;
      if (!user.companyNameNormalized) user.companyNameNormalized = org.normalizedName;
      await user.save();
    }

    invite.acceptedAt = new Date();
    await invite.save();

    await ensureOrgDefaults(org);

    return res.json({
      ok: true,
      ...issueAuthPayload(user),
    });
  } catch (e) {
    console.log("invite-accept error:", e.message);
    return res.status(500).json({ error: "Erreur acceptation invitation" });
  }
});

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

  const lastAudit = await Audit.findOne({ orgId: req.dbUser.orgId })
    .sort({ createdAt: -1 })
    .select("score createdAt url");

  const audits = await Audit.find({
    orgId: req.dbUser.orgId,
    createdAt: { $gte: since },
  })
    .sort({ createdAt: 1 })
    .limit(120)
    .select("score createdAt");

  const chart = audits.map((a) => a.score ?? 0);

  const activeMonitors = await Monitor.countDocuments({
    orgId: req.dbUser.orgId,
    active: true,
  });

  const downMonitors = await Monitor.countDocuments({
    orgId: req.dbUser.orgId,
    active: true,
    lastStatus: "down",
  });

  return res.json({
    ok: true,
    seoScore: lastAudit?.score ?? 0,
    lastAuditAt: lastAudit?.createdAt || null,
    lastAuditUrl: lastAudit?.url || null,
    localVis: "+0%",
    chart,
    monitors: {
      active: activeMonitors,
      down: downMonitors,
    },
    rangeDays: days,
  });
});

// ---------- ORG SETTINGS ----------
app.get("/api/org/settings", auth, requireActive, async (req, res) => {
  const org = await Org.findById(req.dbUser.orgId).select("alertRecipients alertExtraEmails");
  return res.json({
    ok: true,
    settings: org || { alertRecipients: "all", alertExtraEmails: [] },
  });
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

// alias monitor-settings
app.get("/api/org/monitor-settings", auth, requireActive, async (req, res) => {
  const org = await Org.findById(req.dbUser.orgId).select("alertRecipients alertExtraEmails");
  return res.json({
    ok: true,
    settings: org || { alertRecipients: "all", alertExtraEmails: [] },
  });
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
    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: "URL invalide (http/https)" });
    }

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
        summary: `Cache (${AUDIT_CACHE_HOURS}h) — ${cached.summary || ""}`,
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

    return res.json({
      ok: true,
      cached: false,
      auditId: audit._id,
      score: audit.score,
      summary: audit.summary,
    });
  } catch (e) {
    return res.status(400).json({ error: e.message || "Erreur audit" });
  }
});

app.get("/api/audits", auth, requireActive, async (req, res) => {
  const list = await Audit.find({ orgId: req.dbUser.orgId })
    .sort({ createdAt: -1 })
    .limit(50);

  return res.json({ ok: true, audits: list });
});

app.get("/api/audits/:id", auth, requireActive, async (req, res) => {
  const a = await Audit.findOne({
    _id: req.params.id,
    orgId: req.dbUser.orgId,
  });

  if (!a) return res.status(404).json({ error: "Audit introuvable" });
  return res.json({ ok: true, audit: a });
});

app.get("/api/audits/:id/pdf", auth, requireActive, async (req, res) => {
  const a = await Audit.findOne({
    _id: req.params.id,
    orgId: req.dbUser.orgId,
  });

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
  for (const r of rec) {
    doc.fontSize(12).text("• " + r);
  }

  doc.moveDown();
  doc.fontSize(14).text("Checks", { underline: true });
  doc.moveDown(0.25);

  const f = a.findings || {};
  for (const [k, v] of Object.entries(f)) {
    const vv =
      typeof v?.value === "object"
        ? JSON.stringify(v.value)
        : String(v?.value ?? "");

    doc.fontSize(12).text(`${k}: ${v?.ok ? "OK" : "À corriger"} — ${vv}`);
  }

  doc.end();
});

// ---------- MONITORS ----------
app.post("/api/monitors", auth, requireActive, async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim();
    const intervalMinutes = Number(req.body?.intervalMinutes || 60);

    if (!url || !/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: "URL invalide" });
    }

    if (!Number.isFinite(intervalMinutes) || intervalMinutes < 5) {
      return res.status(400).json({ error: "intervalMinutes min = 5" });
    }

    await assertSafePublicUrl(url);

    const allowed = await canCreateActiveMonitor(req.dbUser, req.dbOrg);
    if (!allowed) {
      return res.status(429).json({ error: "Quota monitors actifs dépassé" });
    }

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
  const list = await Monitor.find({ orgId: req.dbUser.orgId })
    .sort({ createdAt: -1 })
    .limit(50);

  return res.json({ ok: true, monitors: list });
});

app.patch("/api/monitors/:id", auth, requireActive, async (req, res) => {
  const m = await Monitor.findOne({
    _id: req.params.id,
    orgId: req.dbUser.orgId,
  });

  if (!m) return res.status(404).json({ error: "Monitor introuvable" });

  if (typeof req.body?.active === "boolean") {
    m.active = req.body.active;
  }

  if (req.body?.intervalMinutes != null) {
    const im = Number(req.body.intervalMinutes);
    if (!Number.isFinite(im) || im < 5) {
      return res.status(400).json({ error: "intervalMinutes min = 5" });
    }
    m.intervalMinutes = im;
  }

  if (m.active === true) {
    const q = effectiveQuotas(req.dbUser, req.dbOrg);
    const countActive = await Monitor.countDocuments({
      orgId: req.dbUser.orgId,
      active: true,
      _id: { $ne: m._id },
    });

    if (countActive + 1 > q.monitors) {
      return res.status(429).json({ error: "Quota monitors actifs dépassé" });
    }
  }

  await m.save();
  return res.json({ ok: true, monitor: m });
});

app.delete("/api/monitors/:id", auth, requireActive, async (req, res) => {
  const m = await Monitor.findOneAndDelete({
    _id: req.params.id,
    orgId: req.dbUser.orgId,
  });

  if (!m) return res.status(404).json({ error: "Monitor introuvable" });

  await MonitorLog.deleteMany({
    orgId: req.dbUser.orgId,
    monitorId: m._id,
  }).catch(() => {});

  return res.json({ ok: true });
});

app.post("/api/monitors/:id/run", auth, requireActive, async (req, res) => {
  const m = await Monitor.findOne({
    _id: req.params.id,
    orgId: req.dbUser.orgId,
  });

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
  const m = await Monitor.findOne({
    _id: req.params.id,
    orgId: req.dbUser.orgId,
  });

  if (!m) return res.status(404).json({ error: "Monitor introuvable" });

  const logs = await MonitorLog.find({
    orgId: req.dbUser.orgId,
    monitorId: m._id,
  })
    .sort({ checkedAt: -1 })
    .limit(200);

  return res.json({ ok: true, logs });
});

app.get("/api/monitors/:id/uptime", auth, requireActive, async (req, res) => {
  const m = await Monitor.findOne({
    _id: req.params.id,
    orgId: req.dbUser.orgId,
  });

  if (!m) return res.status(404).json({ error: "Monitor introuvable" });

  const days = Math.min(30, Math.max(1, Number(req.query.days || 7)));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const logs = await MonitorLog.find({
    orgId: req.dbUser.orgId,
    monitorId: m._id,
    checkedAt: { $gte: since },
  })
    .select("status checkedAt")
    .sort({ checkedAt: 1 });

  const total = logs.length;
  const up = logs.filter((l) => l.status === "up").length;
  const uptime = total ? Math.round((up / total) * 10000) / 100 : null;

  return res.json({
    ok: true,
    days,
    totalChecks: total,
    upChecks: up,
    uptimePercent: uptime,
  });
});

// ---------- CRON ----------
app.post("/api/cron/monitors-run", requireCron, async (req, res) => {
  try {
    const now = Date.now();
    const limit = Math.min(
      500,
      Math.max(1, Number(req.body?.limit || req.query.limit || 200))
    );

    const activeMonitors = await Monitor.find({ active: true })
      .sort({ updatedAt: 1 })
      .limit(limit);

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

    return res.json({
      ok: true,
      checked,
      alertsSent,
      scanned: activeMonitors.length,
      concurrency: CRON_CONCURRENCY,
    });
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

async function sendAuditsCsv(req, res) {
  const ok = await consume(req.dbUser, req.dbOrg, "exports", 1);
  if (!ok) return res.status(429).json({ error: "Quota exports dépassé" });

  const list = await Audit.find({ orgId: req.dbUser.orgId })
    .sort({ createdAt: -1 })
    .limit(500);

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="flowpoint-audits.csv"`);

  const header = ["createdAt", "url", "status", "score", "summary"].join(",") + "\n";
  const rows = list
    .map((a) =>
      [
        a.createdAt?.toISOString?.() || "",
        a.url || "",
        a.status || "",
        a.score ?? "",
        a.summary || "",
      ]
        .map(csvEscape)
        .join(",")
    )
    .join("\n");

  return res.send(header + rows + "\n");
}

async function sendMonitorsCsv(req, res) {
  const ok = await consume(req.dbUser, req.dbOrg, "exports", 1);
  if (!ok) return res.status(429).json({ error: "Quota exports dépassé" });

  const list = await Monitor.find({ orgId: req.dbUser.orgId })
    .sort({ createdAt: -1 })
    .limit(500);

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

  return res.send(header + rows + "\n");
}

app.get("/api/export/audits.csv", auth, requireActive, sendAuditsCsv);
app.get("/api/export/monitors.csv", auth, requireActive, sendMonitorsCsv);
app.get("/api/exports/audits.csv", auth, requireActive, sendAuditsCsv);
app.get("/api/exports/monitors.csv", auth, requireActive, sendMonitorsCsv);

// ---------- ADMIN ----------
app.get("/api/admin/users", requireAdmin, async (req, res) => {
  const list = await User.find({}).sort({ createdAt: -1 }).limit(200);
  return res.json({ ok: true, users: list });
});

app.post("/api/admin/user/block", requireAdmin, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const blocked = !!req.body?.blocked;

  if (!email) return res.status(400).json({ error: "email manquant" });

  await User.updateOne(
    { email },
    { $set: { accessBlocked: blocked } }
  );

  return res.json({ ok: true });
});

app.post("/api/admin/user/reset-usage", requireAdmin, async (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  if (!email) return res.status(400).json({ error: "email manquant" });

  await User.updateOne(
    { email },
    {
      $set: {
        usageMonth: firstDayOfThisMonthUTC(),
        usedAudits: 0,
        usedPdf: 0,
        usedExports: 0,
      },
    }
  );

  return res.json({ ok: true });
});

// ---------- KEEP ALIVE ----------
if (process.env.RENDER) {
  const SELF_URL = process.env.PUBLIC_BASE_URL;

  if (SELF_URL) {
    setInterval(async () => {
      try {
        await fetch(`${SELF_URL.replace(/\/+$/, "")}/api/health`);
        console.log("🔁 Keep alive ping");
      } catch (e) {
        console.log("Keep alive failed:", e.message);
      }
    }, 1000 * 60 * 5);
  }
}

// ---------- API 404 ----------
app.use("/api", (req, res) => {
  return res.status(404).json({ error: "Route API introuvable" });
});

// ---------- START ----------
app.listen(PORT, () => {
  console.log(`✅ ${BRAND_NAME} lancé sur port ${PORT}`);
});
