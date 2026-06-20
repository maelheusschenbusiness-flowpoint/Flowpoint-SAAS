import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { store } from "../services/store.js";
import { logger } from "../lib/logger.js";
import { createSession, deleteSession, getSession, SESSION_TTL_MS } from "../services/sessions.js";
import { authRateLimit } from "../middlewares/rateLimiter.js";
import { Resend } from "resend";
import { pool } from "@workspace/db";

const router = Router();

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

// ── PostgreSQL-backed magic link tokens ───────────────────────────────────────

async function storeMagicToken(token: string, email: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO magic_link_tokens (token, email, expires_at, used)
       VALUES ($1, $2, $3, false)
       ON CONFLICT (token) DO NOTHING`,
      [token, email, expiresAt]
    );
  } finally {
    client.release();
  }
}

async function getMagicToken(token: string): Promise<{ email: string; used: boolean } | null> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT email, used FROM magic_link_tokens
       WHERE token = $1 AND expires_at > NOW() LIMIT 1`,
      [token]
    );
    if (!res.rows[0]) return null;
    return { email: res.rows[0].email as string, used: res.rows[0].used as boolean };
  } finally {
    client.release();
  }
}

async function consumeMagicToken(token: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE magic_link_tokens SET used = true WHERE token = $1`,
      [token]
    );
  } finally {
    client.release();
  }
}

/**
 * Allowlist check.
 * Set ALLOWED_EMAILS (comma-separated) or ALLOWED_EMAIL_DOMAIN on Render.
 * If neither is set, all emails are allowed (open mode — email delivery is the gating factor).
 */
function isEmailAllowed(email: string): boolean {
  const allowedEmails = process.env["ALLOWED_EMAILS"];
  const allowedDomain = process.env["ALLOWED_EMAIL_DOMAIN"];

  if (!allowedEmails && !allowedDomain) {
    return true; // Open mode — anyone who receives the email can log in
  }

  const normalized = email.toLowerCase().trim();

  if (allowedEmails) {
    const list = allowedEmails.split(",").map(e => e.toLowerCase().trim()).filter(Boolean);
    if (list.includes(normalized)) return true;
  }

  if (allowedDomain) {
    const domain = allowedDomain.toLowerCase().trim();
    if (normalized.endsWith(`@${domain}`)) return true;
  }

  return false;
}

function getPublicUrl(): string {
  return (
    process.env["PUBLIC_BASE_URL"] ||
    process.env["PUBLIC_URL"] ||
    ""
  ).replace(/\/$/, "");
}

async function sendMagicEmail(email: string, link: string): Promise<void> {
  const resendKey = process.env["RESEND_API_KEY"];
  if (!resendKey) {
    logger.warn("[Auth] RESEND_API_KEY not set — cannot send magic link");
    throw new Error("RESEND_API_KEY_MISSING");
  }

  // Prefer verified custom domain; fall back to Resend's shared sender (works without domain verification)
  const fromEmail =
    process.env["FROM_EMAIL"] ||
    process.env["ALERT_EMAIL_FROM"] ||
    process.env["EMAIL_FROM"] ||
    "FlowPoint <onboarding@resend.dev>";

  logger.info({
    email,
    from: fromEmail,
    publicBaseUrl: process.env["PUBLIC_BASE_URL"] || "(not set)",
    resendKeyPresent: true,
  }, "[Auth] Sending magic link email");

  const resend = new Resend(resendKey);
  let result: Awaited<ReturnType<typeof resend.emails.send>>;

  try {
    result = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: "Votre lien de connexion FlowPoint",
      html: `<!DOCTYPE html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="light dark"/>
  <meta name="supported-color-schemes" content="light dark"/>
  <title>Connexion FlowPoint</title>
  <style>
    :root { color-scheme: light dark; }

    /* ── Dark mode overrides ──────────────────────────────────────────── */
    @media (prefers-color-scheme: dark) {
      .email-body   { background-color: #0d0f1a !important; }
      .email-card   { background-color: #13162a !important; border-color: #252a45 !important; }
      .email-header { background-color: #0f172a !important; border-bottom-color: #1e293b !important; }
      .email-footer { background-color: #0a0c1c !important; border-top-color: #252a45 !important; }
      .text-main    { color: #e8eeff !important; }
      .text-muted   { color: #8891b8 !important; }
      .text-footer  { color: #5a6380 !important; }
      .link-footer  { color: #6c7aff !important; }
      .divider      { border-color: #252a45 !important; }
      .copy-block   { background-color: #0d0f1a !important; border-color: #252a45 !important; color: #8891b8 !important; }
      .logo-text    { color: #f1f5f9 !important; }
      .logo-sub     { color: #94a3b8 !important; }
    }
  </style>
</head>
<body class="email-body" style="margin:0;padding:0;background-color:#f0f2fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">

  <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <!-- Card -->
        <table class="email-card" width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation"
               style="max-width:560px;background-color:#ffffff;border-radius:16px;border:1px solid #dde1f0;overflow:hidden;">

          <!-- Header -->
          <tr>
            <td class="email-header" style="background-color:#EEF4FF;border-bottom:1px solid #DCE7FF;padding:32px 40px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
                <tr>
                  <td>
                    <!-- Wordmark -->
                    <div style="display:inline-flex;align-items:center;">
                      <!-- SVG logo -->
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="36" height="36" style="display:inline-block;vertical-align:middle;flex-shrink:0;">
                        <defs><linearGradient id="fpg" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#2563EB"/><stop offset="100%" stop-color="#4F46E5"/></linearGradient></defs>
                        <rect x="0" y="0" width="48" height="48" rx="10" ry="10" fill="url(#fpg)"/>
                        <g transform="translate(12, 12)" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                        </g>
                      </svg>
                      <span class="logo-text" style="margin-left:16px;font-size:22px;font-weight:500;color:#0f172a;letter-spacing:-.02em;vertical-align:middle;">FlowPoint</span>
                    </div>
                    <div class="logo-sub" style="margin-top:8px;font-size:11px;color:#64748B;letter-spacing:.08em;text-transform:uppercase;font-weight:500;">SEO · MONITORING · IA LOCALE</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">

              <!-- Eyebrow -->
              <div style="display:inline-block;background:#eff2ff;border:1px solid #c7d0ff;border-radius:6px;padding:4px 12px;font-size:11px;font-weight:700;color:#3d6bff;letter-spacing:.06em;text-transform:uppercase;margin-bottom:20px;">Lien de connexion</div>

              <!-- Title -->
              <h1 class="text-main" style="margin:0 0 12px;font-size:26px;font-weight:800;color:#0d0f1a;letter-spacing:-.03em;line-height:1.2;">Connecte-toi à FlowPoint</h1>

              <!-- Body copy -->
              <p class="text-muted" style="margin:0 0 32px;font-size:15px;color:#4a5280;line-height:1.65;">
                Clique sur le bouton ci-dessous pour accéder à ton espace. Ce lien est valide <strong style="color:#0d0f1a;">15&nbsp;minutes</strong> et ne peut être utilisé qu'une seule fois.
              </p>

              <!-- CTA -->
              <table cellpadding="0" cellspacing="0" border="0" role="presentation" style="margin-bottom:32px;">
                <tr>
                  <td style="border-radius:10px;background:linear-gradient(135deg,#3d6bff 0%,#1a3de8 100%);">
                    <a href="${link}"
                       style="display:inline-block;padding:15px 36px;border-radius:10px;background:linear-gradient(135deg,#3d6bff 0%,#1a3de8 100%);color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:-.01em;white-space:nowrap;">
                      Se connecter →
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Fallback link -->
              <p class="text-muted" style="margin:0 0 8px;font-size:13px;color:#6878b0;">Bouton qui ne fonctionne pas ? Copie ce lien dans ton navigateur :</p>
              <div class="copy-block" style="background:#f5f6fc;border:1px solid #dde1f0;border-radius:8px;padding:10px 14px;font-size:12px;color:#6878b0;word-break:break-all;line-height:1.5;font-family:'Courier New',monospace;">
                ${link}
              </div>

              <!-- Divider -->
              <hr class="divider" style="border:none;border-top:1px solid #eaedf5;margin:28px 0;"/>

              <!-- Security note -->
              <p class="text-muted" style="margin:0;font-size:13px;color:#8891b8;line-height:1.6;">
                🔒 Si tu n'as pas demandé ce lien, ignore cet e-mail — ton compte est en sécurité. Ce lien expirera automatiquement.
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="email-footer" style="background-color:#f7f8fd;border-top:1px solid #eaedf5;padding:24px 40px;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" role="presentation">
                <tr>
                  <td>
                    <p class="text-footer" style="margin:0 0 6px;font-size:12px;color:#9aa0c0;line-height:1.5;">
                      <a class="link-footer" href="https://flowpoint.pro" style="color:#3d6bff;text-decoration:none;font-weight:600;">flowpoint.pro</a>
                      &nbsp;·&nbsp;
                      <a class="link-footer" href="https://app.flowpoint.pro" style="color:#3d6bff;text-decoration:none;">Dashboard</a>
                      &nbsp;·&nbsp;
                      <a class="link-footer" href="mailto:support@flowpoint.pro" style="color:#3d6bff;text-decoration:none;">Support</a>
                    </p>
                    <p class="text-footer" style="margin:0;font-size:11px;color:#b0b6cc;">
                      © ${new Date().getFullYear()} FlowPoint. Tous droits réservés.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>
        <!-- /Card -->

      </td>
    </tr>
  </table>

</body>
</html>`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg, email, from: fromEmail }, "[Auth] Resend threw unexpected error");
    throw new Error("EMAIL_SEND_FAILED: " + msg);
  }

  if (result.error) {
    const errName = (result.error as { name?: string }).name || "";
    const errMsg  = (result.error as { message?: string }).message || JSON.stringify(result.error);
    logger.error({ error: result.error, email, from: fromEmail }, "[Auth] Resend API returned error");

    // Surface a specific message for domain-verification failures
    if (
      errName.includes("domain") ||
      errName.includes("validation") ||
      errMsg.toLowerCase().includes("domain") ||
      errMsg.toLowerCase().includes("not verified") ||
      errMsg.toLowerCase().includes("sender")
    ) {
      throw new Error("DOMAIN_NOT_VERIFIED: " + errMsg);
    }
    throw new Error("RESEND_ERROR: " + errMsg);
  }

  logger.info({ email, id: result.data?.id, from: fromEmail }, "[Auth] Magic link email delivered");
}

router.post("/auth/login-request", authRateLimit, async (req: Request, res: Response) => {
  const rawEmail = (req.body as { email?: string } | undefined)?.email;

  // ── Entry diagnostic log — always visible in Render logs ─────────────────────
  logger.info({
    emailReceived: rawEmail ? String(rawEmail).replace(/(.{2}).+(@.+)/, "$1***$2") : "(none)",
    fromEmail: process.env["FROM_EMAIL"] || process.env["RESEND_FROM"] || process.env["ALERT_EMAIL_FROM"] || process.env["EMAIL_FROM"] || "(fallback: onboarding@resend.dev)",
    publicBaseUrl: process.env["PUBLIC_BASE_URL"] || process.env["PUBLIC_URL"] || "(not set)",
    resendKeyPresent: !!(process.env["RESEND_API_KEY"]),
    databaseUrlPresent: !!(process.env["DATABASE_URL"]),
    allowedEmails: process.env["ALLOWED_EMAILS"] ? "(set)" : "(not set — open mode)",
    nodeEnv: process.env["NODE_ENV"] || "(not set)",
  }, "[Auth] login-request received");

  if (!rawEmail || !String(rawEmail).includes("@")) {
    res.status(400).json({ error: "Email valide requis" });
    return;
  }

  const email = String(rawEmail).toLowerCase().trim();

  if (!isEmailAllowed(email)) {
    logger.warn({ email }, "[Auth] Login rejected — email not on allowlist");
    res.json({ ok: true, message: "Si cette adresse est autorisée, vous recevrez un lien par email." });
    return;
  }

  // ── Store token in PostgreSQL (survives Render restarts) ──────────────────────
  const token = generateToken();
  const publicUrl = getPublicUrl();
  const verifyPath = `${publicUrl}/login-verify.html?token=${token}`;

  try {
    await storeMagicToken(token, email);
    logger.info({ email }, "[Auth] Magic token stored in PostgreSQL");
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    logger.error({ err: msg, email }, "[Auth] DB error — cannot store magic token");
    res.status(500).json({ error: "Impossible de créer le lien de connexion\u00a0: base de données indisponible." });
    return;
  }

  // ── Send via Resend ───────────────────────────────────────────────────────────
  const resendKey = process.env["RESEND_API_KEY"];
  const isProduction = process.env["NODE_ENV"] === "production";

  if (resendKey) {
    try {
      await sendMagicEmail(email, verifyPath);
      logger.info({ email }, "[Auth] login-request: magic link sent successfully");
      res.json({ ok: true, message: "Lien de connexion envoyé par email." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, email }, "[Auth] login-request: Resend failed");

      if (msg.startsWith("RESEND_API_KEY_MISSING")) {
        res.status(503).json({ error: "Service email non configuré." });
      } else if (msg.startsWith("DOMAIN_NOT_VERIFIED")) {
        res.status(500).json({ error: "Impossible d\u2019envoyer l\u2019e-mail\u00a0: configuration Resend invalide (domaine expéditeur non vérifié)." });
      } else {
        res.status(500).json({ error: "Impossible d\u2019envoyer l\u2019e-mail\u00a0: " + msg.substring(0, 120) });
      }
    }
    return;
  }

  if (!isProduction) {
    logger.warn({ email, debugLink: verifyPath }, "[Auth] No RESEND_API_KEY — returning debugLink");
    res.json({ ok: true, debugLink: verifyPath, message: "Mode debug\u00a0: lien retourné directement." });
  } else {
    logger.error("[Auth] RESEND_API_KEY not set in production");
    res.status(503).json({ error: "Service email non configuré. Connectez-vous avec Google." });
  }
});

router.post("/auth/register", authRateLimit, async (req: Request, res: Response) => {
  const { email, firstName, companyName, plan } = req.body as { email?: string; firstName?: string; companyName?: string; plan?: string };

  if (!email || !String(email).includes("@")) {
    res.status(400).json({ error: "Email valide requis" });
    return;
  }

  const normalizedEmail = String(email).toLowerCase().trim();

  if (!isEmailAllowed(normalizedEmail)) {
    logger.warn({ email: normalizedEmail }, "[Auth] Registration rejected — email not on allowlist");
    res.json({ ok: true, message: "Compte créé. Lien envoyé par email." });
    return;
  }

  if (firstName && String(firstName).trim()) store.me.firstName = String(firstName).trim();
  if (companyName && String(companyName).trim()) store.me.org = { name: String(companyName).trim() };
  if (plan && ["standard","pro","ultra"].includes(String(plan))) store.me.plan = String(plan);

  const token = generateToken();
  const publicUrl = getPublicUrl();
  const verifyPath = `${publicUrl}/login-verify.html?token=${token}`;

  try {
    await storeMagicToken(token, normalizedEmail);
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    logger.error({ err: msg, email: normalizedEmail }, "[Auth] DB error in register");
    res.status(500).json({ error: "Impossible de créer le lien de connexion\u00a0: base de données indisponible." });
    return;
  }

  const resendKey = process.env["RESEND_API_KEY"];
  const isProduction = process.env["NODE_ENV"] === "production";

  if (resendKey) {
    try {
      await sendMagicEmail(normalizedEmail, verifyPath);
      res.json({ ok: true, message: "Compte créé. Lien envoyé par email." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, "[Auth] register: Resend failed");
      res.status(500).json({ error: "Impossible d\u2019envoyer l\u2019e-mail\u00a0: " + msg.substring(0, 120) });
    }
  } else if (!isProduction) {
    res.json({ ok: true, debugLink: verifyPath, message: "Mode debug\u00a0: lien retourné directement." });
  } else {
    logger.error("[Auth] RESEND_API_KEY not set in production");
    res.status(503).json({ error: "Service email non configuré." });
  }
});

// ── Full signup: créer compte + org + quotas + magic link ─────────────────────
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com","guerrillamail.com","tempmail.com","throwaway.email","yopmail.com",
  "sharklasers.com","grr.la","spam4.me","trashmail.com","dispostable.com","fakeinbox.com",
  "10minutemail.com","mailnull.com","spamgourmet.com","trashmail.at","maildrop.cc",
  "getairmail.com","filzmail.com","throwam.com","tempr.email","crazymailing.com",
]);

function isDisposableEmail(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase().replace(/\.$/, "") ?? "";
  return DISPOSABLE_DOMAINS.has(domain);
}

function normalizeWebsite(url: string | undefined): string {
  if (!url) return "";
  url = url.trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  try { return new URL(url).origin; } catch { return url; }
}

router.post("/auth/signup", authRateLimit, async (req: Request, res: Response) => {
  const {
    _hp,          // honeypot
    firstName, lastName, email,
    companyName, website, country,
    companySize, objective,
  } = req.body as Record<string, string | undefined>;

  // Honeypot check — bots fill this field, humans don't
  if (_hp && String(_hp).trim().length > 0) {
    // Silently succeed — don't reveal it's a honeypot
    res.json({ ok: true, message: "Compte créé. Lien envoyé par email." });
    return;
  }

  // Validate required fields
  const normalizedEmail = String(email || "").toLowerCase().trim();
  if (!normalizedEmail || !normalizedEmail.includes("@") || !normalizedEmail.includes(".")) {
    res.status(400).json({ error: "Email invalide." });
    return;
  }
  if (!String(firstName || "").trim()) {
    res.status(400).json({ error: "Le prénom est requis." });
    return;
  }
  if (!String(lastName || "").trim()) {
    res.status(400).json({ error: "Le nom est requis." });
    return;
  }
  if (!String(companyName || "").trim()) {
    res.status(400).json({ error: "Le nom de l'entreprise est requis." });
    return;
  }

  // Block disposable emails
  if (isDisposableEmail(normalizedEmail)) {
    res.status(400).json({ error: "Les adresses email temporaires ne sont pas acceptées." });
    return;
  }

  if (!isEmailAllowed(normalizedEmail)) {
    logger.warn({ email: normalizedEmail }, "[Auth/Signup] Email not on allowlist — silent success");
    res.json({ ok: true, message: "Compte créé. Lien envoyé par email." });
    return;
  }

  const normalizedSite = normalizeWebsite(website);
  const fn = String(firstName || "").trim();
  const ln = String(lastName  || "").trim();
  const company = String(companyName || "").trim();
  const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60_000).toISOString();
  const orgId = "default";

  // Upsert org_settings (create or update org)
  try {
    const { upsertOrgSettings } = await import("../services/org-settings.js");
    await upsertOrgSettings(orgId, {
      email:       normalizedEmail,
      name:        company,
      primarySite: normalizedSite || null,
      companySize: companySize ?? null,
      industry:    objective ?? null,
      plan:        "standard",
      trialEndsAt: trialEndsAt,
    });
  } catch (err) {
    logger.warn({ err }, "[Auth/Signup] upsertOrgSettings failed (non-fatal)");
    // Non-fatal — still send the magic link
  }

  // Update in-memory store
  store.me.firstName = fn;
  store.me.org = { name: company };
  store.me.plan = "standard";
  store.me.trialEndsAt = trialEndsAt;

  // Log activity
  store.logActivity({
    type: "account",
    label: `Compte créé : ${fn} ${ln} (${company})`,
    targetId: normalizedEmail,
    targetType: "user",
    metadata: { country: country ?? null, companySize: companySize ?? null, objective: objective ?? null },
  }).catch(() => {});

  // Generate and store magic link token
  const token = generateToken();
  const publicUrl = getPublicUrl();
  const verifyPath = `${publicUrl}/login-verify.html?token=${token}`;

  try {
    await storeMagicToken(token, normalizedEmail);
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    logger.error({ err: msg, email: normalizedEmail }, "[Auth/Signup] DB error storing token");
    res.status(500).json({ error: "Impossible de créer le lien de connexion\u00a0: base de données indisponible." });
    return;
  }

  const resendKey = process.env["RESEND_API_KEY"];
  const isProduction = process.env["NODE_ENV"] === "production";

  if (resendKey) {
    try {
      await sendMagicEmail(normalizedEmail, verifyPath);
      logger.info({ email: normalizedEmail, company }, "[Auth/Signup] Account created — magic link sent");
      res.json({ ok: true, message: "Compte créé. Lien envoyé par email." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, "[Auth/Signup] Resend failed");
      res.status(500).json({ error: "Impossible d\u2019envoyer l\u2019e-mail\u00a0: " + msg.substring(0, 120) });
    }
  } else if (!isProduction) {
    res.json({ ok: true, debugLink: verifyPath, message: "Mode debug\u00a0: lien retourné directement." });
  } else {
    logger.error("[Auth/Signup] RESEND_API_KEY not set in production");
    res.status(503).json({ error: "Service email non configuré. Connectez-vous avec Google." });
  }
});

router.get("/auth/login-verify", async (req: Request, res: Response) => {
  const { token } = req.query as { token?: string };
  if (!token) {
    res.status(400).json({ error: "Token manquant" });
    return;
  }

  let entry: { email: string; used: boolean } | null = null;
  try {
    entry = await getMagicToken(String(token));
  } catch (dbErr) {
    const msg = dbErr instanceof Error ? dbErr.message : String(dbErr);
    logger.error({ err: msg }, "[Auth] login-verify: DB error reading token");
    res.status(500).json({ error: "Erreur base de données. Veuillez réessayer." });
    return;
  }

  if (!entry) {
    res.status(401).json({ error: "Lien invalide ou expiré" });
    return;
  }
  if (entry.used) {
    res.status(401).json({ error: "Lien déjà utilisé" });
    return;
  }

  try {
    await consumeMagicToken(String(token));
  } catch (dbErr) {
    logger.warn({ err: dbErr }, "[Auth] login-verify: could not mark token as used");
    // Non-fatal — continue with session creation
  }

  const sessionToken = await createSession({
    userId: entry.email,
    orgId: "default",
    email: entry.email,
    role: "admin",
  });

  logger.info({ email: entry.email }, "[Auth] Magic link verified — session started");

  const isProd = process.env["NODE_ENV"] === "production";
  res.cookie("fp_token", sessionToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });

  res.json({
    ok: true,
    email: entry.email,
    message: "Connexion réussie",
  });
});

// ── Google OAuth Login (separate from GBP — for account authentication) ──────
router.get("/auth/google/login", (req: Request, res: Response) => {
  const clientId = process.env["GOOGLE_CLIENT_ID"] || "";
  const redirectUri = process.env["GOOGLE_AUTH_REDIRECT_URI"] || `${getPublicUrl()}/api/auth/google/callback`;

  if (!clientId) {
    res.status(503).json({ error: "Google OAuth not configured" });
    return;
  }

  logger.info({ redirectUri }, "[Auth] Google OAuth login — redirect URI");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
    state: Buffer.from(JSON.stringify({ ts: Date.now() })).toString("base64"),
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get("/auth/google/callback", async (req: Request, res: Response) => {
  const { code, error: oauthError } = req.query as { code?: string; error?: string };
  const publicUrl = getPublicUrl();

  if (oauthError) {
    res.redirect(`${publicUrl}/index.html?error=${encodeURIComponent(oauthError)}`);
    return;
  }
  if (!code) {
    res.status(400).json({ error: "Missing OAuth code" });
    return;
  }

  try {
    const clientId = process.env["GOOGLE_CLIENT_ID"] || "";
    const clientSecret = process.env["GOOGLE_CLIENT_SECRET"] || "";
    const redirectUri = process.env["GOOGLE_AUTH_REDIRECT_URI"] || `${publicUrl}/api/auth/google/callback`;

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    const tokens = await tokenRes.json() as { access_token?: string; id_token?: string; error?: string };
    if (!tokens.access_token) throw new Error("No access token: " + (tokens.error || "unknown"));

    const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { "Authorization": `Bearer ${tokens.access_token}` },
    });
    const user = await userRes.json() as { sub?: string; email?: string; name?: string; picture?: string };

    const resolvedEmail = user.email ?? user.sub ?? "";
    if (!isEmailAllowed(resolvedEmail)) {
      logger.warn({ email: resolvedEmail }, "[Auth] Google login rejected — email not on allowlist");
      res.redirect(`${publicUrl}/index.html?error=access_denied`);
      return;
    }

    if (user.name) store.me.firstName = user.name.split(" ")[0];
    if (user.email && !store.me.org?.name) store.me.org = { name: user.email };

    logger.info({ email: user.email }, "[Auth] Google login successful");

    // Issue a unique per-session token and set it as an HttpOnly cookie.
    // In this single-tenant deployment every OAuth login is an owner/admin.
    const sessionToken = await createSession({ userId: resolvedEmail, orgId: "default", email: resolvedEmail, role: "admin" });
    const isProd = process.env["NODE_ENV"] === "production";
    res.cookie("fp_token", sessionToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge: SESSION_TTL_MS,
      path: "/",
    });
    res.redirect(`${publicUrl}/dashboard.html?provider=google`);
  } catch (err) {
    logger.error({ err }, "[Auth] Google login callback failed");
    res.redirect(`${publicUrl}/index.html?error=google_auth_failed`);
  }
});

// ── GitHub OAuth Login (for authentication, not just integration) ─────────────
router.get("/auth/github/login", (req: Request, res: Response) => {
  const clientId = process.env["GITHUB_CLIENT_ID"] || "";
  const redirectUri = process.env["GITHUB_AUTH_REDIRECT_URI"] || `${process.env["PUBLIC_URL"] || ""}/api/auth/github/callback`;

  if (!clientId) {
    res.status(503).json({ error: "GitHub OAuth not configured" });
    return;
  }

  const url = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user,user:email`;
  res.redirect(url);
});

router.get("/auth/github/callback", async (req: Request, res: Response) => {
  const { code, error: oauthError } = req.query as { code?: string; error?: string };
  const publicUrl = getPublicUrl();

  if (oauthError || !code) {
    res.redirect(`${publicUrl}/index.html?error=${encodeURIComponent(oauthError || "missing_code")}`);
    return;
  }

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: process.env["GITHUB_CLIENT_ID"], client_secret: process.env["GITHUB_CLIENT_SECRET"], code }),
    });
    const tokens = await tokenRes.json() as { access_token?: string; error?: string };
    if (!tokens.access_token) throw new Error("No token: " + (tokens.error || "unknown"));

    const userRes = await fetch("https://api.github.com/user", {
      headers: { "Authorization": `Bearer ${tokens.access_token}`, "Accept": "application/vnd.github+json" },
    });
    const user = await userRes.json() as { login?: string; name?: string; email?: string };

    const resolvedEmail = user.email ?? user.login ?? "";
    if (!isEmailAllowed(resolvedEmail)) {
      logger.warn({ login: user.login }, "[Auth] GitHub login rejected — email not on allowlist");
      res.redirect(`${publicUrl}/index.html?error=access_denied`);
      return;
    }

    if (user.name || user.login) store.me.firstName = (user.name || user.login || "").split(" ")[0];

    logger.info({ login: user.login }, "[Auth] GitHub login successful");

    // Issue a unique per-session token and set it as an HttpOnly cookie.
    // In this single-tenant deployment every OAuth login is an owner/admin.
    const sessionToken = await createSession({ userId: resolvedEmail, orgId: "default", email: resolvedEmail, role: "admin" });
    const isProd = process.env["NODE_ENV"] === "production";
    res.cookie("fp_token", sessionToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge: SESSION_TTL_MS,
      path: "/",
    });
    res.redirect(`${publicUrl}/dashboard.html?provider=github`);
  } catch (err) {
    logger.error({ err }, "[Auth] GitHub callback failed");
    res.redirect(`${publicUrl}/index.html?error=github_auth_failed`);
  }
});

// ── Session & Logout ──────────────────────────────────────────────────────────
router.get("/auth/session", async (req: Request, res: Response) => {
  const cookieToken: string = (req as unknown as { cookies?: Record<string, string> }).cookies?.fp_token ?? "";
  const session = cookieToken ? await getSession(cookieToken) : null;
  const authenticated = session !== null;

  res.json({
    authenticated,
    user: authenticated ? {
      firstName: store.me.firstName,
      plan: store.me.plan,
      subscriptionStatus: store.me.subscriptionStatus,
      trialEndsAt: store.me.trialEndsAt,
    } : null,
  });
});

router.post("/auth/logout", (req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cookieToken: string = (req as any).cookies?.fp_token ?? "";
  if (cookieToken) {
    deleteSession(cookieToken);
    logger.info("[Auth] Session revoked on logout");
  }

  const isProd = process.env["NODE_ENV"] === "production";
  res.clearCookie("fp_token", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    path: "/",
  });

  res.json({ ok: true, message: "Session terminée" });
});

// ── Apple Sign In (stub — requires APPLE_CLIENT_ID + APPLE_TEAM_ID + private key) ─
router.get("/auth/apple/login", (req: Request, res: Response) => {
  const clientId = process.env["APPLE_CLIENT_ID"] || "";
  if (!clientId) {
    res.status(503).json({ error: "Apple Sign In not configured" });
    return;
  }
  const redirectUri =
    process.env["APPLE_AUTH_REDIRECT_URI"] ||
    `${getPublicUrl()}/api/auth/apple/callback`;
  const state = Buffer.from(JSON.stringify({ ts: Date.now() })).toString("base64url");
  const url = new URL("https://appleid.apple.com/auth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "form_post");
  url.searchParams.set("scope", "name email");
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

router.get("/auth/providers", (_req: Request, res: Response) => {
  const googleConfigured = !!(process.env["GOOGLE_CLIENT_ID"] && process.env["GOOGLE_CLIENT_SECRET"]);
  const appleConfigured  = !!(process.env["APPLE_CLIENT_ID"]);
  const githubConfigured = !!(process.env["GITHUB_CLIENT_ID"] && process.env["GITHUB_CLIENT_SECRET"]);

  res.json({
    providers: [
      { id: "google", name: "Google", configured: googleConfigured, loginUrl: "/api/auth/google/login" },
      { id: "apple",  name: "Apple",  configured: appleConfigured,  loginUrl: "/api/auth/apple/login"  },
      { id: "github", name: "GitHub", configured: githubConfigured, loginUrl: "/api/auth/github/login" },
      { id: "magic-link", name: "Email (Magic Link)", configured: true, loginUrl: "/api/auth/login-request" },
    ],
  });
});

export default router;
