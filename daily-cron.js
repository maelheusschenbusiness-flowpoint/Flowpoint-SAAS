// daily-cron.js — FlowPoint AI Daily Report
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
    bcc: ALERT_EMAIL_TO || undefined, // admin en copie invisible
    subject,
    html
  });
}

const Org = mongoose.model("Org", new mongoose.Schema({}, {strict:false}));
const User = mongoose.model("User", new mongoose.Schema({}, {strict:false}));
const Monitor = mongoose.model("Monitor", new mongoose.Schema({}, {strict:false}));

async function main() {
  await mongoose.connect(MONGO_URI);

  const orgs = await Org.find({});

  for(const org of orgs){
    const users = await User.find({orgId: org._id});
    const monitorsDown = await Monitor.find({orgId: org._id, lastStatus:"down"});

    if(!users.length) continue;

    const emails = users.map(u=>u.email).filter(Boolean).join(",");

    const html = `
      <h2>FlowPoint AI — Rapport Quotidien</h2>
      <p><b>Organisation:</b> ${org.name || "-"}</p>
      <p><b>Users:</b> ${users.length}</p>
      <p><b>Monitors DOWN:</b> ${monitorsDown.length}</p>
    `;

    await sendMail({
      to: emails,
      subject: `FlowPoint AI — Daily Report — ${org.name}`,
      html
    });
  }

  await mongoose.disconnect();
  console.log("✅ Daily cron terminé");
}

main().catch(e=>{
  console.log("❌ Daily cron error:", e.message);
  process.exit(1);
});
