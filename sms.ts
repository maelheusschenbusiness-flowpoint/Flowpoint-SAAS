import { logger } from "../lib/logger.js";

const TWILIO_ACCOUNT_SID = process.env["TWILIO_ACCOUNT_SID"];
const TWILIO_AUTH_TOKEN = process.env["TWILIO_AUTH_TOKEN"];
const TWILIO_FROM_PHONE = process.env["TWILIO_FROM_PHONE"];

function isTwilioConfigured(): boolean {
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_PHONE);
}

export async function sendSms(to: string, body: string): Promise<boolean> {
  if (!isTwilioConfigured()) {
    logger.warn({ toMasked: to.slice(0, 5) + "***", bodyLength: body.length }, "[SMS] Twilio not configured — SMS not sent");
    return false;
  }
  try {
    const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
    const params = new URLSearchParams({ To: to, From: TWILIO_FROM_PHONE!, Body: body });
    const credentials = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    if (!res.ok) {
      const errBody = await res.text();
      logger.error({ toMasked: to.slice(0, 5) + "***", status: res.status, errBody }, "[SMS] Twilio API error");
      return false;
    }
    logger.info({ toMasked: to.slice(0, 5) + "***" }, "[SMS] Sent successfully");
    return true;
  } catch (err) {
    logger.error({ err }, "[SMS] Failed to send");
    return false;
  }
}

export function buildMonitorDownSms(monitorName: string, url: string): string {
  return `🔴 ALERTE CRITIQUE : "${monitorName}" est inaccessible.\nURL: ${url}\nVérifiez votre site immédiatement.`;
}

export function buildMonitorUpSms(monitorName: string, url: string, downDuration: string): string {
  return `✅ RÉTABLI : "${monitorName}" est à nouveau en ligne après ${downDuration}.\nURL: ${url}`;
}
