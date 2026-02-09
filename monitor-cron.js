// monitor-cron.js — FlowPoint AI
// Monitoring + alertes instantanées + résumé quotidien (9h)
// À exécuter via Render Cron Job (toutes les 5 ou 10 minutes)

require("dotenv").config();
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

// ================= ENV =================
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

const HTTP_TIMEOUT_MS = Number(process.env.MONITOR_HTTP_TIMEOUT_MS || 8000);
const ALERT_COOLDOWN_MINUTES = Number(process.env.MONITOR_ALERT_COOLDOWN_MINUTES || 180);
const MAX_CHECKS_PER_RUN = Number(process.env.MONITOR_MAX_CHECKS_PER_RUN || 100);
const DAILY_HOUR = Number(process.env.MONITOR_DAILY_HOUR || 9); // 9h

function boolEnv(v) {
  return String(v).toLowerCase() === "true";
}

// ================= MAIL =================
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: boolEnv(process.env.SMTP_SECURE),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendMail({ to, subject, html }) {
  await mailer.sendMail({
    from: process.env.ALERT_EMAIL_FROM,
    to,
    subject,
    html,
  });
}

// ================= DB =================
const Org = mongoose.model("Org", new mongoose.Schema({
  name: String,
}, { collection: "orgs" }));

const User = mongoose.model("User", new mongoose.Schema({
  email: String,
  orgId: mongoose.Schema.Types.ObjectId,
}, { collection: "users" }));

const Monitor = mongoose.model("Monitor", new mongoose.Schema({
  orgId: mongoose.Schema.Types.ObjectId,
  url: String,
  active: Boolean,
  intervalMinutes: Number,
  lastCheckedAt: Date,
  lastStatus: String,
  lastAlertAt: Date,
  lastAlertStatus: String,
}, { collection: "monitors" }));

const MonitorLog = mongoose.model("MonitorLog", new mongoose.Schema({
  orgId: mongoose.Schema.Types.ObjectId,
  monitorId: mongoose.Schema.Types.ObjectId,
  status: String,
  checkedAt: Date,
}, { collection: "monitorlogs" }));

// ================= HELPERS =================
function minutesAgo(d) {
  if (!d) return Infinity;
  return (Date.now() - new Date(d).getTime()) / 60000;
}

function shouldRun(m) {
  const interval = Math.max(5, m.intervalMinutes || 60);
  return m.active && minutesAgo(m.lastCheckedAt) >= interval;
}

function canAlert(m, status) {
  if (!m.lastAlertStatus) return true;
  if (status !== m.lastAlertStatus) return true;
  return minutesAgo(m.lastAlertAt) >= ALERT_COOLDOWN_MINUTES;
}

function isDailyWindow() {
  const now = new Date();
  return now.getHours() === DAILY_HOUR && now.getMinutes() < 10;
}

async function checkUrl(url) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: controller.signal });
    clearTimeout(id);
    return r.status >= 200 && r.status < 400 ? "up" : "down";
  } catch {
    clearTimeout(id);
    return "down";
  }
}

// ================= MAIN =================
async function main() {
  console.log("⏱ monitor-cron", new Date().toISOString());
  await mongoose.connect(process.env.MONGO_URI);

  const monitors = await Monitor.find({ active: true }).limit(5000);
  const due = monitors.filter(shouldRun).slice(0, MAX_CHECKS_PER_RUN);

  for (const m of due) {
    const status = await checkUrl(m.url);

    await MonitorLog.create({
      orgId: m.orgId,
      monitorId: m._id,
      status,
      checkedAt: new Date(),
    });

    m.lastCheckedAt = new Date();
    m.lastStatus = status;

    const daily = isDailyWindow();
    const alertNow = daily || canAlert(m, status);

    if (alertNow) {
      const users = await User.find({ orgId: m.orgId });
      const emails = users.map(u => u.email).join(",");

      if (emails) {
        await sendMail({
          to: emails,
          subject: status === "down"
            ? `🚨 Site DOWN — ${m.url}`
            : `✅ Site UP — ${m.url}`,
          html: `
            <h2 style="color:${status === "down" ? "red" : "#0052CC"}">
              ${status.toUpperCase()}
            </h2>
            <p>URL : ${m.url}</p>
            <p>Date : ${new Date().toLocaleString("fr-FR")}</p>
          `,
        });
      }

      m.lastAlertStatus = status;
      m.lastAlertAt = new Date();
    }

    await m.save();
  }

  await mongoose.disconnect();
  console.log("✅ monitor-cron terminé");
}

main().catch(e => {
  console.error("❌ CRON ERROR", e);
  process.exit(1);
});
