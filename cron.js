// cron.js
require("dotenv").config();
const mongoose = require("mongoose");
const User = require("./models/User"); // ou adapte le chemin si besoin
const nodemailer = require("nodemailer");

// ----- MongoDB -----
async function connectDB() {
  await mongoose.connect(process.env.MONGO_URI);
}

// ----- Email (simple SMTP) -----
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendMail(to, subject, text) {
  await transporter.sendMail({
    from: `"FlowPoint AI" <${process.env.SMTP_FROM}>`,
    to,
    subject,
    text,
  });
}

// ----- Cron logic -----
async function run() {
  await connectDB();

  const now = new Date();

  // 1️⃣ Essais expirés
  const expiredTrials = await User.find({
    hasTrial: true,
    trialEndsAt: { $lt: now },
    accessBlocked: false,
  });

  for (const user of expiredTrials) {
    user.accessBlocked = true;
    await user.save();

    await sendMail(
      user.email,
      "Votre essai FlowPoint AI est terminé",
      `Bonjour ${user.name || ""},

Votre période d’essai est terminée.
Pour continuer à utiliser FlowPoint AI, merci de mettre à jour votre abonnement.

👉 Connectez-vous à votre dashboard.
`
    );
  }

  console.log(`✔ Cron terminé – ${expiredTrials.length} essais expirés traités`);
  process.exit(0);
}

run().catch(err => {
  console.error("❌ Cron error:", err);
  process.exit(1);
});
