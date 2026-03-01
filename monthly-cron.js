// monthly-cron.js — FlowPoint Monthly Ultra Report
require("dotenv").config();
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

function bool(v){ return String(v||"").toLowerCase() === "true"; }

const REQUIRED = ["MONGO_URI","ALERT_EMAIL_FROM"];
for (const k of REQUIRED) if (!process.env[k]) console.log("❌ ENV manquante:", k);

async function sendMail({to, subject, html}) {
  // Resend first
  if (process.env.RESEND_API_KEY) {
    const payload = {
      from: process.env.ALERT_EMAIL_FROM,
      to: [to],
      subject,
      html,
      bcc: process.env.ALERT_EMAIL_TO ? [process.env.ALERT_EMAIL_TO] : undefined,
    };

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type":"application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(()=> ({}));
    if(!r.ok) throw new Error(data?.message || `Resend API ${r.status}`);
    return;
  }

  // SMTP fallback
  if(!process.env.SMTP_HOST) throw new Error("SMTP non configuré et RESEND_API_KEY manquante");
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: bool(process.env.SMTP_SECURE),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  await t.sendMail({
    from: process.env.ALERT_EMAIL_FROM,
    to,
    bcc: process.env.ALERT_EMAIL_TO || undefined,
    subject,
    html
  });
}

const User = mongoose.model("User", new mongoose.Schema({}, {strict:false, collection:"users"}));

async function main(){
  await mongoose.connect(process.env.MONGO_URI);

  const ultras = await User.find({ plan:"ultra", accessBlocked:false }).limit(10000);

  for(const user of ultras){
    const html = `
      <h2>FlowPoint — Rapport Mensuel</h2>
      <p>Bonjour ${user.name || ""},</p>
      <p>Voici votre rapport mensuel Ultra.</p>
      <p>Merci d'utiliser FlowPoint.</p>
    `;
    await sendMail({
      to: user.email,
      subject: "FlowPoint — Rapport Mensuel Ultra",
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
