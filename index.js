// =======================
// FlowPoint AI – SaaS Backend (Pack A + Pack B)
// Plans: Standard / Pro / Ultra
// Pack A: SEO Audit + Cache + PDF + Monitoring + Logs + CSV + Magic Link + Admin
// Pack B: Orgs + Team Ultra (Invites) + Roles + Shared data per org
//
// ✅ ADD (4/5/6):
// 4) Cron endpoint sécurisé pour exécuter automatiquement les monitors
// 5) Alertes email sur DOWN/UP (selon settings org + emails extra)
// 6) Rapport monitoring mensuel Ultra + export PDF
// + Fix: OrgSchema manquait alertRecipients/alertExtraEmails => settings cassés
// + Compat: /api/org/settings alias des monitor-settings (pour dashboard fallback)
// =======================

require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Stripe = require("stripe");
const cheerio = require("cheerio");
const PDFDocument = require("pdfkit");
const nodemailer = require("nodemailer");

const app = express();
app.set("trust proxy", true);

const PORT = process.env.PORT || 5000;
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

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

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET_RENDER;
if (!STRIPE_WEBHOOK_SECRET) console.log("⚠️ STRIPE_WEBHOOK_SECRET_RENDER manquante (webhook non validable)");

const ADMIN_KEY = process.env.ADMIN_KEY || "";
const LOGIN_LINK_TTL_MINUTES = Number(process.env.LOGIN_LINK_TTL_MINUTES || 30);
const AUDIT_CACHE_HOURS = Number(process.env.AUDIT_CACHE_HOURS || 24);

// ✅ Cron key (pour Render cron / GitHub actions / autre)
const CRON_KEY = process.env.CRON_KEY || "";
if (!CRON_KEY) console.log("⚠️ CRON_KEY manquante (cron monitors non sécurisé / désactivé)");

// SMTP
const SMTP_READY =
  !!process.env.SMTP_HOST &&
  !!process.env.SMTP_PORT &&
  !!process.env.SMTP_USER &&
  !!process.env.SMTP_PASS &&
  !!process.env.ALERT_EMAIL_FROM;

function boolEnv(v) {
  return String(v).toLowerCase() === "true";
}

function getMailer() {
  if (!SMTP_READY) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: boolEnv(process.env.SMTP_SECURE),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendEmail({ to, subject, text, html, attachments }) {
  const t = getMailer();
  if (!t) {
    console.log("⚠️ SMTP non configuré, email ignoré:", subject);
    return;
  }
  const info = await t.sendMail({
    from: process.env.ALERT_EMAIL_FROM,
    to,
    subject,
    text,
    html,
    attachments,
  });
  console.log("✅ Email envoyé:", info.messageId);
}

function safeBaseUrl(req) {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (base) return base;
  return `https://${req.headers.host}`;
}

// ---------- STRIPE WEBHOOK RAW (AVANT express.json) ----------
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    if (!STRIPE_WEBHOOK_SECRET) return res.status(200).send("no webhook secret");
    const sig = req.headers["stripe-signature"];
    const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);

    async function setBlockedByCustomer(customerId, blocked, status) {
      await User.updateOne(
        { stripeCustomerId: customerId },
        { $set: { accessBlocked: !!blocked, lastPaymentStatus: status || "" } }
      );
    }

    if (event.type === "invoice.payment_failed") {
      const inv = event.data.object;
      await setBlockedByCustomer(inv.customer, true, "payment_failed");
    }

    if (event.type === "invoice.payment_succeeded") {
      const inv = event.data.object;
      await setBlockedByCustomer(inv.customer, false, "payment_succeeded");
    }

    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
      const sub = event.data.object;
      const priceId = sub.items?.data?.[0]?.price?.id;

      const user = await User.findOne({ stripeCustomerId: sub.customer });
      if (user) {
        user.stripeSubscriptionId = sub.id;
        user.subscriptionStatus = sub.status;
        user.lastPaymentStatus = sub.status;

        if (["active", "trialing"].includes(sub.status)) user.accessBlocked = false;
        if (["past_due", "unpaid", "canceled", "incomplete_expired"].includes(sub.status)) user.accessBlocked = true;

        if (priceId === process.env.STRIPE_PRICE_ID_STANDARD) user.plan = "standard";
        if (priceId === process.env.STRIPE_PRICE_ID_PRO) user.plan = "pro";
        if (priceId === process.env.STRIPE_PRICE_ID_ULTRA) user.plan = "ultra";

        await user.save();
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      await User.updateOne(
        { stripeCustomerId: sub.customer },
        { $set: { accessBlocked: true, subscriptionStatus: "canceled", lastPaymentStatus: "subscription_deleted" } }
      );
    }

    return res.json({ received: true });
  } catch (e) {
    console.log("webhook error:", e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }
});

// ---------- SECURITY / PARSERS ----------
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use("/api", rateLimit({ windowMs: 60 * 1000, max: 200 }));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ---------- STATIC ----------
app.use(express.static(path.join(__dirname)));

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

function quotasForPlan(plan) {
  const p = String(plan || "").toLowerCase();
  if (p === "standard") return { audits: 30, monitors: 3, pdf: 30, exports: 30, teamSeats: 1 };
  if (p === "pro") return { audits: 300, monitors: 50, pdf: 300, exports: 300, teamSeats: 1 };
  if (p === "ultra") return { audits: 2000, monitors: 300, pdf: 2000, exports: 2000, teamSeats: 10 };
  return { audits: 0, monitors: 0, pdf: 0, exports: 0, teamSeats: 0 };
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
    user.usedMonitors = 0;
    user.usedPdf = 0;
    user.usedExports = 0;
    await user.save();
  }
}

async function consume(user, key, amount = 1) {
  const q = quotasForPlan(user.plan);
  const map = {
    audits: ["usedAudits", q.audits],
    monitors: ["usedMonitors", q.monitors],
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
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "live.com", "msn.com"
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

// ---------- MODELS ----------
// Org (Pack B)
const OrgSchema = new mongoose.Schema(
  {
    name: String,
    normalizedName: { type: String, unique: true, index: true },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, index: true },

    // For future: billing at org level
    createdFromEmailDomain: String,

    // ✅ FIX: settings monitoring doivent être au niveau ORG
    alertRecipients: { type: String, default: "all" }, // "owner" | "all"
    alertExtraEmails: { type: [String], default: [] },
  },
  { timestamps: true }
);

// User
const UserSchema = new mongoose.Schema(
  {
    email: { type: String, unique: true, index: true },
    emailNormalized: { type: String, unique: true, index: true },

    name: String,
    companyName: String,
    companyNameNormalized: { type: String, index: true },
    companyDomain: { type: String, index: true },

    // (ok de laisser, mais les settings utilisés sont ceux de Org)
    alertRecipients: { type: String, default: "all" },
    alertExtraEmails: { type: [String], default: [] },

    // Pack B
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
    usedMonitors: { type: Number, default: 0 },
    usedPdf: { type: Number, default: 0 },
    usedExports: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const TrialRegistrySchema = new mongoose.Schema(
  {
    emailNormalized: { type: String, unique: true, index: true },
    companyNameNormalized: { type: String, index: true },
    companyDomain: { type: String, index: true },
    ipua: { type: String, index: true },
    usedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const LoginTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },
    tokenHash: { type: String, unique: true, index: true },
    expiresAt: { type: Date, index: true },
    usedAt: Date,
  },
  { timestamps: true }
);

// Invite (Pack B)
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
  { timestamps: true }
);

// Data now linked to org (Pack B)
const AuditSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, index: true }, // who ran it (optional)

    url: { type: String, index: true },
    urlNormalized: { type: String, index: true },

    status: { type: String, enum: ["ok", "error"], default: "ok" },
    score: Number,
    summary: String,

    findings: Object,
    recommendations: [String],
    htmlSnapshot: String,
  },
  { timestamps: true }
);

const MonitorSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, index: true }, // creator

    url: String,
    active: { type: Boolean, default: true },
    intervalMinutes: { type: Number, default: 60 },

    lastCheckedAt: Date,
    lastStatus: { type: String, enum: ["up", "down", "unknown"], default: "unknown" },

    lastAlertStatus: { type: String, default: "unknown" },
    lastAlertAt: Date,
  },
  { timestamps: true }
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
  { timestamps: true }
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
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Non autorisé" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token invalide" });
  }
}

async function ensureOrgForUser(user) {
  if (user.orgId) return user;

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

  req.dbUser = user;
  next();
}

function requirePlan(minPlan) {
  return (req, res, next) => {
    if (planRank(req.dbUser.plan) < planRank(minPlan)) return res.status(403).json({ error: `Plan requis: ${minPlan}` });
    next();
  };
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

// ✅ Cron auth
function requireCron(req, res, next) {
  if (!CRON_KEY) return res.status(500).json({ error: "CRON_KEY manquante" });
  const k = req.headers["x-cron-key"] || req.query.cron_key;
  if (k !== CRON_KEY) return res.status(401).json({ error: "Cron non autorisé" });
  next();
}

// ---------- SEO AUDIT ----------
async function fetchWithTiming(url) {
  const t0 = Date.now();
  const r = await fetch(url, { redirect: "follow" });
  const t1 = Date.now();
  const text = await r.text();
  return { status: r.status, ok: r.ok, headers: r.headers, text, ms: t1 - t0, finalUrl: r.url };
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

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString();
  } catch {
    return String(url || "").trim();
  }
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

  const summary =
    fetched.ok
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

// ---------- MONITOR CHECK ----------
async function checkUrlOnce(url) {
  const timeout = Number(process.env.MONITOR_HTTP_TIMEOUT_MS || 8000);
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  const t0 = Date.now();
  try {
    const r = await fetch(url, { redirect: "follow", signal: controller.signal });
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

// ✅ Helpers alerting
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
  const subject = `FlowPoint AI — ${statusLabel}: ${monitorUrl}`;
  const text =
`Organisation: ${orgName}
URL: ${monitorUrl}
Status: ${statusLabel}
HTTP: ${httpStatus || "-"}
Temps: ${responseTimeMs ? `${responseTimeMs}ms` : "-"}
Date: ${when}
Erreur: ${error || "-"}`;

  const html = `
    <h2 style="margin:0">FlowPoint AI — <span style="color:${status === "down" ? "#B00020" : "#0A7A2F"}">${statusLabel}</span></h2>
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
  // Envoie une alerte seulement si changement vs lastAlertStatus (évite spam)
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

    if (await TrialRegistry.findOne({ emailNormalized: emailNorm })) return res.status(403).json({ error: "Essai déjà utilisé pour cet email." });
    if (await TrialRegistry.findOne({ companyNameNormalized: companyNorm })) return res.status(403).json({ error: "Essai déjà utilisé pour cette entreprise." });

    if (domain && !PUBLIC_EMAIL_DOMAINS.has(domain)) {
      if (await TrialRegistry.findOne({ companyDomain: domain })) return res.status(403).json({ error: "Essai déjà utilisé pour ce domaine entreprise." });
    }
    if (await TrialRegistry.findOne({ ipua })) return res.status(403).json({ error: "Essai déjà utilisé (anti-abus navigateur/IP)." });

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

    await TrialRegistry.create({ emailNormalized: emailNorm, companyNameNormalized: companyNorm, companyDomain: domain, ipua });

    await ensureOrgForUser(user);

    return res.json({ ok: true, token: signToken(user) });
  } catch (e) {
    console.log("lead error:", e.message);
    if (String(e.message || "").includes("duplicate key")) return res.status(403).json({ error: "Essai déjà utilisé (anti-abus)." });
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

    await sendEmail({
      to: user.email,
      subject: "FlowPoint AI — Lien de connexion",
      text: `Lien (valide ${LOGIN_LINK_TTL_MINUTES} min): ${link}`,
      html: `<p>Lien (valide <b>${LOGIN_LINK_TTL_MINUTES} min</b>) :</p><p><a href="${link}">${link}</a></p>`,
    });

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

// ---------- STRIPE: CHECKOUT ----------
app.post("/api/stripe/checkout", auth, requireActive, async (req, res) => {
  try {
    const chosenPlan = String(req.body?.plan || "").toLowerCase();
    if (!["standard", "pro", "ultra"].includes(chosenPlan)) return res.status(400).json({ error: "Plan invalide" });

    const user = req.dbUser;
    const priceId = priceIdForPlan(chosenPlan);
    if (!priceId) return res.status(500).json({ error: "PriceId manquant" });

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.companyName || user.name || undefined,
        metadata: { uid: user._id.toString() },
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }

    const baseUrl = safeBaseUrl(req);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
        metadata: { uid: user._id.toString(), plan: chosenPlan },
      },
      metadata: { uid: user._id.toString(), plan: chosenPlan },
      success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/cancel.html`,
      allow_promotion_codes: true,
    });

    return res.json({ url: session.url });
  } catch (e) {
    console.log("checkout error:", e.message);
    return res.status(500).json({ error: "Erreur Stripe checkout" });
  }
});

// ---------- STRIPE: VERIFY SUCCESS ----------
app.get("/api/stripe/verify", async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).json({ error: "session_id manquant" });

    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription", "customer"] });
    const uid = session.metadata?.uid || session.subscription?.metadata?.uid;
    if (!uid) return res.status(400).json({ error: "uid manquant" });

    const user = await User.findById(uid);
    if (!user) return res.status(404).json({ error: "User introuvable" });

    if (session.customer?.id) user.stripeCustomerId = session.customer.id;
    if (session.subscription?.id) user.stripeSubscriptionId = session.subscription.id;

    if (!user.hasTrial) {
      user.hasTrial = true;
      user.trialStartedAt = new Date();
      user.trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    }

    user.accessBlocked = false;
    user.lastPaymentStatus = "checkout_verified";
    user.subscriptionStatus = user.subscriptionStatus || "trialing";

    await ensureOrgForUser(user);
    await user.save();

    await sendEmail({
      to: user.email,
      subject: "Bienvenue sur FlowPoint AI",
      text: `Ton essai est actif. Dashboard: ${process.env.PUBLIC_BASE_URL}/dashboard.html`,
      html: `<p>Ton essai est actif ✅</p><p>Dashboard: <a href="${process.env.PUBLIC_BASE_URL}/dashboard.html">${process.env.PUBLIC_BASE_URL}/dashboard.html</a></p>`,
    });

    return res.json({ ok: true, token: signToken(user) });
  } catch (e) {
    console.log("verify error:", e.message);
    return res.status(500).json({ error: "Erreur verify" });
  }
});

// ---------- STRIPE: CUSTOMER PORTAL ----------
app.post("/api/stripe/portal", auth, requireActive, async (req, res) => {
  try {
    const user = req.dbUser;
    if (!user.stripeCustomerId) return res.status(400).json({ error: "Customer Stripe manquant" });

    const baseUrl = safeBaseUrl(req);
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${baseUrl}/dashboard.html`,
    });

    return res.json({ url: session.url });
  } catch (e) {
    console.log("portal error:", e.message);
    return res.status(500).json({ error: "Erreur portal" });
  }
});

// ---------- ME ----------
app.get("/api/me", auth, requireActive, async (req, res) => {
  const u = req.dbUser;
  const q = quotasForPlan(u.plan);
  const org = u.orgId ? await Org.findById(u.orgId) : null;

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

    usage: {
      month: u.usageMonth,
      audits: { used: u.usedAudits, limit: q.audits },
      monitors: { used: u.usedMonitors, limit: q.monitors },
      pdf: { used: u.usedPdf, limit: q.pdf },
      exports: { used: u.usedExports, limit: q.exports },
    },
  });
});

//
// ===== ORG / TEAM (Ultra) =====
//
app.get("/api/org/members", auth, requireActive, requirePlan("ultra"), async (req, res) => {
  const members = await User.find({ orgId: req.dbUser.orgId }).select("email name role createdAt").sort({ createdAt: 1 });
  return res.json({ ok: true, members });
});

app.post("/api/org/invite", auth, requireActive, requirePlan("ultra"), requireOwner, async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();
    if (!email) return res.status(400).json({ error: "Email requis" });

    const emailNorm = normalizeEmail(email);

    const q = quotasForPlan(req.dbUser.plan);
    const membersCount = await User.countDocuments({ orgId: req.dbUser.orgId });
    if (membersCount >= q.teamSeats) return res.status(403).json({ error: `Limite de membres atteinte (${q.teamSeats}).` });

    const already = await User.findOne({ orgId: req.dbUser.orgId, emailNormalized: emailNorm });
    if (already) return res.status(400).json({ error: "Ce membre est déjà dans l’organisation." });

    const raw = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await Invite.create({
      orgId: req.dbUser.orgId,
      invitedEmail: email.toLowerCase(),
      invitedEmailNormalized: emailNorm,
      tokenHash,
      expiresAt,
      createdByUserId: req.dbUser._id,
    });

    const baseUrl = safeBaseUrl(req);
    const link = `${baseUrl}/invite-accept.html?token=${raw}`;

    await sendEmail({
      to: email.toLowerCase(),
      subject: "FlowPoint AI — Invitation à rejoindre une équipe",
      text: `Tu as été invité à rejoindre l’équipe ${req.dbUser.companyName}. Lien: ${link}`,
      html: `<p>Tu as été invité à rejoindre l’équipe <b>${req.dbUser.companyName}</b>.</p><p><a href="${link}">Accepter l’invitation</a></p><p>Lien: ${link}</p>`,
    });

    return res.json({ ok: true });
  } catch (e) {
    console.log("invite error:", e.message);
    if (String(e.message || "").includes("duplicate key")) return res.status(400).json({ error: "Invitation déjà existante." });
    return res.status(500).json({ error: "Erreur invite" });
  }
});

app.post("/api/org/invite/accept", async (req, res) => {
  try {
    const raw = String(req.body?.token || "");
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim();

    if (!raw) return res.status(400).json({ error: "Token manquant" });
    if (!email) return res.status(400).json({ error: "Email requis" });

    const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
    const inv = await Invite.findOne({ tokenHash });
    if (!inv) return res.status(400).json({ error: "Invitation invalide" });
    if (inv.acceptedAt) return res.status(400).json({ error: "Invitation déjà utilisée" });
    if (inv.expiresAt && new Date(inv.expiresAt).getTime() < Date.now()) return res.status(400).json({ error: "Invitation expirée" });

    const emailNorm = normalizeEmail(email);
    if (emailNorm !== inv.invitedEmailNormalized) return res.status(400).json({ error: "Cet email ne correspond pas à l’invitation" });

    let user = await User.findOne({ emailNormalized: emailNorm });
    if (!user) {
      user = await User.create({
        email: email.toLowerCase(),
        emailNormalized: emailNorm,
        name: name || "",
        companyName: "Team Member",
        companyNameNormalized: "team-member",
        companyDomain: domainFromEmail(emailNorm),
        plan: "standard",
        role: "member",
        orgId: inv.orgId,
        accessBlocked: false,
      });
    } else {
      user.orgId = inv.orgId;
      user.role = "member";
      user.accessBlocked = false;
      if (name && !user.name) user.name = name;
      await user.save();
    }

    inv.acceptedAt = new Date();
    await inv.save();

    return res.json({ ok: true, token: signToken(user) });
  } catch (e) {
    console.log("invite accept error:", e.message);
    return res.status(500).json({ error: "Erreur accept invitation" });
  }
});

//
// ===== SEO AUDIT + CACHE (org-shared) =====
//
app.post("/api/audits/run", auth, requireActive, async (req, res) => {
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

  const ok = await consume(req.dbUser, "audits", 1);
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

  const ok = await consume(req.dbUser, "pdf", 1);
  if (!ok) return res.status(429).json({ error: "Quota PDF dépassé" });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="flowpoint-audit-${a._id}.pdf"`);

  const doc = new PDFDocument({ margin: 48 });
  doc.pipe(res);

  doc.fontSize(22).text("FlowPoint AI", { continued: true }).fontSize(22).text("  — Rapport SEO");
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

//
// ===== MONITORS (org-shared) =====
//
app.post("/api/monitors", auth, requireActive, async (req, res) => {
  const url = String(req.body?.url || "").trim();
  const intervalMinutes = Number(req.body?.intervalMinutes || 60);

  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: "URL invalide" });
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 5) return res.status(400).json({ error: "intervalMinutes min = 5" });

  const ok = await consume(req.dbUser, "monitors", 1);
  if (!ok) return res.status(429).json({ error: "Quota monitors dépassé" });

  const m = await Monitor.create({
    orgId: req.dbUser.orgId,
    userId: req.dbUser._id,
    url,
    intervalMinutes,
    active: true,
  });

  return res.json({ ok: true, monitor: m });
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

  await m.save();
  return res.json({ ok: true, monitor: m });
});

// ✅ run manuel + écrit log + alerte si changement
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

  // ✅ alerte si changement
  await maybeSendMonitorAlert(m, r);

  return res.json({ ok: true, result: r });
});

app.get("/api/monitors/:id/logs", auth, requireActive, async (req, res) => {
  const m = await Monitor.findOne({ _id: req.params.id, orgId: req.dbUser.orgId });
  if (!m) return res.status(404).json({ error: "Monitor introuvable" });

  const logs = await MonitorLog.find({ orgId: req.dbUser.orgId, monitorId: m._id }).sort({ checkedAt: -1 }).limit(200);
  return res.json({ ok: true, logs });
});

// ✅ (4) CRON: exécute automatiquement les monitors "dus"
app.post("/api/cron/monitors-run", requireCron, async (req, res) => {
  try {
    const now = Date.now();
    const limit = Math.min(500, Math.max(1, Number(req.body?.limit || req.query.limit || 200)));

    const activeMonitors = await Monitor.find({ active: true }).sort({ updatedAt: 1 }).limit(limit);
    let checked = 0;
    let alertsSent = 0;

    for (const m of activeMonitors) {
      const last = m.lastCheckedAt ? new Date(m.lastCheckedAt).getTime() : 0;
      const dueMs = (Number(m.intervalMinutes || 60) * 60 * 1000);
      const due = !last || (now - last >= dueMs);
      if (!due) continue;

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
    }

    return res.json({ ok: true, checked, alertsSent, scanned: activeMonitors.length });
  } catch (e) {
    console.log("cron monitors-run error:", e.message);
    return res.status(500).json({ error: "Erreur cron monitors-run" });
  }
});

//
// ===== EXPORTS CSV (org-shared) =====
//
function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

app.get("/api/export/audits.csv", auth, requireActive, async (req, res) => {
  const ok = await consume(req.dbUser, "exports", 1);
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
  const ok = await consume(req.dbUser, "exports", 1);
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

//
// ===== ADMIN (minimal) =====
//
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
    { $set: { usageMonth: firstDayOfThisMonthUTC(), usedAudits: 0, usedMonitors: 0, usedPdf: 0, usedExports: 0 } }
  );
  res.json({ ok: true });
});

// =======================
// DAILY SEO REPORT (API triggerable)
// =======================
app.post("/api/reports/seo-daily", auth, requireActive, async (req, res) => {
  try {
    const audits = await Audit.find({ orgId: req.dbUser.orgId })
      .sort({ createdAt: -1 })
      .limit(10);

    if (!audits.length) {
      return res.json({ ok: true, message: "Aucun audit à inclure." });
    }

    const doc = new PDFDocument({ margin: 40 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", async () => {
      const pdfBuffer = Buffer.concat(chunks);

      await sendEmail({
        to: req.dbUser.email,
        subject: "📊 FlowPoint AI — Rapport SEO quotidien",
        text: "Votre rapport SEO quotidien est en pièce jointe.",
        html: "<p>Rapport SEO quotidien en pièce jointe.</p>",
        attachments: [{ filename: "seo-report.pdf", content: pdfBuffer }],
      });

      res.json({ ok: true });
    });

    doc.fontSize(20).text("FlowPoint AI — Rapport SEO quotidien");
    doc.moveDown();

    audits.forEach((a) => {
      doc.fontSize(12).text(`URL: ${a.url}`);
      doc.text(`Score: ${a.score}/100`);
      doc.text(`Résumé: ${a.summary}`);
      doc.moveDown();
    });

    doc.end();
  } catch (e) {
    console.log("daily seo report error:", e.message);
    res.status(500).json({ error: "Erreur rapport SEO quotidien" });
  }
});

// =======================
// Monitoring Settings + Monthly Reliability Report (Ultra)
// + PDF endpoint
// =======================

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function reliabilityScoreFromStats({ uptimePct, downs, avgMs }) {
  let score = uptimePct;
  score -= Math.min(25, downs * 1.5);
  if (avgMs > 1200) {
    const extra = clamp((avgMs - 1200) / 2000, 0, 1);
    score -= extra * 15;
  }
  return Math.round(clamp(score, 0, 100));
}

async function computeOrgMonthlyReport(orgId) {
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const logs = await MonitorLog.find({ orgId, checkedAt: { $gte: from } })
    .select("url status responseTimeMs checkedAt");

  const byUrl = new Map();
  for (const l of logs) {
    const url = String(l.url || "").trim();
    if (!url) continue;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(l);
  }

  const sites = [];
  for (const [url, arr] of byUrl.entries()) {
    const total = arr.length || 0;
    const up = arr.filter(x => x.status === "up").length;
    const down = arr.filter(x => x.status === "down").length;
    const uptimePct = total ? (up / total) * 100 : 0;

    const avgMs = total
      ? Math.round(arr.reduce((s, x) => s + (Number(x.responseTimeMs || 0) || 0), 0) / total)
      : 0;

    let incidents = 0;
    const sorted = arr.slice().sort((a, b) => new Date(a.checkedAt) - new Date(b.checkedAt));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].status === "up" && sorted[i].status === "down") incidents++;
    }

    const score = reliabilityScoreFromStats({ uptimePct, downs: incidents, avgMs });

    sites.push({
      url,
      totalChecks: total,
      uptimePct: Math.round(uptimePct * 100) / 100,
      avgMs,
      downLogs: down,
      incidents,
      score,
    });
  }

  sites.sort((a, b) => b.score - a.score);

  const totalChecks = sites.reduce((s, x) => s + x.totalChecks, 0);
  const weightedUptime = totalChecks
    ? sites.reduce((s, x) => s + x.uptimePct * x.totalChecks, 0) / totalChecks
    : 0;
  const weightedAvgMs = totalChecks
    ? Math.round(sites.reduce((s, x) => s + x.avgMs * x.totalChecks, 0) / totalChecks)
    : 0;
  const totalIncidents = sites.reduce((s, x) => s + x.incidents, 0);

  const globalScore = reliabilityScoreFromStats({
    uptimePct: weightedUptime,
    downs: totalIncidents,
    avgMs: weightedAvgMs,
  });

  return {
    rangeDays: 30,
    generatedAt: new Date().toISOString(),
    global: {
      reliabilityScore: globalScore,
      uptimePct: Math.round(weightedUptime * 100) / 100,
      avgMs: weightedAvgMs,
      incidents: totalIncidents,
      sitesCount: sites.length,
    },
    sites,
  };
}

// ✅ GET current org monitoring settings
app.get("/api/org/monitor-settings", auth, requireActive, async (req, res) => {
  const org = await Org.findById(req.dbUser.orgId).select("alertRecipients alertExtraEmails name");
  if (!org) return res.status(404).json({ error: "Org introuvable" });

  return res.json({
    ok: true,
    settings: {
      alertRecipients: org.alertRecipients || "all",
      alertExtraEmails: Array.isArray(org.alertExtraEmails) ? org.alertExtraEmails : [],
    }
  });
});

// ✅ Update org monitoring settings (owner only)
app.post("/api/org/monitor-settings", auth, requireActive, requireOwner, async (req, res) => {
  const alertRecipients = String(req.body?.alertRecipients || "all").toLowerCase();
  const alertExtraEmails = Array.isArray(req.body?.alertExtraEmails) ? req.body.alertExtraEmails : [];

  if (!["all", "owner"].includes(alertRecipients)) return res.status(400).json({ error: "alertRecipients invalide" });

  const cleaned = [...new Set(alertExtraEmails.map(x => String(x || "").trim().toLowerCase()).filter(Boolean))].slice(0, 25);

  await Org.updateOne(
    { _id: req.dbUser.orgId },
    { $set: { alertRecipients, alertExtraEmails: cleaned } }
  );

  return res.json({ ok: true });
});

// ✅ Compat endpoints (dashboard fallback): /api/org/settings
app.get("/api/org/settings", auth, requireActive, async (req, res) => {
  const org = await Org.findById(req.dbUser.orgId).select("alertRecipients alertExtraEmails name");
  if (!org) return res.status(404).json({ error: "Org introuvable" });
  return res.json({
    ok: true,
    settings: {
      alertRecipients: org.alertRecipients || "all",
      alertExtraEmails: Array.isArray(org.alertExtraEmails) ? org.alertExtraEmails : [],
    }
  });
});
app.post("/api/org/settings", auth, requireActive, requireOwner, async (req, res) => {
  // même logique
  const alertRecipients = String(req.body?.alertRecipients || "all").toLowerCase();
  const alertExtraEmails = Array.isArray(req.body?.alertExtraEmails) ? req.body.alertExtraEmails : [];
  if (!["all", "owner"].includes(alertRecipients)) return res.status(400).json({ error: "alertRecipients invalide" });
  const cleaned = [...new Set(alertExtraEmails.map(x => String(x || "").trim().toLowerCase()).filter(Boolean))].slice(0, 25);
  await Org.updateOne({ _id: req.dbUser.orgId }, { $set: { alertRecipients, alertExtraEmails: cleaned } });
  return res.json({ ok: true });
});

// ✅ Ultra only: monthly reliability report JSON for dashboard
app.get("/api/monitoring/monthly-report", auth, requireActive, requirePlan("ultra"), async (req, res) => {
  const report = await computeOrgMonthlyReport(req.dbUser.orgId);
  return res.json({ ok: true, report });
});

// ✅ (6) Ultra only: monthly reliability report PDF
app.get("/api/monitoring/monthly-report/pdf", auth, requireActive, requirePlan("ultra"), async (req, res) => {
  try {
    const ok = await consume(req.dbUser, "pdf", 1);
    if (!ok) return res.status(429).json({ error: "Quota PDF dépassé" });

    const org = await Org.findById(req.dbUser.orgId).select("name");
    const report = await computeOrgMonthlyReport(req.dbUser.orgId);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="flowpoint-monitoring-report.pdf"`);

    const doc = new PDFDocument({ margin: 48 });
    doc.pipe(res);

    doc.fontSize(22).text("FlowPoint AI", { continued: true }).fontSize(22).text("  — Rapport Monitoring (30j)");
    doc.moveDown(0.5);
    doc.fontSize(12).text(`Organisation: ${org?.name || "—"}`);
    doc.text(`Généré: ${new Date(report.generatedAt).toLocaleString("fr-FR")}`);
    doc.moveDown();

    doc.fontSize(14).text("Résumé global", { underline: true });
    doc.moveDown(0.25);
    doc.fontSize(12).text(`Score fiabilité: ${report.global.reliabilityScore}/100`);
    doc.text(`Uptime: ${report.global.uptimePct}%`);
    doc.text(`Latence moyenne: ${report.global.avgMs}ms`);
    doc.text(`Incidents: ${report.global.incidents}`);
    doc.text(`Sites suivis: ${report.global.sitesCount}`);
    doc.moveDown();

    doc.fontSize(14).text("Détails par site", { underline: true });
    doc.moveDown(0.25);

    const sites = Array.isArray(report.sites) ? report.sites : [];
    if (!sites.length) {
      doc.fontSize(12).text("Aucun log sur les 30 derniers jours.");
      doc.end();
      return;
    }

    // tableau simple (liste)
    for (const s of sites.slice(0, 60)) {
      doc.fontSize(12).text(`• ${s.url}`);
      doc.fontSize(10).fillColor("#444").text(
        `  score=${s.score}/100  uptime=${s.uptimePct}%  avg=${s.avgMs}ms  incidents=${s.incidents}  checks=${s.totalChecks}`
      ).fillColor("#000");
      doc.moveDown(0.2);
    }

    doc.end();
  } catch (e) {
    console.log("monthly report pdf error:", e.message);
    return res.status(500).json({ error: "Erreur PDF monitoring" });
  }
});

// ---------- START ----------
app.listen(PORT, () => console.log(`✅ FlowPoint SaaS (Pack B) lancé sur port ${PORT}`));
