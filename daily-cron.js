// daily-cron.js — FlowPoint AI daily org reports (Render Cron Job)
// Envoie 1 rapport / org. Copie admin optionnelle en BCC.
// IMPORTANT: configure SMTP_* + ALERT_EMAIL_FROM sur Render Cron Job.

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

// Copie admin (BCC) — tu peux garder ALERT_EMAIL_TO=maelheusschen.business@gmail.com
// Mode: "always" | "never" | "nonprod"
const ADMIN_COPY_EMAIL = (process.env.ALERT_EMAIL_TO || "").trim();
const ADMIN_COPY_MODE = (process.env.ADMIN_COPY_MODE || "nonprod").trim().toLowerCase();
const NODE_ENV = (process.env.NODE_ENV || "production").trim().toLowerCase();

function boolEnv(v) {
  return String(v).toLowerCase() === "true";
}

function shouldBccAdmin() {
  if (!ADMIN_COPY_EMAIL) return false;
  if (ADMIN_COPY_MODE === "never") return false;
  if (ADMIN_COPY_MODE === "always") return true;
  // default: nonprod
  return NODE_ENV !== "production";
}

function mailer() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: boolEnv(process.env.SMTP_SECURE),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },

    // évite les timeouts longs
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

async function sendMail({ to, subject, text, html }) {
  const t = mailer();

  const mail = {
    from: process.env.ALERT_EMAIL_FROM,
    to,
    subject,
    text,
    html,
  };

  // ✅ Copie admin en BCC (les clients ne voient pas ton email)
  if (shouldBccAdmin()) {
    mail.bcc = ADMIN_COPY_EMAIL;
  }

  const info = await t.sendMail(mail);
  console.log("✅ Daily email envoyé:", info.messageId, "=> to:", to, "bccAdmin:", !!mail.bcc);
}

// --------------- DB MODELS (minimal) ---------------
const OrgSchema = new mongoose.Schema(
  {
    name: String,
    alertRecipients: { type: String, default: "all" }, // owner | all
    alertExtraEmails: { type: [String], default: [] },
  },
  { timestamps: true, collection: "orgs" }
);

const UserSchema = new mongoose.Schema(
  {
    email: String,
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    role: String, // owner/member
    plan: String,
    hasTrial: Boolean,
    trialEndsAt: Date,
    accessBlocked: Boolean,
  },
  { timestamps: true, collection: "users" }
);

const MonitorSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    url: String,
    active: Boolean,
    lastStatus: String, // up/down/unknown
    lastCheckedAt: Date,
  },
  { timestamps: true, collection: "monitors" }
);

const AuditSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    url: String,
    status: String,
    score: Number,
    createdAt: Date,
  },
  { timestamps: true, collection: "audits" }
);

const Org = mongoose.model("Org", OrgSchema);
const User = mongoose.model("User", UserSchema);
const Monitor = mongoose.model("Monitor", MonitorSchema);
const Audit = mongoose.model("Audit", AuditSchema);

// --------------- HELPERS ---------------
function uniqEmails(list) {
  const set = new Set();
  for (const e of list || []) {
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

async function resolveRecipients(orgId) {
  const org = await Org.findById(orgId).select("alertRecipients alertExtraEmails name");
  const policy = String(org?.alertRecipients || "all").toLowerCase();

  let users;
  if (policy === "owner") users = await User.find({ orgId, role: "owner" }).select("email");
  else users = await User.find({ orgId }).select("email");

  const base = uniqEmails(users.map((u) => u.email));
  const extra = uniqEmails(org?.alertExtraEmails || []);

  // ✅ TO = uniquement clients (base + extra)
  const toList = uniqEmails([...base, ...extra]);

  return {
    to: toList.join(","),
    orgName: org?.name || "Organisation",
    policy,
    count: toList.length,
  };
}

// --------------- MAIN ---------------
async function main() {
  console.log("⏱️ daily-cron started", new Date().toISOString(), "NODE_ENV=", NODE_ENV, "ADMIN_COPY_MODE=", ADMIN_COPY_MODE);

  await mongoose.connect(process.env.MONGO_URI);

  const orgs = await Org.find({}).select("_id name").limit(5000);
  console.log("🏢 Orgs:", orgs.length);

  const now = Date.now();
  const in48h = new Date(now + 48 * 60 * 60 * 1000);

  for (const org of orgs) {
    const rec = await resolveRecipients(org._id);
    if (!rec.to) continue;

    const totalUsers = await User.countDocuments({ orgId: org._id });
    const blockedUsers = await User.countDocuments({ orgId: org._id, accessBlocked: true });

    const downMonitors = await Monitor.find({
      orgId: org._id,
      active: true,
      lastStatus: "down",
    }).select("url lastCheckedAt");

    const recentAudits = await Audit.find({ orgId: org._id })
      .sort({ createdAt: -1 })
      .limit(5)
      .select("url status score createdAt");

    const expiringTrials = await User.find({
      orgId: org._id,
      hasTrial: true,
      trialEndsAt: { $exists: true, $lte: in48h },
    })
      .select("email plan trialEndsAt accessBlocked")
      .limit(50);

    const subject = `FlowPoint AI — Rapport quotidien (${new Date().toISOString().slice(0, 10)}) — ${rec.orgName}`;

    const text =
      `Organisation: ${rec.orgName}\n` +
      `RecipientsPolicy: ${rec.policy}\n\n` +
      `Users: ${totalUsers}\n` +
      `Blocked: ${blockedUsers}\n\n` +
      `Monitors DOWN: ${downMonitors.length}\n` +
      downMonitors.map((m) => `- ${m.url} (lastCheck: ${fmt(m.lastCheckedAt)})`).join("\n") +
      `\n\nDerniers audits:\n` +
      recentAudits.map((a) => `- ${fmt(a.createdAt)} | ${a.url} | ${a.status} | score=${a.score}`).join("\n") +
      `\n\nTrials expirant < 48h:\n` +
      (expiringTrials.length
        ? expiringTrials.map((u) => `- ${u.email} | ${u.plan} | ${fmt(u.trialEndsAt)} | blocked=${!!u.accessBlocked}`).join("\n")
        : "- Aucun");

    const html =
      `<h2 style="margin:0">FlowPoint AI — Rapport quotidien</h2>` +
      `<p style="margin:8px 0"><b>Organisation:</b> ${rec.orgName}</p>` +
      `<p style="margin:8px 0"><b>RecipientsPolicy:</b> ${rec.policy} (${rec.count} emails)</p>` +
      `<hr/>` +
      `<ul>` +
      `<li><b>Users:</b> ${totalUsers}</li>` +
      `<li><b>Blocked:</b> ${blockedUsers}</li>` +
      `</ul>` +
      `<h3>Monitors DOWN (${downMonitors.length})</h3>` +
      (downMonitors.length
        ? `<ul>${downMonitors.map((m) => `<li><b>${m.url}</b> — lastCheck: ${fmt(m.lastCheckedAt)}</li>`).join("")}</ul>`
        : `<p>Aucun monitor DOWN ✅</p>`) +
      `<h3>Derniers audits</h3>` +
      (recentAudits.length
        ? `<ul>${recentAudits
            .map((a) => `<li>${fmt(a.createdAt)} — <b>${a.url}</b> — ${a.status} — score=${a.score}</li>`)
            .join("")}</ul>`
        : `<p>Aucun audit récent</p>`) +
      `<h3>Trials expirant &lt; 48h</h3>` +
      (expiringTrials.length
        ? `<ul>${expiringTrials
            .map((u) => `<li>${u.email} — ${u.plan} — ${fmt(u.trialEndsAt)} — blocked=${!!u.accessBlocked}</li>`)
            .join("")}</ul>`
        : `<p>Aucun</p>`);

    await sendMail({ to: rec.to, subject, text, html });
  }

  await mongoose.disconnect();
  console.log("✅ daily-cron terminé");
}

main().catch((e) => {
  console.log("❌ daily-cron fatal:", e.message);
  process.exit(1);
});
