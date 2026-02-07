// monitor-cron.js — FlowPoint AI monitoring checks + email alerts to org members
// Run on Render Cron Job (ex: every 5-10 minutes)

require("dotenv").config();

const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const crypto = require("crypto");

// ---------------- ENV ----------------
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
const MAX_CHECKS_PER_RUN = Number(process.env.MONITOR_MAX_CHECKS_PER_RUN || 80);

// Optionnel: si tu veux recevoir aussi une copie admin
const ALERT_EMAIL_TO_FALLBACK = (process.env.ALERT_EMAIL_TO || "").trim(); // facultatif

function boolEnv(v) {
  return String(v).toLowerCase() === "true";
}

function mailer() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: boolEnv(process.env.SMTP_SECURE),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

async function sendMail({ to, subject, text, html }) {
  const t = mailer();
  const info = await t.sendMail({
    from: process.env.ALERT_EMAIL_FROM,
    to,
    subject,
    text,
    html,
  });
  console.log("✅ Email envoyé:", info.messageId, "=>", to);
}

// --------------- DB MODELS (minimal) ---------------
const UserSchema = new mongoose.Schema(
  {
    email: String,
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    role: String, // owner/member
    plan: String, // standard/pro/ultra
  },
  { timestamps: true, collection: "users" }
);

const MonitorSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    url: String,
    active: Boolean,
    intervalMinutes: Number,

    lastCheckedAt: Date,
    lastStatus: String, // up/down/unknown

    lastAlertStatus: String,
    lastAlertAt: Date,
  },
  { timestamps: true, collection: "monitors" }
);

const MonitorLogSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    monitorId: { type: mongoose.Schema.Types.ObjectId, index: true },
    url: String,
    status: String,
    httpStatus: Number,
    responseTimeMs: Number,
    checkedAt: Date,
    error: String,
  },
  { timestamps: true, collection: "monitorlogs" }
);

const User = mongoose.model("User", UserSchema);
const Monitor = mongoose.model("Monitor", MonitorSchema);
const MonitorLog = mongoose.model("MonitorLog", MonitorLogSchema);

// --------------- HELPERS ---------------
function now() {
  return new Date();
}

function minutesAgo(d) {
  if (!d) return Infinity;
  return (Date.now() - new Date(d).getTime()) / 60000;
}

function shouldRunMonitor(m) {
  if (!m.active) return false;
  const interval = Number(m.intervalMinutes || 60);
  return minutesAgo(m.lastCheckedAt) >= interval;
}

function canAlert(m, newStatus) {
  // alert if status changed OR cooldown passed while still down
  const lastStatus = String(m.lastAlertStatus || "unknown");
  const changed = lastStatus !== String(newStatus);

  const cooldownOk = minutesAgo(m.lastAlertAt) >= ALERT_COOLDOWN_MINUTES;
  // If still down, allow repeated alerts with cooldown
  if (newStatus === "down") return changed || cooldownOk;
  // If recovered to up, alert on change only
  return changed;
}

async function checkUrlOnce(url) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

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

function uniqEmails(list) {
  const set = new Set();
  for (const e of list) {
    const v = String(e || "").trim().toLowerCase();
    if (v) set.add(v);
  }
  return [...set];
}

function fmt(d) {
  try {
    return new Date(d).toLocaleString("fr-FR");
  } catch {
    return String(d || "");
  }
}

function shortId(id) {
  return crypto.createHash("sha1").update(String(id)).digest("hex").slice(0, 8);
}

// --------------- MAIN ---------------
async function main() {
  console.log("⏱️ monitor-cron started", new Date().toISOString());

  await mongoose.connect(process.env.MONGO_URI);

  // 1) Take active monitors and filter those due
  const all = await Monitor.find({ active: true }).limit(2000);
  const due = all.filter(shouldRunMonitor).slice(0, MAX_CHECKS_PER_RUN);

  console.log(`🧭 monitors active=${all.length}, due=${due.length}, max=${MAX_CHECKS_PER_RUN}`);

  let alertsSent = 0;

  for (const m of due) {
    const result = await checkUrlOnce(m.url);

    // Save monitor status
    m.lastCheckedAt = now();
    m.lastStatus = result.status;
    await m.save();

    // Log
    await MonitorLog.create({
      orgId: m.orgId,
      monitorId: m._id,
      url: m.url,
      status: result.status,
      httpStatus: result.httpStatus,
      responseTimeMs: result.responseTimeMs,
      checkedAt: now(),
      error: result.error,
    });

    // Decide alert
    if (!canAlert(m, result.status)) continue;

    // Recipients = all users in org (owner + members)
    const users = await User.find({ orgId: m.orgId }).select("email role plan").limit(200);
    const recipients = uniqEmails(users.map(u => u.email));

    // Optional admin copy
    if (ALERT_EMAIL_TO_FALLBACK) recipients.push(ALERT_EMAIL_TO_FALLBACK);

    const to = uniqEmails(recipients).join(",");
    if (!to) continue;

    const baseSubject =
      result.status === "down"
        ? `🚨 FlowPoint Monitoring DOWN — ${m.url}`
        : `✅ FlowPoint Monitoring UP — ${m.url}`;

    const details =
      `URL: ${m.url}\n` +
      `Status: ${result.status.toUpperCase()}\n` +
      `HTTP: ${result.httpStatus}\n` +
      `Response time: ${result.responseTimeMs}ms\n` +
      `Error: ${result.error || "-"}\n` +
      `Checked at: ${fmt(new Date())}\n` +
      `Monitor: ${shortId(m._id)}\n`;

    const html =
      `<h2>${result.status === "down" ? "🚨 DOWN" : "✅ UP"}</h2>` +
      `<p><b>URL:</b> ${m.url}</p>` +
      `<ul>` +
      `<li><b>Status:</b> ${result.status.toUpperCase()}</li>` +
      `<li><b>HTTP:</b> ${result.httpStatus}</li>` +
      `<li><b>Temps:</b> ${result.responseTimeMs}ms</li>` +
      `<li><b>Erreur:</b> ${result.error || "-"}</li>` +
      `<li><b>Check:</b> ${fmt(new Date())}</li>` +
      `</ul>`;

    try {
      await sendMail({
        to,
        subject: baseSubject,
        text: details,
        html,
      });

      // Update alert markers
      m.lastAlertStatus = result.status;
      m.lastAlertAt = now();
      await m.save();

      alertsSent += 1;
    } catch (e) {
      console.log("❌ email error:", e.message);
    }
  }

  await mongoose.disconnect();
  console.log(`✅ monitor-cron terminé. alertsSent=${alertsSent}`);
}

main().catch((e) => {
  console.log("❌ monitor-cron fatal:", e.message);
  process.exit(1);
});
