// =======================
// FlowPoint AI – SaaS Backend
// Standard / Pro / Ultra
// =======================

require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const Stripe = require("stripe");
const bodyParser = require("body-parser");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 10000;

// =======================
// Vérification ENV
// =======================

const REQUIRED_ENVS = [
  "MONGO_URI",
  "JWT_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET_RENDER",
  "STRIPE_PRICE_ID_STANDARD",
  "STRIPE_PRICE_ID_PRO",
  "STRIPE_PRICE_ID_ULTRA",
];

REQUIRED_ENVS.forEach((key) => {
  if (!process.env[key]) {
    console.error("❌ ENV manquante :", key);
  } else {
    console.log("✅", key);
  }
});

// =======================
// Stripe
// =======================

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// =======================
// Middleware
// =======================

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Webhook → raw body obligatoire
app.use(
  "/api/stripe/webhook",
  bodyParser.raw({ type: "application/json" })
);

// =======================
// MongoDB
// =======================

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connecté"))
  .catch((err) => {
    console.error("❌ MongoDB erreur", err);
    process.exit(1);
  });

// =======================
// Schema User
// =======================

const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  company: String,
  plan: String,
  stripeCustomerId: String,
  trialUsed: { type: Boolean, default: false },
});

const User = mongoose.model("User", UserSchema);

// =======================
// Static pages
// =======================

app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/success", (req, res) => {
  res.sendFile(path.join(__dirname, "success.html"));
});

app.get("/cancel", (req, res) => {
  res.sendFile(path.join(__dirname, "cancel.html"));
});

// =======================
// Create Stripe Checkout
// =======================

app.post("/api/stripe/checkout", async (req, res) => {
  try {
    const { name, email, company, plan } = req.body;

    if (!name || !email || !company || !plan) {
      return res.status(400).json({ error: "Champs manquants" });
    }

    const PLAN_PRICE_MAP = {
      standard: process.env.STRIPE_PRICE_ID_STANDARD,
      pro: process.env.STRIPE_PRICE_ID_PRO,
      ultra: process.env.STRIPE_PRICE_ID_ULTRA,
    };

    const priceId = PLAN_PRICE_MAP[plan];

    if (!priceId) {
      return res.status(400).json({ error: "Plan invalide" });
    }

    let user = await User.findOne({ email });

    if (user && user.trialUsed) {
      return res
        .status(403)
        .json({ error: "Essai déjà utilisé (anti-abus)" });
    }

    if (!user) {
      user = await User.create({
        name,
        email,
        company,
        plan,
        trialUsed: true,
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
      },
      success_url: `${req.headers.origin}/success`,
      cancel_url: `${req.headers.origin}/cancel`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Stripe checkout error:", err);
    res.status(500).json({ error: "Erreur Stripe" });
  }
});

// =======================
// Stripe Webhook (Render)
// =======================

app.post("/api/stripe/webhook", (req, res) => {
  const sig = req.headers["stripe-signature"];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET_RENDER
    );
  } catch (err) {
    console.error("❌ Webhook signature invalide");
    return res.status(400).send(`Webhook Error`);
  }

  switch (event.type) {
    case "checkout.session.completed":
      console.log("✅ Paiement confirmé");
      break;

    case "invoice.payment_failed":
      console.log("❌ Paiement échoué");
      break;

    case "customer.subscription.deleted":
      console.log("🛑 Abonnement résilié");
      break;

    default:
      console.log("ℹ️ Event Stripe:", event.type);
  }

  res.json({ received: true });
});

// =======================
// Start server
// =======================

app.listen(PORT, () => {
  console.log(`🚀 FlowPoint SaaS lancé sur le port ${PORT}`);
});
