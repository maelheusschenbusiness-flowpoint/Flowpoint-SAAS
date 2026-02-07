// monitor-cron.js — checks monitors + logs + email alerts (Render Cron Job)
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
  "ALERT_EMAIL_TO",
];
for (const k of REQUIRED) if (!process.env[k]) console.log("❌ ENV manquante:", k);

function boolEnv(v) { return String(v).toLowerCase() === "true"; }

function mailer() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: boolEnv(process.env.SMTP_SECURE),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendMail(subject, text, html) {
  const t = mailer();
  await t.sendMail({
    from: process.env.ALERT_EMAIL_FROM,
    to: process.env.ALERT_EMAIL_TO,
    subject,
    text,
    html,
  });
}

const UserSchema = new mongoose.Schema(
  {
    email: String,
    accessBlocked: Boolean,
  },
  { timestamps: true }
);

const MonitorSchema = new mongoose.Schema(
  {
    userId: mongoose.Schema.Types.ObjectId,
    url: String,
    active: Boolean,
    intervalMinutes: Number,
    lastCheckedAt: Date,
    lastStatus: String,
    lastAlertStatus: { type: String, default: "unknown" }, // up/down/unknown
    lastAlertAt: Date,
  },
  { timestamps: true }
);

const MonitorLogSchema = new mongoose.Schema(
  {
    userId: mongoose.Schema.Types.ObjectId,
    monitorId: mongoose.Schema.Types.ObjectId,
    url: String,
    status: String,
    httpStatus: Number,
    responseTimeMs: Number,
    checkedAt: { type: Date, default: Date.now },
    error: String,
  },
  { timestamps: true }
);

const User = mongoose.model("User", UserSchema);
const Monitor = mongoose.model("Monitor", MonitorSchema);
const MonitorLog = mongoose.model("MonitorLog", MonitorLogSchema);

async function checkUrlOnce(url) {
  const timeout = Number(process.env.MONITOR_HTTP_TIMEOUT_MS || 8000);
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  const t0 = Date.now();
  try {
    const r = await fetch(url, { redirect: "follow", signal: controller.signal });
    const ms = Date.now() - t0;
    clearTimeout(id);
    const up = r.status >= 200 && r.status < 400;
    return { status: up ? "up" : "down", httpStatus: r.status, responseTimeMs: ms, error: "" };
  } catch (e) {
    const ms = Date.now() - t0;
    clearTimeout(id);
    return { status: "down", httpStatus: 0, responseTimeMs: ms, error: e.message || "fetch failed" };
  }
}

function shouldRun(m, now) {
  if (!m.active) return false;
  if (!m.lastCheckedAt) return true;
  const next = new Date(m.lastCheckedAt).getTime() + (Number(m.intervalMinutes || 60) * 60 * 1000);
  return now >= next;
}

function canAlert(m, now) {
  const cooldownMin = Number(process.env.MONITOR_ALERT_COOLDOWN_MINUTES || 180);
  if (!m.lastAlertAt) return true;
  return now - new Date(m.lastAlertAt).getTime() >= cooldownMin * 60 * 1000;
}

async function main() {
  console.log("⏱️ monitor-cron started");
  await mongoose.connect(process.env.MONGO_URI);

  const now = Date.now();
  const monitors = await Monitor.find({ active: true }).limit(500);

  let checked = 0;
  let downCount = 0;

  for (const m of monitors) {
    if (!shouldRun(m, now)) continue;

    checked++;
    const r = await checkUrlOnce(m.url);

    m.lastCheckedAt = new Date();
    m.lastStatus = r.status;
    await m.save();

    await MonitorLog.create({
      userId: m.userId,
      monitorId: m._id,
      url: m.url,
      status: r.status,
      httpStatus: r.httpStatus,
      responseTimeMs: r.responseTimeMs,
      error: r.error,
    });

    if (r.status === "down") downCount++;

    // Alerts DOWN / RECOVERED
    const changed = (m.lastAlertStatus || "unknown") !== r.status;
    if (changed && canAlert(m, now)) {
      m.lastAlertStatus = r.status;
      m.lastAlertAt = new Date();
      await m.save();

      const subject =
        r.status === "down"
          ? `🚨 FlowPoint Monitoring DOWN: ${m.url}`
          : `✅ FlowPoint Monitoring RECOVERED: ${m.url}`;

      const text =
        `URL: ${m.url}\n` +
        `Status: ${r.status}\n` +
        `HTTP: ${r.httpStatus}\n` +
        `Latency: ${r.responseTimeMs}ms\n` +
        (r.error ? `Error: ${r.error}\n` : "");

      const html =
        `<h2>${subject}</h2>` +
        `<p><b>URL:</b> ${m.url}</p>` +
        `<p><b>Status:</b> ${r.status}</p>` +
        `<p><b>HTTP:</b> ${r.httpStatus}</p>` +
        `<p><b>Latency:</b> ${r.responseTimeMs}ms</p>` +
        (r.error ? `<pre>${r.error}</pre>` : "");

      await sendMail(subject, text, html);
    }
  }

  console.log(`✅ monitor-cron done. checked=${checked}, down=${downCount}`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.log("❌ monitor-cron error:", e.message);
  process.exit(1);
});
