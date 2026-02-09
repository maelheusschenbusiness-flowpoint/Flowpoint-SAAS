// monitor-cron.js — FlowPoint AI monitoring checks + smart alerts to org members
// Run on Render Cron Job (every 5–10 minutes recommended)

require("dotenv").config();

const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

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
const MAX_CHECKS_PER_RUN = Number(process.env.MONITOR_MAX_CHECKS_PER_RUN || 100);

const ADMIN_COPY = (process.env.ALERT_EMAIL_TO || "").trim();

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
const OrgSchema = new mongoose.Schema(
  {
    name: String,
    alertRecipients: { type: String, default: "all" }, // "owner" | "all"
    alertExtraEmails: { type: [String], default: [] },
  },
  { timestamps: true, collection: "orgs" }
);

const UserSchema = new mongoose.Schema(
  {
    email: String,
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    role: String, // owner/member
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

const Org = mongoose.model("Org", OrgSchema);
const User = mongoose.model("User", UserSchema);
const Monitor = mongoose.model("Monitor", MonitorSchema);
const MonitorLog = mongoose.model("MonitorLog", MonitorLogSchema);

// --------------- HELPERS ---------------
function minutesAgo(d) {
  if (!d) return Infinity;
  return (Date.now() - new Date(d).getTime()) / 60000;
}

function shouldRunMonitor(m) {
  if (!m.active) return false;
  const interval = Math.max(5, Number(m.intervalMinutes || 60));
  return minutesAgo(m.lastCheckedAt) >= interval;
}

function canAlert(m, newStatus) {
  const lastStatus = String(m.lastAlertStatus || "unknown");
  const changed = lastStatus !== String(newStatus);

  const cooldownOk = minutesAgo(m.lastAlertAt) >= ALERT_COOLDOWN_MINUTES;

  if (newStatus === "down") return changed || cooldownOk;
  return changed;
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
    const ms = Date.now() - t0;
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
  try { return new Date(d).toLocaleString("fr-FR"); } catch { return String(d || ""); }
}

async function resolveRecipients(orgId) {
  const org = await Org.findById(orgId).select("alertRecipients alertExtraEmails name");
  const policy = String(org?.alertRecipients || "all").toLowerCase();

  let users;
  if (policy === "owner") {
    users = await User.find({ orgId, role: "owner" }).select("email role");
  } else {
    users = await User.find({ orgId }).select("email role");
  }

  const list = uniqEmails(users.map(u => u.email));
  const extra = uniqEmails(org?.alertExtraEmails || []);
  const all = uniqEmails([...list, ...extra, ...(ADMIN_COPY ? [ADMIN_COPY] : [])]);

  return { to: all.join(","), orgName: org?.name || "Organisation", policy, count: all.length };
}

// --------------- MAIN ---------------
async function main() {
  console.log("⏱️ monitor-cron started", new Date().toISOString());
  await mongoose.connect(process.env.MONGO_URI);

  const active = await Monitor.find({ active: true }).limit(5000);
  const due = active.filter(shouldRunMonitor).slice(0, MAX_CHECKS_PER_RUN);

  console.log(`🧭 monitors active=${active.length} due=${due.length} max=${MAX_CHECKS_PER_RUN}`);

  let alertsSent = 0;

  for (const m of due) {
    const result = await checkUrlOnce(m.url);

    // save status + log
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

    if (!canAlert(m, result.status)) continue;

    const rec = await resolveRecipients(m.orgId);
    if (!rec.to) continue;

    const subject =
      result.status === "down"
        ? `🚨 FlowPoint Monitoring DOWN — ${m.url}`
        : `✅ FlowPoint Monitoring UP — ${m.url}`;

    const text =
      `Organisation: ${rec.orgName}\n` +
      `URL: ${m.url}\n` +
      `Status: ${result.status.toUpperCase()}\n` +
      `HTTP: ${result.httpStatus}\n` +
      `Response time: ${result.responseTimeMs}ms\n` +
      `Error: ${result.error || "-"}\n` +
      `Checked at: ${fmt(new Date())}\n` +
      `RecipientsPolicy: ${rec.policy}\n`;

    const html =
      `<h2 style="margin:0">${result.status === "down" ? "🚨 DOWN" : "✅ UP"}</h2>` +
      `<p style="margin:8px 0"><b>Organisation:</b> ${rec.orgName}</p>` +
      `<p style="margin:8px 0"><b>URL:</b> ${m.url}</p>` +
      `<ul>` +
      `<li><b>Status:</b> ${result.status.toUpperCase()}</li>` +
      `<li><b>HTTP:</b> ${result.httpStatus}</li>` +
      `<li><b>Temps:</b> ${result.responseTimeMs}ms</li>` +
      `<li><b>Erreur:</b> ${result.error || "-"}</li>` +
      `<li><b>Check:</b> ${fmt(new Date())}</li>` +
      `</ul>`;

    try {
      await sendMail({ to: rec.to, subject, text, html });

      m.lastAlertStatus = result.status;
      m.lastAlertAt = new Date();
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
