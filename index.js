import express from "express";
import cors from "cors";
import Stripe from "stripe";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const app = express();
app.use(cors());
app.use(express.json());

// ================= CONFIG =================
const PORT = process.env.PORT || 10000;

const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_PRICE_STANDARD = process.env.STRIPE_PRICE_STANDARD;
const STRIPE_PRICE_PRO = process.env.STRIPE_PRICE_PRO;
const STRIPE_PRICE_ULTRA = process.env.STRIPE_PRICE_ULTRA;

function missing(name) {
  console.error(`❌ ENV manquant: ${name}`);
}

if (!JWT_SECRET) missing("JWT_SECRET");
if (!STRIPE_SECRET_KEY) missing("STRIPE_SECRET_KEY");
if (!STRIPE_PRICE_STANDARD) missing("STRIPE_PRICE_STANDARD");
if (!STRIPE_PRICE_PRO) missing("STRIPE_PRICE_PRO");
if (!STRIPE_PRICE_ULTRA) missing("STRIPE_PRICE_ULTRA");

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

// ================= DB =================
if (MONGO_URI) {
  mongoose
    .connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB connecté"))
    .catch((err) => console.error("❌ Mongo error:", err.message));
} else {
  console.warn("⚠️ MONGO_URI manquant (Mongo désactivé)");
}

// ================= FRONTEND =================
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
      body: JSON.stringify({ plan: payload.plan })   // ✅ on envoie le plan
    });

    const out = await stripeRes.json().catch(() => ({}));
    if (!stripeRes.ok) throw new Error(out.error || "Erreur Stripe");

    if (!out.url) throw new Error("URL Stripe manquante");
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

// ================= HEALTH =================
app.get("/test", (_, res) => res.send("Backend OK"));

// ================= API =================
app.post("/api/auth/lead", (req, res) => {
  if (!JWT_SECRET) return res.status(500).json({ error: "JWT_SECRET manquant" });

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: "Email requis" });

  const token = jwt.sign({ email }, JWT_SECRET, { expiresIn: "30m" });
  res.json({ token });
});

app.post("/api/stripe/checkout", async (req, res) => {
  try {
    if (!stripe) return res.status(500).json({ error: "Stripe non configuré" });

    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Non autorisé" });

    try {
      jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: "Token invalide" });
    }

    const plan = String(req.body?.plan || "").toLowerCase();
    const price =
      plan === "standard" ? STRIPE_PRICE_STANDARD :
      plan === "pro" ? STRIPE_PRICE_PRO :
      plan === "ultra" ? STRIPE_PRICE_ULTRA :
      null;

    if (!price) return res.status(400).json({ error: "Plan invalide" });

    const baseUrl = `${req.protocol}://${req.get("host")}`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price, quantity: 1 }],
      subscription_data: { trial_period_days: 14 },
      success_url: `${baseUrl}/success`,
      cancel_url: `${baseUrl}/cancel`
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error("❌ Stripe checkout error:", err?.message || err);
    return res.status(500).json({ error: "Erreur Stripe (voir logs Render)" });
  }
});

app.get("/success", (_, res) => res.type("html").send("<h1>✅ Paiement enregistré</h1><p>Vous pouvez fermer cette page.</p>"));
app.get("/cancel", (_, res) => res.type("html").send("<h1>❌ Paiement annulé</h1><p>Vous pouvez réessayer.</p>"));

// ================= START =================
app.listen(PORT, () => console.log("✅ FlowPoint SaaS lancé sur le port", PORT));

