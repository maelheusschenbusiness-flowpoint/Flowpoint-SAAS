// =======================
// FlowPoint AI – SaaS Backend + Front
// Plans: Standard / Pro / Ultra
// Essai 14 jours, carte requise, blocage auto si paiement échoue
// =======================

import express from "express";
import cors from "cors";
import Stripe from "stripe";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

// ---------- App ----------
const app = express();
app.use(cors());

// JSON partout sauf webhook Stripe (raw)
app.use((req, res, next) => {
  if (req.originalUrl === "/api/stripe/webhook") return next();
  express.json({ limit: "1mb" })(req, res, next);
});

// ---------- ENV ----------
const PORT = process.env.PORT || 10000;

const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// ✅ On accepte plusieurs noms d’ENV (pour éviter les galères)
const PRICE_STANDARD =
  process.env.STRIPE_PRICE_STANDARD ||
  process.env.STRIPE_PRICE_ID_STANDARD ||
  process.env.STRIPE_PRICE_ID_STANDA RD || // (tolérance si typo) - peut être ignoré
  process.env.STRIPE_PRICE_ID_STANDARD;

const PRICE_PRO =
  process.env.STRIPE_PRICE_PRO ||
  process.env.STRIPE_PRICE_ID_PRO;

const PRICE_ULTRA =
  process.env.STRIPE_PRICE_ULTRA ||
  process.env.STRIPE_PRICE_ID_ULTRA;

// ---------- Logs ENV ----------
function envWarn(key) {
  console.error(`❌ ENV manquant: ${key}`);
}
if (!JWT_SECRET) envWarn("JWT_SECRET");
if (!STRIPE_SECRET_KEY) envWarn("STRIPE_SECRET_KEY");
if (!STRIPE_WEBHOOK_SECRET) console.warn("⚠️ STRIPE_WEBHOOK_SECRET manquant (webhook non validable)");
if (!PRICE_STANDARD) envWarn("STRIPE_PRICE_STANDARD (ou STRIPE_PRICE_ID_STANDARD)");
if (!PRICE_PRO) envWarn("STRIPE_PRICE_PRO (ou STRIPE_PRICE_ID_PRO)");
if (!PRICE_ULTRA) envWarn("STRIPE_PRICE_ULTRA (ou STRIPE_PRICE_ID_ULTRA)");

// ---------- Stripe ----------
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// ---------- Mongo ----------
if (MONGO_URI) {
  mongoose
    .connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB connecté"))
    .catch((err) => console.error("❌ Mongo error:", err.message));
} else {
  console.warn("⚠️ MONGO_URI manquant (Mongo désactivé)");
}

// ---------- Helpers ----------
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "live.com", "msn.com",
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

function companyDomainFromEmail(emailNormalized) {
  return (emailNormalized.split("@")[1] || "").toLowerCase();
}

function normalizeCompanyName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function quotasForPlan(plan) {
  // Exemples (à adapter)
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

// ---------- Models ----------
const userSchema = new mongoose.Schema({
  firstName: String,

  emailRaw: String,
  emailNormalized: { type: String, unique: true, index: true },

  companyName: String,
  companyNameNormalized: { type: String, index: true },
  companyDomain: { type: String, index: true },

  // trial | standard | pro | ultra | free
  plan: { type: String, default: "trial" },
  trialStartedAt: Date,
  trialEndsAt: Date,

  // Stripe
  stripeCustomerId: String,
  stripeSubscriptionId: String,
  stripePriceId: String,

  // Access
  accessBlocked: { type: Boolean, default: false },
  lastPaymentStatus: String,

  // Quota
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
});

const User = mongoose.models.User || mongoose.model("User", userSchema);
const TrialRegistry = mongoose.models.TrialRegistry || mongoose.model("TrialRegistry", trialRegistrySchema);

// ---------- Auth ----------
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

async function requireActiveAccess(req, res, next) {
  const user = await User.findById(req.auth.userId);
  if (!user) return res.status(401).json({ error: "Utilisateur introuvable" });
  if (user.accessBlocked) return res.status(403).json({ error: "Accès bloqué (paiement échoué / abonnement inactif)" });
  req.user = user;
  next();
}

function planRank(plan) {
  const map = { free: 0, trial: 1, standard: 2, pro: 3, ultra: 4 };
  return map[plan] ?? 0;
}
function requirePlan(minPlan) {
  return (req, res, next) => {
    if (planRank(req.user.plan) < planRank(minPlan)) {
      return res.status(403).json({ error: `Plan requis: ${minPlan}` });
    }
    next();
  };
}

// quota (simple)
async function resetMonthlyIfNeeded(user) {
  const now = new Date();
  const ra = new Date(user.resetAt || now);
  if (ra.getUTCFullYear() !== now.getUTCFullYear() || ra.getUTCMonth() !== now.getUTCMonth()) {
    user.monthlyUsed = 0;
    user.resetAt = now;
    user.monthlyLimit = quotasForPlan(user.plan);
    await user.save();
  }
}
async function useQuota(user, amount = 1) {
  await resetMonthlyIfNeeded(user);
  if (!user.monthlyLimit || user.monthlyLimit <= 0) return false;
  if (user.monthlyUsed + amount > user.monthlyLimit) return false;
  user.monthlyUsed += amount;
  await user.save();
  return true;
}

// ---------- Frontend (simple page) ----------
app.get("/", (_, res) => {
  res.type("html").send(`
<!doctype html>
<html lang="fr">
<head>
<meta charset="UTF-8" />
<title>FlowPoint AI</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  *{box-sizing:border-box}
  body{font-family:system-ui;background:#f7f7f7;margin:0}
  .box{max-width:520px;margin:70px auto;background:#fff;padding:24px;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.08)}
  h2{margin:0 0 6px}
  p{margin:0 0 16px;color:#666}
  input,select,button{width:100%;padding:12px;margin-top:10px;border-radius:10px;border:1px solid #ddd;font-size:16px}
  button{background:#2563eb;color:white;border:none;font-weight:700;cursor:pointer}
  button:hover{opacity:.92}
  #msg{margin-top:12px;color:#d00;min-height:18px}
</style>
</head>
<body>
<div class="box">
  <h2>FlowPoint AI</h2>
  <p>Essai gratuit 14 jours – carte requise</p>

  <form id="f">
    <input id="firstName" placeholder="Prénom" required />
    <input id="email" type="email" placeholder="Email pro" required />
    <input id="companyName" placeholder="Entreprise" required />

    <select id="plan">
      <option value="standard">Standard</option>
      <option value="pro" selected>Pro</option>
      <option value="ultra">Ultra</option>
    </select>

    <button id="btn" type="submit">Commencer l’essai</button>
  </form>

  <div id="msg"></div>
</div>

<script>
const f = document.getElementById("f");
const msg = document.getElementById("msg");
const btn = document.getElementById("btn");

function setMsg(t){ msg.textContent = t || ""; }

f.addEventListener("submit", async (e) => {
  e.preventDefault();
  setMsg("");
  btn.disabled = true;
  btn.textContent = "Redirection...";

  const payload = {
    firstName: document.getElementById("firstName").value.trim(),
    email: document.getElementById("email").value.trim(),
    companyName: document.getElementById("companyName").value.trim(),
    plan: document.getElementById("plan").value
  };

  try {
    const leadRes = await fetch("/api/auth/lead", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify(payload)
    });
    const lead = await leadRes.json().catch(() => ({}));
    if (!leadRes.ok) throw new Error(lead.error || "Erreur lead");

    const stripeRes = await fetch("/api/stripe/checkout", {
      method: "POST",
      headers: {
        "Content-Type":"application/json",
        "Authorization": "Bearer " + lead.token
      },
      body: JSON.stringify({ plan: payload.plan })
    });

    const out = await stripeRes.json().catch(() => ({}));
    if (!stripeRes.ok) throw new Error(out.error || "Erreur Stripe");

    window.location.href = out.url;
  } catch (err) {
    setMsg("❌ " + (err.message || "Erreur"));
    btn.disabled = false;
    btn.textContent = "Commencer l’essai";
  }
});
</script>
</body>
</html>
`);
});

// ---------- Health ----------
app.get("/test", (_, res) => res.send("Backend OK"));

// ---------- Lead (anti-abus) + user + token ----------
app.post("/api/auth/lead", async (req, res) => {
  const { firstName, email, companyName, plan } = req.body || {};
  if (!email || !companyName || !plan) return res.status(400).json({ error: "Champs manquants" });
  if (!["standard", "pro", "ultra"].includes(plan)) return res.status(400).json({ error: "Plan invalide" });

  const emailNormalized = normalizeEmail(email);
  const domain = companyDomainFromEmail(emailNormalized);
  const companyNameNormalized = normalizeCompanyName(companyName);

  try {
    // anti-abus: 1 essai par email + (si domaine pro) 1 essai par domaine + 1 essai par nom d’entreprise
    const existingEmail = await TrialRegistry.findOne({ emailNormalized });
    if (existingEmail) return res.status(403).json({ error: "Essai déjà utilisé pour cet email." });

    if (!PUBLIC_EMAIL_DOMAINS.has(domain)) {
      const existingDomain = await TrialRegistry.findOne({ companyDomain: domain });
      if (existingDomain) return res.status(403).json({ error: "Essai déjà utilisé pour cette entreprise (domaine)." });
    }

    const existingCompany = await TrialRegistry.findOne({ companyNameNormalized });
    if (existingCompany) return res.status(403).json({ error: "Essai déjà utilisé pour cette entreprise." });

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

    return res.json({ token });
  } catch (err) {
    if (String(err?.message || "").includes("duplicate key")) {
      return res.status(403).json({ error: "Essai déjà utilisé." });
    }
    console.error(err);
    return res.status(500).json({ error: "Erreur serveur" });
  }
});

// ---------- Stripe Checkout (subscription + trial + card required) ----------
app.post("/api/stripe/checkout", requireAuth, async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: "Stripe non configuré" });

    const { plan } = req.body || {};
    if (!["standard", "pro", "ultra"].includes(plan)) return res.status(400).json({ error: "Plan invalide" });

    const priceId = priceForPlan(plan);
    if (!priceId) return res.status(500).json({ error: "Price ID manquant côté serveur" });

    const user = await User.findById(req.auth.userId);
    if (!user) return res.status(401).json({ error: "Utilisateur introuvable" });

    // create/reuse customer
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
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
        metadata: { userId: user._id.toString(), selectedPlan: plan }
      },
      success_url: `${baseUrl}/success`,
      cancel_url: `${baseUrl}/cancel`,
      allow_promotion_codes: true
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Stripe checkout error:", err);
    return res.status(500).json({ error: err?.raw?.message || err?.message || "Erreur Stripe" });
  }
});

// ---------- Stripe Webhook (bloque automatiquement si paiement échoue) ----------
app.post("/api/stripe/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  if (!stripe) return res.status(500).send("Stripe non configuré");
  if (!STRIPE_WEBHOOK_SECRET) return res.status(500).send("Webhook secret manquant");

  const sig = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("❌ Webhook signature error:", err.message);
    return res.status(400).send("Webhook Error");
  }

  try {
    async function getUserFromObject(obj) {
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

    // ✅ On garde une logique simple:
    // - trialing => plan trial + accès OK
    // - active => plan choisi + accès OK
    // - past_due/unpaid/canceled => accès bloqué + plan free

    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
      const sub = event.data.object;
      const user = await getUserFromObject(sub);

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
          user.plan = ["standard", "pro", "ultra"].includes(selectedPlan) ? selectedPlan : "pro";
          user.accessBlocked = false;
          user.monthlyLimit = quotasForPlan(user.plan);
        } else if (status === "past_due" || status === "unpaid" || status === "canceled") {
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
      const user = await getUserFromObject(sub);
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
    console.error("❌ Webhook handler error:", err);
    return res.status(500).send("Webhook handler error");
  }
});

// ---------- Protected examples ----------
app.get("/api/me", requireAuth, requireActiveAccess, async (req, res) => {
  const u = req.user;
  res.json({
    email: u.emailRaw,
    company: u.companyName,
    plan: u.plan,
    accessBlocked: u.accessBlocked,
    trialEndsAt: u.trialEndsAt,
    monthlyUsed: u.monthlyUsed,
    monthlyLimit: u.monthlyLimit,
    lastPaymentStatus: u.lastPaymentStatus
  });
});

app.get("/api/features/standard", requireAuth, requireActiveAccess, async (req, res) => {
  const ok = await useQuota(req.user, 1);
  if (!ok) return res.status(429).json({ error: "Quota dépassé" });
  res.json({ ok: true, feature: "standard", message: "Accès Trial/Standard+" });
});

app.get("/api/features/pro", requireAuth, requireActiveAccess, requirePlan("pro"), async (req, res) => {
  const ok = await useQuota(req.user, 2);
  if (!ok) return res.status(429).json({ error: "Quota dépassé" });
  res.json({ ok: true, feature: "pro", message: "Accès Pro+" });
});

app.get("/api/features/ultra", requireAuth, requireActiveAccess, requirePlan("ultra"), async (req, res) => {
  const ok = await useQuota(req.user, 5);
  if (!ok) return res.status(429).json({ error: "Quota dépassé" });
  res.json({ ok: true, feature: "ultra", message: "Accès Ultra" });
});

// ---------- Pages ----------
app.get("/success", (_, res) => res.type("html").send("<h1>✅ Paiement enregistré</h1><p>Votre essai est actif. Vous pouvez fermer cette page.</p>"));
app.get("/cancel", (_, res) => res.type("html").send("<h1>❌ Paiement annulé</h1><p>Vous pouvez revenir en arrière et réessayer.</p>"));

// ---------- Start ----------
app.listen(PORT, () => console.log("✅ FlowPoint SaaS lancé sur le port", PORT));


