import { logger } from "../lib/logger.js";

interface SendSmsResult {
  ok: boolean;
  sid?: string;
  error?: string;
}

function twilioConfigured(): boolean {
  return Boolean(
    process.env["TWILIO_ACCOUNT_SID"] &&
    process.env["TWILIO_AUTH_TOKEN"] &&
    process.env["TWILIO_FROM_NUMBER"]
  );
}

// Sends a real SMS via the Twilio REST API (no SDK dependency required).
// Returns { ok:false, error:"not_configured" } when Twilio credentials are
// missing so callers can surface an honest error instead of a fake success.
export async function sendSms(to: string, body: string): Promise<SendSmsResult> {
  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const authToken = process.env["TWILIO_AUTH_TOKEN"];
  const from = process.env["TWILIO_FROM_NUMBER"];

  if (!sid || !authToken || !from) {
    return { ok: false, error: "not_configured" };
  }

  try {
    const params = new URLSearchParams({ To: to, From: from, Body: body });
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${sid}:${authToken}`).toString("base64")}`,
      },
      body: params.toString(),
    });

    const data = (await resp.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!resp.ok) {
      logger.warn({ status: resp.status, data }, "[sms-service] Twilio send failed");
      return { ok: false, error: data.message ?? `Twilio error ${resp.status}` };
    }
    return { ok: true, sid: data.sid };
  } catch (err) {
    logger.error({ err }, "[sms-service] Twilio request failed");
    return { ok: false, error: "network_error" };
  }
}

export { twilioConfigured };
