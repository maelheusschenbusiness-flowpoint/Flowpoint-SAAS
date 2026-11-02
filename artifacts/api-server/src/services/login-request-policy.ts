export const LOGIN_REQUEST_ACCEPTED_RESPONSE = Object.freeze({
  ok: true as const,
  message:
    "Si cette adresse correspond à un compte autorisé, un lien de connexion peut être envoyé. Vérifiez aussi les spams.",
});

type LoginRequestEnv = Readonly<Record<string, string | undefined>>;

export function isLoginEmailAllowed(email: string, env: LoginRequestEnv = process.env): boolean {
  const allowedEmails = env["ALLOWED_EMAILS"];
  const allowedDomain = env["ALLOWED_EMAIL_DOMAIN"];

  if (!allowedEmails && !allowedDomain) return true;

  const normalized = email.toLowerCase().trim();
  if (allowedEmails) {
    const list = allowedEmails.split(",").map(value => value.toLowerCase().trim()).filter(Boolean);
    if (list.includes(normalized)) return true;
  }

  if (allowedDomain) {
    const domain = allowedDomain.toLowerCase().trim();
    if (normalized.endsWith(`@${domain}`)) return true;
  }

  return false;
}

export function hasLoginEmailTransport(env: LoginRequestEnv = process.env): boolean {
  return Boolean(
    env["RESEND_API_KEY"] ||
    (env["SMTP_HOST"] && env["SMTP_PASS"]) ||
    env["TEST_MAIL_DIR"],
  );
}

export function maskEmailForAuthLog(email: string | null | undefined): string {
  if (typeof email !== "string") return "(none)";
  const value = email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) return "(invalid-email)";

  const at = value.lastIndexOf("@");
  return `${value.slice(0, Math.min(at, 2))}***@${value.slice(at + 1)}`;
}

export type LoginEmailFailureCode =
  | "EMAIL_TRANSPORT_MISSING"
  | "DOMAIN_NOT_VERIFIED"
  | "TEST_MAILER_NOT_ENABLED"
  | "EMAIL_SEND_FAILED";

export function loginEmailFailureCode(error: unknown): LoginEmailFailureCode {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("EMAIL_TRANSPORT_MISSING")) return "EMAIL_TRANSPORT_MISSING";
  if (message.startsWith("DOMAIN_NOT_VERIFIED")) return "DOMAIN_NOT_VERIFIED";
  if (message.startsWith("TEST_MAILER_NOT_ENABLED")) return "TEST_MAILER_NOT_ENABLED";
  return "EMAIL_SEND_FAILED";
}
