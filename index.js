// =======================
// FlowPoint AI – SaaS Backend
// Plans: Standard / Pro / Ultra
// Modules: Audit (URL), Chat (sur audits), Monitoring (run now + historique)
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

const app = express();

// ---------- ENV ----------
const REQUIRED = [
  "MONGO_URI",
  "JWT_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_PRICE_ID_STANDARD",
  "STRIPE_PRICE_ID_PRO",
  "STRIPE_PRICE_ID_ULTRA"
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

// ---------- STATIC ----------
app.use(express.static(path.join(__dirname)));

// ---------- DB ----------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connecté"))
  .catch((e) => console.log("❌ MongoDB erreur:", e.message));

// ---------- PLAN + QUOTAS ----------
function planRank(plan) {
  const map = { standard: 1, pro: 2, ultra: 3 };
  return map[String(plan || "").toLowerCase()] || 0;
}

// quotas / mois
function planQuotas(plan) {
  const p = String(plan || "").toLowerCase();
  if (p === "standard") return { audits: 200, chat: 400, monitors: 20 };
  if (p === "pro") return { audits: 2000, chat: 5000, monitors: 200 };
  if (p === "ultra") return { audits: 8000, chat: 20000, monitors: 1000 };
  return { audits: 0, chat: 0, monitors: 0 };
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

    // usage mensuel
    resetAt: { type: Date, default: Date.now },
    usedAudits: { type: Number, default: 0 },
    usedChat: { type: Number, default: 0 },
    usedMonitors: { type: Number, default: 0 }
  },
  { timestamps: true }
);

const TrialRegistrySchema = new mongoose.Schema(
  { fingerprint: { type: String, unique: true, index: true }, usedAt: { type: Date, default: Date.now } },
  { timestamps: true }
);

const ProjectSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, index: true },
    name: String,
    url: String,
    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

const AuditSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, index: true },
    url: String,
    score: Number,
    findings: [String],
    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

const ChatSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, index: true },
    projectId: { type: mongoose.Schema.Types.ObjectId, index: true },
    role: { type: String, enum: ["user", "assistant"], required: true },
    text: String,
    createdAt: { type: Date, default: Date.now }
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

const User = mongoose.model("User", UserSchema);
const TrialRegistry = mongoose.model("TrialRegistry", TrialRegistrySchema);
const Project = mongoose.model("Project", ProjectSchema);
const Audit = mongoose.model("Audit", AuditSchema);
const ChatMessage = mongoose.model("ChatMessage", ChatSchema);
const Monitor = mongoose.model("Monitor", MonitorSchema);
const MonitorRun = mongoose.model("MonitorRun", MonitorRunSchema);

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

// ---------- URL FETCH (Audit + Monitor) ----------
async function fetchWithTimeout(url, ms = 8000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  const start = Date.now();
  try {
    const r = await fetch(url, { signal: controller.signal, redirect: "follow" });
    const text = await r.text();
    return { ok: true, status: r.status, latencyMs: Date.now() - start, text };
  } finally {
    clearTimeout(t);
  }
}

// ---------- AUDIT HEURISTICS ----------
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

// ---------- PAGES ----------
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/dashboard", (req, res) => res.sendFile(path.join(__dirname, "dashboard.html")));
app.get("/success", (req, res) => res.sendFile(path.join(__dirname, "success.html")));
app.get("/cancel", (req, res) => res.sendFile(path.join(__dirname, "cancel.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "login.html")));

// ---------- API ----------
app.get("/api/health", (_, res) => res.json({ ok: true }));

// lead
app.post("/api/auth/lead", async (req, res) => {
  try {
    const { firstName, email, companyName, plan } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email requis" });
    if (!companyName) return res.status(400).json({ error: "Entreprise requise" });

    const chosenPlan = (plan || "").toLowerCase();
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

// login (retour plus tard)
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

// checkout
app.post("/api/stripe/checkout", auth, async (req, res) => {
  try {
    const { plan } = req.body || {};
    const chosenPlan = (plan || "").toLowerCase();
    if (!["standard", "pro", "ultra"].includes(chosenPlan)) return res.status(400).json({ error: "Plan invalide" });

    const user = await User.findById(req.user.uid);
    if (!user) return res.status(404).json({ error: "User introuvable" });
    if (user.accessBlocked) return res.status(403).json({ error: "Accès bloqué (paiement échoué)" });

    const fp = makeFingerprint(req, user.email);
    const already = await TrialRegistry.findOne({ fingerprint: fp });
    if (already) return res.status(403).json({ error: "Essai déjà utilisé (anti-abus)." });

    const priceId =
      chosenPlan === "standard" ? process.env.STRIPE_PRICE_ID_STANDARD :
      chosenPlan === "pro" ? process.env.STRIPE_PRICE_ID_PRO :
      process.env.STRIPE_PRICE_ID_ULTRA;

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

    const baseUrl = (process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`).trim();

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

// verify
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

    const p = (session.metadata?.plan || "").toLowerCase();
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

// portal
app.post("/api/stripe/portal", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.uid);
    if (!user?.stripeCustomerId) return res.status(400).json({ error: "Customer Stripe manquant" });

    const baseUrl = (process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`).trim();
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

// me + quotas
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
      monitors: { used: user.usedMonitors, limit: q.monitors }
    }
  });
});

//
// ========== PROJECTS ==========
//
app.post("/api/projects", auth, requirePlan("standard"), async (req, res) => {
  const { name, url } = req.body || {};
  if (!url) return res.status(400).json({ error: "URL requise" });
  const p = await Project.create({
    ownerId: req.dbUser._id,
    name: name || "Mon projet",
    url: String(url).trim()
  });
  return res.json({ ok: true, project: p });
});

app.get("/api/projects", auth, requirePlan("standard"), async (req, res) => {
  const list = await Project.find({ ownerId: req.dbUser._id }).sort({ createdAt: -1 }).limit(50);
  return res.json({ ok: true, projects: list });
});

//
// ========== AUDIT (URL -> score + findings + store) ==========
//
app.post("/api/audit/run", auth, requirePlan("standard"), async (req, res) => {
  const user = req.dbUser;
  const { projectId, url } = req.body || {};

  const targetUrl = (url || "").trim();
  if (!targetUrl) return res.status(400).json({ error: "URL requise" });

  // quota
  const ok = await consume(user, "audits", 1);
  if (!ok) return res.status(429).json({ error: "Quota audits dépassé" });

  try {
    const r = await fetchWithTimeout(targetUrl, 9000);
    const { score, findings } = auditHtml(targetUrl, r.text || "");
    const audit = await Audit.create({
      ownerId: user._id,
      projectId: projectId || null,
      url: targetUrl,
      score,
      findings
    });
    return res.json({ ok: true, audit });
  } catch (e) {
    return res.status(500).json({ error: "Audit impossible (URL inaccessible ou timeout)" });
  }
});

app.get("/api/audit/latest", auth, requirePlan("standard"), async (req, res) => {
  const { projectId } = req.query || {};
  const q = { ownerId: req.dbUser._id };
  if (projectId) q.projectId = projectId;
  const audit = await Audit.findOne(q).sort({ createdAt: -1 });
  return res.json({ ok: true, audit: audit || null });
});

//
// ========== CHAT (simple assistant basé sur audits) ==========
//
function buildAssistantReply(userText, latestAudit) {
  const t = String(userText || "").toLowerCase();

  if (!latestAudit) {
    return "Je n’ai pas encore d’audit enregistré pour ce projet. Lance un audit (bouton ‘Run audit’) et je pourrai te conseiller.";
  }

  if (t.includes("score")) {
    return `Ton dernier score est ${latestAudit.score}/100. Points à améliorer : ${latestAudit.findings.slice(0, 5).join(", ") || "aucun"}.`;
  }

  if (t.includes("priorité") || t.includes("priorites") || t.includes("first")) {
    const top = latestAudit.findings.slice(0, 3);
    return `Priorité: ${top.join(" → ")}. Commence par corriger ça, puis refais un audit.`;
  }

  if (t.includes("seo")) {
    const seo = latestAudit.findings.filter(x => x.toLowerCase().includes("meta") || x.toLowerCase().includes("canonical") || x.toLowerCase().includes("title"));
    return `SEO: ${seo.length ? seo.join(", ") : "rien de critique détecté côté title/meta/canonical."}`;
  }

  return `Je peux t’aider sur: "score", "priorités", "SEO". Ton audit dit: ${latestAudit.findings.slice(0, 4).join(", ")}.`;
}

app.post("/api/chat/send", auth, requirePlan("standard"), async (req, res) => {
  const user = req.dbUser;
  const { projectId, text } = req.body || {};
  if (!text) return res.status(400).json({ error: "Message requis" });

  // quota
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
  const { projectId } = req.query || {};
  const q = { ownerId: req.dbUser._id };
  if (projectId) q.projectId = projectId;
  const history = await ChatMessage.find(q).sort({ createdAt: -1 }).limit(30);
  return res.json({ ok: true, history: history.reverse() });
});

//
// ========== MONITORING (run now + historique) ==========
//
app.post("/api/monitors", auth, requirePlan("pro"), async (req, res) => {
  // monitoring = Pro+
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
  const list = await Monitor.find({ ownerId: req.dbUser._id }).sort({ createdAt: -1 }).limit(50);
  return res.json({ ok: true, monitors: list });
});

app.post("/api/monitors/run", auth, requirePlan("pro"), async (req, res) => {
  const user = req.dbUser;
  const { monitorId } = req.body || {};
  if (!monitorId) return res.status(400).json({ error: "monitorId requis" });

  const ok = await consume(user, "monitors", 1);
  if (!ok) return res.status(429).json({ error: "Quota monitoring dépassé" });

  const m = await Monitor.findOne({ _id: monitorId, ownerId: user._id });
  if (!m) return res.status(404).json({ error: "Monitor introuvable" });

  try {
    const start = Date.now();
    const r = await fetch(String(m.url), { redirect: "follow" });
    const latency = Date.now() - start;
    const code = r.status;
    const okStatus = code >= 200 && code < 400;

    m.lastStatus = okStatus ? "ok" : "down";
    m.lastCode = code;
    m.lastLatencyMs = latency;
    m.lastRunAt = new Date();
    await m.save();

    await MonitorRun.create({
      ownerId: user._id,
      monitorId: m._id,
      ok: okStatus,
      statusCode: code,
      latencyMs: latency
    });

    return res.json({ ok: true, monitor: m });
  } catch (e) {
    m.lastStatus = "down";
    m.lastCode = 0;
    m.lastLatencyMs = 0;
    m.lastRunAt = new Date();
    await m.save();

    await MonitorRun.create({
      ownerId: user._id,
      monitorId: m._id,
      ok: false,
      statusCode: 0,
      latencyMs: 0
    });

    return res.json({ ok: true, monitor: m });
  }
});

app.get("/api/monitors/history", auth, requirePlan("pro"), async (req, res) => {
  const { monitorId } = req.query || {};
  if (!monitorId) return res.status(400).json({ error: "monitorId requis" });
  const list = await MonitorRun.find({ ownerId: req.dbUser._id, monitorId }).sort({ checkedAt: -1 }).limit(30);
  return res.json({ ok: true, history: list.reverse() });
});

app.listen(PORT, () => console.log(`✅ FlowPoint SaaS lancé sur le port ${PORT}`));
