// cron.js — FlowPoint AI daily report per ORG (owner + members)
// Run on Render Cron Job (daily at 09:00)
//
// IMPORTANT: Render Cron uses UTC for scheduling.
// If you want 09:00 Paris:
// - Winter: 08:00 UTC
// - Summer: 07:00 UTC
// So schedule accordingly in Render.

require("dotenv").config();

const mongoose = require("mongoose");
const nodemailer = require("nodemailer");

// ---------- ENV ----------
const REQUIRED = [
  "MONGO_URI",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "ALERT_EMAIL_FROM",
];

function requiredEnv(k) {
  const v = (process.env[k] || "").trim();
  if (!v) throw new Error(`Missing env var: ${k}`);
  return v;
}

function boolEnv(v) {
  return String(v).toLowerCase() === "true";
}

// optional: admin copy
const ADMIN_COPY = (process.env.ALERT_EMAIL_TO || "").trim();

function mailer() {
  return nodemailer.createTransport({
    host: requiredEnv("SMTP_HOST"),
    port: Number(requiredEnv("SMTP_PORT")),
    secure: boolEnv(requiredEnv("SMTP_SECURE")),
    auth: { user: requiredEnv("SMTP_USER"), pass: requiredEnv("SMTP_PASS") },
  });
}

async function sendMail({ to, subject, text, html }) {
  const t = mailer();
  const info = await t.sendMail({
    from: requiredEnv("ALERT_EMAIL_FROM"),
    to,
    subject,
    text,
    html,
  });
  console.log("✅ Email envoyé:", info.messageId, "=>", to);
}

function uniqEmails(list) {
  const s = new Set();
  for (const e of list) {
    const v = String(e || "").trim().toLowerCase();
    if (v) s.add(v);
  }
  return [...s];
}

function fmt(d) {
  if (!d) return "-";
  try {
    return new Date(d).toLocaleString("fr-FR");
  } catch {
    return String(d);
  }
}

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function pickExistingCollection(db, candidates) {
  const cols = await db.listCollections().toArray();
  const names = new Set(cols.map((c) => c.name));
  for (const c of candidates) {
    if (names.has(c)) return c;
  }
  return null;
}

// ---------- MAIN ----------
async function main() {
  console.log("⏱️ Daily cron started:", new Date().toISOString());

  // Safety: remove quotes/spaces around URI if user pasted with quotes in env
  const rawUri = requiredEnv("MONGO_URI");
  const uri = rawUri.replace(/^"+|"+$/g, "").trim();

  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  // Detect collections (FR/EN)
  const ORG_CANDIDATES = ["organisations", "orgs"];
  const USER_CANDIDATES = ["utilisateurs", "users"];
  const AUDIT_CANDIDATES = ["audits"];
  const MONITOR_CANDIDATES = ["moniteurs", "monitors"];
  const MONITORLOG_CANDIDATES = ["monitorlogs", "journaux_de_surveillance", "journaux_surveillance", "monitor_logs"];
  const EMAILLOG_CANDIDATES = ["journaux_courriel", "email_logs", "emaillogs"];

  const orgCol = await pickExistingCollection(db, ORG_CANDIDATES);
  const userCol = await pickExistingCollection(db, USER_CANDIDATES);
  const auditCol = await pickExistingCollection(db, AUDIT_CANDIDATES);
  const monitorCol = await pickExistingCollection(db, MONITOR_CANDIDATES);
  const monitorLogCol = await pickExistingCollection(db, MONITORLOG_CANDIDATES);
  const emailLogCol = await pickExistingCollection(db, EMAILLOG_CANDIDATES);

  console.log("🧩 Using collections:", {
    orgCol,
    userCol,
    auditCol,
    monitorCol,
    monitorLogCol,
    emailLogCol,
  });

  if (!orgCol) throw new Error("No org collection found (expected organisations or orgs)");
  if (!userCol) throw new Error("No user collection found (expected utilisateurs or users)");

  // Debug DB name
  const dbName = db.databaseName || "(unknown)";
  console.log("🗄️ DB name:", dbName);

  const orgs = await db.collection(orgCol).find({}).project({ _id: 1, name: 1 }).limit(5000).toArray();
  console.log("Organisations:", orgs.length);

  let orgEmailsSent = 0;

  const now = Date.now();
  const in48h = new Date(now + 48 * 60 * 60 * 1000);
  const since24h = new Date(now - 24 * 60 * 60 * 1000);
  const since30d = new Date(now - 30 * 24 * 60 * 60 * 1000);

  for (const org of orgs) {
    // users linked to org — support orgId or organisationId
    const members = await db
      .collection(userCol)
      .find({
        $or: [
          { orgId: org._id },
          { organisationId: org._id },
        ],
      })
      .project({
        email: 1,
        role: 1,
        plan: 1,
        hasTrial: 1,
        trialEndsAt: 1,
        accessBlocked: 1,
        lastPaymentStatus: 1,
        subscriptionStatus: 1,
      })
      .limit(500)
      .toArray();

    const toList = uniqEmails(members.map((m) => m.email));
    if (ADMIN_COPY) toList.push(ADMIN_COPY);
    const to = uniqEmails(toList);
    if (!to.length) continue;

    const totalMembers = members.length;
    const blockedMembers = members.filter((m) => !!m.accessBlocked).length;

    const expiring = members
      .filter((m) => m.hasTrial && m.trialEndsAt && new Date(m.trialEndsAt).getTime() <= in48h.getTime())
      .slice(0, 50);

    // audits last 24h
    let audits24h = [];
    if (auditCol) {
      audits24h = await db
        .collection(auditCol)
        .find({ orgId: org._id, createdAt: { $gte: since24h } })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray();
    }

    // monitors state
    let monitors = [];
    if (monitorCol) {
      monitors = await db
        .collection(monitorCol)
        .find({ orgId: org._id })
        .project({ url: 1, active: 1, lastStatus: 1, lastCheckedAt: 1, intervalMinutes: 1 })
        .limit(200)
        .toArray();
    }
    const down = monitors.filter((m) => m.active && String(m.lastStatus) === "down").slice(0, 30);

    // down logs 24h
    let downLogs24h = [];
    if (monitorLogCol) {
      downLogs24h = await db
        .collection(monitorLogCol)
        .find({ orgId: org._id, checkedAt: { $gte: since24h }, status: "down" })
        .sort({ checkedAt: -1 })
        .limit(30)
        .toArray();
    }

    // monthly emails sent last 30d (optional)
    let monthlyEmailsSent = null;
    if (emailLogCol) {
      monthlyEmailsSent = await db.collection(emailLogCol).countDocuments({ orgId: org._id, createdAt: { $gte: since30d } });
    }

    const subject = `FlowPoint AI — Rapport quotidien (${dayKey()}) — ${org.name || "Organisation"}`;

    const text =
      `Organisation: ${org.name || "Organisation"}\n` +
      `Membres: ${totalMembers}\n` +
      `Membres bloqués: ${blockedMembers}\n` +
      (monthlyEmailsSent === null ? "" : `Emails (30j): ${monthlyEmailsSent}\n`) +
      `\nMonitors DOWN: ${down.length}\n` +
      (down.length
        ? down.map((m) => `- ${m.url} | lastCheck=${fmt(m.lastCheckedAt)} | interval=${m.intervalMinutes}m`).join("\n")
        : "- Aucun") +
      `\n\nAudits (24h): ${audits24h.length}\n` +
      (audits24h.length
        ? audits24h.map((a) => `- ${fmt(a.createdAt)} | ${a.url} | score=${a.score}`).join("\n")
        : "- Aucun") +
      `\n\nTrials expirant < 48h: ${expiring.length}\n` +
      (expiring.length
        ? expiring.map((u) => `- ${u.email} | trialEndsAt=${fmt(u.trialEndsAt)} | blocked=${!!u.accessBlocked}`).join("\n")
        : "- Aucun") +
      `\n\nDown logs (24h): ${downLogs24h.length}\n` +
      (downLogs24h.length
        ? downLogs24h
            .map((l) => `- ${fmt(l.checkedAt)} | ${l.url} | HTTP=${l.httpStatus || "-"} | ${l.responseTimeMs || "-"}ms | ${l.error || "-"}`)
            .join("\n")
        : "- Aucun");

    const html =
      `<h2>FlowPoint AI — Rapport quotidien</h2>` +
      `<p><b>Organisation:</b> ${org.name || "Organisation"}</p>` +
      `<ul>` +
      `<li><b>Membres:</b> ${totalMembers}</li>` +
      `<li><b>Membres bloqués:</b> ${blockedMembers}</li>` +
      (monthlyEmailsSent === null ? "" : `<li><b>Emails (30j):</b> ${monthlyEmailsSent}</li>`) +
      `</ul>` +
      `<h3>Monitors DOWN</h3>` +
      (down.length
        ? `<ul>${down.map((m) => `<li><b>${m.url}</b> — lastCheck ${fmt(m.lastCheckedAt)} — interval ${m.intervalMinutes}m</li>`).join("")}</ul>`
        : `<p>Aucun ✅</p>`) +
      `<h3>Audits (dernières 24h)</h3>` +
      (audits24h.length
        ? `<ul>${audits24h.map((a) => `<li>${fmt(a.createdAt)} — <b>${a.url}</b> — score ${a.score}</li>`).join("")}</ul>`
        : `<p>Aucun</p>`) +
      `<h3>Trials expirant &lt; 48h</h3>` +
      (expiring.length
        ? `<ul>${expiring.map((u) => `<li>${u.email} — fin ${fmt(u.trialEndsAt)} — blocked=${!!u.accessBlocked}</li>`).join("")}</ul>`
        : `<p>Aucun</p>`) +
      `<h3>Logs DOWN (24h)</h3>` +
      (downLogs24h.length
        ? `<ul>${downLogs24h.map((l) => `<li>${fmt(l.checkedAt)} — ${l.url} — HTTP ${l.httpStatus || "-"} — ${l.responseTimeMs || "-"}ms — ${l.error || "-"}</li>`).join("")}</ul>`
        : `<p>Aucun</p>`);

    try {
      await sendMail({ to: to.join(","), subject, text, html });
      orgEmailsSent += 1;
    } catch (e) {
      console.log("❌ Email error org=", String(org._id), e.message);
    }
  }

  await mongoose.disconnect();
  console.log("✅ Daily cron terminé. orgEmailsSent=", orgEmailsSent);
}

main().catch((e) => {
  console.log("❌ Daily cron fatal:", e.message);
  process.exit(1);
});
