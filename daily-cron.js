// daily-cron.js — Daily Report (Flowpoint)
require("dotenv").config();
const mongoose = require("mongoose");

// Brand (et surtout: plus de "AI")
const BRAND_NAME = process.env.BRAND_NAME || "Flowpoint";

// --- Models (schemas permissifs) ---
const Org = mongoose.model("Org", new mongoose.Schema({}, { strict: false, collection: "orgs" }));
const User = mongoose.model("User", new mongoose.Schema({}, { strict: false, collection: "users" }));
const Monitor = mongoose.model("Monitor", new mongoose.Schema({}, { strict: false, collection: "monitors" }));

function uniqEmails(list) {
  const set = new Set();
  for (const e of list || []) {
    const v = String(e || "").trim().toLowerCase();
    if (v) set.add(v);
  }
  return [...set];
}

async function sendMailResend({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY manquante");
  if (!process.env.ALERT_EMAIL_FROM) throw new Error("ALERT_EMAIL_FROM manquante");

  const toList = String(to || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const payload = {
    from: process.env.ALERT_EMAIL_FROM,
    to: toList,
    subject,
    html,
    bcc: process.env.ALERT_EMAIL_TO ? [process.env.ALERT_EMAIL_TO] : undefined,
  };

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.message || `Resend API ${r.status}`);
}

async function resolveRecipients(org) {
  const policy = String(org?.alertRecipients || "all").toLowerCase(); // owner | all
  const extra = Array.isArray(org?.alertExtraEmails) ? org.alertExtraEmails : [];
  let base = [];

  if (policy === "owner" && org?.ownerUserId) {
    const owner = await User.findById(org.ownerUserId).select("email");
    if (owner?.email) base.push(owner.email);
  } else {
    const users = await User.find({ orgId: org._id }).select("email");
    base.push(...users.map((u) => u.email).filter(Boolean));
  }

  return uniqEmails([...base, ...extra]).slice(0, 60);
}

async function main() {
  console.log("⏱️ Daily cron started:", new Date().toISOString());
  await mongoose.connect(process.env.MONGO_URI);

  const orgs = await Org.find({}).limit(5000);
  console.log("🏢 Orgs:", orgs.length);

  for (const org of orgs) {
    const recipients = await resolveRecipients(org);
    if (!recipients.length) continue;

    const usersCount = await User.countDocuments({ orgId: org._id });
    const monitorsDown = await Monitor.countDocuments({ orgId: org._id, active: true, lastStatus: "down" });

    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial">
        <h2 style="margin:0">${BRAND_NAME} — Rapport quotidien</h2>
        <p><b>Organisation:</b> ${org.name || "-"}</p>
        <ul>
          <li><b>Users:</b> ${usersCount}</li>
          <li><b>Monitors DOWN:</b> ${monitorsDown}</li>
        </ul>
        <p style="color:#666;font-size:12px">Email envoyé automatiquement.</p>
      </div>
    `;

    await sendMailResend({
      to: recipients.join(","),
      subject: `${BRAND_NAME} — Rapport quotidien — ${org.name || "Organisation"}`,
      html,
    });
  }

  await mongoose.disconnect();
  console.log("✅ Daily cron terminé");
}

main().catch((e) => {
  console.log("❌ Daily cron error:", e.message);
  process.exit(1);
});
