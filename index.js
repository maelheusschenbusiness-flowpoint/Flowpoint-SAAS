// =======================
// FlowPoint AI – SaaS Backend
// Plans: Standard / Pro / Ultra
// Modules: Projects, Audit, Chat, Monitoring Auto + Email Alerts
// =======================

require("dotenv").config();

const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const Stripe = require("stripe");
const nodemailer = require("nodemailer");

const app = express();

// ---------- ENV CHECK ----------
const REQUIRED = [
  "MONGO_URI",
  "JWT_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_PRICE_ID_STANDARD",
  "STRIPE_PRICE_ID_PRO",
  "STRIPE_PRICE_ID_ULTRA",
  "PUBLIC_BASE_URL",
  "CRON_SECRET"
];

for (const k of REQUIRED) {
  if (!process.env[k]) console.log("❌ ENV manquante:", k);
}

if (!process.env.STRIPE_WEBHOOK_SECRET_RENDER) {
  console.log("⚠️ STRIPE_WEBHOOK_SECRET_RENDER manquante (webhook non validable)");
}

const PORT = process.env.PORT || 5000;
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ---------- SECURITY ----------
app.set("trust proxy", true);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use("/api", rateLimit({ windowMs: 60 * 1000, max: 200 }));

// ---------- WEBHOOK RAW (BEFORE JSON) ----------
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const sig = req.headers["stripe-signature"];
    const secret = process.env.STRIPE_WEBHOOK_SECRET_RENDER;
    if (!secret) return res.status(200).send("no webhook secret");

    const event = stripe.webhooks.constructEvent(req.body, sig, secret);

    if (event.type === "invoice.payment_failed") {
      const inv = event.data.object;
      await User.updateOne({ stripeCustomerId: inv.customer }, { $set: { accessBlocked: true } });
    }

    if (event.type === "invoice.payment_succeeded") {
      const inv = event.data.object;
      await User.updateOne({ stripeCustomerId: inv.customer }, { $set: { accessBlocked: false } });
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      await User.updateOne({ stripeSubscriptionId: sub.id }, { $set: { accessBlocked: true } });
    }

    return res.json({ received: true });
  } catch (e) {
    console.log("webhook error:", e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }
});

// ---------- PARSERS ----------
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ---------- STATIC FRONT ----------
app.use(express.static(path.join(__dirname)));

// ---------- DB ----------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connecté"))
  .catch((e) => console.log("❌ MongoDB erreur:", e.message));

// ---------- PLAN / QUOTAS ----------
function planRank(plan) {
  const map = { standard: 1, pro: 2, ultra: 3 };
  return map[String(plan || "").toLowerCase()] || 0;
}

function planQuotas(plan) {
  const p = String(plan || "").toLowerCase();
  if (p === "standard") return { audits: 200, chat: 400, monitors: 0, projects: 1 };
  if (p === "pro") return { audits: 2000, chat: 5000, monitors: 200, projects: 3 };
  if (p === "ultra") return { audits: 8000, chat: 20000, monitors: 1000, projects: 15 };
  return { audits: 0, chat: 0, monitors: 0, projects: 0 };
}

// ---------- MODELS ----------
const UserSchema = new mongoose.Schema(
  {
    email: { type: String, unique: true, index: true },
    name: String,
    companyName: String,
    companyNameNormalized: String,

    plan: { type: String, enum: ["standard", "pro", "ultra"], default: "standard" },
    stripeCustomerId: String,
    stripeSubscriptionId: String,

    hasTrial: { type: Boolean, default: false },
    trialStartedAt: Date,
    trialEndsAt: Date,
    accessBlocked: { type: Boolean, default: false },

    resetAt: { type: Date, default: Date.now },
    usedAudits: { type: Number, default: 0 },
    usedChat: { type: Number, default: 0 },
    usedMonitors: { type: Number, default: 0 }
  },
  { timestamps: true }
);

const TrialRegistrySchema = new mongoose.Schema(
  {
    fingerprint: { type: String, unique: true, index: true },
    usedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

const ProjectSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, index: true },
    name: String,
    url: String
  },
  { timestamps: true }
);

const AuditSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, index: true },
    url: String,
    score: Number,
    findings: [String]
  },
  { timestamps: true }
);

const ChatSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, index: true },
    role: { type: String, enum: ["user", "assistant"], required: true },
    text: String
  },
  { timestamps: true }
);

const MonitorSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, index: true },
    name: String,
    url: String,
    lastStatus: String,
    lastCode: Number,
    lastLatencyMs: Number,
    lastRunAt: Date
  },
  { timestamps: true }
);

const MonitorRunSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, index: true },
    monitorId: { type: mongoose.Schema.Types.ObjectId, index: true },
    ok: Boolean,
    statusCode: Number,
    latencyMs: Number,
    checkedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

const AlertSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, index: true },
    type: { type: String, enum: ["monitor_down", "monitor_recovered"], required: true },
    monitorId: { type: mongoose.Schema.Types.ObjectId, index: true },
    monitorName: String,
    url: String,
    statusCode: Number,
    latencyMs: Number,
    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: false }
);

const User = mongoose.model("User", UserSchema);
const TrialRegistry = mongoose.model("TrialRegistry", TrialRegistrySchema);
const Project = mongoose.model("Project", ProjectSchema);
const Audit = mongoose.model("Audit", AuditSchema);
const ChatMessage = mongoose.model("ChatMessage", ChatSchema);
const Monitor = mongoose.model("Monitor", MonitorSchema);
const MonitorRun = mongoose.model("MonitorRun", MonitorRunSchema);
const Alert = mongoose.model("Alert", AlertSchema);

// ---------- HELPERS ----------
function normalizeCompanyName(s) {
  return (s || "").toLowerCase().trim().replace(/\s+/g, " ").replace(/[^a-z0-9\s-]/g, "");
}
function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (xff) return String(xff).split(",")[0].trim();
  return req.ip || req.socket.remoteAddress || "";
}
function makeFingerprint(req, email) {
  const ip = getClientIp(req);
  const ua = (req.headers["user-agent"] || "").toString();
  const base = `${ip}||${ua}||${(email || "").toLowerCase()}`;
  return Buffer.from(base).toString("base64");
}
function signToken(user) {
  return jwt.sign({ uid: user._id.toString(), email: user.email }, process.env.JWT_SECRET, { expiresIn: "30d" });
}
function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Non autorisé" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: "Token invalide" });
  }
}

async function loadUser(req) {
  return await User.findById(req.user.uid);
}

function requirePlan(minPlan) {
  return async (req, res, next) => {
    const u = await loadUser(req);
    if (!u) return res.status(401).json({ error: "User introuvable" });
    if (u.accessBlocked) return res.status(403).json({ error: "Accès bloqué (paiement échoué)" });
    if (planRank(u.plan) < planRank(minPlan)) return res.status(403).json({ error: `Plan requis: ${minPlan}` });
    req.dbUser = u;
    next();
  };
}

async function resetMonthlyIfNeeded(user) {
  const now = new Date();
  const ra = user.resetAt ? new Date(user.resetAt) : now;
  if (ra.getUTCFullYear() !== now.getUTCFullYear() || ra.getUTCMonth() !== now.getUTCMonth()) {
    user.usedAudits = 0;
    user.usedChat = 0;
    user.usedMonitors = 0;
    user.resetAt = now;
    await user.save();
  }
}

async function consume(user, key, amount = 1) {
  await resetMonthlyIfNeeded(user);
  const q = planQuotas(user.plan);
  const map = {
    audits: ["usedAudits", q.audits],
    chat: ["usedChat", q.chat],
    monitors: ["usedMonitors", q.monitors]
  };
  const info = map[key];
  if (!info) return false;
  const [field, limit] = info;
  if (limit <= 0) return false;
  if (user[field] + amount > limit) return false;
  user[field] += amount;
  await user.save();
  return true;
}

function priceForPlan(plan) {
  if (plan === "standard") return process.env.STRIPE_PRICE_ID_STANDARD;
  if (plan === "pro") return process.env.STRIPE_PRICE_ID_PRO;
  if (plan === "ultra") return process.env.STRIPE_PRICE_ID_ULTRA;
  return null;
}

// ---------- EMAIL (SMTP) ----------
function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_PORT && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_FROM);
}

function mailer() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465, // 465 = true, 587 = false
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

async function sendAlertEmail({ to, subject, html }) {
  if (!smtpConfigured()) return;
  const transport = mailer();
  await transport.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject,
    html
  });
}

// ---------- AUDIT LOGIC ----------
async function fetchHtml(url, ms = 9000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const start = Date.now();
    const r = await fetch(url, { signal: controller.signal, redirect: "follow" });
    const text = await r.text();
    return { status: r.status, latencyMs: Date.now() - start, text };
  } finally {
    clearTimeout(t);
  }
}

function auditHtml(url, html) {
  const findings = [];
  let score = 100;

  const hasTitle = /<title>.*<\/title>/i.test(html);
  if (!hasTitle) { findings.push("Missing <title> tag"); score -= 10; }

  const metaDesc = /<meta[^>]+name=["']description["'][^>]*>/i.test(html);
  if (!metaDesc) { findings.push("Missing meta description"); score -= 10; }

  const h1Count = (html.match(/<h1\b/gi) || []).length;
  if (h1Count === 0) { findings.push("No H1 found"); score -= 8; }
  if (h1Count > 1) { findings.push("Multiple H1 found"); score -= 4; }

  const hasViewport = /<meta[^>]+name=["']viewport["'][^>]*>/i.test(html);
  if (!hasViewport) { findings.push("Missing viewport meta (mobile)"); score -= 6; }

  const hasCanonical = /<link[^>]+rel=["']canonical["'][^>]*>/i.test(html);
  if (!hasCanonical) { findings.push("Missing canonical link"); score -= 4; }

  const hasOG = /property=["']og:/i.test(html);
  if (!hasOG) { findings.push("No OpenGraph meta (social sharing)"); score -= 3; }

  const isHttps = String(url).toLowerCase().startsWith("https://");
  if (!isHttps) { findings.push("Site is not HTTPS"); score -= 15; }

  if (score < 0) score = 0;
  return { score, findings };
}

// ---------- CHAT LOGIC ----------
function buildAssistantReply(userText, latestAudit) {
  const t = String(userText || "").toLowerCase();

  if (!latestAudit) {
    return "Je n’ai pas encore d’audit pour ce projet. Lance un audit (Run audit) et je pourrai te conseiller.";
  }

  if (t.includes("score")) {
    return `Ton dernier score est ${latestAudit.score}/100. Principaux points: ${latestAudit.findings.slice(0, 5).join(", ") || "aucun"}.`;
  }

  if (t.includes("priorité") || t.includes("priorites") || t.includes("plan") || t.includes("action")) {
    const top = latestAudit.findings.slice(0, 5);
    return [
      "Plan d’action (simple):",
      `1) Corrige: ${top[0] || "—"}`,
      `2) Puis: ${top[1] || "—"}`,
      `3) Ensuite: ${top[2] || "—"}`,
      `4) Bonus: ${top[3] || "—"}`,
      `5) Bonus: ${top[4] || "—"}`,
      "Refais un audit après chaque correction pour mesurer l’impact."
    ].join("\n");
  }

  if (t.includes("seo")) {
    const seo = latestAudit.findings.filter(x => x.toLowerCase().includes("meta") || x.toLowerCase().includes("canonical") || x.toLowerCase().includes("title"));
    return `SEO: ${seo.length ? seo.join(", ") : "rien de critique détecté côté title/meta/canonical."}`;
  }

  if (t.includes("client") || t.includes("agence") || t.includes("rapport")) {
    return [
      "Résumé client:",
      `- Score: ${latestAudit.score}/100`,
      `- URL: ${latestAudit.url}`,
      `- Top fixes: ${latestAudit.findings.slice(0, 3).join(" | ")}`,
      "- Recommandation: appliquer corrections puis refaire audit."
    ].join("\n");
  }

  return `Je peux aider sur: "score", "plan d’action", "SEO", "rapport client". Ton audit indique: ${latestAudit.findings.slice(0, 4).join(", ")}.`;
}

// ---------- CRON AUTH ----------
function requireCronSecret(req, res, next) {
  const secret = process.env.CRON_SECRET;
  const got = req.headers["x-cron-secret"] || req.query.secret;
  if (!secret) return res.status(500).json({ error: "CRON_SECRET manquant" });
  if (got !== secret) return res.status(401).json({ error: "Unauthorized cron" });
  next();
}

// ---------- PAGES ----------
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/dashboard", (_, res) => res.sendFile(path.join(__dirname, "dashboard.html")));
app.get("/success", (_, res) => res.sendFile(path.join(__dirname, "success.html")));
app.get("/cancel", (_, res) => res.sendFile(path.join(__dirname, "cancel.html")));
app.get("/login", (_, res) => res.sendFile(path.join(__dirname, "login.html")));

// ---------- API: HEALTH ----------
app.get("/api/health", (_, res) => res.json({ ok: true }));

// ---------- AUTH: LEAD ----------
app.post("/api/auth/lead", async (req, res) => {
  try {
    const { firstName, email, companyName, plan } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email requis" });
    if (!companyName) return res.status(400).json({ error: "Entreprise requise" });

    const chosenPlan = String(plan || "").toLowerCase();
    if (!["standard", "pro", "ultra"].includes(chosenPlan)) return res.status(400).json({ error: "Plan invalide" });

    const companyNameNormalized = normalizeCompanyName(companyName);

    let user = await User.findOne({ email: String(email).toLowerCase() });
    if (!user) {
      user = await User.create({
        email: String(email).toLowerCase(),
        name: firstName || "",
        companyName,
        companyNameNormalized,
        plan: chosenPlan
      });
    } else {
      user.name = firstName || user.name;
      user.companyName = companyName || user.companyName;
      user.companyNameNormalized = companyNameNormalized || user.companyNameNormalized;
      user.plan = chosenPlan;
      await user.save();
    }

    return res.json({ ok: true, token: signToken(user) });
  } catch (e) {
    console.log("lead error:", e.message);
    return res.status(500).json({ error: "Erreur serveur lead" });
  }
});

// ---------- AUTH: LOGIN ----------
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email requis" });

    const user = await User.findOne({ email: String(email).toLowerCase().trim() });
    if (!user) return res.status(404).json({ error: "Compte introuvable. Inscrivez-vous d'abord." });

    return res.json({ ok: true, token: signToken(user) });
  } catch (e) {
    console.log("login error:", e.message);
    return res.status(500).json({ error: "Erreur serveur login" });
  }
});

// ---------- STRIPE: CHECKOUT ----------
app.post("/api/stripe/checkout", auth, async (req, res) => {
  try {
    const { plan } = req.body || {};
    const chosenPlan = String(plan || "").toLowerCase();
    if (!["standard", "pro", "ultra"].includes(chosenPlan)) return res.status(400).json({ error: "Plan invalide" });

    const user = await User.findById(req.user.uid);
    if (!user) return res.status(404).json({ error: "User introuvable" });
    if (user.accessBlocked) return res.status(403).json({ error: "Accès bloqué (paiement échoué)" });

    // anti abus: on consomme au moment du checkout
    const fp = makeFingerprint(req, user.email);
    const already = await TrialRegistry.findOne({ fingerprint: fp });
    if (already) return res.status(403).json({ error: "Essai déjà utilisé (anti-abus)." });

    const priceId = priceForPlan(chosenPlan);
    if (!priceId) return res.status(500).json({ error: "PriceId manquant" });

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name || undefined,
        metadata: { uid: user._id.toString() }
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }

    const baseUrl = String(process.env.PUBLIC_BASE_URL).trim();

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
        metadata: { uid: user._id.toString(), plan: chosenPlan }
      },
      metadata: { uid: user._id.toString(), plan: chosenPlan },
      success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/cancel.html`,
      allow_promotion_codes: true
    });

    await TrialRegistry.create({ fingerprint: fp });
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
    if (!uid) return res.status(400).json({ error: "uid manquant dans metadata" });

    const user = await User.findById(uid);
    if (!user) return res.status(404).json({ error: "User introuvable" });

    if (session.customer?.id) user.stripeCustomerId = session.customer.id;
    if (session.subscription?.id) user.stripeSubscriptionId = session.subscription.id;

    if (!user.hasTrial) {
      user.hasTrial = true;
      user.trialStartedAt = new Date();
      user.trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    }

    const p = String(session.metadata?.plan || "").toLowerCase();
    if (["standard", "pro", "ultra"].includes(p)) user.plan = p;

    await user.save();

    return res.json({
      ok: true,
      token: signToken(user),
      user: {
        email: user.email,
        name: user.name,
        companyName: user.companyName,
        plan: user.plan,
        trialEndsAt: user.trialEndsAt,
        accessBlocked: user.accessBlocked
      }
    });
  } catch (e) {
    console.log("verify error:", e.message);
    return res.status(500).json({ error: "Erreur verify" });
  }
});

// ---------- STRIPE: PORTAL ----------
app.post("/api/stripe/portal", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.uid);
    if (!user?.stripeCustomerId) return res.status(400).json({ error: "Customer Stripe manquant" });

    const baseUrl = String(process.env.PUBLIC_BASE_URL).trim();
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${baseUrl}/dashboard.html`
    });

    return res.json({ url: session.url });
  } catch (e) {
    console.log("portal error:", e.message);
    return res.status(500).json({ error: "Erreur portal" });
  }
});

// ---------- API: ME + USAGE ----------
app.get("/api/me", auth, async (req, res) => {
  const user = await User.findById(req.user.uid);
  if (!user) return res.status(404).json({ error: "User introuvable" });

  await resetMonthlyIfNeeded(user);
  const q = planQuotas(user.plan);

  return res.json({
    email: user.email,
    name: user.name,
    companyName: user.companyName,
    plan: user.plan,
    hasTrial: user.hasTrial,
    trialEndsAt: user.trialEndsAt,
    accessBlocked: user.accessBlocked,
    usage: {
      audits: { used: user.usedAudits, limit: q.audits },
      chat: { used: user.usedChat, limit: q.chat },
      monitors: { used: user.usedMonitors, limit: q.monitors },
      projects: { limit: q.projects }
    }
  });
});

// ---------- API: ALERTS (dashboard) ----------
app.get("/api/alerts/recent", auth, requirePlan("standard"), async (req, res) => {
  const user = req.dbUser;
  const list = await Alert.find({ ownerId: user._id }).sort({ createdAt: -1 }).limit(20);
  return res.json({ ok: true, alerts: list });
});

//
// ========== PROJECTS ==========
//
app.post("/api/projects", auth, requirePlan("standard"), async (req, res) => {
  const user = req.dbUser;
  const { name, url } = req.body || {};
  if (!url) return res.status(400).json({ error: "URL requise" });

  const q = planQuotas(user.plan);
  const count = await Project.countDocuments({ ownerId: user._id });
  if (count >= q.projects) return res.status(403).json({ error: `Limite projets atteinte (${q.projects})` });

  const p = await Project.create({
    ownerId: user._id,
    name: name || "Mon projet",
    url: String(url).trim()
  });
  return res.json({ ok: true, project: p });
});

app.get("/api/projects", auth, requirePlan("standard"), async (req, res) => {
  const user = req.dbUser;
  const list = await Project.find({ ownerId: user._id }).sort({ createdAt: -1 }).limit(50);
  return res.json({ ok: true, projects: list });
});

//
// ========== AUDIT ==========
//
app.post("/api/audit/run", auth, requirePlan("standard"), async (req, res) => {
  const user = req.dbUser;
  const { projectId, url } = req.body || {};
  const targetUrl = String(url || "").trim();
  if (!targetUrl) return res.status(400).json({ error: "URL requise" });

  const ok = await consume(user, "audits", 1);
  if (!ok) return res.status(429).json({ error: "Quota audits dépassé" });

  try {
    const { text } = await fetchHtml(targetUrl, 9000);
    const { score, findings } = auditHtml(targetUrl, text || "");
    const audit = await Audit.create({
      ownerId: user._id,
      projectId: projectId || null,
      url: targetUrl,
      score,
      findings
    });
    return res.json({ ok: true, audit });
  } catch {
    return res.status(500).json({ error: "Audit impossible (URL inaccessible / timeout)" });
  }
});

app.get("/api/audit/latest", auth, requirePlan("standard"), async (req, res) => {
  const user = req.dbUser;
  const { projectId } = req.query || {};
  const q = { ownerId: user._id };
  if (projectId) q.projectId = projectId;
  const audit = await Audit.findOne(q).sort({ createdAt: -1 });
  return res.json({ ok: true, audit: audit || null });
});

//
// ========== REPORT HTML (export PDF via print) ==========
//
app.get("/api/report/html", auth, requirePlan("standard"), async (req, res) => {
  const user = req.dbUser;
  const { projectId } = req.query || {};

  const q = { ownerId: user._id };
  if (projectId) q.projectId = projectId;

  const audit = await Audit.findOne(q).sort({ createdAt: -1 });
  if (!audit) return res.status(404).send("No audit yet");

  const html = `
  <html><head><meta charset="utf-8"/>
  <title>FlowPoint Report</title>
  <style>
    body{font-family:system-ui;margin:24px}
    .pill{display:inline-block;padding:6px 10px;border-radius:999px;background:#eef2ff;color:#1d4ed8;font-weight:900}
    ul{line-height:1.6}
    .muted{color:#666}
  </style></head>
  <body>
    <h1>FlowPoint AI — Report</h1>
    <div class="pill">Plan: ${(user.plan||"").toUpperCase()}</div>
    <p class="muted"><b>Email:</b> ${user.email}<br/><b>Entreprise:</b> ${user.companyName || "-"}</p>

    <h2>Dernier audit</h2>
    <p><b>URL:</b> ${audit.url}<br/>
    <b>Date:</b> ${new Date(audit.createdAt).toLocaleString("fr-FR")}<br/>
    <b>Score:</b> ${audit.score}/100</p>

    <h3>Findings</h3>
    <ul>${(audit.findings||[]).map(f=>`<li>${f}</li>`).join("")}</ul>

    <hr/>
    <p class="muted">Astuce: Ctrl+P → “Enregistrer en PDF”.</p>
  </body></html>
  `;
  res.type("html").send(html);
});

//
// ========== CHAT ==========
//
app.post("/api/chat/send", auth, requirePlan("standard"), async (req, res) => {
  const user = req.dbUser;
  const { projectId, text } = req.body || {};
  if (!text) return res.status(400).json({ error: "Message requis" });

  const ok = await consume(user, "chat", 1);
  if (!ok) return res.status(429).json({ error: "Quota chat dépassé" });

  const q = { ownerId: user._id };
  if (projectId) q.projectId = projectId;

  const latestAudit = await Audit.findOne(q).sort({ createdAt: -1 });

  const userMsg = await ChatMessage.create({
    ownerId: user._id,
    projectId: projectId || null,
    role: "user",
    text: String(text).slice(0, 2000)
  });

  const reply = buildAssistantReply(text, latestAudit);

  const botMsg = await ChatMessage.create({
    ownerId: user._id,
    projectId: projectId || null,
    role: "assistant",
    text: reply
  });

  return res.json({ ok: true, messages: [userMsg, botMsg] });
});

app.get("/api/chat/history", auth, requirePlan("standard"), async (req, res) => {
  const user = req.dbUser;
  const { projectId } = req.query || {};
  const q = { ownerId: user._id };
  if (projectId) q.projectId = projectId;
  const history = await ChatMessage.find(q).sort({ createdAt: -1 }).limit(30);
  return res.json({ ok: true, history: history.reverse() });
});

//
// ========== MONITORING (Pro+) ==========
//
app.post("/api/monitors", auth, requirePlan("pro"), async (req, res) => {
  const user = req.dbUser;
  const { projectId, name, url } = req.body || {};
  if (!url) return res.status(400).json({ error: "URL requise" });

  const m = await Monitor.create({
    ownerId: user._id,
    projectId: projectId || null,
    name: name || "Monitor",
    url: String(url).trim(),
    lastStatus: "never"
  });

  return res.json({ ok: true, monitor: m });
});

app.get("/api/monitors", auth, requirePlan("pro"), async (req, res) => {
  const user = req.dbUser;
  const list = await Monitor.find({ ownerId: user._id }).sort({ createdAt: -1 }).limit(50);
  return res.json({ ok: true, monitors: list });
});

async function runOneMonitor(user, monitor) {
  const prevStatus = monitor.lastStatus || "never";

  try {
    const start = Date.now();
    const r = await fetch(String(monitor.url), { redirect: "follow" });
    const latency = Date.now() - start;
    const code = r.status;
    const okStatus = code >= 200 && code < 400;

    monitor.lastStatus = okStatus ? "ok" : "down";
    monitor.lastCode = code;
    monitor.lastLatencyMs = latency;
    monitor.lastRunAt = new Date();
    await monitor.save();

    await MonitorRun.create({
      ownerId: user._id,
      monitorId: monitor._id,
      ok: okStatus,
      statusCode: code,
      latencyMs: latency
    });

    // Alerte + email si changement de statut
    if (prevStatus !== monitor.lastStatus) {
      if (monitor.lastStatus === "down") {
        await Alert.create({
          ownerId: user._id,
          type: "monitor_down",
          monitorId: monitor._id,
          monitorName: monitor.name,
          url: monitor.url,
          statusCode: code,
          latencyMs: latency
        });

        await sendAlertEmail({
          to: user.email,
          subject: `🚨 FlowPoint Alert: ${monitor.name} DOWN`,
          html: `
            <h2>Monitor DOWN</h2>
            <p><b>${monitor.name}</b> (${monitor.url}) est DOWN.</p>
            <p>Status code: <b>${code}</b> — Latence: <b>${latency}ms</b></p>
            <p>Date: ${new Date().toLocaleString("fr-FR")}</p>
          `
        });
      }

      if (prevStatus === "down" && monitor.lastStatus === "ok") {
        await Alert.create({
          ownerId: user._id,
          type: "monitor_recovered",
          monitorId: monitor._id,
          monitorName: monitor.name,
          url: monitor.url,
          statusCode: code,
          latencyMs: latency
        });

        await sendAlertEmail({
          to: user.email,
          subject: `✅ FlowPoint Alert: ${monitor.name} RECOVERED`,
          html: `
            <h2>Monitor RECOVERED</h2>
            <p><b>${monitor.name}</b> (${monitor.url}) est de nouveau OK.</p>
            <p>Status code: <b>${code}</b> — Latence: <b>${latency}ms</b></p>
            <p>Date: ${new Date().toLocaleString("fr-FR")}</p>
          `
        });
      }
    }

    return monitor;
  } catch {
    monitor.lastStatus = "down";
    monitor.lastCode = 0;
    monitor.lastLatencyMs = 0;
    monitor.lastRunAt = new Date();
    await monitor.save();

    await MonitorRun.create({
      ownerId: user._id,
      monitorId: monitor._id,
      ok: false,
      statusCode: 0,
      latencyMs: 0
    });

    if (prevStatus !== "down") {
      await Alert.create({
        ownerId: user._id,
        type: "monitor_down",
        monitorId: monitor._id,
        monitorName: monitor.name,
        url: monitor.url,
        statusCode: 0,
        latencyMs: 0
      });

      await sendAlertEmail({
        to: user.email,
        subject: `🚨 FlowPoint Alert: ${monitor.name} DOWN`,
        html: `
          <h2>Monitor DOWN</h2>
          <p><b>${monitor.name}</b> (${monitor.url}) est DOWN (timeout/erreur).</p>
          <p>Date: ${new Date().toLocaleString("fr-FR")}</p>
        `
      });
    }

    return monitor;
  }
}

// Run now (1 monitor)
app.post("/api/monitors/run", auth, requirePlan("pro"), async (req, res) => {
  const user = req.dbUser;
  const { monitorId } = req.body || {};
  if (!monitorId) return res.status(400).json({ error: "monitorId requis" });

  const ok = await consume(user, "monitors", 1);
  if (!ok) return res.status(429).json({ error: "Quota monitoring dépassé" });

  const m = await Monitor.findOne({ _id: monitorId, ownerId: user._id });
  if (!m) return res.status(404).json({ error: "Monitor introuvable" });

  const updated = await runOneMonitor(user, m);
  return res.json({ ok: true, monitor: updated });
});

// History
app.get("/api/monitors/history", auth, requirePlan("pro"), async (req, res) => {
  const user = req.dbUser;
  const { monitorId } = req.query || {};
  if (!monitorId) return res.status(400).json({ error: "monitorId requis" });

  const list = await MonitorRun.find({ ownerId: user._id, monitorId }).sort({ checkedAt: -1 }).limit(30);
  return res.json({ ok: true, history: list.reverse() });
});

//
// ========== CRON (AUTO MONITORING) ==========
// Render Cron Job appelle cet endpoint toutes les X minutes
// URL: POST /api/cron/run-monitors?secret=CRON_SECRET
//
app.post("/api/cron/run-monitors", requireCronSecret, async (req, res) => {
  // on exécute pour tous les users Pro/Ultra non bloqués
  const users = await User.find({ plan: { $in: ["pro", "ultra"] }, accessBlocked: false }).limit(1000);

  let totalRan = 0;

  for (const u of users) {
    await resetMonthlyIfNeeded(u);
    const q = planQuotas(u.plan);

    // si pas de quota monitoring, skip
    if (q.monitors <= 0) continue;

    const monitors = await Monitor.find({ ownerId: u._id }).limit(50);

    for (const m of monitors) {
      // consommation quota
      const ok = await consume(u, "monitors", 1);
      if (!ok) break;

      await runOneMonitor(u, m);
      totalRan++;
    }
  }

  return res.json({ ok: true, totalRan, smtpConfigured: smtpConfigured() });
});

app.listen(PORT, () => console.log(`✅ FlowPoint SaaS lancé sur le port ${PORT}`));
