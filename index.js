// =======================
// FlowPoint AI – SaaS Backend
// Standard / Pro / Ultra
// =======================

const path = require("path");
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const Stripe = require("stripe");

const app = express();

// ----- CORS -----
app.use(cors());

// ----- Stripe webhook: doit être en RAW -----
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      if (!stripe) return res.status(500).send("Stripe non configuré");
      if (!STRIPE_WEBHOOK_SECRET_RENDER)
        return res.status(500).send("Webhook secret manquant (Render)");

      const sig = req.headers["stripe-signature"];
      let event;

      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          sig,
          STRIPE_WEBHOOK_SECRET_RENDER
        );
      } catch (err) {
        console.error("❌ Webhook signature error:", err.message);
        return res.status(400).send("Webhook Error");
      }

      // Helpers
      async function getUserByStripeObject(obj) {
        const metaUserId = obj?.metadata?.userId;
        if (metaUserId) return await User.findById(metaUserId);

        const custId = obj?.customer;
        if (custId && stripe) {
          const cust = await stripe.customers.retrieve(custId);
          const uid = cust?.metadata?.userId;
          if (uid) return await User.findById(uid);
        }
        return null;
      }

      // --- Events importants ---
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const user = await getUserByStripeObject(session);
        if (user) {
          user.stripeCustomerId = session.customer || user.stripeCustomerId;
          user.stripeSubscriptionId = session.subscription || user.stripeSubscriptionId;
          user.accessBlocked = false;
          user.lastPaymentStatus = "checkout_completed";
          await user.save();
        }
      }

      if (
        event.type === "customer.subscription.created" ||
        event.type === "customer.subscription.updated"
      ) {
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
            const selectedPlan = sub.metadata?.selectedPlan;
            user.plan = ["standard", "pro", "ultra"].includes(selectedPlan)
              ? selectedPlan
              : "pro";
            user.accessBlocked = false;
            user.monthlyLimit = quotasForPlan(user.plan);
          } else if (status === "past_due" || status === "unpaid") {
            // paiement échoué => bloqué
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
    } catch (e) {
      console.error("❌ Webhook handler error:", e);
      return res.status(500).send("Webhook handler error");
    }
  }
);

// ----- JSON pour toutes les autres routes -----
app.use(express.json({ limit: "1mb" }));

// ----- Static (ton site) -----
// Tu as tes fichiers HTML à la racine => on sert la racine
app.use(express.static(__dirname));

// ================== ENV ==================
const PORT = process.env.PORT || 5000;

const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
// tu as choisi un nom différent pour Render (pas celui de Make)
const STRIPE_WEBHOOK_SECRET_RENDER = process.env.STRIPE_WEBHOOK_SECRET_RENDER;

const STRIPE_PRICE_ID_STANDARD = process.env.STRIPE_PRICE_ID_STANDARD;
const STRIPE_PRICE_ID_PRO = process.env.STRIPE_PRICE_ID_PRO;
const STRIPE_PRICE_ID_ULTRA = process.env.STRIPE_PRICE_ID_ULTRA;

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// Logs clairs au boot
function envOk(k) {
  if (!process.env[k]) {
    console.log("❌ ENV manquant:", k);
    return false;
  }
  console.log("✅", k);
  return true;
}

envOk("MONGO_URI");
envOk("JWT_SECRET");
envOk("STRIPE_SECRET_KEY");
envOk("STRIPE_WEBHOOK_SECRET_RENDER");
envOk("STRIPE_PRICE_ID_STANDARD");
envOk("STRIPE_PRICE_ID_PRO");
envOk("STRIPE_PRICE_ID_ULTRA");

// ================== HELPERS ==================
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

function normalizeCompanyName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
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
  if (plan === "standard") return STRIPE_PRICE_ID_STANDARD;
  if (plan === "pro") return STRIPE_PRICE_ID_PRO;
  if (plan === "ultra") return STRIPE_PRICE_ID_ULTRA;
  return null;
}

// ================== DB ==================
if (!MONGO_URI) console.error("❌ MONGO_URI manquant (Render Env)");
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

  monthlyLimit: { type: Number, default: 0 },
  monthlyUsed: { type: Number, default: 0 },
  resetAt: { type: Date, default: Date.now },

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

// ================== AUTH ==================
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

async function requireActiveAccess(req, res, next) {
  const user = await User.findById(req.auth.userId);
  if (!user) return res.status(401).json({ error: "Utilisateur introuvable" });
  if (user.accessBlocked)
    return res.status(403).json({ error: "Accès bloqué (paiement échoué / abonnement inactif)" });
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
app.get("/health", (_, res) => res.json({ ok: true }));

// Racine => index.html
app.get("/", (_, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Lead + anti-abus + token
app.post("/api/auth/lead", async (req, res) => {
  const { firstName, email, companyName, plan } = req.body || {};
  if (!email || !companyName || !plan) return res.status(400).json({ error: "Champs manquants" });
  if (!["standard", "pro", "ultra"].includes(plan)) return res.status(400).json({ error: "Plan invalide" });

  const emailNormalized = normalizeEmail(email);
  const domain = (emailNormalized.split("@")[1] || "").toLowerCase();
  const companyNameNormalized = normalizeCompanyName(companyName);

  try {
    const existingByEmail = await TrialRegistry.findOne({ emailNormalized });
    if (existingByEmail) {
      return res.status(403).json({ error: "Essai déjà utilisé (anti-abus)." });
    }

    // 1 essai / domaine (si pro email)
    if (!PUBLIC_EMAIL_DOMAINS.has(domain)) {
      const existingByDomain = await TrialRegistry.findOne({ companyDomain: domain });
      if (existingByDomain) {
        return res.status(403).json({ error: "Essai déjà utilisé pour cette entreprise (domaine)." });
      }
    }

    // 1 essai / nom d’entreprise
    const existingByCompany = await TrialRegistry.findOne({ companyNameNormalized });
    if (existingByCompany) {
      return res.status(403).json({ error: "Essai déjà utilisé pour cette entreprise." });
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
      resetAt: now,
    });

    await TrialRegistry.create({
      emailNormalized,
      companyDomain: domain,
      companyNameNormalized,
    });

    const token = jwt.sign({ userId: user._id.toString(), emailNormalized }, JWT_SECRET, {
      expiresIn: "7d",
    });

    return res.json({ ok: true, token });
  } catch (err) {
    if (String(err?.message || "").includes("duplicate key")) {
      return res.status(403).json({ error: "Essai déjà utilisé (anti-abus)." });
    }
    console.error(err);
    return res.status(500).json({ error: "Erreur serveur" });
  }
});

// Stripe checkout (route principale)
// IMPORTANT: ton front appelle /api/stripe/checkout => on garde ce nom
app.post("/api/stripe/checkout", requireAuth, async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: "Stripe non configuré (STRIPE_SECRET_KEY)" });

    const { plan } = req.body || {};
    if (!["standard", "pro", "ultra"].includes(plan)) return res.status(400).json({ error: "Plan invalide" });

    const priceId = priceForPlan(plan);
    if (!priceId) return res.status(500).json({ error: "Price ID manquant (STRIPE_PRICE_ID_...)" });

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
        metadata: { userId: user._id.toString(), selectedPlan: plan },
      },
      success_url: `${baseUrl}/success.html`,
      cancel_url: `${baseUrl}/cancel.html`,
      allow_promotion_codes: true,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Stripe checkout error:", err);
    return res.status(500).json({ error: "Erreur Stripe" });
  }
});

// alias compat si jamais
app.post("/api/stripe/create-checkout-session", requireAuth, (req, res) =>
  app._router.handle(
    { ...req, url: "/api/stripe/checkout", originalUrl: "/api/stripe/checkout" },
    res
  )
);

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
    lastPaymentStatus: u.lastPaymentStatus,
  });
});

// Exemples de features
app.get("/api/features/basic", requireAuth, requireActiveAccess, async (req, res) => {
  const ok = await useQuota(req.user, 1);
  if (!ok) return res.status(429).json({ error: "Quota mensuel dépassé" });
  return res.json({ ok: true, feature: "basic", message: "Accès Trial/Standard+" });
});

app.get("/api/features/advanced", requireAuth, requireActiveAccess, requirePlan("pro"), async (req, res) => {
  const ok = await useQuota(req.user, 2);
  if (!ok) return res.status(429).json({ error: "Quota mensuel dépassé" });
  return res.json({ ok: true, feature: "advanced", message: "Accès Pro+" });
});

app.get("/api/features/ultra", requireAuth, requireActiveAccess, requirePlan("ultra"), async (req, res) => {
  const ok = await useQuota(req.user, 5);
  if (!ok) return res.status(429).json({ error: "Quota mensuel dépassé" });
  return res.json({ ok: true, feature: "ultra", message: "Accès Ultra" });
});

// Start
app.listen(PORT, () => console.log(`✅ FlowPoint SaaS lancé sur le port ${PORT}`));
