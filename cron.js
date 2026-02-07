// cron.js — FlowPoint AI daily alerts (Render Cron Job)

require("dotenv").config();

const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

// ---------- ENV ----------
const REQUIRED = [
  "MONGO_URI",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "ALERT_EMAIL_FROM",
  "ALERT_EMAIL_TO",
];

for (const k of REQUIRED) {
  if (!process.env[k]) {
    console.log("❌ ENV manquante:", k);
  }
}

// ---------- DB (minimal models) ----------
const UserSchema = new mongoose.Schema(
  {
    email: { type: String, unique: true, index: true },
    name: String,
    companyName: String,
    plan: String,
    hasTrial: Boolean,
    trialEndsAt: Date,
    accessBlocked: Boolean,
    stripeSubscriptionId: String,
  },
  { timestamps: true }
);

const User = mongoose.model("User", UserSchema);

// ---------- MAIL ----------
function boolEnv(v) {
  return String(v).toLowerCase() === "true";
}

async function sendMail({ subject, text, html }) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: boolEnv(process.env.SMTP_SECURE), // false pour 587, true pour 465
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const info = await transporter.sendMail({
    from: process.env.ALERT_EMAIL_FROM,
    to: process.env.ALERT_EMAIL_TO,
    subject,
    text,
    html,
  });

  console.log("✅ Email envoyé:", info.messageId);
}

function formatDate(d) {
  if (!d) return "-";
  try {
    return new Date(d).toISOString().slice(0, 19).replace("T", " ");
  } catch {
    return String(d);
  }
}

// ---------- MAIN ----------
async function main() {
  console.log("⏱️ Cron started");

  await mongoose.connect(process.env.MONGO_URI);

  // Exemple de “monitoring simple” : stats du SaaS
  const totalUsers = await User.countDocuments({});
  const blockedUsers = await User.countDocuments({ accessBlocked: true });
  const trialUsers = await User.countDocuments({ hasTrial: true });

  // Trials qui expirent dans moins de 48h (optionnel)
  const now = Date.now();
  const in48h = new Date(now + 48 * 60 * 60 * 1000);
  const expiringTrials = await User.find({
    hasTrial: true,
    trialEndsAt: { $exists: true, $lte: in48h },
  })
    .select("email trialEndsAt plan accessBlocked")
    .limit(50);

  const lines = expiringTrials
    .map(
      (u) =>
        `- ${u.email} | plan=${u.plan} | trialEndsAt=${formatDate(u.trialEndsAt)} | blocked=${!!u.accessBlocked}`
    )
    .join("\n");

  const subject = `FlowPoint AI — Rapport quotidien (${new Date().toISOString().slice(0, 10)})`;

  const text =
    `Stats:\n` +
    `- Total users: ${totalUsers}\n` +
    `- Trials actifs: ${trialUsers}\n` +
    `- Users bloqués: ${blockedUsers}\n\n` +
    `Trials expirant < 48h:\n` +
    (lines || "- Aucun");

  const html =
    `<h2>FlowPoint AI — Rapport quotidien</h2>` +
    `<ul>` +
    `<li><b>Total users:</b> ${totalUsers}</li>` +
    `<li><b>Trials actifs:</b> ${trialUsers}</li>` +
    `<li><b>Users bloqués:</b> ${blockedUsers}</li>` +
    `</ul>` +
    `<h3>Trials expirant &lt; 48h</h3>` +
    (expiringTrials.length
      ? `<pre style="background:#f6f6f6;padding:12px;border-radius:8px">${lines}</pre>`
      : `<p>Aucun</p>`);

  await sendMail({ subject, text, html });

  await mongoose.disconnect();
  console.log("✅ Cron terminé");
}

main().catch((e) => {
  console.log("❌ Cron error:", e.message);
  process.exit(1);
});
