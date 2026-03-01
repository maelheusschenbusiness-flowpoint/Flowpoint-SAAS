// daily-cron.js — FlowPoint Daily Report
// Node 18+ => fetch disponible
require("dotenv").config();
const mongoose = require("mongoose");

// ✅ Brand
const BRAND_NAME = "FlowPoint";

const REQUIRED = ["MONGO_URI", "ALERT_EMAIL_FROM", "RESEND_API_KEY"]; // on utilise Resend ici
for (const k of REQUIRED) {
  if (!process.env[k]) console.log("❌ ENV manquante:", k);
}

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

  const all = uniqEmails([...base, ...extra]);
  return all.slice(0, 60); // sécurité
}

function logoBlockHTML() {
  // ✅ Carré bleu + éclair blanc (comme ton header / photo)
  return `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
      <div style="width:44px;height:44px;border-radius:14px;background:#2F6BFF;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 24px rgba(47,107,255,.22), inset 0 0 0 1px rgba(255,255,255,.18);">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M13 2L4 14h7l-1 8 10-14h-7l0-6Z"
                stroke="#fff" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>
      </div>
      <div>
        <div style="color:#0f172a;font-weight:800;font-size:18px;line-height:1">${BRAND_NAME}</div>
        <div style="color:#667085;font-size:13px">Rapport automatique</div>
      </div>
    </div>
  `;
}

async function sendMailResend({ to, subject, html }) {
  if (!process.env.RESEND_API_KEY) throw new Error("RESEND_API_KEY manquante");

  const toList = String(to || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const payload = {
    from: process.env.ALERT_EMAIL_FROM,
    to: toList,
    subject,
    html,
    // BCC optionnel admin
    bcc: process.env.ALERT_EMAIL_TO ? [String(process.env.ALERT_EMAIL_TO).trim()] : undefined,
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

function buildDailyHtml({ orgName, usersCount, monitorsDown }) {
  return `
  <div style="background:#f6f7fb;padding:28px 16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:18px;padding:22px;border:1px solid rgba(15,23,42,.08)">
      ${logoBlockHTML()}
      <h2 style="margin:10px 0 8px;color:#0f172a;font-size:18px">${BRAND_NAME} — Rapport quotidien</h2>

      <div style="color:#667085;font-size:14px;line-height:1.55">
        <p style="margin:0 0 10px;"><b>Organisation :</b> ${orgName || "-"}</p>

        <div style="border:1px solid rgba(15,23,42,.10);border-radius:14px;padding:12px 14px;background:rgba(15,23,42,.02)">
          <ul style="margin:0;padding-left:18px">
            <li><b>Users :</b> ${usersCount}</li>
            <li><b>Monitors DOWN :</b> ${monitorsDown}</li>
          </ul>
        </div>

        <p style="margin:14px 0 0;color:#98a2b3;font-size:12px">
          Email envoyé automatiquement.
        </p>
      </div>

      <div style="margin-top:18px;padding-top:14px;border-top:1px solid rgba(15,23,42,.08);color:#98a2b3;font-size:12px">
        © ${new Date().getFullYear()} ${BRAND_NAME}
      </div>
    </div>
  </div>
  `;
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

    const orgName = org?.name || "Organisation";
    const html = buildDailyHtml({ orgName, usersCount, monitorsDown });

    await sendMailResend({
      to: recipients.join(","),
      subject: `${BRAND_NAME} — Rapport quotidien — ${orgName}`,
      html,
    });

    console.log("✅ Daily report envoyé =>", orgName, "(", recipients.length, "recipients )");
  }

  await mongoose.disconnect();
  console.log("✅ Daily cron terminé");
}

main().catch((e) => {
  console.log("❌ Daily cron error:", e.message);
  process.exit(1);
});
