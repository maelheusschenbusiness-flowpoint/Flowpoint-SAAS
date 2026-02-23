// =======================
// FlowPoint AI – SaaS Backend (Pack A + Pack B)
// Plans: Standard / Pro / Ultra
// Pack A: SEO Audit + Cache + PDF + Monitoring + Logs + CSV + Magic Link + Admin
// Pack B: Orgs + Team Ultra (Invites) + Roles + Shared data per org
// =======================

/* =========================================================
   PART 1/2 — SETUP, CONFIG, HELPERS, MODELS, MIDDLEWARES
   ========================================================= */

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
app.set("trust proxy", 1);

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

const CRON_KEY = process.env.CRON_KEY || "";
if (!CRON_KEY) console.log("⚠️ CRON_KEY manquante (cron monitors non sécurisé)");

// ---------- SMTP / RESEND ----------
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
    secure: boolEnv(process.env.SMTP_SECURE), // 465 => true, 587 => false
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });

  return _cachedTransport;
}

// ✅ Port 443 = HTTPS (Resend API). Rien à configurer côté code.
async function sendEmail({ to, subject, text, html, attachments, bcc }) {
  try {
    // 1) Resend API (si clé)
    if (process.env.RESEND_API_KEY) {
      const toList = String(to || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const bccList = bcc
        ? String(bcc)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;

      const payload = {
        from: process.env.ALERT_EMAIL_FROM, // ex: "FlowPoint AI <support@flowpoint.pro>"
        to: toList,
        subject,
        text: text || undefined,
        html: html || undefined,
        bcc: bccList && bccList.length ? bccList : undefined,
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

      console.log("✅ Email envoyé (Resend API):", data?.id, "=>", toList.join(","));
      return { ok: true };
    }

    // 2) SMTP fallback
    const t = getMailer();
    if (!t) {
      console.log("⚠️ SMTP non configuré, email ignoré:", subject);
      return { ok: false, skipped: true };
    }

    const info = await t.sendMail({
      from: process.env.ALERT_EMAIL_FROM,
      to,
      bcc,
      subject,
      text,
      html,
      attachments,
    });

    console.log("✅ Email envoyé (SMTP):", info.messageId, "=>", to);
    return { ok: true };
  } catch (e) {
    console.log("❌ Email error:", e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

function safeBaseUrl(req) {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/+$/, "");
  if (base) return base;
  return `https://${req.headers.host}`;
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
  "gmail.com","googlemail.com","yahoo.com","outlook.com","hotmail.com","icloud.com","live.com","msn.com",
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
const OrgSchema = new mongoose.Schema(
  {
    name: String,
    normalizedName: { type: String, unique: true, index: true },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, index: true },
    createdFromEmailDomain: String,
    alertRecipients: { type: String, default: "all" }, // "owner" | "all"
    alertExtraEmails: { type: [String], default: [] },
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
    usedMonitors: { type: Number, default: 0 },
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

function requireCron(req, res, next) {
  if (!CRON_KEY) return res.status(500).json({ error: "CRON_KEY manquante" });
  const k = req.headers["x-cron-key"] || req.query.cron_key;
  if (k !== CRON_KEY) return res.status(401).json({ error: "Cron non autorisé" });
  next();
}
/* =========================================================
   PART 2/2 — ROUTES, WEBHOOK, MIDDLEWARES, START
   ========================================================= */

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

// ---------- AUTH: LOGIN MAGIC LINK ----------
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

function magicLinkEmailHtml({ link, ttlMinutes }) {
  const brand = {
    bg: "#0b1220",
    card: "#111a2e",
    primary: "#0052CC",
    text: "#e5e7eb",
    muted: "#a3a3a3",
  };

  return `
  <div style="background:${brand.bg};padding:32px 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;">
    <div style="max-width:560px;margin:0 auto;background:${brand.card};border-radius:16px;padding:24px;border:1px solid rgba(255,255,255,.08)">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <div style="width:44px;height:44px;border-radius:12px;background:rgba(0,82,204,.18);display:flex;align-items:center;justify-content:center">
          <div style="width:18px;height:18px;border-radius:6px;background:${brand.primary}"></div>
        </div>
        <div>
          <div style="color:${brand.text};font-weight:900;font-size:18px;line-height:1">FlowPoint AI</div>
          <div style="color:${brand.muted};font-size:13px">Connexion sécurisée (sans mot de passe)</div>
        </div>
      </div>

      <h2 style="margin:12px 0 8px;color:${brand.text};font-size:18px">Ton lien de connexion</h2>
      <p style="margin:0 0 18px;color:${brand.muted};font-size:14px;line-height:1.5">
        Ce lien est valide <b>${ttlMinutes} minutes</b>. Si tu n’es pas à l’origine de cette demande, ignore cet email.
      </p>

      <a href="${link}"
         style="display:inline-block;background:${brand.primary};color:white;text-decoration:none;
                padding:12px 16px;border-radius:12px;font-weight:900;">
        Se connecter
      </a>

      <p style="margin:18px 0 6px;color:${brand.muted};font-size:12px">
        Bouton ne marche pas ? Copie-colle ce lien :
      </p>
      <p style="margin:0;color:${brand.text};font-size:12px;word-break:break-all">
        ${link}
      </p>

      <div style="margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,.08);
                  color:${brand.muted};font-size:12px">
        © ${new Date().getFullYear()} FlowPoint AI
      </div>
    </div>
  </div>
  `;
}

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

    const html = magicLinkEmailHtml({ link, ttlMinutes: LOGIN_LINK_TTL_MINUTES });

    const r = await sendEmail({
      to: user.email,
      subject: "FlowPoint AI — Ton lien de connexion",
      text: `Lien (valide ${LOGIN_LINK_TTL_MINUTES} min): ${link}`,
      html,
    });

    if (!r.ok) {
      return res.status(502).json({
        ok: false,
        error: "Email non envoyé",
        debugLink: String(process.env.DEBUG_LOGIN_LINK || "").toLowerCase() === "true" ? link : undefined,
      });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.log("login-request error:", e.message);
    return res.status(500).json({ error: "Erreur login-request" });
  }
});

// ✅ IMPORTANT: alias GET + POST (comme ça même si front se trompe, ça marche)
async function handleLoginVerify(req, res) {
  try {
    const raw = String(req.query?.token || req.body?.token || "");
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
}

app.get("/api/auth/login-verify", handleLoginVerify);
app.post("/api/auth/login-verify", handleLoginVerify);

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

// ---------- START ----------
app.listen(PORT, () => console.log(`✅ FlowPoint SaaS lancé sur port ${PORT}`));
