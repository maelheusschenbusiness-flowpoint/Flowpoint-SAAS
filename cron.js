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

for (const k of REQUIRED) {
  if (!process.env[k]) console.log("❌ ENV manquante:", k);
}

// optional: admin copy
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

// ---------- COLLECTION AUTO-DETECT ----------
async function pickCollectionName(db, candidates) {
  // db.listCollections() is reliable in Atlas/Render
  const cols = await db.listCollections().toArray();
  const names = new Set(cols.map((c) => c.name));
  for (const c of candidates) {
    if (names.has(c)) return c;
  }
  return null;
}

async function detectCollections(conn) {
  const db = conn.connection.db;
  const cols = await db.listCollections().toArray();
  const list = cols.map((c) => c.name).sort();

  // Candidates (FR + EN + your previous names)
  const orgCandidates = ["orgs", "organisations", "organizations", "organisation"];
  const userCandidates = ["users", "utilisateurs", "user"];
  const auditCandidates = ["audits", "audit"];
  const monitorCandidates = ["monitors", "moniteurs", "monitor"];
  const monitorLogCandidates = ["monitorlogs", "journaux_surveillance", "monitor_logs", "monitorlog"];
  const emailLogCandidates = ["email_logs", "journaux_courriel", "emailLogs", "journaux-courriel"];

  const orgCol = await pickCollectionName(db, orgCandidates);
  const userCol = await pickCollectionName(db, userCandidates);
  const auditCol = await pickCollectionName(db, auditCandidates);
  const monitorCol = await pickCollectionName(db, monitorCandidates);
  const monitorLogCol = await pickCollectionName(db, monitorLogCandidates);
  const emailLogCol = await pickCollectionName(db, emailLogCandidates);

  return {
    dbName: db.databaseName,
    allCollections: list,
    orgCol,
    userCol,
    auditCol,
    monitorCol,
    monitorLogCol,
    emailLogCol,
  };
}

// ---------- MINIMAL MODELS (dynamic collection names) ----------
function makeModels(cols) {
  const OrgSchema = new mongoose.Schema(
    { name: String },
    { timestamps: true, collection: cols.orgCol }
  );

  const UserSchema = new mongoose.Schema(
    {
      email: String,
      orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
      organisationId: { type: mongoose.Schema.Types.ObjectId, index: true },
      role: String,
      plan: String,
      hasTrial: Boolean,
      trialEndsAt: Date,
      accessBlocked: Boolean,
      lastPaymentStatus: String,
      subscriptionStatus: String,
    },
    { timestamps: true, collection: cols.userCol }
  );

  const AuditSchema = new mongoose.Schema(
    {
      orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
      organisationId: { type: mongoose.Schema.Types.ObjectId, index: true },
      url: String,
      score: Number,
      status: String,
      createdAt: Date,
    },
    { timestamps: true, collection: cols.auditCol }
  );

  const MonitorSchema = new mongoose.Schema(
    {
      orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
      organisationId: { type: mongoose.Schema.Types.ObjectId, index: true },
      url: String,
      active: Boolean,
      intervalMinutes: Number,
      lastStatus: String,
      lastCheckedAt: Date,
    },
    { timestamps: true, collection: cols.monitorCol }
  );

  const MonitorLogSchema = new mongoose.Schema(
    {
      orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
      organisationId: { type: mongoose.Schema.Types.ObjectId, index: true },
      monitorId: { type: mongoose.Schema.Types.ObjectId, index: true },
      status: String,
      httpStatus: Number,
      responseTimeMs: Number,
      checkedAt: Date,
      url: String,
      error: String,
    },
    { timestamps: true, collection: cols.monitorLogCol }
  );

  const EmailLogSchema = new mongoose.Schema(
    {
      orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
      organisationId: { type: mongoose.Schema.Types.ObjectId, index: true },
      to: String,
      subject: String,
      sentAt: Date,
      providerId: String,
    },
    { timestamps: true, collection: cols.emailLogCol }
  );

  // Prevent OverwriteModelError on hot reloads
  const Org = mongoose.models.Org || mongoose.model("Org", OrgSchema);
  const User = mongoose.models.User || mongoose.model("User", UserSchema);
  const Audit = mongoose.models.Audit || mongoose.model("Audit", AuditSchema);
  const Monitor = mongoose.models.Monitor || mongoose.model("Monitor", MonitorSchema);
  const MonitorLog = mongoose.models.MonitorLog || mongoose.model("MonitorLog", MonitorLogSchema);
  const EmailLog = mongoose.models.EmailLog || mongoose.model("EmailLog", EmailLogSchema);

  return { Org, User, Audit, Monitor, MonitorLog, EmailLog };
}

// ---------- MAIN ----------
async function main() {
  console.log("⏱️ Daily cron started:", new Date().toISOString());

  // IMPORTANT: MONGO_URI must be EXACT (no quotes, no backticks)
  // Valid: mongodb+srv://... or mongodb://...
  await mongoose.connect(process.env.MONGO_URI);

  const cols = await detectCollections(mongoose);
  console.log("🍀 Using collections:", {
    orgCol: cols.orgCol,
    userCol: cols.userCol,
    auditCol: cols.auditCol,
    monitorCol: cols.monitorCol,
    monitorLogCol: cols.monitorLogCol,
    emailLogCol: cols.emailLogCol,
  });
  console.log("🧪 DB name:", cols.dbName);

  // Hard safety: must have at least org+user collection detected
  if (!cols.orgCol || !cols.userCol) {
    console.log("❌ Impossible: collections ORG/USER introuvables.");
    console.log("Collections détectées:", cols.allCollections);
    await mongoose.disconnect();
    return;
  }

  // Some collections may not exist yet, handle gracefully
  const models = makeModels({
    orgCol: cols.orgCol,
    userCol: cols.userCol,
    auditCol: cols.auditCol || "audits",
    monitorCol: cols.monitorCol || "monitors",
    monitorLogCol: cols.monitorLogCol || "monitorlogs",
    emailLogCol: cols.emailLogCol || "email_logs",
  });

  const { Org, User, Audit, Monitor, MonitorLog, EmailLog } = models;

  const orgs = await Org.find({}).select("_id name").limit(5000);
  console.log("Organisations:", orgs.length);

  let orgEmailsSent = 0;

  const now = Date.now();
  const in48h = new Date(now + 48 * 60 * 60 * 1000);
  const since24h = new Date(now - 24 * 60 * 60 * 1000);

  for (const org of orgs) {
    // users can reference org with orgId OR organisationId depending on older versions
    const members = await User.find({
      $or: [{ orgId: org._id }, { organisationId: org._id }],
    })
      .select("email role plan hasTrial trialEndsAt accessBlocked lastPaymentStatus subscriptionStatus")
      .limit(2000);

    const toList = uniqEmails(members.map((m) => m.email));

    if (ADMIN_COPY) toList.push(ADMIN_COPY);
    const to = uniqEmails(toList);
    if (!to.length) continue;

    const totalMembers = members.length;
    const blockedMembers = members.filter((m) => !!m.accessBlocked).length;

    const expiring = members
      .filter(
        (m) =>
          m.hasTrial &&
          m.trialEndsAt &&
          new Date(m.trialEndsAt).getTime() <= in48h.getTime()
      )
      .slice(0, 50);

    // audits last 24h (if collection exists)
    let audits24h = [];
    try {
      audits24h = await Audit.find({
        $or: [{ orgId: org._id }, { organisationId: org._id }],
        createdAt: { $gte: since24h },
      })
        .sort({ createdAt: -1 })
        .limit(10);
    } catch {}

    // monitors state (if collection exists)
    let monitors = [];
    try {
      monitors = await Monitor.find({
        $or: [{ orgId: org._id }, { organisationId: org._id }],
      })
        .select("url active lastStatus lastCheckedAt intervalMinutes")
        .limit(5000);
    } catch {}

    const down = monitors
      .filter((m) => m.active && String(m.lastStatus) === "down")
      .slice(0, 30);

    // down logs last 24h (if collection exists)
    let downLogs24h = [];
    try {
      downLogs24h = await MonitorLog.find({
        $or: [{ orgId: org._id }, { organisationId: org._id }],
        checkedAt: { $gte: since24h },
        status: "down",
      })
        .sort({ checkedAt: -1 })
        .limit(30);
    } catch {}

    const subject = `FlowPoint AI — Rapport quotidien (${dayKey()}) — ${
      org.name || "Organisation"
    }`;

    const text =
      `Organisation: ${org.name || "Organisation"}\n` +
      `Membres: ${totalMembers}\n` +
      `Membres bloqués: ${blockedMembers}\n\n` +
      `Monitors DOWN: ${down.length}\n` +
      (down.length
        ? down
            .map(
              (m) =>
                `- ${m.url} | lastCheck=${fmt(m.lastCheckedAt)} | interval=${m.intervalMinutes}m`
            )
            .join("\n")
        : "- Aucun") +
      `\n\nAudits (24h): ${audits24h.length}\n` +
      (audits24h.length
        ? audits24h
            .map((a) => `- ${fmt(a.createdAt)} | ${a.url} | score=${a.score}`)
            .join("\n")
        : "- Aucun") +
      `\n\nTrials expirant < 48h: ${expiring.length}\n` +
      (expiring.length
        ? expiring
            .map(
              (u) =>
                `- ${u.email} | trialEndsAt=${fmt(u.trialEndsAt)} | blocked=${!!u.accessBlocked}`
            )
            .join("\n")
        : "- Aucun") +
      `\n\nDown logs (24h): ${downLogs24h.length}\n` +
      (downLogs24h.length
        ? downLogs24h
            .map(
              (l) =>
                `- ${fmt(l.checkedAt)} | ${l.url} | HTTP=${l.httpStatus} | ${l.responseTimeMs}ms | ${
                  l.error || "-"
                }`
            )
            .join("\n")
        : "- Aucun");

    const html =
      `<h2>FlowPoint AI — Rapport quotidien</h2>` +
      `<p><b>Organisation:</b> ${org.name || "Organisation"}</p>` +
      `<ul>` +
      `<li><b>Membres:</b> ${totalMembers}</li>` +
      `<li><b>Membres bloqués:</b> ${blockedMembers}</li>` +
      `</ul>` +
      `<h3>Monitors DOWN</h3>` +
      (down.length
        ? `<ul>${down
            .map(
              (m) =>
                `<li><b>${m.url}</b> — lastCheck ${fmt(
                  m.lastCheckedAt
                )} — interval ${m.intervalMinutes}m</li>`
            )
            .join("")}</ul>`
        : `<p>Aucun ✅</p>`) +
      `<h3>Audits (dernières 24h)</h3>` +
      (audits24h.length
        ? `<ul>${audits24h
            .map(
              (a) =>
                `<li>${fmt(a.createdAt)} — <b>${a.url}</b> — score ${a.score}</li>`
            )
            .join("")}</ul>`
        : `<p>Aucun</p>`) +
      `<h3>Trials expirant &lt; 48h</h3>` +
      (expiring.length
        ? `<ul>${expiring
            .map(
              (u) =>
                `<li>${u.email} — fin ${fmt(u.trialEndsAt)} — blocked=${!!u.accessBlocked}</li>`
            )
            .join("")}</ul>`
        : `<p>Aucun</p>`) +
      `<h3>Logs DOWN (24h)</h3>` +
      (downLogs24h.length
        ? `<ul>${downLogs24h
            .map(
              (l) =>
                `<li>${fmt(l.checkedAt)} — ${l.url} — HTTP ${l.httpStatus} — ${l.responseTimeMs}ms — ${
                  l.error || "-"
                }</li>`
            )
            .join("")}</ul>`
        : `<p>Aucun</p>`);

    try {
      const toCsv = uniqEmails(to).join(",");
      await sendMail({ to: toCsv, subject, text, html });

      // optional log in DB if collection exists
      try {
        await EmailLog.create({
          orgId: org._id,
          to: toCsv,
          subject,
          sentAt: new Date(),
        });
      } catch {}

      orgEmailsSent += 1;
    } catch (e) {
      console.log("❌ Email error org=", org._id.toString(), e.message);
    }
  }

  await mongoose.disconnect();
  console.log("✅ Daily cron terminé. orgEmailsSent=", orgEmailsSent);
}

main().catch((e) => {
  console.log("❌ Daily cron fatal:", e.message);
  process.exit(1);
});
