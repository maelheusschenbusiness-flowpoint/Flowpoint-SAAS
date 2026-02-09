// seo-daily-cron.js — envoi rapport SEO quotidien

require("dotenv").config();
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const PDFDocument = require("pdfkit");

const Audit = mongoose.model("Audit", new mongoose.Schema({}, { strict: false }), "audits");
const User = mongoose.model("User", new mongoose.Schema({}, { strict: false }), "users");

async function main() {
  await mongoose.connect(process.env.MONGO_URI);

  const users = await User.find({ accessBlocked: false });

  for (const u of users) {
    const audits = await Audit.find({ orgId: u.orgId }).sort({ createdAt: -1 }).limit(5);
    if (!audits.length) continue;

    const doc = new PDFDocument();
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", async () => {
      const pdf = Buffer.concat(chunks);

      const t = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        secure: false,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      });

      await t.sendMail({
        from: process.env.ALERT_EMAIL_FROM,
        to: u.email,
        subject: "📈 Rapport SEO quotidien",
        attachments: [{ filename: "seo.pdf", content: pdf }]
      });
    });

    doc.text("Rapport SEO quotidien");
    audits.forEach(a => doc.text(`${a.url} — ${a.score}/100`));
    doc.end();
  }

  await mongoose.disconnect();
}

main();
