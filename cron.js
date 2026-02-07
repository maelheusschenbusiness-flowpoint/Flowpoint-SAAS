// =======================
// FlowPoint AI – Daily Cron (Render Cron Job)
// - Email admin report
// - Email trial reminders
// =======================

require("dotenv").config();

const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

// ---------- DB ----------
const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.log("❌ MONGO_URI manquant");
  process.exit(1);
}

// ---------- MODELS (mêmes schémas que index.js) ----------
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

const User = mongoose.model("User", UserSchema);

// ---------- MAIL ----------
function getTransport() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || "587");
  const secure = String(process.env.SMTP_SECURE || "false") === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
}

async function sendMail({ to, subject, html }) {
  const t = getTransport();
  if (!t) {
    console.log("⚠️ SMTP non configuré — email non envoyé:", subject);
    return;
  }
  const from = process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER;

  await t.sendMail({ from, to, subject, html });
}

function daysBetween(a, b) {
  const ms = b.getTime() - a.getTime();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

async function main() {
  console.log("🕘 Cron started");

  await mongoose.connect(MONGO_URI);

  const now = new Date();
  const adminTo = process.env.ALERT_EMAIL_TO; // ex: ton email
  const baseUrl = process.env.PUBLIC_BASE_URL || "(non défini)";

  // ---- Admin report ----
  const totalUsers = await User.countDocuments({});
  const blocked = await User.find({ accessBlocked: true }).select("email plan updatedAt");
  const endingSoon3 = await User.find({
    hasTrial: true,
    trialEndsAt: { $gte: now, $lte: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000) }
  }).select("email plan trialEndsAt");

  const endingSoon1 = await User.find({
    hasTrial: true,
    trialEndsAt: { $gte: now, $lte: new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000) }
  }).select("email plan trialEndsAt");

  if (adminTo) {
    const html = `
      <h2>📊 FlowPoint AI — Rapport quotidien</h2>
      <p><b>Base URL:</b> ${baseUrl}</p>
      <ul>
        <li><b>Total utilisateurs:</b> ${totalUsers}</li>
        <li><b>Accès bloqués:</b> ${blocked.length}</li>
        <li><b>Essais finissent sous 3 jours:</b> ${endingSoon3.length}</li>
        <li><b>Essais finissent sous 24h:</b> ${endingSoon1.length}</li>
      </ul>

      <h3>⛔ Comptes bloqués</h3>
      <ul>
        ${blocked.map(u => `<li>${u.email} — ${u.plan}</li>`).join("") || "<li>Aucun</li>"}
      </ul>

      <h3>⏳ Essais qui finissent bientôt (≤ 3 jours)</h3>
      <ul>
        ${endingSoon3.map(u => `<li>${u.email} — ${u.plan} — fin: ${u.trialEndsAt?.toISOString()}</li>`).join("") || "<li>Aucun</li>"}
      </ul>
    `;

    await sendMail({
      to: adminTo,
      subject: "📊 FlowPoint AI — Rapport quotidien",
      html
    });
  }

  // ---- User reminders (J-3 et J-1) ----
  const reminderTargets = await User.find({
    hasTrial: true,
    trialEndsAt: { $gte: now, $lte: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000) }
  }).select("email name plan trialEndsAt");

  for (const u of reminderTargets) {
    if (!u.trialEndsAt) continue;
    const d = daysBetween(now, u.trialEndsAt);
    if (![3, 1].includes(d)) continue;

    const subject =
      d === 3
        ? "⏳ Ton essai FlowPoint AI se termine dans 3 jours"
        : "⚠️ Ton essai FlowPoint AI se termine demain";

    const html = `
      <p>Salut ${u.name || ""},</p>
      <p>Ton essai FlowPoint AI (<b>${u.plan}</b>) se termine dans <b>${d} jour(s)</b>.</p>
      <p>Pour éviter toute interruption, tu peux gérer / upgrader ton abonnement depuis ton dashboard.</p>
      <p><b>Lien:</b> ${baseUrl}/dashboard.html</p>
    `;

    await sendMail({ to: u.email, subject, html });
  }

  await mongoose.disconnect();
  console.log("✅ Cron terminé");
}

main().catch((e) => {
  console.log("❌ Cron error:", e.message);
  process.exit(1);
});
