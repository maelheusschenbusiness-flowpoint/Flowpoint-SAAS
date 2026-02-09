// monitor-cron.js — FlowPoint AI
// Monitoring + alertes intelligentes + résumé quotidien à 9h
// À exécuter via Render Cron Job (toutes les 5–10 min)

require("dotenv").config();

const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

// ================= ENV =================
const REQUIRED = [
  "MONGO_URI",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "ALERT_EMAIL_FROM",
];

for (const k of REQUIRED) {
  if (!process.env[k]) console.log("❌ ENV manquante:", k);
}

const HTTP_TIMEOUT_MS = Number(process.env.MONITOR_HTTP_TIMEOUT_MS || 8000);
const ALERT_COOLDOWN_MINUTES = Number(process.env.MONITOR_ALERT_COOLDOWN_MINUTES || 180);
const MAX_CHECKS_PER_RUN = Number(process.env.MONITOR_MAX_CHECKS_PER_RUN || 100);
const DAILY_HOUR = Number(process.env.MONITOR_DAILY_HOUR || 9);

// ================= MAIL =================
function boolEnv(v) {
  return String(v).toLowerCase() === "true";
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: boolEnv(process.env.SMTP_SECURE),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendMail({ to, subject, text, html }) {
  await transporter.sendMail({
    from: process.env.ALERT_EMAIL_FROM,
    to,
    subject,
    text,
    html,
  });
}

// ================= DB MODELS =================
const OrgSchema = new mongoose.Schema(
  {
    name: String,
    alertRecipients: { type: String, default: "all" }, // owner | all
    alertExtraEmails: { type: [String], default: [] },
  },
  { collection: "orgs" }
);

const UserSchema = new mongoose.Schema(
  {
    email: String,
    orgId: mongoose.Schema.Types.ObjectId,
    role: String,
  },
  { collection: "users" }
);

const MonitorSchema = new mongoose.Schema(
  {
    orgId: mongoose.Schema.Types.ObjectId,
    url: String,
    active: Boolean,
    intervalMinutes: Number,
    lastCheckedAt: Date,
    lastStatus: String,
    lastAlertStatus: String,
    lastAlertAt: Date,
  },
  { collection: "monitors" }
);

const MonitorLogSchema = new mongoose.Schema(
  {
    orgId: mongoose.Schema.Types.ObjectId,
    monitorId: mongoose.Schema.Types.ObjectId,
    url: String,
    status: String,
    httpStatus: Number,
    responseTimeMs: Number,
    checkedAt: Date,
    error: String,
  },
  { collection: "monitorlogs" }
);

const Org = mongoose.model("Org", OrgSchema);
const User = mongoose.model("User", UserSchema);
const Monitor = mongoose.model("Monitor", MonitorSchema);
const MonitorLog = mongoose.model("MonitorLog", MonitorLogSchema);

// ================= HELPERS =================
function minutesAgo(d) {
  if (!d) return Infinity;
  return (Date.now() - new Date(d).getTime()) / 60000;
}

function shouldRunMonitor(m) {
  const interval = Math.max(5, Number(m.intervalMinutes || 60));
  return m.active && minutesAgo(m.lastCheckedAt) >= interval;
}

function canAlert(m, newStatus) {
  const changed = m.lastAlertStatus !== newStatus;
  const cooldownOk = minutesAgo(m.lastAlertAt) >= ALERT_COOLDOWN_MINUTES;
  if (newStatus === "down") return changed || cooldownOk;
  return changed;
}

function isDailyWindow() {
  const now = new Date();
  return now.getHours() === DAILY_HOUR && now.getMinutes() < 10;
}

async function checkUrlOnce(url) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

  const t0 = Date.now();
  try {
    const r = await fetch(url, { redirect: "follow", signal: controller.signal });
    clearTimeout(id);
    const ms = Date.now() - t0;
    const up = r.status >= 200 && r.status < 400;
    return { status: up ? "up" : "down", httpStatus: r.status, responseTimeMs: ms, error: "" };
  } catch (e) {
    clearTimeout(id);
    return { status: "down", httpStatus: 0, responseTimeMs: 0, error: e.message };
  }
}

async function resolveRecipients(orgId) {
  const org = await Org.findById(orgId);
  const policy = org?.alertRecipients || "all";

  const users =
    policy === "owner"
      ? await User.find({ orgId, role: "owner" })
      : await User.find({ orgId });

  const emails = new Set(users.map(u => u.email));
  (org?.alertExtraEmails || []).forEach(e => emails.add(e));

  return {
    to: [...emails].join(","),
    orgName: org?.name || "Organisation",
  };
}

// ================= MAIN =================
async function main() {
  console.log("⏱️ monitor-cron start");
  await mongoose.connect(process.env.MONGO_URI);

  const monitors = await Monitor.find({ active: true });
  const due = monitors.filter(shouldRunMonitor).slice(0, MAX_CHECKS_PER_RUN);

  for (const m of due) {
    const result = await checkUrlOnce(m.url);

    m.lastCheckedAt = new Date();
    m.lastStatus = result.status;
    await m.save();

    await MonitorLog.create({
      orgId: m.orgId,
      monitorId: m._id,
      url: m.url,
      status: result.status,
      httpStatus: result.httpStatus,
      responseTimeMs: result.responseTimeMs,
      checkedAt: new Date(),
      error: result.error,
    });

    const daily = isDailyWindow() && result.status === "down";
    if (!daily && !canAlert(m, result.status)) continue;

    const rec = await resolveRecipients(m.orgId);
    if (!rec.to) continue;

    const subject =
      daily
        ? `📊 Rapport quotidien — ${m.url}`
        : result.status === "down"
        ? `🚨 DOWN — ${m.url}`
        : `✅ UP — ${m.url}`;

    const text =
      `Organisation: ${rec.orgName}\nURL: ${m.url}\nStatus: ${result.status}\nHTTP: ${result.httpStatus}\nTemps: ${result.responseTimeMs}ms\n`;

    const html =
      `<h2>${subject}</h2>
       <p><b>Organisation:</b> ${rec.orgName}</p>
       <p><b>URL:</b> ${m.url}</p>
       <ul>
         <li>Status: ${result.status}</li>
         <li>HTTP: ${result.httpStatus}</li>
         <li>Temps: ${result.responseTimeMs} ms</li>
       </ul>`;

    await sendMail({ to: rec.to, subject, text, html });

    m.lastAlertStatus = result.status;
    m.lastAlertAt = new Date();
    await m.save();
  }

  await mongoose.disconnect();
  console.log("✅ monitor-cron terminé");
}

main().catch(err => {
  console.error("❌ monitor-cron fatal:", err);
  process.exit(1);
});
