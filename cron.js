// cron.js — FlowPoint AI daily report per ORG (owner + members)
// Run on Render Cron Job (daily at 09:00)

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

// ---------- MINIMAL MODELS (match your collections) ----------
// ✅ IMPORTANT: tes collections sont en FR dans MongoDB Atlas (DB test)
// - organisations
// - utilisateurs
// - moniteurs
// - audits
// - journaux_courriel (pour log d'envoi, optionnel)

const OrgSchema = new mongoose.Schema(
  {
    name: String,
  },
  { timestamps: true, collection: "organisations" }
);

const UserSchema = new mongoose.Schema(
  {
    email: String,
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    role: String,
    plan: String,
    hasTrial: Boolean,
    trialEndsAt: Date,
    accessBlocked: Boolean,
    lastPaymentStatus: String,
    subscriptionStatus: String,
  },
  { timestamps: true, collection: "utilisateurs" }
);

const AuditSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    url: String,
    score: Number,
    status: String,
    createdAt: Date,
  },
  { timestamps: true, collection: "audits" }
);

const MonitorSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    url: String,
    active: Boolean,
    intervalMinutes: Number,
    lastStatus: String,
    lastCheckedAt: Date,
  },
  { timestamps: true, collection: "moniteurs" }
);

// Optionnel: log email (si tu veux tracer)
const MailLogSchema = new mongoose.Schema(
  {
    orgId: { type: mongoose.Schema.Types.ObjectId, index: true },
    day: String,
    to: [String],
    subject: String,
    sentAt: Date,
    ok: Boolean,
    error: String,
  },
  { timestamps: true, collection: "journaux_courriel" }
);

const Org = mongoose.models.Org || mongoose.model("Org", OrgSchema);
const User = mongoose.models.User || mongoose.model("User", UserSchema);
const Audit = mongoose.models.Audit || mongoose.model("Audit", AuditSchema);
const Monitor =
  mongoose.models.Monitor || mongoose.model("Monitor", MonitorSchema);
const MailLog =
  mongoose.models.MailLog || mongoose.model("MailLog", MailLogSchema);

// ---------- MAIN ----------
async function main() {
  console.log("⏱️ Daily cron started:", new Date().toISOString());
  await mongoose.connect(process.env.MONGO_URI);

  // DEBUG utile (peut rester)
  try {
    console.log("🧪 DEBUG DB name:", mongoose.connection.name);
    const cols = await mongoose.connection.db.listCollections().toArray();
    console.log("🧪 DEBUG Collections:", cols.map((c) => c.name));
  } catch (e) {
    console.log("🧪 DEBUG error:", e.message);
  }

  const orgs = await Org.find({}).select("_id name").limit(5000);
  console.log("Organisations :", orgs.length);

  let emailsSent = 0;

  const now = Date.now();
  const in48h = new Date(now + 48 * 60 * 60 * 1000);
  const since24h = new Date(now - 24 * 60 * 60 * 1000);

  for (const org of orgs) {
    // members of org
    const members = await User.find({ orgId: org._id })
      .select(
        "email role plan hasTrial trialEndsAt accessBlocked lastPaymentStatus subscriptionStatus"
      )
      .limit(500);

    const toList = uniqEmails(members.map((m) => m.email));

    if (ADMIN_COPY) toList.push(ADMIN_COPY);
    const to = uniqEmails(toList);
    if (!to.length) continue;

    // org stats
    const totalMembers = members.length;
    const blockedMembers = members.filter((m) => !!m.accessBlocked).length;

    // trials expiring < 48h
    const expiring = members
      .filter(
        (m) =>
          m.hasTrial &&
          m.trialEndsAt &&
          new Date(m.trialEndsAt).getTime() <= in48h.getTime()
      )
      .slice(0, 50);

    // audits last 24h
    const audits24h = await Audit.find({
      orgId: org._id,
      createdAt: { $gte: since24h },
    })
      .sort({ createdAt: -1 })
      .limit(10);

    // monitors state
    const monitors = await Monitor.find({ orgId: org._id })
      .select("url active lastStatus lastCheckedAt intervalMinutes")
      .limit(200);

    const down = monitors
      .filter((m) => m.active && String(m.lastStatus) === "down")
      .slice(0, 30);

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
                `- ${m.url} | lastCheck=${fmt(
                  m.lastCheckedAt
                )} | interval=${m.intervalMinutes}m`
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
                `- ${u.email} | trialEndsAt=${fmt(
                  u.trialEndsAt
                )} | blocked=${!!u.accessBlocked}`
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
                `<li>${u.email} — fin ${fmt(
                  u.trialEndsAt
                )} — blocked=${!!u.accessBlocked}</li>`
            )
            .join("")}</ul>`
        : `<p>Aucun</p>`);

    try {
      await sendMail({ to: to.join(","), subject, text, html });
      emailsSent += 1;

      // log optionnel (ne bloque pas si erreur)
      try {
        await MailLog.create({
          orgId: org._id,
          day: dayKey(),
          to,
          subject,
          sentAt: new Date(),
          ok: true,
          error: "",
        });
      } catch {}
    } catch (e) {
      console.log("❌ Email error org=", org._id.toString(), e.message);

      try {
        await MailLog.create({
          orgId: org._id,
          day: dayKey(),
          to,
          subject,
          sentAt: new Date(),
          ok: false,
          error: String(e.message || e),
        });
      } catch {}
    }
  }

  await mongoose.disconnect();
  console.log("✅ Daily cron terminé. orgEmailsSent=", emailsSent);
}

main().catch((e) => {
  console.log("❌ Daily cron fatal:", e.message);
  process.exit(1);
});
