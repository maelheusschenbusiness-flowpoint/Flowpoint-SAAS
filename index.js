// =======================
// FlowPoint AI – SaaS Backend
// Standard / Pro / Ultra
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

// ---------- ENV CHECK ----------
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

// ---------- STRIPE ----------
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ---------- SECURITY ----------
app.set("trust proxy", true);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));

app.use("/api", rateLimit({ windowMs: 60 * 1000, max: 160 }));

// ---------- WEBHOOK MUST BE RAW (BEFORE JSON) ----------
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const sig = req.headers["stripe-signature"];
    const secret = process.env.STRIPE_WEBHOOK_SECRET_RENDER;

    if (!secret) return res.status(200).send("no webhook secret");

    const event = stripe.webhooks.constructEvent(req.body, sig, secret);

    if (event.type === "invoice.payment_failed") {
      const inv = event.data.object;
      await User.updateOne(
        { stripeCustomerId: inv.customer },
        { $set: { accessBlocked: true } }
      );
    }

    if (event.type === "invoice.payment_succeeded") {
      const inv = event.data.object;
      await User.updateOne(
        { stripeCustomerId: inv.customer },
        { $set: { accessBlocked: false } }
      );
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      await User.updateOne(
        { stripeSubscriptionId: sub.id },
        { $set: { accessBlocked: true } }
      );
    }

    return res.json({ received: true });
  } catch (e) {
    console.log("webhook error:", e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }
});

// ---------- BODY PARSERS ----------
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ---------- STATIC FRONT ----------
app.use(express.static(path.join(__dirname)));

// ---------- DB ----------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connecté"))
  .catch((e) => console.log("❌ MongoDB erreur:", e.message));

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

    accessBlocked: { type: Boolean, default: false }
  },
  { timestamps: true }
);

const TrialRegistrySchema = new mongoose.Schema(
  {
    // anti-abus minimal : email + ip + user-agent
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
    return next();
  } catch {
    return res.status(401).json({ error: "Token invalide" });
  }
}

function priceForPlan(plan) {
  if (plan === "standard") return process.env.STRIPE_PRICE_ID_STANDARD;
  if (plan === "pro") return process.env.STRIPE_PRICE_ID_PRO;
  if (plan === "ultra") return process.env.STRIPE_PRICE_ID_ULTRA;
  return null;
}

// ---------- PAGES ----------
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/dashboard", (req, res) => res.sendFile(path.join(__dirname, "dashboard.html")));
app.get("/success", (req, res) => res.sendFile(path.join(__dirname, "success.html")));
app.get("/cancel", (req, res) => res.sendFile(path.join(__dirname, "cancel.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "login.html")));

// ---------- API HEALTH ----------
app.get("/api/health", (_, res) => res.json({ ok: true }));

// ---------- API: LEAD (création user + token) ----------
app.post("/api/auth/lead", async (req, res) => {
  try {
    const { firstName, email, companyName, plan } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email requis" });
    if (!companyName) return res.status(400).json({ error: "Entreprise requise" });

    const chosenPlan = (plan || "").toLowerCase();
    if (!["standard", "pro", "ultra"].includes(chosenPlan)) {
      return res.status(400).json({ error: "Plan invalide" });
    }

    const companyNameNormalized = normalizeCompanyName(companyName);

    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      user = await User.create({
        email: email.toLowerCase(),
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

// ---------- API: LOGIN (pour revenir au dashboard) ----------
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

// ---------- API: STRIPE CHECKOUT (anti-abus ici) ----------
app.post("/api/stripe/checkout", auth, async (req, res) => {
  try {
    const { plan } = req.body || {};
    const chosenPlan = (plan || "").toLowerCase();
    if (!["standard", "pro", "ultra"].includes(chosenPlan)) {
      return res.status(400).json({ error: "Plan invalide" });
    }

    const user = await User.findById(req.user.uid);
    if (!user) return res.status(404).json({ error: "User introuvable" });
    if (user.accessBlocked) return res.status(403).json({ error: "Accès bloqué (paiement échoué)" });

    // Anti-abus (consommé à la création checkout)
    const fp = makeFingerprint(req, user.email);
    const already = await TrialRegistry.findOne({ fingerprint: fp });
    if (already) return res.status(403).json({ error: "Essai déjà utilisé (anti-abus)." });

    const priceId = priceForPlan(chosenPlan);
    if (!priceId) return res.status(500).json({ error: "PriceId manquant" });

    // Customer
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

// ---------- API: VERIFY SUCCESS (token + infos user) ----------
app.get("/api/stripe/verify", async (req, res) => {
  try {
    const sessionId = req.query.session_id;
    if (!sessionId) return res.status(400).json({ error: "session_id manquant" });

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["subscription", "customer"]
    });

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

// ---------- API: ME (dashboard) ----------
app.get("/api/me", auth, async (req, res) => {
  const user = await User.findById(req.user.uid);
  if (!user) return res.status(404).json({ error: "User introuvable" });

  return res.json({
    email: user.email,
    name: user.name,
    companyName: user.companyName,
    plan: user.plan,
    hasTrial: user.hasTrial,
    trialEndsAt: user.trialEndsAt,
    accessBlocked: user.accessBlocked
  });
});

// ---------- API: CUSTOMER PORTAL (pour upgrade/downgrade/annulation) ----------
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

app.listen(PORT, () => console.log(`✅ FlowPoint SaaS lancé sur le port ${PORT}`));
