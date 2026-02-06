// =======================
// FlowPoint AI – SaaS Backend (Render)
// Plans: standard / pro / ultra
// Trial 14 jours (carte obligatoire via Stripe Checkout)
// Blocage auto si paiement échoue (webhooks)
// Webhook secret attendu: STRIPE_WEBHOOK_SECRET_RENDER
// =======================

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");
const Stripe = require("stripe");

// ---------- APP ----------
const app = express();
app.use(cors());

// JSON partout SAUF webhook Stripe
app.use((req, res, next) => {
  if (req.originalUrl === "/api/stripe/webhook") return next();
  express.json({ limit: "1mb" })(req, res, next);
});

// ---------- ENV ----------
const PORT = process.env.PORT || 10000;

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || "change-me-now";

// Stripe
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY; // tu as mis LIVE -> OK
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// IMPORTANT : on lit en priorité _RENDER comme tu veux
const STRIPE_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET_RENDER ||
  process.env.STRIPE_WEBHOOK_SECRET || // fallback si un jour tu changes
  "";

// Prices (noms simples)
const PRICE_STANDARD =
  process.env.STRIPE_PRICE_ID_STANDARD ||
  process.env.STRIPE_PRICE_STANDARD ||
  process.env.STRIPE_PRICE_ID_STANDARE || // tolérance typo éventuelle
  "";

const PRICE_PRO =
  process.env.STRIPE_PRICE_ID_PRO ||
  process.env.STRIPE_PRICE_PRO ||
  "";

const PRICE_ULTRA =
  process.env.STRIPE_PRICE_ID_ULTRA ||
  process.env.STRIPE_PRICE_ULTRA ||
  "";

// ---------- HELPERS ----------
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

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com",
  "icloud.com", "live.com", "msn.com"
]);

function normalizeEmail(emailRaw) {
  const email = String(emailRaw || "").trim().toLowerCase();
  const parts = email.split("@");
  if (parts.length !== 2) return email;
  let [local, domain] = parts;

  if (domain === "googlemail.com") domain = "gmail.com";

  // Gmail: supprime +alias et points
  if (domain === "gmail.com") {
    const plusIndex = local.indexOf("+");
    if (plusIndex >= 0) local = local.slice(0, plusIndex);
    local = local.replace(/\./g, "");
  }

  return `${local}@${domain}`;
}

function normalizeCompanyName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function requireAuth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Non autorisé" });

  try {
    req.auth = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token invalide" });
  }
}

function requirePlan(minPlan) {
  return (req, res, next) => {
    if (planRank(req.user.plan) < planRank(minPlan)) {
      return res.status(403).json({ error: `Plan requis: ${minPlan}` });
    }
    next();
  };
}

async function requireActiveAccess(req, res, next) {
  const user = await User.findById(req.auth.userId);
  if (!user) return res.status(401).json({ error: "Utilisateur introuvable" });
  if (user.accessBlocked) return res.status(403).json({ error: "Accès bloqué (paiement échoué / abonnement inactif)" });
  req.user = user;
  next();
}

async function resetMonthlyIfNeeded(user) {
  const now = new Date();
  const ra = user.resetAt ? new Date(user.resetAt) : now;
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

// ---------- DB ----------
if (!MONGO_URI) console.log("❌ MONGO_URI manquant");
mongoose
  .connect(MONGO_URI || "mongodb://invalid")
  .then(() => console.log("✅ MongoDB connecté"))
  .catch((e) => console.log("❌ MongoDB erreur:", e.message));

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

const trialRegistrySchema = new mongoose.Schema({
  emailNormalized: { type: String, unique: true, index: true },
  companyDomain: { type: String, index: true },
  companyNameNormalized: { type: String, index: true },
  firstTrialAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);
const TrialRegistry = mongoose.model("TrialRegistry", trialRegistrySchema);

// ---------- FRONT (HTML intégré) ----------
function renderIndexHtml() {
  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <title>FlowPoint AI</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <style>
    body { font-family: system-ui, Arial; background:#f7f7f7; }
    .wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }
    .card { width: 100%; max-width: 560px; background:#fff; border:1px solid #e7e7e7; border-radius:16px; padding:22px; box-shadow: 0 12px 30px rgba(0,0,0,0.06); }
    h1 { margin:0 0 6px 0; font-size:32px; }
    .muted { color:#666; margin:0 0 14px 0; }
    input, select, button { width: 100%; padding: 12px; margin: 8px 0; border-radius: 10px; border: 1px solid #dcdcdc; font-size:16px; box-sizing:border-box; }
    button { background: #2d5bff; border:none; color:white; font-weight:700; cursor:pointer; }
    button:disabled { opacity: 0.6; cursor:not-allowed; }
    .err { color:#c00; margin-top:10px; }
    .ok { color:#0a7; margin-top:10px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>FlowPoint AI</h1>
      <p class="muted">Essai gratuit 14 jours — carte requise. Accès bloqué si le paiement échoue après l’essai.</p>

      <form id="signup-form">
        <input id="firstName" type="text" placeholder="Prénom" required />
        <input id="email" type="email" placeholder="Email professionnel" required />
        <input id="companyName" type="text" placeholder="Nom de l’entreprise" required />

        <select id="plan" required>
          <option value="standard">Standard</option>
          <option value="pro" selected>Pro</option>
          <option value="ultra">Ultra</option>
        </select>

        <button id="btn" type="submit">Commencer l’essai</button>
      </form>

      <div id="msg"></div>
    </div>
  </div>

<script>
  const msg = document.getElementById("msg");
  const btn = document.getElementById("btn");
  function setMsg(text, kind) {
    msg.className = kind ? kind : "";
    msg.textContent = text || "";
  }

  document.getElementById("signup-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    setMsg("");
    btn.disabled = true;
    btn.textContent = "Redirection...";

    const firstName = document.getElementById("firstName").value.trim();
    const email = document.getElementById("email").value.trim();
    const companyName = document.getElementById("companyName").value.trim();
    const plan = document.getElementById("plan").value;

    try {
      const leadRes = await fetch("/api/auth/lead", {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ firstName, email, companyName, plan })
      });
      const leadData = await leadRes.json();
      if (!leadRes.ok) throw new Error(leadData.error || "Erreur lead");

      const stripeRes = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type":"application/json",
          "Authorization": "Bearer " + leadData.token
        },
        body: JSON.stringify({ plan })
      });
      const stripeData = await stripeRes.json();
      if (!stripeRes.ok) throw new Error(stripeData.error || "Erreur Stripe");

      window.location.href = stripeData.url;
    } catch (err) {
      setMsg("❌ " + (err.message || "Erreur"), "err");
      btn.disabled = false;
      btn.textContent = "Commencer l’essai";
    }
  });
</script>
</body>
</html>`;
}

// Routes front
app.get("/", (req, res) => res.type("html").send(renderIndexHtml()));
app.get("/success", (req, res) => res.type("html").send(`<h1>✅ Paiement enregistré</h1><p>Ton essai est actif. Tu peux fermer cette page.</p>`));
app.get("/cancel", (req, res) => res.type("html").send(`<h1>❌ Paiement annulé</h1><p>Tu peux revenir en arrière et réessayer.</p>`));

// ---------- API ----------
app.get("/test", (_, res) => res.send("Backend OK"));

// Lead + anti-abus + token
app.post("/api/auth/lead", async (req, res) => {
  const { firstName, email, companyName, plan } = req.body || {};

  if (!email || !companyName || !plan) return res.status(400).json({ error: "Champs manquants" });
  if (!["standard","pro","ultra"].includes(plan)) return res.status(400).json({ error: "Plan invalide" });

  const emailNormalized = normalizeEmail(email);
  const domain = (emailNormalized.split("@")[1] || "").toLowerCase();
  const companyNameNormalized = normalizeCompanyName(companyName);

  try {
    // anti-abus email
    const usedEmail = await TrialRegistry.findOne({ emailNormalized });
    if (usedEmail) return res.status(403).json({ error: "Essai déjà utilisé pour cet email." });

    // anti-abus domaine entreprise (sauf emails publics)
    if (!PUBLIC_EMAIL_DOMAINS.has(domain)) {
      const usedDomain = await TrialRegistry.findOne({ companyDomain: domain });
      if (usedDomain) return res.status(403).json({ error: "Essai déjà utilisé pour cette entreprise (domaine)." });
    }

    // anti-abus nom entreprise
    const usedCompany = await TrialRegistry.findOne({ companyNameNormalized });
    if (usedCompany) return res.status(403).json({ error: "Essai déjà utilisé pour cette entreprise (nom)." });

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

    await TrialRegistry.create({ emailNormalized, companyDomain: domain, companyNameNormalized });

    const token = jwt.sign(
      { userId: user._id.toString(), emailNormalized },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ ok: true, token });
  } catch (err) {
    if (String(err?.message || "").includes("duplicate key")) {
      return res.status(403).json({ error: "Essai déjà utilisé (anti-abus)." });
    }
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// Stripe checkout
app.post("/api/stripe/create-checkout-session", requireAuth, async (req, res) => {
  if (!stripe) return res.status(500).json({ error: "Stripe non configuré (STRIPE_SECRET_KEY)" });

  const { plan } = req.body || {};
  if (!["standard","pro","ultra"].includes(plan)) return res.status(400).json({ error: "Plan invalide" });

  const priceId = priceForPlan(plan);
  if (!priceId) return res.status(500).json({ error: "Price ID manquant pour ce plan (ENV Stripe)" });

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
      allow_promotion_codes: true,

      // TRIAL 14 jours + carte requise via Checkout
      subscription_data: {
        trial_period_days: 14,
        metadata: { userId: user._id.toString(), selectedPlan: plan }
      },

      success_url: `${baseUrl}/success`,
      cancel_url: `${baseUrl}/cancel`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Stripe error:", err);
    res.status(500).json({ error: "Erreur Stripe (voir logs Render)" });
  }
});

// Webhook Stripe (raw body)
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe) return res.status(500).send("Stripe non configuré");
  if (!STRIPE_WEBHOOK_SECRET) return res.status(500).send("Webhook secret manquant (STRIPE_WEBHOOK_SECRET_RENDER)");

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("Webhook signature error:", err.message);
    return res.status(400).send("Webhook Error");
  }

  try {
    async function findUserByStripe(obj) {
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
      const user = await findUserByStripe(session);
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
      const user = await findUserByStripe(sub);
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
          user.plan = ["standard","pro","ultra"].includes(selectedPlan) ? selectedPlan : "pro";
          user.accessBlocked = false;
          user.monthlyLimit = quotasForPlan(user.plan);
        } else if (status === "past_due" || status === "unpaid") {
          // blocage si paiement échoue
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
      const user = await findUserByStripe(sub);
      if (user) {
        user.accessBlocked = true;
        user.plan = "free";
        user.lastPaymentStatus = "subscription_deleted";
        user.monthlyLimit = 0;
        await user.save();
      }
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    res.status(500).send("Webhook handler error");
  }
});

// /me (debug)
app.get("/api/me", requireAuth, requireActiveAccess, async (req, res) => {
  const u = req.user;
  res.json({
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

// Features (exemples)
app.get("/api/features/basic", requireAuth, requireActiveAccess, async (req, res) => {
  const ok = await useQuota(req.user, 1);
  if (!ok) return res.status(429).json({ error: "Quota mensuel dépassé" });
  res.json({ ok: true, feature: "basic", message: "Accès Trial/Standard+" });
});

app.get("/api/features/advanced", requireAuth, requireActiveAccess, requirePlan("pro"), async (req, res) => {
  const ok = await useQuota(req.user, 2);
  if (!ok) return res.status(429).json({ error: "Quota mensuel dépassé" });
  res.json({ ok: true, feature: "advanced", message: "Accès Pro+" });
});

app.get("/api/features/ultra", requireAuth, requireActiveAccess, requirePlan("ultra"), async (req, res) => {
  const ok = await useQuota(req.user, 5);
  if (!ok) return res.status(429).json({ error: "Quota mensuel dépassé" });
  res.json({ ok: true, feature: "ultra", message: "Accès Ultra" });
});

// ---------- START ----------
function envWarn(key, ok) {
  console.log((ok ? "✅" : "❌") + " " + key + (ok ? "" : " manquant"));
}

envWarn("MONGO_URI", !!MONGO_URI);
envWarn("JWT_SECRET", !!process.env.JWT_SECRET);
envWarn("STRIPE_SECRET_KEY", !!STRIPE_SECRET_KEY);
envWarn("STRIPE_WEBHOOK_SECRET_RENDER", !!process.env.STRIPE_WEBHOOK_SECRET_RENDER);
envWarn("STRIPE_PRICE_ID_STANDARD", !!PRICE_STANDARD);
envWarn("STRIPE_PRICE_ID_PRO", !!PRICE_PRO);
envWarn("STRIPE_PRICE_ID_ULTRA", !!PRICE_ULTRA);

app.listen(PORT, () => {
  console.log("✅ FlowPoint SaaS lancé sur le port " + PORT);
});


