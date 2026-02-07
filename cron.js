// ===============================
// FlowPoint AI - Daily Email Cron
// Envoi 1 email / jour à 9h
// ===============================

require("dotenv").config();
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

// ---------- LOG ----------
console.log("🕘 Cron started");

// ---------- ENV CHECK ----------
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
    console.error("❌ ENV manquante :", k);
    process.exit(1);
  }
}

// ---------- DB ----------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB connecté (cron)"))
  .catch((e) => {
    console.error("❌ MongoDB error:", e.message);
    process.exit(1);
  });

// ---------- USER MODEL (minimal) ----------
const UserSchema = new mongoose.Schema({
  email: String,
  plan: String,
  accessBlocked: Boolean,
  trialEndsAt: Date,
});
const User = mongoose.model("User", UserSchema);

// ---------- SMTP ----------
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true", // false pour 587
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ---------- MAIN ----------
(async () => {
  try {
    const totalUsers = await User.countDocuments();
    const blockedUsers = await User.countDocuments({ accessBlocked: true });
    const trialsEndingSoon = await User.countDocuments({
      trialEndsAt: { $lte: new Date(Date.now() + 48 * 60 * 60 * 1000) },
    });

    const text = `
📊 FlowPoint AI – Rapport quotidien

👥 Utilisateurs totaux : ${totalUsers}
🚫 Comptes bloqués : ${blockedUsers}
⏳ Essais expirant sous 48h : ${trialsEndingSoon}

Date : ${new Date().toLocaleString("fr-FR")}
`;

    await transporter.sendMail({
      from: process.env.ALERT_EMAIL_FROM,
      to: process.env.ALERT_EMAIL_TO,
      subject: "📊 FlowPoint AI – Rapport quotidien",
      text,
    });

    console.log("📧 Email envoyé avec succès");
  } catch (err) {
    console.error("❌ Erreur cron:", err.message);
  } finally {
    await mongoose.disconnect();
    console.log("✅ Cron terminé");
    process.exit(0);
  }
})();
