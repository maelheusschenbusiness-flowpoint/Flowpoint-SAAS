import { logger } from "../lib/logger.js";

type EmailOptions = {
  to: string;
  subject: string;
  html: string;
};

async function getTransport() {
  const nodemailer = await import("nodemailer");
  const host = process.env["SMTP_HOST"];
  const port = parseInt(process.env["SMTP_PORT"] || "587", 10);
  const user = process.env["SMTP_USER"];
  const pass = process.env["SMTP_PASS"];

  if (!host || !user || !pass) {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendEmail(opts: EmailOptions): Promise<boolean> {
  try {
    const transport = await getTransport();
    if (!transport) {
      logger.warn({ to: opts.to, subject: opts.subject }, "[Email] SMTP not configured — logging email instead");
      logger.info({ email: opts }, "[Email] Would have sent:");
      return false;
    }
    const from = process.env["SMTP_FROM"] || process.env["SMTP_USER"] || "noreply@flowpoint.pro";
    await transport.sendMail({ from, ...opts });
    logger.info({ to: opts.to, subject: opts.subject }, "[Email] Sent successfully");
    return true;
  } catch (err) {
    logger.error({ err }, "[Email] Failed to send");
    return false;
  }
}

export function buildMonitorDownEmail(monitorName: string, url: string): { subject: string; html: string } {
  const now = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
  return {
    subject: `🔴 ALERTE : ${monitorName} est inaccessible`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f172a;color:#e2e8f0;border-radius:12px;overflow:hidden">
        <div style="background:#ef4444;padding:24px 32px">
          <h1 style="margin:0;font-size:22px;font-weight:800;color:#fff">🔴 Monitor DOWN</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px">Alerte générée par Flowpoint</p>
        </div>
        <div style="padding:32px">
          <p style="font-size:16px;font-weight:700;color:#fff;margin:0 0 8px">Site inaccessible détecté</p>
          <p style="font-size:14px;color:#94a3b8;margin:0 0 24px">Votre monitor a détecté que le site suivant est inaccessible :</p>
          <div style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:16px;margin-bottom:24px">
            <div style="font-size:13px;color:#94a3b8;margin-bottom:4px">Monitor</div>
            <div style="font-size:16px;font-weight:700;color:#fff;margin-bottom:12px">${monitorName}</div>
            <div style="font-size:13px;color:#94a3b8;margin-bottom:4px">URL</div>
            <div style="font-size:14px;color:#60a5fa">${url}</div>
            <div style="font-size:13px;color:#94a3b8;margin-top:12px;margin-bottom:4px">Détecté à</div>
            <div style="font-size:14px;color:#fff">${now}</div>
          </div>
          <a href="${url}" style="display:inline-block;background:#2563EB;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">Vérifier le site</a>
          <p style="font-size:12px;color:#475569;margin-top:32px">Cet email a été envoyé automatiquement par <strong>Flowpoint Dashboard</strong>.<br>Pour gérer vos alertes, connectez-vous à votre tableau de bord.</p>
        </div>
      </div>
    `,
  };
}

export function buildMonitorUpEmail(monitorName: string, url: string, downDuration: string): { subject: string; html: string } {
  const now = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
  return {
    subject: `✅ RÉTABLI : ${monitorName} est à nouveau accessible`,
    html: `
      <div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;background:#0f172a;color:#e2e8f0;border-radius:12px;overflow:hidden">
        <div style="background:#22c55e;padding:24px 32px">
          <h1 style="margin:0;font-size:22px;font-weight:800;color:#fff">✅ Monitor UP</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.85);font-size:14px">Service rétabli — Flowpoint</p>
        </div>
        <div style="padding:32px">
          <p style="font-size:16px;font-weight:700;color:#fff;margin:0 0 8px">${monitorName} est à nouveau en ligne</p>
          <div style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:16px;margin-bottom:24px">
            <div style="font-size:13px;color:#94a3b8;margin-bottom:4px">URL</div>
            <div style="font-size:14px;color:#60a5fa;margin-bottom:12px">${url}</div>
            <div style="font-size:13px;color:#94a3b8;margin-bottom:4px">Rétabli à</div>
            <div style="font-size:14px;color:#fff;margin-bottom:12px">${now}</div>
            <div style="font-size:13px;color:#94a3b8;margin-bottom:4px">Durée de l'incident</div>
            <div style="font-size:14px;color:#f59e0b">${downDuration}</div>
          </div>
        </div>
      </div>
    `,
  };
}
