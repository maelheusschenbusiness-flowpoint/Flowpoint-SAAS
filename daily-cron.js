// daily-cron.js — FlowPoint AI Daily Report
require("dotenv").config();
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

const REQUIRED = [
  "MONGO_URI",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "ALERT_EMAIL_FROM",
];

for (const k of REQUIRED) {
  if (!process.env[k]) console.log("❌ ENV manquante:", k);
}

function bool(v) { return String(v).toLowerCase() === "true"; }

const ADMIN_BCC = String(process.env.ALERT_EMAIL_TO || "").trim(); // optionnel

let _t = null;
function mailer() {
  if (_t) return _t;

  _t = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: bool(process.env.SMTP_SECURE), // 587 => false
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });

  return _t;
}

function uniqEmails(list) {
  const set = new Set();
  for (const e of list || []) {
    const v = String(e || "").trim().toLowerCase();
    if (v) set.add(v);
  }
  return [...set];
}

async function sendMail({ to, subject, html }) {
  const info = await mailer().sendMail({
    from: process.env.ALERT_EMAIL_FROM,
    to,
    bcc: ADMIN_BCC || undefined,
    replyTo: process.env.ALERT_EMAIL_TO || undefined,
    subject,
    html,
  });

  console.log("✅ Daily email envoyé:", {
    messageId: info.messageId,
    to,
    accepted: info.accepted,
    rejected: info.rejected,
  });

  if (Array.isArray(info.accepted) && info.accepted.length === 0) {
    throw new Error("No recipients accepted");
  }
}

// --- Models (schemas permissifs) ---
const Org = mongoose.model("Org", new mongoose.Schema({}, { strict: false, collection: "orgs" }));
const User = mongoose.model("User", new mongoose.Schema({}, { strict: false, collection: "users" }));
const Monitor = mongoose.model("Monitor", new mongoose.Schema({}, { strict: false, collection: "monitors" }));

async function resolveRecipients(org) {
  const policy = String(org?.alertRecipients || "all").toLowerCase(); // owner | all
  const extra = Array.isArray(org?.alertExtraEmails) ? org.alertExtraEmails : [];

  let base = [];

  if (policy === "owner" && org?.ownerUserId) {
    const owner = await User.findById(org.ownerUserId).select("email");
    if (owner?.email) base.push(owner.email);
  } else {
    const users = await User.find({ orgId: org._id }).select("email");
    base.push(...users.map(u => u.email).filter(Boolean));
  }

  const all = uniqEmails([...base, ...extra]);
  return all.slice(0, 60); // sécurité
}

async function main() {
  console.log("⏱️ Daily cron started:", new Date().toISOString());
  await mongoose.connect(process.env.MONGO_URI);

  const orgs = await Org.find({}).limit(5000);
  console.log("🏢 Orgs:", orgs.length);

  for (const org of orgs) {
    const recipients = await resolveRecipients(org);
    if (!recipients.length) continue;

    const usersCount = await User.countDocuments({ orgId: org._id });
    const monitorsDown = await Monitor.countDocuments({ orgId: org._id, active: true, lastStatus: "down" });

    const html = `
      <h2 style="margin:0">FlowPoint AI — Rapport Quotidien</h2>
      <p><b>Organisation:</b> ${org.name || "-"}</p>
      <ul>
        <li><b>Users:</b> ${usersCount}</li>
        <li><b>Monitors DOWN:</b> ${monitorsDown}</li>
      </ul>
      <p style="color:#666;font-size:12px">Email envoyé automatiquement.</p>
    `;

    await sendMail({
      to: recipients.join(","),
      subject: `FlowPoint AI — Rapport quotidien — ${org.name || "Organisation"}`,
      html,
    });
  }

  await mongoose.disconnect();
  console.log("✅ Daily cron terminé");
}

main().catch((e) => {
  console.log("❌ Daily cron error:", e.message);
  process.exit(1);
});
