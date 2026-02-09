// monitor-cron.js — FlowPoint AI monitoring checks + smart alerts + daily summary + monthly reliability report (Ultra)
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

// Optionnel: copie admin sur tous les emails
const ADMIN_COPY = (process.env.ALERT_EMAIL_TO || "").trim();

// Daily summary window (ex: 9h00-9h10)
const DAILY_HOUR = Number(process.env.MONITOR_DAILY_HOUR || 9);
const DAILY_WINDOW_MINUTES = Number(process.env.MONITOR_DAILY_WINDOW_MINUTES || 10);

// Monthly report sending day/hour (UTC by default)
const MONTHLY_REPORT_DAY = Number(process.env.MONITOR_MONTHLY_REPORT_DAY || 1); // 1er du mois
const MONTHLY_REPORT_HOUR = Number(process.env.MONITOR_MONTHLY_REPORT_HOUR || 9); // 09:00
const MONTHLY_REPORT_WINDOW_MINUTES = Number(process.env.MONITOR_MONTHLY_REPORT_WINDOW_MINUTES || 20);

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
    alertExtraEmails: { type: [String], default: [] }, // ex: ["ops@..."]
  },
  { timestamps: true, collection: "orgs" }
);

const UserSchema = new mongoose.Schema(
  {
    email: String,
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    role: String, // owner/member
    plan: String, // standard/pro/ultra (pour Ultra-only monthly report)
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
    status: String, // up/down
    httpStatus: Number,
    responseTimeMs: Number,
    checkedAt: Date,
    error: String,
  },
  { timestamps: true, collection: "monitorlogs" }
);

// Anti double-send (daily/monthly)
const CronRunSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, index: true }, // ex: daily:YYYY-MM-DD, monthly:YYYY-MM
    ranAt: { type: Date, default: Date.now },
  },
  { timestamps: true, collection: "cronruns" }
);

const Org = mongoose.model("Org", OrgSchema);
const User = mongoose.model("User", UserSchema);
const Monitor = mongoose.model("Monitor", MonitorSchema);
const MonitorLog = mongoose.model("MonitorLog", MonitorLogSchema);
const CronRun = mongoose.model("CronRun", CronRunSchema);

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

  // DOWN -> alerte si changement OU cooldown passé
  if (newStatus === "down") return changed || cooldownOk;
  // UP -> alerte seulement si changement (recovery)
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
  try {
    return new Date(d).toLocaleString("fr-FR");
  } catch {
    return String(d || "");
  }
}

// recipients per org settings
async function resolveRecipients(orgId) {
  const org = await Org.findById(orgId).select("alertRecipients alertExtraEmails name");
  const policy = String(org?.alertRecipients || "all").toLowerCase();

  let users;
  if (policy === "owner") {
    users = await User.find({ orgId, role: "owner" }).select("email role");
  } else {
    users = await User.find({ orgId }).select("email role");
  }

  const list = uniqEmails(users.map((u) => u.email));
  const extra = uniqEmails(org?.alertExtraEmails || []);
  const all = uniqEmails([...list, ...extra, ...(ADMIN_COPY ? [ADMIN_COPY] : [])]);

  return { to: all.join(","), orgName: org?.name || "Organisation", policy, count: all.length };
}

function isDailyWindow() {
  const now = new Date();
  return now.getHours() === DAILY_HOUR && now.getMinutes() < DAILY_WINDOW_MINUTES;
}

function isMonthlyWindow() {
  const now = new Date();
  const dayOk = now.getDate() === MONTHLY_REPORT_DAY;
  const hourOk = now.getHours() === MONTHLY_REPORT_HOUR;
  const minOk = now.getMinutes() < MONTHLY_REPORT_WINDOW_MINUTES;
  return dayOk && hourOk && minOk;
}

function monthKeyUTC(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function dayKeyLocal(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function reliabilityScoreFromStats({ uptimePct, downs, avgMs }) {
  // Score simple, lisible, stable :
  // base = uptimePct
  // pénalité: downs (incidents) + lenteur
  let score = uptimePct;

  // down incidents: -1.5 points / incident (cap à -25)
  score -= Math.min(25, downs * 1.5);

  // perf: si avgMs > 1200 => pénalité jusqu’à -15
  if (avgMs > 1200) {
    const extra = clamp((avgMs - 1200) / 2000, 0, 1); // 1200->3200
    score -= extra * 15;
  }

  return Math.round(clamp(score, 0, 100));
}

async function computeOrgMonthlyReport(orgId) {
  const now = new Date();
  const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const logs = await MonitorLog.find({ orgId, checkedAt: { $gte: from } }).select(
    "url status responseTimeMs checkedAt"
  );

  const byUrl = new Map();
  for (const l of logs) {
    const url = String(l.url || "").trim();
    if (!url) continue;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push(l);
  }

  const sites = [];
  for (const [url, arr] of byUrl.entries()) {
    const total = arr.length || 0;
    const up = arr.filter((x) => x.status === "up").length;
    const down = arr.filter((x) => x.status === "down").length;
    const uptimePct = total ? (up / total) * 100 : 0;

    const avgMs = total
      ? Math.round(arr.reduce((s, x) => s + (Number(x.responseTimeMs || 0) || 0), 0) / total)
      : 0;

    // downs “incidents” (approx) : compte transitions up->down
    let incidents = 0;
    const sorted = arr.slice().sort((a, b) => new Date(a.checkedAt) - new Date(b.checkedAt));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].status === "up" && sorted[i].status === "down") incidents++;
    }

    const score = reliabilityScoreFromStats({ uptimePct, downs: incidents, avgMs });

    sites.push({
      url,
      totalChecks: total,
      uptimePct: Math.round(uptimePct * 100) / 100,
      avgMs,
      downLogs: down,
      incidents,
      score,
    });
  }

  sites.sort((a, b) => b.score - a.score);

  // global
  const totalChecks = sites.reduce((s, x) => s + x.totalChecks, 0);
  const weightedUptime = totalChecks
    ? sites.reduce((s, x) => s + x.uptimePct * x.totalChecks, 0) / totalChecks
    : 0;
  const weightedAvgMs = totalChecks
    ? Math.round(sites.reduce((s, x) => s + x.avgMs * x.totalChecks, 0) / totalChecks)
    : 0;
  const totalIncidents = sites.reduce((s, x) => s + x.incidents, 0);

  const globalScore = reliabilityScoreFromStats({
    uptimePct: weightedUptime,
    downs: totalIncidents,
    avgMs: weightedAvgMs,
  });

  return {
    rangeDays: 30,
    generatedAt: new Date().toISOString(),
    global: {
      reliabilityScore: globalScore,
      uptimePct: Math.round(weightedUptime * 100) / 100,
      avgMs: weightedAvgMs,
      incidents: totalIncidents,
      sitesCount: sites.length,
    },
    sites,
  };
}

async function ownerIsUltra(orgId) {
  const owner = await User.findOne({ orgId, role: "owner" }).select("plan email");
  const plan = String(owner?.plan || "").toLowerCase();
  return { ultra: plan === "ultra", ownerEmail: owner?.email || "" };
}

// --------------- MAIN ---------------
async function main() {
  console.log("⏱️ monitor-cron started", new Date().toISOString());
  await mongoose.connect(process.env.MONGO_URI);

  // 1) Standard checks run
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

    // smart alerts (UP recovery or DOWN with cooldown)
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

  // 2) Daily summary (only once/day; send only if at least one DOWN in last 24h)
  if (isDailyWindow()) {
    const key = `daily:${dayKeyLocal(new Date())}`;
    const already = await CronRun.findOne({ key });
    if (!already) {
      await CronRun.create({ key });

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const orgIds = await Monitor.distinct("orgId", { active: true });

      let sentDaily = 0;

      for (const orgId of orgIds) {
        const downs = await MonitorLog.find({ orgId, checkedAt: { $gte: since }, status: "down" }).select("url checkedAt error");
        if (!downs.length) continue;

        const rec = await resolveRecipients(orgId);
        if (!rec.to) continue;

        const lines = downs
          .slice(0, 50)
          .map((d) => `- ${fmt(d.checkedAt)} | ${d.url} | ${String(d.error || "-").slice(0, 160)}`)
          .join("\n");

        const subject = `🧾 FlowPoint — Résumé monitoring (24h) — ${rec.orgName}`;
        const text =
          `Organisation: ${rec.orgName}\n` +
          `DOWN events (24h): ${downs.length}\n\n` +
          lines +
          `\n\n(Top 50 affichés)\n`;

        const html =
          `<h2 style="margin:0">🧾 Résumé monitoring (24h)</h2>` +
          `<p><b>Organisation:</b> ${rec.orgName}</p>` +
          `<p><b>DOWN events:</b> ${downs.length}</p>` +
          `<pre style="background:#f6f8ff;padding:12px;border-radius:12px;border:1px solid #e6eaf2;white-space:pre-wrap">${lines}</pre>` +
          `<p style="color:#667085">(Top 50 affichés)</p>`;

        try {
          await sendMail({ to: rec.to, subject, text, html });
          sentDaily++;
        } catch (e) {
          console.log("❌ daily email error:", e.message);
        }
      }

      console.log(`🧾 daily summary done. sent=${sentDaily}`);
    }
  }

  // 3) Monthly reliability report (Ultra only) — once per month window
  if (isMonthlyWindow()) {
    const mk = monthKeyUTC(new Date());
    const key = `monthly:${mk}`;
    const already = await CronRun.findOne({ key });
    if (!already) {
      await CronRun.create({ key });

      const orgIds = await Monitor.distinct("orgId", { active: true });
      let sentMonthly = 0;

      for (const orgId of orgIds) {
        const { ultra } = await ownerIsUltra(orgId);
        if (!ultra) continue;

        const rec = await resolveRecipients(orgId);
        if (!rec.to) continue;

        const org = await Org.findById(orgId).select("name");
        const report = await computeOrgMonthlyReport(orgId);

        const subject = `📈 FlowPoint — Rapport mensuel fiabilité — ${org?.name || rec.orgName}`;
        const top = report.sites.slice(0, 8);

        const text =
          `Organisation: ${org?.name || rec.orgName}\n` +
          `Période: ${report.rangeDays} jours\n` +
          `Score fiabilité: ${report.global.reliabilityScore}/100\n` +
          `Uptime: ${report.global.uptimePct}%\n` +
          `Temps moyen: ${report.global.avgMs}ms\n` +
          `Incidents: ${report.global.incidents}\n\n` +
          top
            .map(
              (s) =>
                `- ${s.url}\n  score=${s.score}/100 uptime=${s.uptimePct}% avg=${s.avgMs}ms incidents=${s.incidents} checks=${s.totalChecks}`
            )
            .join("\n");

        const html =
          `<h2 style="margin:0">📈 Rapport mensuel fiabilité</h2>` +
          `<p style="margin:8px 0"><b>Organisation:</b> ${org?.name || rec.orgName}</p>` +
          `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0">` +
          `<span style="background:#E8F0FF;color:#0052CC;padding:8px 10px;border-radius:999px;font-weight:900">Score: ${report.global.reliabilityScore}/100</span>` +
          `<span style="background:#f3f4f6;color:#0b1220;padding:8px 10px;border-radius:999px;font-weight:900">Uptime: ${report.global.uptimePct}%</span>` +
          `<span style="background:#f3f4f6;color:#0b1220;padding:8px 10px;border-radius:999px;font-weight:900">Avg: ${report.global.avgMs}ms</span>` +
          `<span style="background:#f3f4f6;color:#0b1220;padding:8px 10px;border-radius:999px;font-weight:900">Incidents: ${report.global.incidents}</span>` +
          `</div>` +
          `<div style="border:1px solid #e6eaf2;border-radius:16px;padding:12px;background:#fbfcff">` +
          `<div style="font-weight:900;margin-bottom:8px">Top sites</div>` +
          `<table style="width:100%;border-collapse:collapse;font-size:14px">` +
          `<thead><tr>` +
          `<th style="text-align:left;padding:8px;border-bottom:1px solid #eef2f8">URL</th>` +
          `<th style="text-align:left;padding:8px;border-bottom:1px solid #eef2f8">Score</th>` +
          `<th style="text-align:left;padding:8px;border-bottom:1px solid #eef2f8">Uptime</th>` +
          `<th style="text-align:left;padding:8px;border-bottom:1px solid #eef2f8">Avg</th>` +
          `<th style="text-align:left;padding:8px;border-bottom:1px solid #eef2f8">Incidents</th>` +
          `</tr></thead>` +
          `<tbody>` +
          top
            .map(
              (s) =>
                `<tr>` +
                `<td style="padding:8px;border-bottom:1px solid #eef2f8">${s.url}</td>` +
                `<td style="padding:8px;border-bottom:1px solid #eef2f8"><b>${s.score}/100</b></td>` +
                `<td style="padding:8px;border-bottom:1px solid #eef2f8">${s.uptimePct}%</td>` +
                `<td style="padding:8px;border-bottom:1px solid #eef2f8">${s.avgMs}ms</td>` +
                `<td style="padding:8px;border-bottom:1px solid #eef2f8">${s.incidents}</td>` +
                `</tr>`
            )
            .join("") +
          `</tbody></table>` +
          `</div>` +
          `<p style="color:#667085;margin-top:10px">Ultra only — généré automatiquement.</p>`;

        try {
          await sendMail({ to: rec.to, subject, text, html });
          sentMonthly++;
        } catch (e) {
          console.log("❌ monthly email error:", e.message);
        }
      }

      console.log(`📈 monthly report done. sent=${sentMonthly}`);
    }
  }

  await mongoose.disconnect();
  console.log(`✅ monitor-cron terminé. alertsSent=${alertsSent}`);
}

main().catch((e) => {
  console.log("❌ monitor-cron fatal:", e.message);
  process.exit(1);
});
