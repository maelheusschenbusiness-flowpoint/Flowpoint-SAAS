import express from "express";
import cors from "cors";
import Stripe from "stripe";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const app = express();
app.use(cors());
app.use(express.json());

// ================= CONFIG =================
const PORT = process.env.PORT || 5000;
const {
  MONGO_URI,
  JWT_SECRET,
  STRIPE_SECRET_KEY,
  STRIPE_PRICE_STANDARD,
  STRIPE_PRICE_PRO,
  STRIPE_PRICE_ULTRA
} = process.env;

if (!JWT_SECRET) console.error("❌ JWT_SECRET manquant");

// ================= DB =================
if (MONGO_URI) {
  mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ MongoDB connecté"))
    .catch(err => console.error("❌ Mongo error", err.message));
}

// ================= STRIPE =================
const stripe = STRIPE_SECRET_KEY
  ? new Stripe(STRIPE_SECRET_KEY)
  : null;

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
body{font-family:system-ui;background:#f7f7f7}
.box{max-width:480px;margin:60px auto;background:#fff;padding:24px;border-radius:12px}
input,select,button{width:100%;padding:12px;margin-top:10px}
button{background:#2563eb;color:white;border:none;border-radius:8px}
</style>
</head>
<body>
<div class="box">
<h2>FlowPoint AI</h2>
<p>Essai gratuit 14 jours – carte requise</p>
<form id="f">
<input id="name" placeholder="Prénom" required />
<input id="email" type="email" placeholder="Email pro" required />
<input id="company" placeholder="Entreprise" required />
<select id="plan">
<option value="standard">Standard</option>
<option value="pro">Pro</option>
<option value="ultra">Ultra</option>
</select>
<button>Commencer l’essai</button>
</form>
<p id="msg"></p>
</div>

<script>
document.getElementById("f").onsubmit = async (e) => {
  e.preventDefault();
  const data = {
    firstName: name.value,
    email: email.value,
    companyName: company.value,
    plan: plan.value
  };

  const r = await fetch("/api/auth/lead", {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(data)
  });

  const j = await r.json();
  if (!r.ok) return msg.innerText = j.error;

  const s = await fetch("/api/stripe/checkout", {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Authorization":"Bearer "+j.token
    }
  });

  const k = await s.json();
  if (k.url) location.href = k.url;
};
</script>
</body>
</html>
`);
});

// ================= API =================
app.post("/api/auth/lead", (req, res) => {
  const token = jwt.sign(req.body, JWT_SECRET, { expiresIn: "15m" });
  res.json({ token });
});

app.post("/api/stripe/checkout", (req, res) => {
  if (!stripe) return res.status(500).json({ error:"Stripe non configuré" });

  const price =
    req.body.plan === "standard" ? STRIPE_PRICE_STANDARD :
    req.body.plan === "pro" ? STRIPE_PRICE_PRO :
    STRIPE_PRICE_ULTRA;

  stripe.checkout.sessions.create({
    mode:"subscription",
    line_items:[{ price, quantity:1 }],
    success_url:"https://flowpoint-ai.com/success",
    cancel_url:"https://flowpoint-ai.com/cancel"
  }).then(s => res.json({ url:s.url }));
});

app.listen(PORT, () =>
  console.log("✅ FlowPoint SaaS lancé sur le port", PORT)
);
