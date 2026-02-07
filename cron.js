require("dotenv").config();
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

(async () => {
  console.log("⏰ Cron FlowPoint AI démarré");

  await mongoose.connect(process.env.MONGO_URI);

  const User = mongoose.model(
    "User",
    new mongoose.Schema({
      email: String,
      trialEndsAt: Date,
      accessBlocked: Boolean,
    })
  );

  const now = new Date();
  const soon = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const users = await User.find({
    trialEndsAt: { $lte: soon, $gte: now },
    accessBlocked: false,
  });

  if (!users.length) {
    console.log("✅ Aucun utilisateur à notifier");
    process.exit(0);
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  for (const user of users) {
    await transporter.sendMail({
      from: process.env.ALERT_EMAIL_FROM,
      to: user.email,
      subject: "⏰ Votre essai FlowPoint AI expire bientôt",
      html: `<p>Bonjour,<br>Votre essai expire sous 24h.</p>`,
    });

    console.log("📧 Email envoyé à", user.email);
  }

  process.exit(0);
})();
