// =======================
// FlowPoint AI – SaaS Backend (Render)
// Plans: Standard / Pro / Ultra
// Sécurité + clean version
// =======================

const express = require("express");
const mongoose = require("mongoose");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const Stripe = require("stripe");
const path = require("path");

const app = express();

// -----------------------
// 0) ENV (Render)
// -----------------------
const PORT = process.env.PORT || 10000;

const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;

// Stripe
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
// Tu as choisi STRIPE_WEBHOOK_SECRET_RENDER pour éviter doublon Make : OK
const STRIPE_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET_RENDER || process.env.STRIPE_WEBHOOK_SECRET;

// Price IDs (IMPORTANT: mêmes noms que sur Render)
const PRICE_STANDARD = process.env.STRIPE_PRICE_ID_STANDARD;
const PRICE_PRO = process.env.STRIPE_PRICE_ID_PRO;
const PRICE_ULTRA = process.env.STRIPE_PRICE_ID_ULTRA;

// Optionnel: whitelist CORS (sécurise l’API)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// -----------------------
// 1) Sécurité HTTP
// -----------------------
app.set("trust proxy", 1); // important sur Render

app.use(
  helmet({
    contentSecurityPolicy: false, // simple pour éviter soucis sur pages statiques
  })
);

// CORS : si ALLOWED_ORIGINS vide => on autorise même origine (safe avec fetch relatif)
// Si tu veux strict: mets ALLOWED_ORIGINS="https://tonsite.com,https://flowpoint-saas-1.onrender.com"
app.use(
  cors({
    origin: function (origin, cb) {
      if (!origin) return cb(null, true); // requêtes serveur/health
      if (ALLOWED_ORIGINS.length === 0) return cb(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error("CORS blocked"), false);
    },
    credentials: true,
  })
);

// JSON partout sauf webhook Stripe (raw)
app.use((req, res, next) => {
  if (req.originalUrl === "/api/stripe/webhook") return next();
  express.json({ limit: "1mb" })(req, res, next);
});

// Rate limit global léger
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Rate limit plus strict sur endpoints sensibles
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

const stripeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

// -----------------------
// 2) Stripe client
// -----------------------
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// -----------------------
// 3) Helpers
// -----------------------
function mustEnv(name, value) {
  if (!value) console.error(`❌ ENV manquant: ${name}`);
  else console.log(`✅ ${name}`);
}

function normalizeEmail(emailRaw) {
  const email = String(emailRaw || "").trim().toLowerCase();
  const parts = email.split("@");
  if (parts.length !== 2) return email;

  let [local, domain] = parts;

  // gmail anti abuse (dots + plus)
  if (domain === "googlemail.com") domain = "gmail.com";
  if (domain === "gmail.com") {
    const plusIndex = local.indexOf("+");
    if (plusIndex >= 0) local = local.slice(0, plusIndex);
    local = local.replace(/\./g, "");
  }

  return `${local}@${domain}`;
}

function normalizeCompanyName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isValidPlan(plan) {
  return ["standard", "pro", "ultra"].includes(String(plan || "").toLowerCase());
}

function priceForPlan(plan) {
  const p = String(plan || "").toLowerCase();
  if (p === "standard") return PRICE_STANDARD;
  if (p === "pro") return PRICE_PRO;
  if (p === "ultra") return PRICE_ULTRA;
  return null;
}

// -----------------------
// 4) DB
// -----------------------
if (!MONGO_URI) console.error("❌ MONGO_URI manquant");

mongoose
  .connect(MONGO_URI || "mongodb://invalid")
  .then(() => console.log("✅ MongoDB connecté"))
  .catch((e) => console.error("❌ MongoDB erreur:", e.message));

const userSchema = new mongoose.Schema({
  firstName: String,
  emailRaw: String,
  emailNormalized: { type: String, unique: true, index: true },
  companyName: String,
  companyNameNormalized: { type: String, index: true },
  companyDomain: { type: String, index: true },

  plan: { type: String, default: "trial" }, // trial|standard|pro|ultra|free
  trialStartedAt: Date,
  trialEndsAt: Date,

  stripeCustomerId: String,
  stripeSubscriptionId: String,
  stripePriceId: String,

  accessBlocked: { type: Boolean, default: false },
  lastPaymentStatus: String,

  createdAt: { type: Date, default: Date.now },
});

const trialRegistrySchema = new mongoose.Schema({
  emailNormalized: { type: String, unique: true, index: true },
  companyDomain: { type: String, index: true },
  companyNameNormalized: { type: String, index: true },

  firstTrialAt: { type: Date, default: Date.now },
  lastAttemptAt: { type: Date, default: Date.now },
  attemptsCount: { type: Number, default: 1 },
});

const User = mongoose.model("User", userSchema);
const TrialRegistry = mongoose.model("TrialRegistry", trialRegistrySchema);

// -----------------------
// 5) Auth middleware
// -----------------------
function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Non autorisé" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.auth = payload;
    return next();
  } catch {
    return res.status(401).json({ error: "Token invalide" });
  }
}

// -----------------------
// 6) Static Front (pages)
// -----------------------
app.use(express.static(path.join(__dirname))); // sert index.html, app.js, etc.

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// -----------------------
// 7) Health check
// -----------------------
app.get("/test", (req, res) => res.send("Backend OK"));
app.get("/api/health", (req, res) => res.json({ ok: true }));

// -----------------------
// 8) Lead + anti-abus + token
// -----------------------
app.post("/api/auth/lead", authLimiter, async (req, res) => {
  const { firstName, email, companyName, plan } = req.body || {};

  if (!email || !companyName || !plan) {
    return res.status(400).json({ error: "Champs manquants" });
  }

  const selectedPlan = String(plan).toLowerCase();
  if (!isValidPlan(selectedPlan)) {
    return res.status(400).json({ error: "Plan invalide" });
  }

  const emailNormalized = normalizeEmail(email);
  const domain = (emailNormalized.split("@")[1] || "").toLowerCase();
  const companyNameNormalized = normalizeCompanyName(companyName);

  try {
    // anti abus: email unique
    const existingByEmail = await TrialRegistry.findOne({ emailNormalized });
    if (existingByEmail) {
      return res.status(403).json({ error: "Essai déjà utilisé (anti-abus)." });
    }

    // anti abus: entreprise unique (nom)
    const existingByCompany = await TrialRegistry.findOne({ companyNameNormalized });
    if (existingByCompany) {
      return res.status(403).json({ error: "Essai déjà utilisé (anti-abus)." });
    }

    // optionnel: anti abus par domaine (si pas gmail etc)
    const PUBLIC_DOMAINS = new Set([
      "gmail.com","googlemail.com","yahoo.com","outlook.com","hotmail.com","icloud.com","live.com","msn.com"
    ]);

    if (!PUBLIC_DOMAINS.has(domain)) {
      const existingByDomain = await TrialRegistry.findOne({ companyDomain: domain });
      if (existingByDomain) {
        return res.status(403).json({ error: "Essai déjà utilisé (anti-abus)." });
      }
    }

    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const user = await User.create({
      firstName: String(firstName || "").trim(),
      emailRaw: String(email).trim(),
      emailNormalized,
      companyName: String(companyName).trim(),
      companyNameNormalized,
      companyDomain: domain,

      plan: "trial",
      trialStartedAt: now,
      trialEndsAt,

      accessBlocked: false,
      lastPaymentStatus: "trialing",
    });

    await TrialRegistry.create({
      emailNormalized,
      companyDomain: domain,
      companyNameNormalized,
    });

    const token = jwt.sign(
      { userId: user._id.toString(), emailNormalized },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.json({ ok: true, token });
  } catch (err) {
    if (String(err?.message || "").includes("duplicate key")) {
      return res.status(403).json({ error: "Essai déjà utilisé (anti-abus)." });
    }
    console.error(err);
    return res.status(500).json({ error: "Erreur serveur" });
  }
});

// -----------------------
// 9) Stripe checkout session
// -----------------------
app.post("/api/stripe/checkout", stripeLimiter, requireAuth, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: "Stripe non configuré" });

  const { plan } = req.body || {};
  const selectedPlan = String(plan || "").toLowerCase();

  if (!isValidPlan(selectedPlan)) {
    return res.status(400).json({ error: "Plan invalide" });
  }

  const priceId = priceForPlan(selectedPlan);
  if (!priceId) {
    return res.status(500).json({ error: "Price ID manquant côté serveur" });
  }

  try {
    const user = await User.findById(req.auth.userId);
    if (!user) return res.status(401).json({ error: "Utilisateur introuvable" });

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.emailRaw,
        name: user.companyName,
        metadata: { userId: user._id.toString(), emailNormalized: user.emailNormalized },
      });
      customerId = customer.id;
      user.stripeCustomerId = customerId;
      await user.save();
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
        metadata: { userId: user._id.toString(), selectedPlan },
      },
      success_url: `${baseUrl}/success.html`,
      cancel_url: `${baseUrl}/cancel.html`,
      allow_promotion_codes: true,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout error:", err?.message || err);
    return res.status(500).json({ error: "Erreur Stripe" });
  }
});

// -----------------------
// 10) Stripe webhook (RAW + signature)
// -----------------------
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe) return res.status(500).send("Stripe non configuré");
  if (!STRIPE_WEBHOOK_SECRET) return res.status(500).send("Webhook secret manquant");

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(400).send("Webhook Error");
  }

  try {
    async function getUserByStripeObject(obj) {
      const metaUserId = obj?.metadata?.userId;
      if (metaUserId) return await User.findById(metaUserId);

      const custId = obj?.customer;
      if (custId) {
        const cust = await stripe.customers.retrieve(custId);
        const uid = cust?.metadata?.userId;
        if (uid) return await User.findById(uid);
      }
      return null;
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const user = await getUserByStripeObject(session);
      if (user) {
        user.stripeCustomerId = session.customer || user.stripeCustomerId;
        user.stripeSubscriptionId = session.subscription || user.stripeSubscriptionId;
        user.lastPaymentStatus = "checkout_completed";
        user.accessBlocked = false;
        await user.save();
      }
    }

    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
      const sub = event.data.object;
      const user = await getUserByStripeObject(sub);

      if (user) {
        user.stripeSubscriptionId = sub.id;
        user.stripeCustomerId = sub.customer;
        user.stripePriceId = sub.items?.data?.[0]?.price?.id || user.stripePriceId;

        const status = sub.status;
        user.lastPaymentStatus = status;

        if (status === "trialing") {
          user.plan = "trial";
          user.accessBlocked = false;
        } else if (status === "active") {
          const selectedPlan = sub.metadata?.selectedPlan;
          user.plan = isValidPlan(selectedPlan) ? selectedPlan : "pro";
          user.accessBlocked = false;
        } else if (status === "past_due" || status === "unpaid") {
          user.accessBlocked = true;
          user.plan = "free";
        }

        await user.save();
      }
    }

    if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object;
      const cust = await stripe.customers.retrieve(invoice.customer);
      const uid = cust?.metadata?.userId;
      if (uid) {
        const user = await User.findById(uid);
        if (user) {
          user.accessBlocked = true;
          user.plan = "free";
          user.lastPaymentStatus = "payment_failed";
          await user.save();
        }
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const user = await getUserByStripeObject(sub);
      if (user) {
        user.accessBlocked = true;
        user.plan = "free";
        user.lastPaymentStatus = "subscription_deleted";
        await user.save();
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return res.status(500).send("Webhook handler error");
  }
});

// -----------------------
// 11) /api/me (debug)
// -----------------------
app.get("/api/me", requireAuth, async (req, res) => {
  const u = await User.findById(req.auth.userId);
  if (!u) return res.status(404).json({ error: "Utilisateur introuvable" });

  return res.json({
    email: u.emailRaw,
    company: u.companyName,
    plan: u.plan,
    trialEndsAt: u.trialEndsAt,
    blocked: u.accessBlocked,
    lastPaymentStatus: u.lastPaymentStatus,
  });
});

// -----------------------
// 12) Pages fallback
// -----------------------
app.get("/success.html", (_, res) => {
  res.type("html").send(`<h1>✅ Paiement enregistré</h1><p>Votre essai est actif. Vous pouvez fermer cette page.</p>`);
});

app.get("/cancel.html", (_, res) => {
  res.type("html").send(`<h1>❌ Paiement annulé</h1><p>Vous pouvez revenir en arrière et réessayer.</p>`);
});

// -----------------------
// 13) Boot + env checks
// -----------------------
mustEnv("MONGO_URI", MONGO_URI);
mustEnv("JWT_SECRET", JWT_SECRET);
mustEnv("STRIPE_SECRET_KEY", STRIPE_SECRET_KEY);
mustEnv("STRIPE_WEBHOOK_SECRET_RENDER (ou STRIPE_WEBHOOK_SECRET)", STRIPE_WEBHOOK_SECRET);
mustEnv("STRIPE_PRICE_ID_STANDARD", PRICE_STANDARD);
mustEnv("STRIPE_PRICE_ID_PRO", PRICE_PRO);
mustEnv("STRIPE_PRICE_ID_ULTRA", PRICE_ULTRA);

app.listen(PORT, () => console.log(`✅ FlowPoint SaaS lancé sur le port ${PORT}`));
