/**
 * FlowPoint AI – SaaS Backend (Standard / Pro / Ultra)
 * - Trial 14 jours (carte obligatoire via Stripe Checkout Subscription)
 * - Anti-abus (1 trial par email normalisé / domaine / nom entreprise)
 * - Blocage auto si paiement échoue (past_due/unpaid/invoice.payment_failed/subscription.deleted)
 * - Webhook Stripe signature OK (express.raw)
 * - Quotas par plan (exemple)
 */

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const Stripe = require("stripe");

const app = express();
app.use(cors());

// JSON partout sauf webhook Stripe (raw)
app.use((req, res, next) => {
  if (req.originalUrl === "/api/stripe/webhook") return next();
  express.json({ limit: "1mb" })(req, res, next);
});

// ================== ENV ==================
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || process.env.SECRET_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const PRICE_STANDARD = process.env.STRIPE_PRICE_ID_STANDARD;
const PRICE_PRO = process.env.STRIPE_PRICE_ID_PRO;
const PRICE_ULTRA = process.env.STRIPE_PRICE_ID_ULTRA;

const PORT = Number(process.env.PORT || 5000);

if (!MONGO_URI) console.error("❌ MONGO_URI manquant");
if (!JWT_SECRET) console.error("❌ JWT_SECRET manquant");
if (!STRIPE_SECRET_KEY) console.error("❌ STRIPE_SECRET_KEY manquant");
if (!STRIPE_WEBHOOK_SECRET) console.warn("⚠️ STRIPE_WEBHOOK_SECRET manquant (webhook non validable)");
if (!PRICE_STANDARD || !PRICE_PRO || !PRICE_ULTRA) console.error("❌ Price IDs manquants (STANDARD/PRO/ULTRA)");

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// ================== HELPERS ==================
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "icloud.com", "live.com", "msn.com", "aol.com", "proton.me", "protonmail.com"
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

function normalizeCompanyName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizePlan(p) {
  const v = String(p || "").trim().toLowerCase();
  if (v === "standard") return "standard";
  if (v === "pro") return "pro";
  if (v === "ultra") return "ultra";
  if (v.includes("ultra")) return "ultra";
  if (v.includes("standard")) return "standard";
  if (v.includes("pro")) return "pro";
  return "pro";
}

function planRank(plan) {
  const map = { free: 0, trial: 1, standard: 2, pro: 3, ultra: 4 };
  return map[plan] ?? 0;
}

function quotasForPlan(plan) {
  if (plan === "trial") return 50;
  if (plan === "standard") return 500;
  if (plan === "pro") return 5000;
  if (plan === "ultra") return 20000;
  return 0;
}

function priceForPlan(plan) {
  if (plan === "standard") return PRICE_STANDARD;
  if (plan === "pro") return PRICE_PRO;
  if (plan === "ultra") return PRICE_ULTRA;
  return null;
}

// ================== DB ==================
mongoose
  .connect(MONGO_URI || "mongodb://invalid")
  .then(() => console.log("✅ MongoDB connecté"))
  .catch((e) => console.error("❌ MongoDB erreur:", e.message));

// User
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

  monthlyLimit: { type: Number, default: 0 },
  monthlyUsed: { type: Number, default: 0 },
  resetAt: { type: Date, default: Date.now },

  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model("User", userSchema);

// Anti-abus registry
const trialRegistrySchema = new mongoose.Schema({
  emailNormalized: { type: String, unique: true, index: true },
  companyDomain: { type: String, index: true },
  companyNameNormalized: { type: String, index: true },

  firstTrialAt: { type: Date, default: Date.now },
  lastAttemptAt: { type: Date, default: Date.now },
  attemptsCount: { type: Number, default: 1 }
});
const TrialRegistry = mongoose.model("TrialRegistry", trialRegistrySchema);

// ================== AUTH ==================
function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Non autorisé" });
  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: "Token invalide" });
  }
}

async function requireActiveAccess(req, res, next) {
  const user = await User.findById(req.auth.userId);
  if (!user) return res.status(401).json({ error: "Utilisateur introuvable" });
  if (user.accessBlocked) return res.status(403).json({ error: "Accès bloqué (paiement échoué / abonnement inactif)" });
  req.user = user;
  return next();
}

function requirePlan(minPlan) {
  return (req, res, next) => {
    if (planRank(req.user.plan) < planRank(minPlan)) {
      return res.status(403).json({ error: `Plan requis: ${minPlan}` });
    }
    next();
  };
}

// ================== QUOTAS ==================
async function resetMonthlyIfNeeded(user) {
  const now = new Date();
  if (!user.resetAt) user.resetAt = now;

  const ra = new Date(user.resetAt);
  if (ra.getUTCFullYear() !== now.getUTCFullYear() || ra.getUTCMonth() !== now.getUTCMonth()) {
    user.monthlyUsed = 0;
    user.resetAt = now;
    user.monthlyLimit = quotasForPlan(user.plan);
    await user.save();
  }
}

async function useQuota(user, amount = 1) {
  await resetMonthlyIfNeeded(user);
  if (user.monthlyLimit <= 0) return false;
  if (user.monthlyUsed + amount > user.monthlyLimit) return false;
  user.monthlyUsed += amount;
  await user.save();
  return true;
}

// ================== ROUTES ==================
app.get("/test", (_, res) => res.send("Backend OK"));

// Lead + anti-abus + user trial + token
app.post("/api/auth/lead", async (req, res) => {
  const { firstName, email, companyName, plan } = req.body || {};
  if (!email || !companyName) return res.status(400).json({ error: "Email et entreprise requis" });

  const planNormalized = normalizePlan(plan);
  if (!["standard", "pro", "ultra"].includes(planNormalized)) {
    return res.status(400).json({ error: "Plan invalide" });
  }

  const emailNormalized = normalizeEmail(email);
  const domain = (emailNormalized.split("@")[1] || "").toLowerCase();
  const companyNameNormalized = normalizeCompanyName(companyName);

  try {
    const existingByEmail = await TrialRegistry.findOne({ emailNormalized });
    if (existingByEmail) {
      return res.status(403).json({ error: "Essai déjà utilisé pour cet email. Contactez-nous." });
    }

    if (!PUBLIC_EMAIL_DOMAINS.has(domain)) {
      const existingByDomain = await TrialRegistry.findOne({ companyDomain: domain });
      if (existingByDomain) {
        return res.status(403).json({ error: "Essai déjà utilisé pour cette entreprise (domaine). Contactez-nous." });
      }
    }

    const existingByCompany = await TrialRegistry.findOne({ companyNameNormalized });
    if (existingByCompany) {
      return res.status(403).json({ error: "Essai déjà utilisé pour cette entreprise. Contactez-nous." });
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

      monthlyLimit: quotasForPlan("trial"),
      monthlyUsed: 0,
      resetAt: now
    });

    await TrialRegistry.create({
      emailNormalized,
      companyDomain: domain,
      companyNameNormalized
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

// Stripe checkout session (trial 14 jours)
app.post("/api/stripe/create-checkout-session", requireAuth, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: "Stripe non configuré (STRIPE_SECRET_KEY)" });

  const { plan } = req.body || {};
  const planNormalized = normalizePlan(plan);
  if (!["standard", "pro", "ultra"].includes(planNormalized)) {
    return res.status(400).json({ error: "Plan invalide" });
  }

  const priceId = priceForPlan(planNormalized);
  if (!priceId) return res.status(500).json({ error: "Price ID Stripe manquant (STANDARD/PRO/ULTRA)" });

  try {
    const user = await User.findById(req.auth.userId);
    if (!user) return res.status(401).json({ error: "Utilisateur introuvable" });

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.emailRaw,
        name: user.companyName,
        metadata: { userId: user._id.toString(), emailNormalized: user.emailNormalized }
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
        metadata: { userId: user._id.toString(), selectedPlan: planNormalized }
      },
      success_url: `${baseUrl}/success.html`,
      cancel_url: `${baseUrl}/cancel.html`,
      allow_promotion_codes: true
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erreur Stripe" });
  }
});

// Stripe webhook (signature)
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
          user.monthlyLimit = quotasForPlan("trial");
        } else if (status === "active") {
          const selectedPlan = normalizePlan(sub.metadata?.selectedPlan);
          user.plan = ["standard", "pro", "ultra"].includes(selectedPlan) ? selectedPlan : "pro";
          user.accessBlocked = false;
          user.monthlyLimit = quotasForPlan(user.plan);
        } else if (status === "past_due" || status === "unpaid") {
          user.accessBlocked = true;
          user.plan = "free";
          user.monthlyLimit = 0;
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
          user.monthlyLimit = 0;
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
        user.monthlyLimit = 0;
        await user.save();
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    return res.status(500).send("Webhook handler error");
  }
});

// pages success/cancel
app.get("/success.html", (_, res) => {
  res.type("html").send(`<h1>✅ Paiement enregistré</h1><p>Votre essai est actif.</p>`);
});
app.get("/cancel.html", (_, res) => {
  res.type("html").send(`<h1>❌ Paiement annulé</h1><p>Vous pouvez réessayer.</p>`);
});

// /me
app.get("/api/me", requireAuth, requireActiveAccess, async (req, res) => {
  const u = req.user;
  return res.json({
    email: u.emailRaw,
    company: u.companyName,
    plan: u.plan,
    trialEndsAt: u.trialEndsAt,
    monthlyUsed: u.monthlyUsed,
    monthlyLimit: u.monthlyLimit,
    accessBlocked: u.accessBlocked,
    lastPaymentStatus: u.lastPaymentStatus
  });
});

// exemples gated
app.get("/api/features/basic", requireAuth, requireActiveAccess, async (req, res) => {
  const ok = await useQuota(req.user, 1);
  if (!ok) return res.status(429).json({ error: "Quota mensuel dépassé" });
  return res.json({ ok: true, feature: "basic" });
});

app.get("/api/features/advanced", requireAuth, requireActiveAccess, requirePlan("pro"), async (req, res) => {
  const ok = await useQuota(req.user, 2);
  if (!ok) return res.status(429).json({ error: "Quota mensuel dépassé" });
  return res.json({ ok: true, feature: "advanced" });
});

app.get("/api/features/ultra", requireAuth, requireActiveAccess, requirePlan("ultra"), async (req, res) => {
  const ok = await useQuota(req.user, 5);
  if (!ok) return res.status(429).json({ error: "Quota mensuel dépassé" });
  return res.json({ ok: true, feature: "ultra" });
});

// start
app.listen(PORT, () => console.log(`✅ SaaS backend lancé sur le port ${PORT}`));
