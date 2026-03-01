// seo-daily-cron.js — envoi rapport SEO quotidien (PDF)
require("dotenv").config();
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");

// ✅ Brand
const BRAND_NAME = "FlowPoint";

const Audit = mongoose.model("Audit", new mongoose.Schema({}, { strict: false, collection: "audits" }));
const User = mongoose.model("User", new mongoose.Schema({}, { strict: false, collection: "users" }));

function bool(v) {
  return String(v || "").toLowerCase() === "true";
}

async function sendPdfEmail({ to, subject, pdfBuffer }) {
  // Resend first
  if (process.env.RESEND_API_KEY) {
    const payload = {
      from: process.env.ALERT_EMAIL_FROM,
      to: [to],
      subject,
      html: `
        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial">
          <p>Votre rapport SEO quotidien est en pièce jointe.</p>
          <p style="color:#667085;font-size:12px">— ${BRAND_NAME}</p>
        </div>
      `,
      attachments: [
        {
          filename: "seo-report.pdf",
          content: pdfBuffer.toString("base64"),
        },
      ],
      bcc: process.env.ALERT_EMAIL_TO ? [process.env.ALERT_EMAIL_TO] : undefined,
    };

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.message || `Resend API ${r.status}`);
    return;
  }

  // SMTP fallback
  const t = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: bool(process.env.SMTP_SECURE),
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  await t.sendMail({
    from: process.env.ALERT_EMAIL_FROM,
    to,
    subject,
    text: "Votre rapport SEO quotidien est en pièce jointe.",
    attachments: [{ filename: "seo-report.pdf", content: pdfBuffer }],
  });
}

async function buildPdfForAudits(audits) {
  return await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const chunks = [];

    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ✅ Branding PDF
    doc.fontSize(20).text(`${BRAND_NAME} — Rapport SEO quotidien`);
    doc.moveDown();

    for (const a of audits) {
      doc
        .fontSize(12)
        .text(`${new Date(a.createdAt).toLocaleString("fr-FR")} — ${a.url} — ${a.score}/100`);
    }

    doc.end();
  });
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const users = await User.find({ accessBlocked: false }).limit(5000);

  for (const u of users) {
    if (!u.orgId) continue;

    const audits = await Audit.find({ orgId: u.orgId }).sort({ createdAt: -1 }).limit(5);
    if (!audits.length) continue;

    const pdf = await buildPdfForAudits(audits);

    try {
      await sendPdfEmail({
        to: u.email,
        // ✅ Sujet cohérent et brandé
        subject: `${BRAND_NAME} — Rapport SEO quotidien`,
        pdfBuffer: pdf,
      });
      console.log("✅ SEO PDF envoyé =>", u.email);
    } catch (e) {
      console.log("❌ SEO PDF error =>", u.email, e.message);
    }
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.log("❌ seo-daily-cron fatal:", e.message);
  process.exit(1);
});
