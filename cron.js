require("dotenv").config();
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

// ===== Mongo =====
mongoose.connect(process.env.MONGO_URI);

// ===== User model minimal =====
const User = mongoose.model(
  "User",
  new mongoose.Schema({
    email: String,
    accessBlocked: Boolean,
    trialEndsAt: Date,
  })
);

// ===== SMTP =====
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// ===== JOB =====
(async () => {
  console.log("⏰ Cron started");

  const now = new Date();

  // 1️⃣ Trials expirés
  const expiredTrials = await User.find({
    trialEndsAt: { $lt: now },
    accessBlocked: false,
  });

  for (const user of expiredTrials) {
    user.accessBlocked = true;
    await user.save();

    await transporter.sendMail({
      from: process.env.ALERT_EMAIL_FROM,
      to: user.email,
      subject: "Votre essai FlowPoint AI est terminé",
      text: `Bonjour,

Votre période d’essai est terminée.
Votre accès a été suspendu.

👉 Connectez-vous pour passer à un abonnement.

– FlowPoint AI`,
    });

    console.log("🔒 Trial expiré :", user.email);
  }

  console.log("✅ Cron terminé");
  process.exit(0);
})();
