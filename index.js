// =======================
// FlowPoint AI – SaaS Backend (Standard / Pro / Ultra)
// - Stripe Checkout + Portal + Webhook
// - JWT Auth
// - Trial 14 days (card required via Stripe trial)
// - Access blocked if payment fails / subscription deleted
// - Monthly quotas per plan (audits, chat, monitors)
// - Dashboard endpoints
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
app.set("trust proxy", true);

const PORT = process.env.PORT || 5000;

// ---------- ENV ----------
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

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET_RENDER; // render webhook secret
if (!STRIPE_WEBHOOK_SECRET) console.log("⚠️ STRIPE_WEBHOOK_SECRET_RENDER manquante");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ---------- SECURITY ----------
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use("/api", rateLimit({ windowMs: 60 * 1000, max: 200 }));

// ---------- STRIPE WEBHOOK RAW (must be before json) ----------
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    if (!STRIPE_WEBHOOK_SECRET) return res.status(200).send("no webhook secret");
    const sig = req.headers["stripe-signature"];
    const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);

    // Helper: find user by customer/sub metadata
    async function getUserFromObject(obj) {
      const uid = obj?.metadata?.uid || obj?.metadata?.userId;
      if (uid) return await User.findById(uid);

      const customerId = obj?.customer;
      if (customerId) return await User.findOne({ stripeCustomerId: customerId });

      return null;
    }

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

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      const user = await getUserFromObject(sub);
      if (user) {
        user.accessBlocked = true;
        user.lastPaymentStatus = "subscription_deleted";
        await user.save();
      }
    }

    if (event.type === "customer.subscription.updated") {
      const sub = event.data.object;
      const user = await getUserFromObject(sub);
      if (user) {
        user.stripeSubscriptionId = sub.id;
        user.stripeCustomerId = sub.customer;

        // Stripe status -> block/unblock
        const status = sub.status;
        user.lastPaymentStatus = status;

        if (["active", "trialing"].includes(status)) {
          user.accessBlocked = false;
        }
        if (["past_due", "unpaid", "canceled"].includes(status)) {
          user.accessBlocked = true;
        }

        // Sync plan from priceId if possible
        const priceId = sub.items?.data?.[0]?.price?.id;
        if (priceId) {
          if (priceId === process.env.STRIPE_PRICE_ID_STANDARD) user.plan = "standard";
          if (priceId === process.env.STRIPE_PRICE_ID_PRO) user.plan = "pro";
          if (priceId === process.env.STRIPE_PRICE_ID_ULTRA) user.plan = "ultra";
        }

        await user.save();
      }
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

// ---------- QUOTAS ----------
function planRank(plan) {
  const map = { standard: 1, pro: 2, ultra: 3 };
  return map[String(plan || "").toLowerCase()] || 0;
}

function quotasForPlan(plan) {
  const p = String(plan || "").toLowerCase();
  // Ajuste si tu veux
  if (p === "standard") return { audits: 50, chat: 200, monitors: 0 };
  if (p === "pro") return { audits: 500, chat: 2000, monitors: 50 };
  if (p === "ultra") return { audits: 2000, chat: 10000, monitors: 300 };
  return { audits: 0, chat: 0, monitors: 0 };
}

function firstDayOfThisMonthUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0));
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

    // Monthly usage
    usageMonth: { type: Date, default: firstDayOfThisMonthUTC },
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

const User = mongoose.model("User", UserSchema);
const TrialRegistry = mongoose.model("TrialRegistry", TrialRegistrySchema);

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
  return jwt.sign(
    { uid: user._id.toString(), email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "30d" }
  );
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

async function resetUsageIfNewMonth(user) {
  const month = firstDayOfThisMonthUTC();
  if (!user.usageMonth || new Date(user.usageMonth).getTime() !== month.getTime()) {
    user.usageMonth = month;
    user.usedAudits = 0;
    user.usedChat = 0;
    user.usedMonitors = 0;
    await user.save();
  }
}

async function requireActive(req, res, next) {
  const user = await User.findById(req.user.uid);
  if (!user) return res.status(404).json({ error: "User introuvable" });

  // Trial expiration => block (safety)
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
    if (planRank(req.dbUser.plan) < planRank(minPlan)) {
      return res.status(403).json({ error: `Plan requis: ${minPlan}` });
    }
    next();
  };
}

async function consume(user, key, amount = 1) {
  const q = quotasForPlan(user.plan);
  const map = {
    audits: ["usedAudits", q.audits],
    chat: ["usedChat", q.chat],
    monitors: ["usedMonitors", q.monitors]
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

// ---------- PAGES ----------
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/dashboard", (req, res) => res.sendFile(path.join(__dirname, "dashboard.html")));
app.get("/pricing", (req, res) => res.sendFile(path.join(__dirname, "pricing.html")));
app.get("/success", (req, res) => res.sendFile(path.join(__dirname, "success.html")));
app.get("/cancel", (req, res) => res.sendFile(path.join(__dirname, "cancel.html")));

// ---------- API ----------
app.get("/api/health", (_, res) => res.json({ ok: true }));

// Lead (anti-abus + token)
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

    // reserve trial usage (anti-abus)
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
    const { plan } = req.body || {};
    const chosenPlan = String(plan || "").toLowerCase();
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
      subscription_data: {
        trial_period_days: 14,
        metadata: { uid: user._id.toString(), plan: chosenPlan }
      },
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

// Verify checkout success
app.get("/api/stripe/verify", async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).json({ error: "session_id manquant" });

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription", "customer"]
    });

    const uid = session.metadata?.uid || session.subscription?.metadata?.uid;
    if (!uid) return res.status(400).json({ error: "uid manquant" });

    const user = await User.findById(uid);
    if (!user) return res.status(404).json({ error: "User introuvable" });

    if (session.customer?.id) user.stripeCustomerId = session.customer.id;
    if (session.subscription?.id) user.stripeSubscriptionId = session.subscription.id;

    // trial
    if (!user.hasTrial) {
      user.hasTrial = true;
      user.trialStartedAt = new Date();
      user.trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    }

    // plan
    const plan = String(session.metadata?.plan || "").toLowerCase();
    if (["standard", "pro", "ultra"].includes(plan)) user.plan = plan;

    user.accessBlocked = false;
    user.lastPaymentStatus = "checkout_verified";
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

// Dashboard: me + quotas
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
      chat: { used: u.usedChat, limit: q.chat },
      monitors: { used: u.usedMonitors, limit: q.monitors }
    }
  });
});

// ----- DEMO FEATURES (gated + quota) -----
app.post("/api/features/audit", auth, requireActive, async (req, res) => {
  const ok = await consume(req.dbUser, "audits", 1);
  if (!ok) return res.status(429).json({ error: "Quota audits dépassé (ou plan insuffisant)" });
  return res.json({ ok: true, message: "Audit consommé (démo).", usedAudits: req.dbUser.usedAudits });
});

app.post("/api/features/chat", auth, requireActive, async (req, res) => {
  const ok = await consume(req.dbUser, "chat", 1);
  if (!ok) return res.status(429).json({ error: "Quota chat dépassé (ou plan insuffisant)" });
  return res.json({ ok: true, message: "Chat message consommé (démo).", usedChat: req.dbUser.usedChat });
});

app.post("/api/features/monitor", auth, requireActive, requirePlan("pro"), async (req, res) => {
  const ok = await consume(req.dbUser, "monitors", 1);
  if (!ok) return res.status(429).json({ error: "Quota monitoring dépassé" });
  return res.json({ ok: true, message: "Monitoring consommé (démo).", usedMonitors: req.dbUser.usedMonitors });
});

app.post("/api/features/ultra-only", auth, requireActive, requirePlan("ultra"), async (req, res) => {
  return res.json({ ok: true, message: "Feature Ultra OK (démo)." });
});

// ---------- START ----------
app.listen(PORT, () => console.log(`✅ FlowPoint SaaS lancé sur port ${PORT}`));
