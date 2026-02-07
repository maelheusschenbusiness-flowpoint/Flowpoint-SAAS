// =======================
// FlowPoint AI – SaaS Backend
// Standard / Pro / Ultra
// Features: SEO Audit + Monitoring + PDF + History
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
const cheerio = require("cheerio");
const PDFDocument = require("pdfkit");

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
  "PUBLIC_BASE_URL"
];
for (const k of REQUIRED) {
  if (!process.env[k]) console.log("❌ ENV manquante:", k);
}
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET_RENDER;
if (!STRIPE_WEBHOOK_SECRET) console.log("⚠️ STRIPE_WEBHOOK_SECRET_RENDER manquante");

// ---------- STRIPE WEBHOOK RAW (AVANT express.json) ----------
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    if (!STRIPE_WEBHOOK_SECRET) return res.status(200).send("no webhook secret");
    const sig = req.headers["stripe-signature"];
    const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);

    if (event.type === "invoice.payment_failed") {
      const inv = event.data.object;
      await User.updateOne(
        { stripeCustomerId: inv.customer },
        { $set: { accessBlocked: true, lastPaymentStatus: "payment_failed" } }
      );
    }

    if (event.type === "invoice.payment_succeeded") {
      const inv = event.data.object;
      await User.updateOne(
        { stripeCustomerId: inv.customer },
        { $set: { accessBlocked: false, lastPaymentStatus: "payment_succeeded" } }
      );
    }

    if (event.type === "customer.subscription.updated") {
      const sub = event.data.object;
      const priceId = sub.items?.data?.[0]?.price?.id;

      const user = await User.findOne({ stripeCustomerId: sub.customer });
      if (user) {
        user.stripeSubscriptionId = sub.id;
        user.lastPaymentStatus = sub.status;

        if (["active", "trialing"].includes(sub.status)) user.accessBlocked = false;
        if (["past_due", "unpaid", "canceled"].includes(sub.status)) user.accessBlocked = true;

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
        { $set: { accessBlocked: true, lastPaymentStatus: "subscription_deleted" } }
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

// ---------- QUOTAS & PLANS ----------
function planRank(plan) {
  const map = { standard: 1, pro: 2, ultra: 3 };
  return map[String(plan || "").toLowerCase()] || 0;
}
function quotasForPlan(plan) {
  const p = String(plan || "").toLowerCase();
  if (p === "standard") return { audits: 30, monitors: 3, pdf: 30 };
  if (p === "pro") return { audits: 300, monitors: 50, pdf: 300 };
  if (p === "ultra") return { audits: 2000, monitors: 300, pdf: 2000 };
  return { audits: 0, monitors: 0, pdf: 0 };
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
    await user.save();
  }
}
async function consume(user, key, amount = 1) {
  const q = quotasForPlan(user.plan);
  const map = {
    audits: ["usedAudits", q.audits],
    monitors: ["usedMonitors", q.monitors],
    pdf: ["usedPdf", q.pdf]
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
    lastPaymentStatus: String,

    hasTrial: { type: Boolean, default: false },
    trialStartedAt: Date,
    trialEndsAt: Date,
    accessBlocked: { type: Boolean, default: false },

    usageMonth: { type: Date, default: firstDayOfThisMonthUTC },
    usedAudits: { type: Number, default: 0 },
    usedMonitors: { type: Number, default: 0 },
    usedPdf: { type: Number, default: 0 }
  },
  { timestamps: true }
);

const TrialRegistrySchema = new mongoose.Schema(
  { fingerprint: { type: String, unique: true, index: true }, usedAt: { type: Date, default: Date.now } },
  { timestamps: true }
);

const AuditSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },
    url: String,
    status: { type: String, enum: ["ok", "error"], default: "ok" },
    score: Number,
    summary: String,
    findings: Object, // checks détaillés
    recommendations: [String],
    htmlSnapshot: String // optionnel (petit)
  },
  { timestamps: true }
);

const MonitorSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },
    url: String,
    active: { type: Boolean, default: true },
    intervalMinutes: { type: Number, default: 60 }, // simple
    lastCheckedAt: Date,
    lastStatus: { type: String, enum: ["up", "down", "unknown"], default: "unknown" }
  },
  { timestamps: true }
);

const MonitorLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },
    monitorId: { type: mongoose.Schema.Types.ObjectId, index: true },
    url: String,
    status: { type: String, enum: ["up", "down"], default: "down" },
    httpStatus: Number,
    responseTimeMs: Number,
    checkedAt: { type: Date, default: Date.now },
    error: String
  },
  { timestamps: true }
);

const User = mongoose.model("User", UserSchema);
const TrialRegistry = mongoose.model("TrialRegistry", TrialRegistrySchema);
const Audit = mongoose.model("Audit", AuditSchema);
const Monitor = mongoose.model("Monitor", MonitorSchema);
const MonitorLog = mongoose.model("MonitorLog", MonitorLogSchema);

// ---------- HELPERS ----------
function normalizeCompanyName(s) {
  return (s || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9\s-]/g, "");
}
function makeFingerprint(req, email, companyName) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString();
  const ua = (req.headers["user-agent"] || "").toString();
  const base = `${ip}||${ua}||${(email || "").toLowerCase()}||${normalizeCompanyName(companyName)}`;
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
    next();
  } catch {
    return res.status(401).json({ error: "Token invalide" });
  }
}
async function requireActive(req, res, next) {
  const user = await User.findById(req.user.uid);
  if (!user) return res.status(404).json({ error: "User introuvable" });

  // sécurité: essai expiré => bloqué
  if (user.hasTrial && user.trialEndsAt && new Date(user.trialEndsAt).getTime() < Date.now()) {
    user.accessBlocked = true;
    user.lastPaymentStatus = user.lastPaymentStatus || "trial_expired";
    await user.save();
  }

  if (user.accessBlocked) return res.status(403).json({ error: "Accès bloqué (paiement échoué / essai terminé)" });

  await resetUsageIfNewMonth(user);
  req.dbUser = user;
  next();
}
function requirePlan(minPlan) {
  return (req, res, next) => {
    if (planRank(req.dbUser.plan) < planRank(minPlan)) return res.status(403).json({ error: `Plan requis: ${minPlan}` });
    next();
  };
}

// ---------- SEO AUDIT (simple mais efficace) ----------
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
  penalize(!checks.sitemapHint.ok, 3);

  if (score < 0) score = 0;
  return score;
}

function buildRecommendations(checks) {
  const rec = [];
  if (!checks.title.ok) rec.push("Ajouter un <title> unique (50–60 caractères).");
  if (!checks.metaDescription.ok) rec.push("Ajouter une meta description (140–160 caractères).");
  if (!checks.h1.ok) rec.push("Ajouter exactement 1 H1 pertinent (éviter 0 ou plusieurs).");
  if (!checks.canonical.ok) rec.push("Ajouter un lien canonical pour éviter le contenu dupliqué.");
  if (!checks.robots.ok) rec.push("Ajouter une meta robots cohérente (index/follow) ou vérifier robots.txt.");
  if (!checks.lang.ok) rec.push("Ajouter l’attribut lang sur <html> (ex: fr).");
  if (!checks.https.ok) rec.push("Forcer HTTPS (redirections + HSTS).");
  if (!checks.viewport.ok) rec.push("Ajouter meta viewport pour mobile.");
  if (!checks.og.ok) rec.push("Ajouter Open Graph (og:title, og:description, og:image) pour partage social.");
  return rec;
}

async function runSeoAudit(url) {
  const result = { url, checks: {}, recommendations: [], summary: "" };

  let fetched;
  try {
    fetched = await fetchWithTiming(url);
  } catch (e) {
    return { ...result, status: "error", score: 0, summary: "Impossible de charger l’URL.", error: e.message };
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

  // Sitemap hint (simple)
  const sitemapHint = "/sitemap.xml";

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
    sitemapHint: { ok: true, value: sitemapHint }
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
    htmlSnapshot: fetched.text.slice(0, 20000) // petit snapshot (limité)
  };
}

// ---------- MONITOR CHECK (simple) ----------
async function checkUrlOnce(url) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { redirect: "follow" });
    const ms = Date.now() - t0;
    const up = r.status >= 200 && r.status < 400;
    return { status: up ? "up" : "down", httpStatus: r.status, responseTimeMs: ms, error: "" };
  } catch (e) {
    const ms = Date.now() - t0;
    return { status: "down", httpStatus: 0, responseTimeMs: ms, error: e.message || "fetch failed" };
  }
}

// ---------- PAGES ----------
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/dashboard", (_, res) => res.sendFile(path.join(__dirname, "dashboard.html")));
app.get("/pricing", (_, res) => res.sendFile(path.join(__dirname, "pricing.html")));
app.get("/success", (_, res) => res.sendFile(path.join(__dirname, "success.html")));
app.get("/cancel", (_, res) => res.sendFile(path.join(__dirname, "cancel.html")));

// ---------- API ----------
app.get("/api/health", (_, res) => res.json({ ok: true }));

// Lead + token + anti-abus
app.post("/api/auth/lead", async (req, res) => {
  try {
    const { firstName, email, companyName, plan } = req.body || {};
    if (!email || !companyName) return res.status(400).json({ error: "Email + entreprise requis" });

    const chosenPlan = String(plan || "").toLowerCase();
    if (!["standard", "pro", "ultra"].includes(chosenPlan)) return res.status(400).json({ error: "Plan invalide" });

    const fingerprint = makeFingerprint(req, email, companyName);
    const already = await TrialRegistry.findOne({ fingerprint });
    if (already) return res.status(403).json({ error: "Essai déjà utilisé (anti-abus)." });

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

    await TrialRegistry.create({ fingerprint });

    return res.json({ ok: true, token: signToken(user) });
  } catch (e) {
    console.log("lead error:", e.message);
    return res.status(500).json({ error: "Erreur serveur lead" });
  }
});

// Stripe checkout
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
        metadata: { uid: user._id.toString() }
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }

    const baseUrl = process.env.PUBLIC_BASE_URL;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: { trial_period_days: 14, metadata: { uid: user._id.toString(), plan: chosenPlan } },
      metadata: { uid: user._id.toString(), plan: chosenPlan },
      success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/cancel.html`,
      allow_promotion_codes: true
    });

    return res.json({ url: session.url });
  } catch (e) {
    console.log("checkout error:", e.message);
    return res.status(500).json({ error: "Erreur Stripe checkout" });
  }
});

// Verify success
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

    const plan = String(session.metadata?.plan || "").toLowerCase();
    if (["standard", "pro", "ultra"].includes(plan)) user.plan = plan;

    user.accessBlocked = false;
    user.lastPaymentStatus = "checkout_verified";
    await user.save();

    return res.json({ ok: true, token: signToken(user) });
  } catch (e) {
    console.log("verify error:", e.message);
    return res.status(500).json({ error: "Erreur verify" });
  }
});

// Stripe portal
app.post("/api/stripe/portal", auth, requireActive, async (req, res) => {
  try {
    const user = req.dbUser;
    if (!user.stripeCustomerId) return res.status(400).json({ error: "Customer Stripe manquant" });

    const baseUrl = process.env.PUBLIC_BASE_URL;
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

// Me (dashboard)
app.get("/api/me", auth, requireActive, async (req, res) => {
  const u = req.dbUser;
  const q = quotasForPlan(u.plan);

  return res.json({
    email: u.email,
    name: u.name,
    companyName: u.companyName,
    plan: u.plan,
    hasTrial: u.hasTrial,
    trialEndsAt: u.trialEndsAt,
    accessBlocked: u.accessBlocked,
    lastPaymentStatus: u.lastPaymentStatus || "",
    usage: {
      month: u.usageMonth,
      audits: { used: u.usedAudits, limit: q.audits },
      monitors: { used: u.usedMonitors, limit: q.monitors },
      pdf: { used: u.usedPdf, limit: q.pdf }
    }
  });
});

//
// ===== FEATURE 1: SEO AUDIT + HISTORY =====
//

// Run audit
app.post("/api/audits/run", auth, requireActive, async (req, res) => {
  const url = String(req.body?.url || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: "URL invalide (doit commencer par http/https)" });

  const ok = await consume(req.dbUser, "audits", 1);
  if (!ok) return res.status(429).json({ error: "Quota audits dépassé" });

  const out = await runSeoAudit(url);

  const audit = await Audit.create({
    userId: req.dbUser._id,
    url,
    status: out.status,
    score: out.score,
    summary: out.summary,
    findings: out.findings,
    recommendations: out.recommendations,
    htmlSnapshot: out.htmlSnapshot
  });

  return res.json({ ok: true, auditId: audit._id, score: audit.score, summary: audit.summary });
});

// List audits
app.get("/api/audits", auth, requireActive, async (req, res) => {
  const list = await Audit.find({ userId: req.dbUser._id }).sort({ createdAt: -1 }).limit(50);
  return res.json({ ok: true, audits: list });
});

// Audit detail
app.get("/api/audits/:id", auth, requireActive, async (req, res) => {
  const a = await Audit.findOne({ _id: req.params.id, userId: req.dbUser._id });
  if (!a) return res.status(404).json({ error: "Audit introuvable" });
  return res.json({ ok: true, audit: a });
});

//
// ===== FEATURE 2: PDF REPORT GENERATION =====
//

// PDF from audit
app.get("/api/audits/:id/pdf", auth, requireActive, async (req, res) => {
  const a = await Audit.findOne({ _id: req.params.id, userId: req.dbUser._id });
  if (!a) return res.status(404).json({ error: "Audit introuvable" });

  const ok = await consume(req.dbUser, "pdf", 1);
  if (!ok) return res.status(429).json({ error: "Quota PDF dépassé" });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="flowpoint-audit-${a._id}.pdf"`);

  const doc = new PDFDocument({ margin: 48 });
  doc.pipe(res);

  doc.fontSize(20).text("FlowPoint AI — Rapport SEO", { underline: true });
  doc.moveDown(0.5);
  doc.fontSize(12).text(`URL: ${a.url}`);
  doc.text(`Date: ${new Date(a.createdAt).toLocaleString("fr-FR")}`);
  doc.text(`Score: ${a.score}/100`);
  doc.moveDown();

  doc.fontSize(14).text("Résumé", { underline: true });
  doc.fontSize(12).text(a.summary || "-");
  doc.moveDown();

  doc.fontSize(14).text("Recommandations", { underline: true });
  doc.moveDown(0.25);
  const rec = Array.isArray(a.recommendations) ? a.recommendations : [];
  if (!rec.length) doc.fontSize(12).text("Aucune recommandation.");
  for (const r of rec) doc.fontSize(12).text("• " + r);
  doc.moveDown();

  doc.fontSize(14).text("Checks", { underline: true });
  doc.moveDown(0.25);
  const f = a.findings || {};
  for (const [k, v] of Object.entries(f)) {
    doc.fontSize(12).text(`${k}: ${v?.ok ? "OK" : "À corriger"} — ${typeof v?.value === "object" ? JSON.stringify(v.value) : String(v?.value ?? "")}`);
  }

  doc.end();
});

//
// ===== FEATURE 3: MONITORING + LOGS + HISTORY =====
//

// Create monitor (Pro+ recommandé, mais on laisse Standard = petit nombre)
app.post("/api/monitors", auth, requireActive, async (req, res) => {
  const url = String(req.body?.url || "").trim();
  const intervalMinutes = Number(req.body?.intervalMinutes || 60);

  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: "URL invalide" });
  if (!Number.isFinite(intervalMinutes) || intervalMinutes < 5) return res.status(400).json({ error: "intervalMinutes min = 5" });

  // quota monitors = nombre de monitors max (usage)
  // on consomme 1 "monitor" à la création (tu peux changer)
  const ok = await consume(req.dbUser, "monitors", 1);
  if (!ok) return res.status(429).json({ error: "Quota monitors dépassé" });

  const m = await Monitor.create({
    userId: req.dbUser._id,
    url,
    intervalMinutes,
    active: true
  });

  return res.json({ ok: true, monitor: m });
});

// List monitors
app.get("/api/monitors", auth, requireActive, async (req, res) => {
  const list = await Monitor.find({ userId: req.dbUser._id }).sort({ createdAt: -1 }).limit(50);
  return res.json({ ok: true, monitors: list });
});

// Toggle monitor
app.patch("/api/monitors/:id", auth, requireActive, async (req, res) => {
  const m = await Monitor.findOne({ _id: req.params.id, userId: req.dbUser._id });
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

// Run monitor now (manual check)
app.post("/api/monitors/:id/run", auth, requireActive, async (req, res) => {
  const m = await Monitor.findOne({ _id: req.params.id, userId: req.dbUser._id });
  if (!m) return res.status(404).json({ error: "Monitor introuvable" });
  if (!m.active) return res.status(400).json({ error: "Monitor inactif" });

  // Pro+ : checks manuels illimités, Standard : autorisé mais logique simple
  const r = await checkUrlOnce(m.url);

  m.lastCheckedAt = new Date();
  m.lastStatus = r.status;
  await m.save();

  await MonitorLog.create({
    userId: req.dbUser._id,
    monitorId: m._id,
    url: m.url,
    status: r.status,
    httpStatus: r.httpStatus,
    responseTimeMs: r.responseTimeMs,
    error: r.error
  });

  return res.json({ ok: true, result: r });
});

// List monitor logs
app.get("/api/monitors/:id/logs", auth, requireActive, async (req, res) => {
  const m = await Monitor.findOne({ _id: req.params.id, userId: req.dbUser._id });
  if (!m) return res.status(404).json({ error: "Monitor introuvable" });

  const logs = await MonitorLog.find({ userId: req.dbUser._id, monitorId: m._id }).sort({ checkedAt: -1 }).limit(100);
  return res.json({ ok: true, logs });
});

// ---------- START ----------
app.listen(PORT, () => console.log(`✅ FlowPoint SaaS lancé sur port ${PORT}`));
