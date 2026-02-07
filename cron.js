// cron.js
require("dotenv").config();
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

// ----- DB -----
mongoose.connect(process.env.MONGO_URI);

// ----- MODELE USER (simple) -----
const UserSchema = new mongoose.Schema({
  email: String,
  trialEndsAt: Date,
  accessBlocked: Boolean
});
const User = mongoose.model("User", UserSchema);

// ----- EMAIL -----
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

(async () => {
  console.log("⏱️ Cron job started");

  const now = new Date();

  // utilisateurs dont l’essai est fini
  const expired = await User.find({
    trialEndsAt: { $lt: now },
    accessBlocked: false
  });

  for (const user of expired) {
    user.accessBlocked = true;
    await user.save();

    await transporter.sendMail({
      from: `"FlowPoint AI" <${process.env.SMTP_USER}>`,
      to: user.email,
      subject: "Votre essai est terminé",
      html: `
        <p>Bonjour,</p>
        <p>Votre essai FlowPoint AI est terminé.</p>
        <p>Connectez-vous pour mettre à niveau votre abonnement.</p>
      `
    });

    console.log("🔒 Bloqué + email envoyé:", user.email);
  }

  console.log("✅ Cron terminé");
  process.exit(0);
})();
