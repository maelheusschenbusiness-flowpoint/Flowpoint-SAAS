// monthly-cron.js — FlowPoint AI Monthly Ultra Report
require("dotenv").config();
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

const {
  MONGO_URI,
  SMTP_HOST,
  SMTP_PORT,
  SMTP_SECURE,
  SMTP_USER,
  SMTP_PASS,
  ALERT_EMAIL_FROM,
  ALERT_EMAIL_TO,
} = process.env;

function bool(v){ return String(v).toLowerCase() === "true"; }

async function sendMail({to, subject, html}) {
  const t = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: bool(SMTP_SECURE),
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  await t.sendMail({
    from: ALERT_EMAIL_FROM,
    to,
    bcc: ALERT_EMAIL_TO || undefined,
    subject,
    html
  });
}

const User = mongoose.model("User", new mongoose.Schema({}, {strict:false}));

async function main(){
  await mongoose.connect(MONGO_URI);

  const ultras = await User.find({plan:"ultra", accessBlocked:false});

  for(const user of ultras){
    const html = `
      <h2>FlowPoint AI — Rapport Mensuel</h2>
      <p>Bonjour ${user.name || ""},</p>
      <p>Voici votre rapport mensuel Ultra.</p>
      <p>Merci d'utiliser FlowPoint AI.</p>
    `;

    await sendMail({
      to: user.email,
      subject: "FlowPoint AI — Rapport Mensuel Ultra",
      html
    });
  }

  await mongoose.disconnect();
  console.log("✅ Monthly cron terminé");
}

main().catch(e=>{
  console.log("❌ Monthly cron error:", e.message);
  process.exit(1);
});
