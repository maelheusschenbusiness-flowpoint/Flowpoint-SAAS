// =======================
// FlowPoint — index.js
// Backend principal propre + compatible dashboard / billing / addons / admin
// =======================

require("dotenv").config();

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const PDFDocument = require("pdfkit");
const cheerio = require("cheerio");

const { buildStripeModule } = require("./stripe");

// -----------------------
// ENV
// -----------------------
const {
  PORT = 3000,
  PUBLIC_BASE_URL,
  JWT_SECRET,
  MONGO_URI,
  CRON_KEY,
  ADMIN_KEY,
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET_RENDER,
  STRIPE_PRICE_ID_STANDARD,
  STRIPE_PRICE_ID_PRO,
  STRIPE_PRICE_ID_ULTRA,
} = process.env;

if (!MONGO_URI) console.log("❌ ENV manquante: MONGO_URI");
if (!JWT_SECRET) console.log("❌ ENV manquante: JWT_SECRET");
if (!STRIPE_SECRET_KEY) console.log("❌ ENV manquante: STRIPE_SECRET_KEY");

// -----------------------
// APP
// -----------------------
const app = express();

app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

app.use(
  cors({
    origin: true,
    credentials: true,
  })
);

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", apiLimiter);

// Stripe webhook raw body must come BEFORE express.json on that route
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" })
);

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

app.use(express.static(path.join(__dirname, "public")));

// -----------------------
// DB
// -----------------------
mongoose.set("strictQuery", true);

mongoose
  .connect(MONGO_URI, {
    serverSelectionTimeoutMS: 15000,
  })
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.log("❌ MongoDB error:", err.message));

// -----------------------
// HELPERS
// -----------------------
function boolEnv(v) {
  return String(v || "").toLowerCase() === "true";
}

function now() {
  return new Date();
}

function startOfUtcMonth(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
}

function firstDayOfMonthLabel(date = new Date()) {
  const d = startOfUtcMonth(date);
  return d.toISOString();
}

function escCsv(value) {
  const s = String(value ?? "");
  if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function safeBaseUrl(req) {
  if (PUBLIC_BASE_URL && String(PUBLIC_BASE_URL).trim()) {
    return String(PUBLIC_BASE_URL).replace(/\/+$/, "");
  }
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}

function signToken(user) {
  return jwt.sign(
    {
      uid: String(user._id),
      email: user.email,
      orgId: user.orgId ? String(user.orgId) : null,
      role: user.role || "owner",
      plan: user.plan || "standard",
    },
    JWT_SECRET,
    { expiresIn: "2h" }
  );
}

function signRefreshToken(user) {
  return jwt.sign(
    {
      uid: String(user._id),
      type: "refresh",
    },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function randomToken(size = 32) {
  return crypto.randomBytes(size).toString("hex");
}

function sha256(input) {
  return crypto.createHash("sha256").update(String(input || "")).digest("hex");
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeCompanyName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s.-]/gu, "");
}

function getCompanyDomain(email) {
  const e = normalizeEmail(email);
  const parts = e.split("@");
  return parts[1] || "";
}

function usageShape(limit = 0, used = 0) {
  return { used: Number(used || 0), limit: Number(limit || 0) };
}

function ensureMonthUsageReset(user) {
  const currentMonth = firstDayOfMonthLabel(new Date());
  if (user.usageMonth !== currentMonth) {
    user.usageMonth = currentMonth;
    user.usage = {
      audits: 0,
      pdf: 0,
      exports: 0,
      monitorsCreated: 0,
    };
  }
}

function planLimits(plan = "standard", org = null) {
  const p = String(plan || "standard").toLowerCase();

  let audits = 30;
  let monitors = 3;
  let pdf = 30;
  let exportsCount = 30;
  let seats = 1;

  if (p === "pro") {
    audits = 300;
    monitors = 50;
    pdf = 300;
    exportsCount = 300;
    seats = 3;
  }

  if (p === "ultra") {
    audits = 2000;
    monitors = 300;
    pdf = 2000;
    exportsCount = 2000;
    seats = 10;
  }

  const addons = org?.billingAddons || {};

  audits += Number(addons.auditsPack200 || 0) * 200;
  audits += Number(addons.auditsPack1000 || 0) * 1000;
  pdf += Number(addons.pdfPack200 || 0) * 200;
  exportsCount += Number(addons.exportsPack1000 || 0) * 1000;
  monitors += Number(addons.monitorsPack50 || 0) * 50;
  seats += Number(addons.extraSeats || 0);

  return {
    audits,
    monitors,
    pdf,
    exports: exportsCount,
    seats,
  };
}

function mapUsageForClient(user, org) {
  ensureMonthUsageReset(user);
  const limits = planLimits(user.plan, org);

  return {
    audits: usageShape(limits.audits, user.usage?.audits || 0),
    pdf: usageShape(limits.pdf, user.usage?.pdf || 0),
    exports: usageShape(limits.exports, user.usage?.exports || 0),
    monitors: usageShape(
      limits.monitors,
      org?.monitorCountCache || 0
    ),
  };
}

function computeSeoSummary(html) {
  try {
    const $ = cheerio.load(String(html || ""));
    const title = $("title").first().text().trim();
    const desc = $('meta[name="description"]').attr("content") || "";
    const h1Count = $("h1").length;
    const imgs = $("img").length;
    const imgsMissingAlt = $("img").filter((_, el) => !$(el).attr("alt")).length;
    const canon = $('link[rel="canonical"]').attr("href") || "";
    const robots = $('meta[name="robots"]').attr("content") || "";

    let score = 100;
    const recommendations = [];
    const findings = {};

    findings.title = { ok: !!title, value: title || "Absente" };
    findings.description = { ok: !!desc, value: desc || "Absente" };
    findings.h1 = { ok: h1Count >= 1, value: h1Count };
    findings.imagesAlt = { ok: imgs === 0 || imgsMissingAlt === 0, value: `${imgsMissingAlt}/${imgs}` };
    findings.canonical = { ok: !!canon, value: canon || "Absent" };
    findings.robots = { ok: !/noindex/i.test(robots), value: robots || "Default" };

    if (!title) {
      score -= 18;
      recommendations.push("Ajouter une balise title claire et pertinente.");
    }
    if (!desc) {
      score -= 14;
      recommendations.push("Ajouter une meta description pour améliorer le CTR.");
    }
    if (h1Count < 1) {
      score -= 14;
      recommendations.push("Ajouter un H1 principal sur la page.");
    }
    if (imgsMissingAlt > 0) {
      score -= Math.min(16, imgsMissingAlt * 2);
      recommendations.push("Ajouter des attributs alt sur les images.");
    }
    if (!canon) {
      score -= 8;
      recommendations.push("Ajouter une URL canonique.");
    }
    if (/noindex/i.test(robots)) {
      score -= 25;
      recommendations.push("Vérifier la directive robots noindex.");
    }

    score = Math.max(5, Math.min(100, Math.round(score)));

    let summary = "Audit SEO généré automatiquement.";
    if (score >= 80) summary = "La page est globalement saine avec peu de corrections prioritaires.";
    else if (score >= 55) summary = "La page a une base correcte mais nécessite plusieurs optimisations.";
    else summary = "La page présente plusieurs problèmes SEO prioritaires à corriger.";

    return {
      score,
      summary,
      recommendations,
      findings,
    };
  } catch (e) {
    return {
      score: 25,
      summary: "Impossible d’analyser le HTML proprement.",
      recommendations: ["Vérifier le contenu HTML envoyé au backend."],
      findings: {},
    };
  }
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "FlowPointBot/1.0 (+SEO Audit)",
      },
    });

    const html = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      html,
    };
  } finally {
    clearTimeout(t);
  }
}

function requireCronKey(req, res, next) {
  const k = req.headers["x-cron-key"] || req.query.key;
  if (!CRON_KEY || String(k || "") !== String(CRON_KEY)) {
    return res.status(401).json({ error: "Unauthorized cron" });
  }
  next();
}

function requireAdmin(req, res, next) {
  const k = String(req.headers["x-admin-key"] || "").trim();
  if (!ADMIN_KEY || k !== String(ADMIN_KEY).trim()) {
    return res.status(401).json({ error: "Admin key invalide" });
  }
  next();
}

async function authRequired(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

    if (!token) return res.status(401).json({ error: "Token manquant" });

    const payload = verifyToken(token);
    const user = await User.findById(payload.uid);

    if (!user) return res.status(401).json({ error: "Utilisateur introuvable" });
    if (user.accessBlocked) return res.status(403).json({ error: "Accès bloqué" });

    ensureMonthUsageReset(user);
    await user.save();

    req.auth = payload;
    req.dbUser = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Token invalide" });
  }
}

// -----------------------
// MODELS
// -----------------------
const OrgSchema = new mongoose.Schema(
  {
    name: { type: String, default: "Workspace principal" },
    normalizedName: { type: String, index: true },
    ownerUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },

    alertRecipients: { type: String, default: "all" }, // all | owner
    alertExtraEmails: { type: [String], default: [] },

    billingAddons: {
      whiteLabel: { type: Boolean, default: true },
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
    },

    credits: {
      audits: { type: Number, default: 0 },
      pdf: { type: Number, default: 0 },
      exports: { type: Number, default: 0 },
    },

    retentionDays: { type: Number, default: 30 },
    inviteToken: { type: String, default: "" },
    inviteEmail: { type: String, default: "" },
    inviteExpiresAt: { type: Date, default: null },

    monitorCountCache: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "orgs" }
);

const UserSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    email: { type: String, required: true, index: true },
    emailNormalized: { type: String, required: true, index: true, unique: true },

    role: { type: String, default: "owner" }, // owner | member
    plan: { type: String, default: "standard" },

    orgId: { type: mongoose.Schema.Types.ObjectId, ref: "Org", index: true },

    stripeCustomerId: { type: String, default: "" },
    stripeSubscriptionId: { type: String, default: "" },
    subscriptionStatus: { type: String, default: "" },
    lastPaymentStatus: { type: String, default: "" },

    hasTrial: { type: Boolean, default: false },
    trialStartedAt: { type: Date, default: null },
    trialEndsAt: { type: Date, default: null },

    accessBlocked: { type: Boolean, default: false },

    usageMonth: { type: String, default: firstDayOfMonthLabel(new Date()) },
    usage: {
      audits: { type: Number, default: 0 },
      pdf: { type: Number, default: 0 },
      exports: { type: Number, default: 0 },
      monitorsCreated: { type: Number, default: 0 },
    },

    addons: {
      whiteLabel: { type: Boolean, default: true },
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
    },
  },
  { timestamps: true, collection: "users" }
);

const TrialRegistrySchema = new mongoose.Schema(
  {
    emailNormalized: { type: String, default: "" },
    companyNameNormalized: { type: String, default: "" },
    companyDomain: { type: String, default: "" },
    fingerprint: { type: String, default: "" },
    ipua: { type: String, default: "" },
  },
  { timestamps: true, collection: "trialregistries" }
);

const LoginTokenSchema = new mongoose.Schema(
  {
    emailNormalized: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    usedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "logintokens" }
);

const AuditSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: "Org", index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    url: { type: String, default: "", index: true },
    score: { type: Number, default: 0 },
    summary: { type: String, default: "" },
    recommendations: { type: [String], default: [] },
    findings: { type: mongoose.Schema.Types.Mixed, default: {} },
    htmlSnapshot: { type: String, default: "" },
    status: { type: String, default: "ok" },
  },
  { timestamps: true, collection: "audits" }
);

const MonitorSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: "Org", index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    url: { type: String, default: "", index: true },
    active: { type: Boolean, default: true },
    intervalMinutes: { type: Number, default: 60 },
    lastCheckedAt: { type: Date, default: null },
    lastStatus: { type: String, default: "unknown" },
    lastHttpStatus: { type: Number, default: 0 },
    lastResponseTimeMs: { type: Number, default: 0 },
    lastError: { type: String, default: "" },
  },
  { timestamps: true, collection: "monitors" }
);

const MonitorLogSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: "Org", index: true },
    monitorId: { type: mongoose.Schema.Types.ObjectId, ref: "Monitor", index: true },
    url: { type: String, default: "" },
    status: { type: String, default: "unknown", index: true },
    httpStatus: { type: Number, default: 0 },
    responseTimeMs: { type: Number, default: 0 },
    error: { type: String, default: "" },
    checkedAt: { type: Date, default: now, index: true },
  },
  { timestamps: true, collection: "monitorlogs" }
);

const Org = mongoose.models.Org || mongoose.model("Org", OrgSchema);
const User = mongoose.models.User || mongoose.model("User", UserSchema);
const TrialRegistry =
  mongoose.models.TrialRegistry || mongoose.model("TrialRegistry", TrialRegistrySchema);
const LoginToken = mongoose.models.LoginToken || mongoose.model("LoginToken", LoginTokenSchema);
const Audit = mongoose.models.Audit || mongoose.model("Audit", AuditSchema);
const Monitor = mongoose.models.Monitor || mongoose.model("Monitor", MonitorSchema);
const MonitorLog = mongoose.models.MonitorLog || mongoose.model("MonitorLog", MonitorLogSchema);

// -----------------------
// ORG HELPERS
// -----------------------
async function ensureOrgDefaults(org) {
  if (!org) return null;

  if (!org.name) org.name = "Workspace principal";
  if (!org.normalizedName) org.normalizedName = normalizeCompanyName(org.name);

  if (!org.alertRecipients) org.alertRecipients = "all";
  if (!Array.isArray(org.alertExtraEmails)) org.alertExtraEmails = [];

  if (!org.billingAddons) {
    org.billingAddons = {
      whiteLabel: true,
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
    };
  }

  if (!org.credits) {
    org.credits = { audits: 0, pdf: 0, exports: 0 };
  }

  if (!org.retentionDays) org.retentionDays = 30;
  if (typeof org.monitorCountCache !== "number") org.monitorCountCache = 0;

  return org;
}

async function ensureOrgForUser(user) {
  if (user.orgId) {
    const existing = await Org.findById(user.orgId);
    if (existing) {
      await ensureOrgDefaults(existing);
      await existing.save();
      return existing;
    }
  }

  const orgName = user.name ? `${user.name} Workspace` : "Workspace principal";

  const org = await Org.create({
    name: orgName,
    normalizedName: normalizeCompanyName(orgName),
    ownerUserId: user._id,
    alertRecipients: "all",
    alertExtraEmails: [],
    billingAddons: {
      whiteLabel: true,
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
    },
    credits: { audits: 0, pdf: 0, exports: 0 },
    retentionDays: 30,
    monitorCountCache: 0,
  });

  user.orgId = org._id;
  if (!user.role) user.role = "owner";
  await user.save();

  return org;
}

async function refreshOrgMonitorCount(orgId) {
  if (!orgId) return 0;
  const count = await Monitor.countDocuments({ orgId, active: true });
  await Org.updateOne({ _id: orgId }, { $set: { monitorCountCache: count } });
  return count;
}
// -----------------------
// STRIPE MODULE
// -----------------------
function priceIdForPlan(plan) {
  const p = String(plan || "").toLowerCase();
  if (p === "standard") return STRIPE_PRICE_ID_STANDARD;
  if (p === "pro") return STRIPE_PRICE_ID_PRO;
  if (p === "ultra") return STRIPE_PRICE_ID_ULTRA;
  return "";
}

const stripeModule = buildStripeModule({
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: STRIPE_WEBHOOK_SECRET_RENDER,
  priceIdForPlan,
  safeBaseUrl,
  signToken,
  ensureOrgForUser,
  ensureOrgDefaults,
  User,
  Org,
});

// -----------------------
// AUTH ROUTES
// -----------------------
app.post("/api/auth/login-request", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "Email requis" });

    let user = await User.findOne({ emailNormalized: email });

    if (!user) {
      user = await User.create({
        name: email.split("@")[0],
        email,
        emailNormalized: email,
        role: "owner",
        plan: "standard",
        accessBlocked: false,
        usageMonth: firstDayOfMonthLabel(new Date()),
        usage: {
          audits: 0,
          pdf: 0,
          exports: 0,
          monitorsCreated: 0,
        },
      });

      await ensureOrgForUser(user);
    }

    const rawToken = randomToken(24);
    const tokenHash = sha256(rawToken);

    await LoginToken.create({
      emailNormalized: email,
      tokenHash,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    const debugLink = `${safeBaseUrl(req)}/login-verify.html?token=${encodeURIComponent(rawToken)}`;

    return res.json({
      ok: true,
      debugLink,
    });
  } catch (e) {
    console.log("login-request error:", e.message);
    return res.status(500).json({ error: "Erreur login-request" });
  }
});

app.get("/api/auth/login-verify", async (req, res) => {
  try {
    const token = String(req.query?.token || "").trim();
    if (!token) return res.status(400).json({ error: "Token manquant" });

    const tokenHash = sha256(token);

    const loginToken = await LoginToken.findOne({
      tokenHash,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    });

    if (!loginToken) return res.status(400).json({ error: "Lien invalide ou expiré" });

    loginToken.usedAt = new Date();
    await loginToken.save();

    const user = await User.findOne({ emailNormalized: loginToken.emailNormalized });
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });

    await ensureOrgForUser(user);
    ensureMonthUsageReset(user);
    await user.save();

    const jwtToken = signToken(user);
    const refreshToken = signRefreshToken(user);

    return res.json({
      ok: true,
      token: jwtToken,
      refreshToken,
    });
  } catch (e) {
    console.log("login-verify error:", e.message);
    return res.status(500).json({ error: "Erreur login-verify" });
  }
});

app.post("/api/auth/refresh", async (req, res) => {
  try {
    const refreshToken = String(req.body?.refreshToken || "").trim();
    if (!refreshToken) return res.status(400).json({ error: "Refresh token manquant" });

    const payload = verifyToken(refreshToken);
    if (payload?.type !== "refresh") return res.status(401).json({ error: "Refresh token invalide" });

    const user = await User.findById(payload.uid);
    if (!user) return res.status(401).json({ error: "Utilisateur introuvable" });

    const nextToken = signToken(user);
    const nextRefresh = signRefreshToken(user);

    return res.json({
      ok: true,
      token: nextToken,
      refreshToken: nextRefresh,
    });
  } catch (e) {
    return res.status(401).json({ error: "Refresh token invalide" });
  }
});

// -----------------------
// BASIC / HEALTH
// -----------------------
app.get("/api/health", async (_req, res) => {
  try {
    return res.json({
      ok: true,
      dbReady: mongoose.connection.readyState === 1,
      now: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ ok: false });
  }
});

// -----------------------
// STRIPE ROUTES
// -----------------------
app.post("/api/stripe/checkout", authRequired, stripeModule.checkoutPlan);
app.post("/api/stripe/checkout-embedded", authRequired, stripeModule.checkoutEmbedded);
app.get("/api/stripe/verify", stripeModule.verifyCheckout);
app.post("/api/stripe/portal", authRequired, stripeModule.customerPortal);

// Rebind webhook with raw body route
app._router.stack = app._router.stack.filter(
  (layer) => !(layer.route && layer.route.path === "/api/stripe/webhook")
);

app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  stripeModule.webhookHandler
);

// -----------------------
// /api/me
// -----------------------
app.get("/api/me", authRequired, async (req, res) => {
  try {
    const user = req.dbUser;
    const org = user.orgId ? await Org.findById(user.orgId) : null;
    if (org) await ensureOrgDefaults(org);

    const usage = mapUsageForClient(user, org);

    user.addons = user.addons || {};
    if (org?.billingAddons) {
      user.addons = {
        whiteLabel: !!org.billingAddons.whiteLabel,
        monitorsPack50: Number(org.billingAddons.monitorsPack50 || 0),
        extraSeats: Number(org.billingAddons.extraSeats || 0),
        retention90d: !!org.billingAddons.retention90d,
        retention365d: !!org.billingAddons.retention365d,
        auditsPack200: Number(org.billingAddons.auditsPack200 || 0),
        auditsPack1000: Number(org.billingAddons.auditsPack1000 || 0),
        pdfPack200: Number(org.billingAddons.pdfPack200 || 0),
        exportsPack1000: Number(org.billingAddons.exportsPack1000 || 0),
        prioritySupport: !!org.billingAddons.prioritySupport,
        customDomain: !!org.billingAddons.customDomain,
      };
      await user.save();
    }

    return res.json({
      _id: user._id,
      name: user.name || "",
      email: user.email,
      role: user.role || "owner",
      plan: user.plan || "standard",
      accessBlocked: !!user.accessBlocked,

      subscriptionStatus: user.subscriptionStatus || "",
      lastPaymentStatus: user.lastPaymentStatus || "",

      hasTrial: !!user.hasTrial,
      trialStartedAt: user.trialStartedAt,
      trialEndsAt: user.trialEndsAt,

      usage,

      addons: user.addons || {},

      org: org
        ? {
            _id: org._id,
            name: org.name || "Workspace principal",
          }
        : null,
    });
  } catch (e) {
    console.log("/api/me error:", e.message);
    return res.status(500).json({ error: "Erreur /api/me" });
  }
});

// -----------------------
// /api/overview
// -----------------------
app.get("/api/overview", authRequired, async (req, res) => {
  try {
    const user = req.dbUser;
    const days = [3, 7, 30].includes(Number(req.query?.days)) ? Number(req.query.days) : 30;

    const org = user.orgId ? await Org.findById(user.orgId) : null;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const audits = await Audit.find({
      orgId: user.orgId,
      createdAt: { $gte: since },
    })
      .sort({ createdAt: 1 })
      .limit(100);

    const lastAudit = await Audit.findOne({ orgId: user.orgId }).sort({ createdAt: -1 });

    const monitorsActive = await Monitor.countDocuments({ orgId: user.orgId, active: true });
    const monitorsDown = await Monitor.countDocuments({
      orgId: user.orgId,
      active: true,
      lastStatus: "down",
    });

    const chart = audits.length
      ? audits.map((a) => Number(a.score || 0))
      : [];

    const avgSeo = chart.length
      ? Math.round(chart.reduce((sum, n) => sum + n, 0) / chart.length)
      : Number(lastAudit?.score || 0);

    if (org) {
      org.monitorCountCache = monitorsActive;
      await org.save();
    }

    return res.json({
      seoScore: avgSeo || 0,
      chart,
      monitors: {
        active: monitorsActive,
        down: monitorsDown,
      },
      lastAuditAt: lastAudit?.createdAt || null,
      lastAuditUrl: lastAudit?.url || "",
    });
  } catch (e) {
    console.log("/api/overview error:", e.message);
    return res.status(500).json({ error: "Erreur /api/overview" });
  }
});
// -----------------------
// AUDITS
// -----------------------
app.get("/api/audits", authRequired, async (req, res) => {
  try {
    const audits = await Audit.find({ orgId: req.dbUser.orgId })
      .sort({ createdAt: -1 })
      .limit(300);

    return res.json({ audits });
  } catch (e) {
    console.log("/api/audits error:", e.message);
    return res.status(500).json({ error: "Erreur audits" });
  }
});

app.get("/api/audits/:id", authRequired, async (req, res) => {
  try {
    const audit = await Audit.findOne({
      _id: req.params.id,
      orgId: req.dbUser.orgId,
    });

    if (!audit) return res.status(404).json({ error: "Audit introuvable" });

    return res.json({ audit });
  } catch (e) {
    console.log("/api/audits/:id error:", e.message);
    return res.status(500).json({ error: "Erreur détail audit" });
  }
});

app.post("/api/audits/run", authRequired, async (req, res) => {
  try {
    const user = req.dbUser;
    const org = await Org.findById(user.orgId);
    await ensureOrgDefaults(org);

    ensureMonthUsageReset(user);

    const limits = planLimits(user.plan, org);
    if (Number(user.usage?.audits || 0) >= limits.audits) {
      return res.status(403).json({ error: "Quota audits atteint" });
    }

    const url = String(req.body?.url || "").trim();
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: "URL invalide" });
    }

    const fetched = await fetchHtml(url);
    const analysis = computeSeoSummary(fetched.html);

    const audit = await Audit.create({
      orgId: user.orgId,
      userId: user._id,
      url,
      score: analysis.score,
      summary: analysis.summary,
      recommendations: analysis.recommendations,
      findings: analysis.findings,
      htmlSnapshot: String(fetched.html || "").slice(0, 200000),
      status: analysis.score >= 55 ? "ok" : "error",
    });

    user.usage.audits = Number(user.usage?.audits || 0) + 1;
    await user.save();

    return res.json({
      ok: true,
      audit,
    });
  } catch (e) {
    console.log("/api/audits/run error:", e.message);
    return res.status(500).json({ error: "Erreur lancement audit" });
  }
});

app.get("/api/audits/:id/pdf", authRequired, async (req, res) => {
  try {
    const user = req.dbUser;
    const org = await Org.findById(user.orgId);
    await ensureOrgDefaults(org);

    ensureMonthUsageReset(user);

    const limits = planLimits(user.plan, org);
    if (Number(user.usage?.pdf || 0) >= limits.pdf) {
      return res.status(403).json({ error: "Quota PDF atteint" });
    }

    const audit = await Audit.findOne({
      _id: req.params.id,
      orgId: user.orgId,
    });

    if (!audit) return res.status(404).json({ error: "Audit introuvable" });

    user.usage.pdf = Number(user.usage?.pdf || 0) + 1;
    await user.save();

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `inline; filename="flowpoint-audit-${String(audit._id)}.pdf"`
    );

    const doc = new PDFDocument({ margin: 42 });
    doc.pipe(res);

    doc.fontSize(22).text("FlowPoint — Audit SEO");
    doc.moveDown(0.5);
    doc.fontSize(12).text(`URL: ${audit.url}`);
    doc.text(`Date: ${formatDate(audit.createdAt)}`);
    doc.text(`Score: ${audit.score}/100`);
    doc.moveDown();

    doc.fontSize(16).text("Résumé");
    doc.fontSize(11).text(audit.summary || "Aucun résumé");
    doc.moveDown();

    doc.fontSize(16).text("Recommandations");
    (audit.recommendations || []).forEach((r) => {
      doc.fontSize(11).text(`• ${r}`);
    });

    doc.moveDown();
    doc.fontSize(16).text("Checks");
    Object.entries(audit.findings || {}).forEach(([key, val]) => {
      doc
        .fontSize(11)
        .text(`${key}: ${typeof val?.value === "object" ? JSON.stringify(val?.value) : String(val?.value ?? "—")} (${val?.ok ? "OK" : "KO"})`);
    });

    doc.end();
  } catch (e) {
    console.log("/api/audits/:id/pdf error:", e.message);
    return res.status(500).json({ error: "Erreur génération PDF" });
  }
});

// -----------------------
// MONITORS
// -----------------------
async function runSingleMonitorCheck(monitor) {
  const startedAt = Date.now();
  let status = "unknown";
  let httpStatus = 0;
  let responseTimeMs = 0;
  let error = "";

  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(monitor.url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "FlowPointMonitor/1.0",
      },
    });

    clearTimeout(t);

    httpStatus = res.status;
    responseTimeMs = Date.now() - startedAt;
    status = res.ok ? "up" : "down";
  } catch (e) {
    responseTimeMs = Date.now() - startedAt;
    status = "down";
    error = e.message || "Request failed";
  }

  monitor.lastCheckedAt = new Date();
  monitor.lastStatus = status;
  monitor.lastHttpStatus = httpStatus;
  monitor.lastResponseTimeMs = responseTimeMs;
  monitor.lastError = error;
  await monitor.save();

  await MonitorLog.create({
    orgId: monitor.orgId,
    monitorId: monitor._id,
    url: monitor.url,
    status,
    httpStatus,
    responseTimeMs,
    error,
    checkedAt: new Date(),
  });

  return monitor;
}

app.get("/api/monitors", authRequired, async (req, res) => {
  try {
    const monitors = await Monitor.find({ orgId: req.dbUser.orgId })
      .sort({ createdAt: -1 })
      .limit(300);

    return res.json({ monitors });
  } catch (e) {
    console.log("/api/monitors error:", e.message);
    return res.status(500).json({ error: "Erreur monitors" });
  }
});

app.post("/api/monitors", authRequired, async (req, res) => {
  try {
    const user = req.dbUser;
    const org = await Org.findById(user.orgId);
    await ensureOrgDefaults(org);

    const limits = planLimits(user.plan, org);

    const activeCount = await Monitor.countDocuments({ orgId: user.orgId, active: true });
    if (activeCount >= limits.monitors) {
      return res.status(403).json({ error: "Quota monitors atteint" });
    }

    const url = String(req.body?.url || "").trim();
    const intervalMinutes = Math.max(5, Number(req.body?.intervalMinutes || 60));

    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: "URL invalide" });
    }

    const monitor = await Monitor.create({
      orgId: user.orgId,
      userId: user._id,
      url,
      intervalMinutes,
      active: true,
      lastStatus: "unknown",
    });

    await refreshOrgMonitorCount(user.orgId);

    return res.json({
      ok: true,
      monitor,
    });
  } catch (e) {
    console.log("/api/monitors POST error:", e.message);
    return res.status(500).json({ error: "Erreur création monitor" });
  }
});

app.post("/api/monitors/:id/run", authRequired, async (req, res) => {
  try {
    const monitor = await Monitor.findOne({
      _id: req.params.id,
      orgId: req.dbUser.orgId,
    });

    if (!monitor) return res.status(404).json({ error: "Monitor introuvable" });

    await runSingleMonitorCheck(monitor);

    return res.json({
      ok: true,
      monitor,
    });
  } catch (e) {
    console.log("/api/monitors/:id/run error:", e.message);
    return res.status(500).json({ error: "Erreur run monitor" });
  }
});

app.delete("/api/monitors/:id", authRequired, async (req, res) => {
  try {
    const monitor = await Monitor.findOneAndDelete({
      _id: req.params.id,
      orgId: req.dbUser.orgId,
    });

    if (!monitor) return res.status(404).json({ error: "Monitor introuvable" });

    await refreshOrgMonitorCount(req.dbUser.orgId);

    return res.json({ ok: true });
  } catch (e) {
    console.log("/api/monitors/:id DELETE error:", e.message);
    return res.status(500).json({ error: "Erreur suppression monitor" });
  }
});

app.get("/api/monitors/:id/logs", authRequired, async (req, res) => {
  try {
    const monitor = await Monitor.findOne({
      _id: req.params.id,
      orgId: req.dbUser.orgId,
    });
    if (!monitor) return res.status(404).json({ error: "Monitor introuvable" });

    const logs = await MonitorLog.find({
      orgId: req.dbUser.orgId,
      monitorId: monitor._id,
    })
      .sort({ checkedAt: -1 })
      .limit(80);

    return res.json({ logs });
  } catch (e) {
    console.log("/api/monitors/:id/logs error:", e.message);
    return res.status(500).json({ error: "Erreur logs monitor" });
  }
});

app.get("/api/monitors/:id/uptime", authRequired, async (req, res) => {
  try {
    const monitor = await Monitor.findOne({
      _id: req.params.id,
      orgId: req.dbUser.orgId,
    });
    if (!monitor) return res.status(404).json({ error: "Monitor introuvable" });

    const days = [3, 7, 30].includes(Number(req.query?.days)) ? Number(req.query.days) : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const logs = await MonitorLog.find({
      orgId: req.dbUser.orgId,
      monitorId: monitor._id,
      checkedAt: { $gte: since },
    });

    const totalChecks = logs.length;
    const upChecks = logs.filter((l) => l.status === "up").length;
    const uptimePercent = totalChecks ? Math.round((upChecks / totalChecks) * 10000) / 100 : null;

    return res.json({
      days,
      totalChecks,
      upChecks,
      uptimePercent,
    });
  } catch (e) {
    console.log("/api/monitors/:id/uptime error:", e.message);
    return res.status(500).json({ error: "Erreur uptime monitor" });
  }
});

// -----------------------
// ORG SETTINGS
// -----------------------
app.get("/api/org/settings", authRequired, async (req, res) => {
  try {
    const org = await Org.findById(req.dbUser.orgId);
    if (!org) return res.status(404).json({ error: "Organisation introuvable" });

    await ensureOrgDefaults(org);
    await org.save();

    return res.json({
      settings: {
        alertRecipients: org.alertRecipients || "all",
        alertExtraEmails: Array.isArray(org.alertExtraEmails) ? org.alertExtraEmails : [],
      },
    });
  } catch (e) {
    console.log("/api/org/settings GET error:", e.message);
    return res.status(500).json({ error: "Erreur org settings" });
  }
});

app.post("/api/org/settings", authRequired, async (req, res) => {
  try {
    const org = await Org.findById(req.dbUser.orgId);
    if (!org) return res.status(404).json({ error: "Organisation introuvable" });

    await ensureOrgDefaults(org);

    const mode = String(req.body?.alertRecipients || "all").toLowerCase();
    const extra = Array.isArray(req.body?.alertExtraEmails)
      ? req.body.alertExtraEmails
      : [];

    org.alertRecipients = mode === "owner" ? "owner" : "all";
    org.alertExtraEmails = extra
      .map((e) => normalizeEmail(e))
      .filter(Boolean)
      .slice(0, 20);

    await org.save();

    return res.json({
      ok: true,
      settings: {
        alertRecipients: org.alertRecipients,
        alertExtraEmails: org.alertExtraEmails,
      },
    });
  } catch (e) {
    console.log("/api/org/settings POST error:", e.message);
    return res.status(500).json({ error: "Erreur save org settings" });
  }
});

// -----------------------
// EXPORTS
// -----------------------
app.get("/api/exports/audits.csv", authRequired, async (req, res) => {
  try {
    const user = req.dbUser;
    const org = await Org.findById(user.orgId);
    await ensureOrgDefaults(org);

    ensureMonthUsageReset(user);

    const limits = planLimits(user.plan, org);
    if (Number(user.usage?.exports || 0) >= limits.exports) {
      return res.status(403).json({ error: "Quota exports atteint" });
    }

    const audits = await Audit.find({ orgId: user.orgId }).sort({ createdAt: -1 }).limit(2000);

    user.usage.exports = Number(user.usage?.exports || 0) + 1;
    await user.save();

    const header = ["id", "url", "score", "status", "summary", "createdAt"];
    const rows = audits.map((a) => [
      a._id,
      a.url,
      a.score,
      a.status,
      a.summary,
      a.createdAt?.toISOString?.() || "",
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map(escCsv).join(","))
      .join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="flowpoint-audits.csv"`);
    return res.send(csv);
  } catch (e) {
    console.log("/api/exports/audits.csv error:", e.message);
    return res.status(500).json({ error: "Erreur export audits" });
  }
});

app.get("/api/exports/monitors.csv", authRequired, async (req, res) => {
  try {
    const user = req.dbUser;
    const org = await Org.findById(user.orgId);
    await ensureOrgDefaults(org);

    ensureMonthUsageReset(user);

    const limits = planLimits(user.plan, org);
    if (Number(user.usage?.exports || 0) >= limits.exports) {
      return res.status(403).json({ error: "Quota exports atteint" });
    }

    const monitors = await Monitor.find({ orgId: user.orgId }).sort({ createdAt: -1 }).limit(2000);

    user.usage.exports = Number(user.usage?.exports || 0) + 1;
    await user.save();

    const header = ["id", "url", "active", "intervalMinutes", "lastStatus", "lastHttpStatus", "lastResponseTimeMs", "lastCheckedAt"];
    const rows = monitors.map((m) => [
      m._id,
      m.url,
      m.active,
      m.intervalMinutes,
      m.lastStatus,
      m.lastHttpStatus,
      m.lastResponseTimeMs,
      m.lastCheckedAt?.toISOString?.() || "",
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map(escCsv).join(","))
      .join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="flowpoint-monitors.csv"`);
    return res.send(csv);
  } catch (e) {
    console.log("/api/exports/monitors.csv error:", e.message);
    return res.status(500).json({ error: "Erreur export monitors" });
  }
});

// -----------------------
// ADMIN
// -----------------------
app.get("/api/admin/users", requireAdmin, async (_req, res) => {
  try {
    const users = await User.find({})
      .sort({ createdAt: -1 })
      .limit(1000)
      .lean();

    return res.json({ users });
  } catch (e) {
    console.log("/api/admin/users error:", e.message);
    return res.status(500).json({ error: "Erreur admin users" });
  }
});

app.post("/api/admin/user/block", requireAdmin, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const blocked = !!req.body?.blocked;

    const user = await User.findOne({ emailNormalized: email });
    if (!user) return res.status(404).json({ error: "User introuvable" });

    user.accessBlocked = blocked;
    await user.save();

    return res.json({ ok: true });
  } catch (e) {
    console.log("/api/admin/user/block error:", e.message);
    return res.status(500).json({ error: "Erreur admin block" });
  }
});

app.post("/api/admin/user/reset-usage", requireAdmin, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const user = await User.findOne({ emailNormalized: email });
    if (!user) return res.status(404).json({ error: "User introuvable" });

    user.usageMonth = firstDayOfMonthLabel(new Date());
    user.usage = {
      audits: 0,
      pdf: 0,
      exports: 0,
      monitorsCreated: 0,
    };
    await user.save();

    return res.json({ ok: true });
  } catch (e) {
    console.log("/api/admin/user/reset-usage error:", e.message);
    return res.status(500).json({ error: "Erreur reset usage" });
  }
});
// -----------------------
// INVITE ACCEPT (minimal backend support)
// -----------------------
app.post("/api/org/invite/create", authRequired, async (req, res) => {
  try {
    const user = req.dbUser;
    if (String(user.role || "owner").toLowerCase() !== "owner") {
      return res.status(403).json({ error: "Seul le owner peut inviter" });
    }

    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "Email requis" });

    const org = await Org.findById(user.orgId);
    if (!org) return res.status(404).json({ error: "Organisation introuvable" });

    const token = randomToken(20);
    org.inviteToken = token;
    org.inviteEmail = email;
    org.inviteExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await org.save();

    return res.json({
      ok: true,
      inviteUrl: `${safeBaseUrl(req)}/invite-accept.html?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`,
    });
  } catch (e) {
    console.log("/api/org/invite/create error:", e.message);
    return res.status(500).json({ error: "Erreur invite create" });
  }
});

app.post("/api/org/invite/accept", async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const email = normalizeEmail(req.body?.email);

    if (!token || !email) {
      return res.status(400).json({ error: "Token et email requis" });
    }

    const org = await Org.findOne({
      inviteToken: token,
      inviteEmail: email,
      inviteExpiresAt: { $gt: new Date() },
    });

    if (!org) return res.status(400).json({ error: "Invitation invalide ou expirée" });

    let user = await User.findOne({ emailNormalized: email });

    if (!user) {
      user = await User.create({
        name: email.split("@")[0],
        email,
        emailNormalized: email,
        role: "member",
        plan: "standard",
        accessBlocked: false,
        usageMonth: firstDayOfMonthLabel(new Date()),
        usage: {
          audits: 0,
          pdf: 0,
          exports: 0,
          monitorsCreated: 0,
        },
      });
    }

    user.orgId = org._id;
    user.role = "member";
    await user.save();

    const jwtToken = signToken(user);
    const refreshToken = signRefreshToken(user);

    return res.json({
      ok: true,
      token: jwtToken,
      refreshToken,
    });
  } catch (e) {
    console.log("/api/org/invite/accept error:", e.message);
    return res.status(500).json({ error: "Erreur invite accept" });
  }
});

// -----------------------
// CRON ENDPOINT
// -----------------------
app.post("/api/cron/run-monitors", requireCronKey, async (_req, res) => {
  try {
    const due = await Monitor.find({ active: true }).limit(200);

    for (const monitor of due) {
      const last = monitor.lastCheckedAt ? new Date(monitor.lastCheckedAt).getTime() : 0;
      const intervalMs = Math.max(5, Number(monitor.intervalMinutes || 60)) * 60 * 1000;

      if (!last || Date.now() - last >= intervalMs) {
        try {
          await runSingleMonitorCheck(monitor);
        } catch (e) {
          console.log("monitor cron item error:", e.message);
        }
      }
    }

    await Promise.all(
      [...new Set(due.map((m) => String(m.orgId || "")).filter(Boolean))].map((orgId) =>
        refreshOrgMonitorCount(orgId).catch(() => 0)
      )
    );

    return res.json({ ok: true, processed: due.length });
  } catch (e) {
    console.log("/api/cron/run-monitors error:", e.message);
    return res.status(500).json({ error: "Erreur cron monitors" });
  }
});

// -----------------------
// SIMPLE FALLBACK ROUTES
// -----------------------
app.get("/", (_req, res) => {
  const publicIndex = path.join(__dirname, "public", "index.html");
  if (fs.existsSync(publicIndex)) return res.sendFile(publicIndex);
  return res.send("FlowPoint backend OK");
});

app.get("*", (req, res) => {
  const target = path.join(__dirname, "public", req.path);
  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    return res.sendFile(target);
  }

  const dashboard = path.join(__dirname, "public", "dashboard.html");
  if (fs.existsSync(dashboard)) return res.sendFile(dashboard);

  return res.status(404).send("Not found");
});

// -----------------------
// START
// -----------------------
app.listen(PORT, () => {
  console.log(`✅ FlowPoint listening on :${PORT}`);
});
