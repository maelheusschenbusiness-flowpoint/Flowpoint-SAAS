// cron.js — FlowPoint daily report per ORG
require("dotenv").config();

const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

const REQUIRED = ["MONGO_URI","ALERT_EMAIL_FROM"];
for (const k of REQUIRED) if (!process.env[k]) console.log("❌ ENV manquante:", k);

const SMTP_READY =
  !!process.env.SMTP_HOST && !!process.env.SMTP_PORT && !!process.env.SMTP_USER && !!process.env.SMTP_PASS;

function boolEnv(v){ return String(v || "").toLowerCase() === "true"; }

let _transport = null;
function mailer(){
  if(!SMTP_READY) return null;
  if(_transport) return _transport;
  _transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: boolEnv(process.env.SMTP_SECURE),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 20000,
  });
  return _transport;
}

async function sendEmail({ to, subject, html }) {
  // Resend first
  if (process.env.RESEND_API_KEY) {
    const toList = String(to || "").split(",").map(s=>s.trim()).filter(Boolean);
    const payload = { from: process.env.ALERT_EMAIL_FROM, to: toList, subject, html,
      bcc: process.env.ALERT_EMAIL_TO ? [process.env.ALERT_EMAIL_TO] : undefined
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
  const t = mailer();
  if(!t) throw new Error("SMTP non configuré et RESEND_API_KEY manquante");

  await t.sendMail({
    from: process.env.ALERT_EMAIL_FROM,
    to,
    bcc: process.env.ALERT_EMAIL_TO || undefined,
    subject,
    html,
  });
}

function uniqEmails(list){
  const s = new Set();
  for(const e of list || []){
    const v = String(e||"").trim().toLowerCase();
    if(v) s.add(v);
  }
  return [...s];
}

// Schemas permissifs (stable)
const Org = mongoose.model("Org", new mongoose.Schema({}, { strict:false, collection:"orgs" }));
const User = mongoose.model("User", new mongoose.Schema({}, { strict:false, collection:"users" }));
const Audit = mongoose.model("Audit", new mongoose.Schema({}, { strict:false, collection:"audits" }));
const Monitor = mongoose.model("Monitor", new mongoose.Schema({}, { strict:false, collection:"monitors" }));
const MonitorLog = mongoose.model("MonitorLog", new mongoose.Schema({}, { strict:false, collection:"monitorlogs" }));

async function resolveRecipients(org) {
  const policy = String(org?.alertRecipients || "all").toLowerCase(); // owner | all
  const extra = Array.isArray(org?.alertExtraEmails) ? org.alertExtraEmails : [];

  let base = [];
  if (policy === "owner" && org?.ownerUserId) {
    const owner = await User.findById(org.ownerUserId).select("email");
    if (owner?.email) base.push(owner.email);
  } else {
    const users = await User.find({ orgId: org._id }).select("email");
    base.push(...users.map(u=>u.email).filter(Boolean));
  }

  return uniqEmails([...base, ...extra]).slice(0, 60);
}

function fmt(d){
  if(!d) return "-";
  try { return new Date(d).toLocaleString("fr-FR"); } catch { return String(d); }
}

async function main(){
  console.log("⏱️ Daily cron started:", new Date().toISOString());
  await mongoose.connect(process.env.MONGO_URI);

  const orgs = await Org.find({}).limit(5000);

  for (const org of orgs) {
    const recipients = await resolveRecipients(org);
    if(!recipients.length) continue;

    const since24h = new Date(Date.now() - 24*60*60*1000);

    const usersCount = await User.countDocuments({ orgId: org._id });
    const monitorsDown = await Monitor.countDocuments({ orgId: org._id, active:true, lastStatus:"down" });

    const audits24h = await Audit.find({ orgId: org._id, createdAt: { $gte: since24h } })
      .sort({ createdAt:-1 }).limit(5);

    const downLogs = await MonitorLog.find({ orgId: org._id, checkedAt: { $gte: since24h }, status:"down" })
      .sort({ checkedAt:-1 }).limit(5);

    const html = `
      <h2 style="margin:0">FlowPoint AI — Rapport Quotidien</h2>
      <p><b>Organisation:</b> ${org.name || "-"}</p>
      <ul>
        <li><b>Users:</b> ${usersCount}</li>
        <li><b>Monitors DOWN:</b> ${monitorsDown}</li>
      </ul>
      <h3>Audits (24h)</h3>
      ${audits24h.length ? `<ul>${audits24h.map(a=>`<li>${fmt(a.createdAt)} — ${a.url} — score ${a.score}</li>`).join("")}</ul>` : `<p>Aucun</p>`}
      <h3>Logs DOWN (24h)</h3>
      ${downLogs.length ? `<ul>${downLogs.map(l=>`<li>${fmt(l.checkedAt)} — ${l.url} — HTTP ${l.httpStatus} — ${l.responseTimeMs}ms — ${l.error||"-"}</li>`).join("")}</ul>` : `<p>Aucun</p>`}
      <p style="color:#666;font-size:12px">Email envoyé automatiquement.</p>
    `;

    await sendEmail({
      to: recipients.join(","),
      subject: `FlowPoint AI — Rapport quotidien — ${org.name || "Organisation"}`,
      html,
    });
  }

  await mongoose.disconnect();
  console.log("✅ Daily cron terminé");
}

main().catch((e)=>{
  console.log("❌ Daily cron error:", e.message);
  process.exit(1);
});
