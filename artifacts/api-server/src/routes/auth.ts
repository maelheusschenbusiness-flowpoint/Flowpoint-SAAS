import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { store } from "../services/store.js";
import { logger } from "../lib/logger.js";
import { createSession, deleteSession, getSession, invalidateAllSessions, SESSION_TTL_MS } from "../services/sessions.js";
import { authRateLimit } from "../middlewares/rateLimiter.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { Resend } from "resend";
import { pool } from "@workspace/db";

const router = Router();

// ── Dev/prod detection ────────────────────────────────────────────────────────
// REPLIT_DEV_DOMAIN is set in all Replit workspaces but NOT in deployments.
// Using NODE_ENV alone is unreliable because Replit sets NODE_ENV=production
// even in the interactive workspace. isDeployedProd() is true only in real
// production deployments (Render, Railway, Replit Deployments, etc.).
function isDeployedProd(): boolean {
  return process.env["NODE_ENV"] === "production" && !process.env["REPLIT_DEV_DOMAIN"];
}

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

// ── Alias /auth/me → /me (success.html frontend legacy path)
// Requires a valid authenticated session — never returns a hardcoded fallback user.
router.get("/auth/me", requireAuth, async (req: Request, res: Response) => {
  const orgId = req.orgContext?.orgId;
  if (!orgId || orgId === "default") {
    res.status(401).json({ error: "Unauthorized: no valid session" });
    return;
  }
  try {
    const { loadOrgSettings } = await import("../services/org-settings.js");
    const dbData = await loadOrgSettings(orgId);
    if (dbData) {
      const plan = dbData.plan.toLowerCase();
      const { PLAN_LIMITS } = await import("../lib/plans.js");
      const limits = PLAN_LIMITS[plan] ?? PLAN_LIMITS["standard"];
      const firstName = dbData.firstName || (req.orgContext?.email?.split("@")[0] ?? "");
      res.json({
        id: dbData.id || orgId,
        firstName,
        lastName: dbData.lastName ?? "",
        email: req.orgContext?.email ?? "",
        plan: dbData.plan,
        role: req.orgContext?.role ?? "owner",
        org: { name: dbData.orgName, website: dbData.website ?? "" },
        subscriptionStatus: dbData.subscriptionStatus,
        trialEndsAt: dbData.trialEndsAt,
        usage: dbData.usage,
        addons: dbData.addons,
        limits,
        createdAt: dbData.createdAt ?? new Date().toISOString(),
      });
      return;
    }
  } catch { /* fall through */ }
  res.status(401).json({ error: "Unauthorized: organization data not found" });
});

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

  // Centralized transactional sender — override via RESEND_FROM env var only
  const fromEmail =
    process.env["RESEND_FROM"] || "FlowPoint <noreply@flowpoint.pro>";

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
      .email-header { background-color: #1d4ed8 !important; }
      .email-footer { background-color: #1e3a8a !important; }
      .text-main    { color: #e8eeff !important; }
      .text-muted   { color: #8891b8 !important; }
      .divider      { border-color: #252a45 !important; }
      .copy-block   { background-color: #0d0f1a !important; border-color: #252a45 !important; color: #8891b8 !important; }
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
            <td class="email-header" style="background-color:#2563EB;padding:32px 40px 28px;text-align:center;">
              <!-- Wordmark -->
              <div style="display:inline-flex;align-items:center;justify-content:center;gap:12px;">
                <!-- Zap icon — white on translucent bg -->
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="36" height="36" style="display:inline-block;vertical-align:middle;flex-shrink:0;">
                  <rect x="0" y="0" width="48" height="48" rx="10" ry="10" fill="rgba(255,255,255,0.18)"/>
                  <g transform="translate(12,12)" fill="none" stroke="white" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                  </g>
                </svg>
                <span style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:-.03em;vertical-align:middle;">FlowPoint</span>
              </div>
              <div style="margin-top:10px;font-size:12px;color:rgba(255,255,255,0.75);letter-spacing:.1em;text-transform:uppercase;font-weight:500;">SEO &nbsp;·&nbsp; Monitoring &nbsp;·&nbsp; Local SEO &nbsp;·&nbsp; IA</div>
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
            <td class="email-footer" style="background-color:#2563EB;padding:22px 40px;text-align:center;">
              <p style="margin:0 0 8px;font-size:13px;color:rgba(255,255,255,0.9);line-height:1.5;">
                <a href="https://flowpoint.pro" style="color:#ffffff;text-decoration:none;font-weight:700;">flowpoint.pro</a>
                &nbsp;&nbsp;·&nbsp;&nbsp;
                <a href="https://app.flowpoint.pro" style="color:rgba(255,255,255,0.85);text-decoration:none;">Dashboard</a>
                &nbsp;&nbsp;·&nbsp;&nbsp;
                <a href="mailto:support@flowpoint.pro" style="color:rgba(255,255,255,0.85);text-decoration:none;">Support</a>
              </p>
              <p style="margin:0;font-size:11px;color:rgba(255,255,255,0.55);">
                © ${new Date().getFullYear()} FlowPoint. Tous droits réservés.
              </p>
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

router.post("/auth/magic-link", authRateLimit, async (req: Request, res: Response) => {
  res.redirect(307, "/api/auth/login-request");
});

router.post("/auth/login-request", authRateLimit, async (req: Request, res: Response) => {
  const rawEmail = (req.body as { email?: string } | undefined)?.email;

  // ── Entry diagnostic log — always visible in Render logs ─────────────────────
  logger.info({
    emailReceived: rawEmail ? String(rawEmail).replace(/(.{2}).+(@.+)/, "$1***$2") : "(none)",
    fromEmail: process.env["RESEND_FROM"] || "FlowPoint <noreply@flowpoint.pro>",
    publicBaseUrl: process.env["PUBLIC_BASE_URL"] || process.env["PUBLIC_URL"] || "(not set)",
    resendKeyPresent: !!(process.env["RESEND_API_KEY"]),
    databaseUrlPresent: !!(process.env["DATABASE_URL"]),
    allowedEmails: process.env["ALLOWED_EMAILS"] ? "(set)" : "(not set — open mode)",
    nodeEnv: process.env["NODE_ENV"] || "(not set)",
  }, "[Auth] login-request received");

  if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(rawEmail).trim())) {
    res.status(400).json({ error: "Adresse email invalide" });
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
  const isProduction = isDeployedProd();
  const isDevWorkspace = !!process.env["REPLIT_DEV_DOMAIN"];

  if (resendKey) {
    try {
      await sendMagicEmail(email, verifyPath);
      logger.info({ email }, "[Auth] login-request: magic link sent successfully");
      // In dev workspace always include debugLink so Playwright tests can auth
      if (isDevWorkspace) {
        res.json({ ok: true, debugLink: verifyPath, message: "Lien de connexion envoyé par email." });
      } else {
        res.json({ ok: true, message: "Lien de connexion envoyé par email." });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, email }, "[Auth] login-request: Resend failed");

      if (msg.startsWith("RESEND_API_KEY_MISSING")) {
        res.status(503).json({ error: "Service email non configuré." });
      } else if (msg.startsWith("DOMAIN_NOT_VERIFIED")) {
        // 503 = service unavailable (external config issue, not internal error)
        res.status(503).json({
          error: "Service email indisponible\u00a0: le domaine expéditeur n\u2019est pas vérifié dans Resend.",
          hint:  "Vérifiez les enregistrements DNS (SPF, DKIM) pour le domaine configuré dans RESEND_FROM.",
          from:  process.env["RESEND_FROM"] || "FlowPoint <noreply@flowpoint.pro>",
        });
      } else {
        res.status(503).json({ error: "Service email temporairement indisponible\u00a0: " + msg.substring(0, 120) });
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

  const normalizedEmail = String(email ?? "").toLowerCase().trim();
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizedEmail)) {
    res.status(400).json({ error: "Adresse email invalide ou manquante" });
    return;
  }

  if (!isEmailAllowed(normalizedEmail)) {
    logger.warn({ email: normalizedEmail }, "[Auth] Registration rejected — email not on allowlist");
    res.json({ ok: true, message: "Compte créé. Lien envoyé par email." });
    return;
  }

  // SECURITY: store.me writes removed — global singleton causes cross-user data leakage.

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
  const isProduction = isDeployedProd();
  const isDevWorkspaceR = !!process.env["REPLIT_DEV_DOMAIN"];

  if (resendKey) {
    try {
      await sendMagicEmail(normalizedEmail, verifyPath);
      if (isDevWorkspaceR) {
        res.json({ ok: true, debugLink: verifyPath, message: "Compte créé. Lien envoyé par email." });
      } else {
        res.json({ ok: true, message: "Compte créé. Lien envoyé par email." });
      }
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
    companySize, objective, city, address,
    plan: planField,
  } = req.body as Record<string, string | undefined>;

  // Validate and resolve selected plan (default: standard)
  const selectedPlan = (["standard","pro","ultra"] as string[]).includes(String(planField ?? ""))
    ? String(planField)
    : "standard";

  // Honeypot check — bots fill this field, humans don't
  if (_hp && String(_hp).trim().length > 0) {
    // Silently succeed — don't reveal it's a honeypot
    res.json({ ok: true, message: "Compte créé. Lien envoyé par email." });
    return;
  }

  // Validate required fields
  const normalizedEmail = String(email ?? "").toLowerCase().trim();
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizedEmail)) {
    res.status(400).json({ error: "Adresse email invalide ou manquante." });
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
  // Each user gets their own org keyed by their email — never share the "default" seed org
  const orgId = normalizedEmail;

  // Upsert org_settings (create or update org)
  // SECURITY (P0): Detect existing account — never overwrite billing data on re-signup.
  let _signupIsNewAccount = true;
  try {
    const { loadOrgSettings: _loadExisting, upsertOrgSettings } = await import("../services/org-settings.js");
    const _existing = await _loadExisting(orgId).catch(() => null);
    _signupIsNewAccount = !_existing;

    if (_existing) {
      // Account already exists — update contact info ONLY, never touch plan/trial/billing.
      await upsertOrgSettings(orgId, {
        firstName: fn  || _existing.firstName  || undefined,
        lastName:  ln  || _existing.lastName   || undefined,
        country:   country  ?? _existing.country  ?? null,
        city:      city?.trim()    ?? _existing.city    ?? null,
        address:   address?.trim() ?? _existing.address ?? null,
      }).catch((e) => logger.warn({ e }, "[Auth/Signup] contact-only upsert failed"));
      logger.info({ orgId, email: normalizedEmail }, "[Auth/Signup] Existing account detected — billing data preserved");
    } else {
      await upsertOrgSettings(orgId, {
        email:              normalizedEmail,
        name:               company,
        firstName:          fn,
        lastName:           ln,
        primarySite:        normalizedSite || null,
        companySize:        companySize ?? null,
        industry:           objective ?? null,
        plan:               selectedPlan,
        subscriptionStatus: "pending_billing",
        country:            country ?? null,
        city:               city?.trim()    ?? null,
        address:            address?.trim() ?? null,
        locationConfigured: !!(city?.trim() || address?.trim()),
        locationSource:     "manual",
      });
    }
  } catch (err) {
    logger.warn({ err }, "[Auth/Signup] upsertOrgSettings failed (non-fatal)");
    // Non-fatal — still send the magic link
  }

  // REMOVED: store.me writes deliberately omitted.
  // store.me is a global singleton — writing user-specific data here causes cross-user
  // data leakage when /api/me falls back to the in-memory store.

  // Log activity
  store.logActivity({
    type: "account",
    label: `Compte créé : ${fn} ${ln} (${company})`,
    targetId: normalizedEmail,
    targetType: "user",
    metadata: { country: country ?? null, companySize: companySize ?? null, objective: objective ?? null },
  }).catch(err => logger.error({ err }, "[auth] logActivity failed"));

  logger.info(
    { email: normalizedEmail, postgres: true },
    "[Auth] user persisted postgres=true",
  );

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
  const isProduction = isDeployedProd();
  const isDevWorkspaceS = !!process.env["REPLIT_DEV_DOMAIN"];

  if (resendKey) {
    try {
      await sendMagicEmail(normalizedEmail, verifyPath);
      logger.info({ email: normalizedEmail, company, plan: selectedPlan }, "[Auth/Signup] Account created — magic link sent");
      const _signupMsg = _signupIsNewAccount
        ? "Compte créé. Lien envoyé par email."
        : "Un compte existe déjà avec cette adresse. Un lien de connexion vous a été envoyé.";
      if (isDevWorkspaceS) {
        res.json({ ok: true, existingAccount: !_signupIsNewAccount, debugLink: verifyPath, message: _signupMsg });
      } else {
        res.json({ ok: true, existingAccount: !_signupIsNewAccount, message: _signupMsg });
      }

      // ── Fire-and-forget: ensure Stripe customer exists (deduplicates by orgId) ──────────
      // Uses ensureStripeCustomer which checks for an existing customer BEFORE creating,
      // preventing duplicate Stripe customers when the same email re-signs up.
      const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
      if (stripeKey) {
        const _fn = fn; const _ln = ln; const _company = company;
        const _selectedPlan = selectedPlan; const _orgId = orgId; const _email = normalizedEmail;
        (async () => {
          try {
            const { ensureStripeCustomer } = await import("../services/ensure-stripe-customer.js");
            const customerId = await ensureStripeCustomer(_orgId, {
              stripeCustomerId: null,
              email: _email,
              firstName: `${_fn} ${_ln}`.trim(),
              orgName: _company,
            });
            logger.info({ customerId, plan: _selectedPlan, email: _email }, "[Auth/Signup] Stripe customer ensured (no duplicate)");
          } catch (stripeErr) {
            logger.warn({ err: stripeErr }, "[Auth/Signup] Stripe customer ensure failed (non-fatal)");
          }
        })();
      }

      // ── Fire-and-forget: welcome + trial-started emails ─────────────────
      const { mailer: _mailer } = await import("../services/mailer.js").catch(() => ({ mailer: null }));
      if (_mailer) {
        _mailer.sendWelcome({ to: normalizedEmail, name: fn }).catch(() => {});
        // Note: sendTrialStarted fires from the Stripe webhook when a real trial subscription
        // is created — NOT at signup (trial is no longer granted at signup).
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg }, "[Auth/Signup] Resend failed");
      // In dev mode, return the magic link directly so the flow can be tested without email
      if (!isProduction) {
        res.json({ ok: true, debugLink: verifyPath, message: "Mode debug\u00a0: envoi email échoué, lien retourné directement." });
        return;
      }
      res.status(500).json({ error: "Impossible d\u2019envoyer l\u2019e-mail\u00a0: " + msg.substring(0, 120) });
    }
  } else if (!isProduction) {
    res.json({ ok: true, debugLink: verifyPath, message: "Mode debug\u00a0: lien retourné directement." });
  } else {
    logger.error("[Auth/Signup] RESEND_API_KEY not set in production");
    res.status(503).json({ error: "Service email non configuré. Connectez-vous avec Google." });
  }
});

/* ════════════════════════════════════════════════════════════════════════════
   POST /api/auth/pre-register
   ─ Nouveau flux signup étape 1 : valide le formulaire, stocke les données
     dans pending_signups, retourne un token opaque.
     Aucun compte créé, aucun magic link, aucune session.
════════════════════════════════════════════════════════════════════════════ */
router.post("/auth/pre-register", authRateLimit, async (req: Request, res: Response) => {
  const {
    _hp,
    firstName, lastName, email, companyName,
    country, address, city, postalCode,
    phone, vat,
  } = req.body as Record<string, string | undefined>;

  // Honeypot — bots fill hidden fields, humans don't
  if (_hp && String(_hp).trim().length > 0) {
    res.json({ ok: true, preRegisterToken: "hp_" + Date.now() });
    return;
  }

  // Validate required fields
  const normalizedEmail = String(email ?? "").toLowerCase().trim();
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalizedEmail)) {
    res.status(400).json({ error: "Adresse email invalide ou manquante." });
    return;
  }
  const fn          = String(firstName   || "").trim();
  const ln          = String(lastName    || "").trim();
  const company     = String(companyName || "").trim();
  const countryVal  = String(country     || "").trim();
  const addressVal  = String(address     || "").trim();
  const cityVal     = String(city        || "").trim();
  const postalVal   = String(postalCode  || "").trim();

  if (!fn)         { res.status(400).json({ error: "Le prénom est requis." });              return; }
  if (!ln)         { res.status(400).json({ error: "Le nom est requis." });                 return; }
  if (!company)    { res.status(400).json({ error: "Le nom de l'entreprise est requis." }); return; }
  if (!countryVal) { res.status(400).json({ error: "Le pays est requis." });                return; }
  if (!addressVal) { res.status(400).json({ error: "L'adresse est requise." });             return; }
  if (!cityVal)    { res.status(400).json({ error: "La ville est requise." });              return; }
  if (!postalVal)  { res.status(400).json({ error: "Le code postal est requis." });         return; }

  if (isDisposableEmail(normalizedEmail)) {
    res.status(400).json({ error: "Les adresses email temporaires ne sont pas acceptées." });
    return;
  }
  if (!isEmailAllowed(normalizedEmail)) {
    // Silent success — don't reveal allowlist
    res.json({ ok: true, preRegisterToken: "blocked_" + Date.now() });
    return;
  }

  // Store in pending_signups (no account created yet)
  const preToken = generateToken();
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO pending_signups
         (token, email, first_name, last_name, company_name, country, address, city, postal_code, phone, vat, created_at, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),NOW() + INTERVAL '2 hours')
       ON CONFLICT (token) DO NOTHING`,
      [
        preToken, normalizedEmail, fn, ln, company,
        countryVal, addressVal, cityVal, postalVal,
        String(phone || "").trim() || null,
        String(vat   || "").trim() || null,
      ]
    );
  } finally {
    client.release();
  }

  logger.info({ email: normalizedEmail, company }, "[Auth/PreRegister] Pre-registration stored — awaiting plan + payment");
  res.json({ ok: true, preRegisterToken: preToken });
});

/* ════════════════════════════════════════════════════════════════════════════
   GET /api/auth/checkout-complete?session_id=...
   ─ Appelé par checkout-return.html après la redirection Stripe.

   FLUX SÉCURISÉ (2 chemins) :

   A) PRIMAIRE — via checkout_post_tokens (webhook a déjà créé le jeton) :
      1. Cherche l'entrée par stripe_session_id.
      2. Si consumed_at IS NOT NULL → 409 (déjà utilisé).
      3. Si expiré → 410 (recommencer).
      4. Si valide → UPDATE consumed_at + CREATE session + cookie httpOnly.
      → Garantie: jeton à usage unique, hashé en DB, 30 min TTL.

   B) FALLBACK — via Stripe API directe (webhook lent / non encore reçu) :
      1. Vérifie avec Stripe que la session est payée.
      2. Si non payée → 402 (retry dans checkout-return.html).
      3. Si payée → crée l'org depuis pending_signups + insère+consomme
         checkout_post_tokens + CREATE session + cookie.
      → Garantie: même résultat idempotent.

   Jamais de token de session permanent dans l'URL.
════════════════════════════════════════════════════════════════════════════ */
router.get("/auth/checkout-complete", async (req: Request, res: Response) => {
  const { session_id: sessionId } = req.query as { session_id?: string };
  if (!sessionId || typeof sessionId !== "string" || sessionId.length < 8) {
    res.status(400).json({ error: "session_id manquant ou invalide." });
    return;
  }

  /** Helper: emit cookie + JSON response after successful auth. */
  async function emitSession(orgId: string): Promise<void> {
    const sessionToken = await createSession({ userId: orgId, orgId, email: orgId, role: "owner" });
    const isProd = isDeployedProd();
    res.cookie("fp_token", sessionToken, {
      httpOnly: true,
      secure:   isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge:   SESSION_TTL_MS,
      path:     "/",
    });
    logger.info({ orgId }, "[Auth/CheckoutComplete] Auto-login successful — session created");
    store.logActivity({
      type: "account", label: `Compte activé après paiement : ${orgId}`,
      targetId: orgId, targetType: "user",
    }).catch(() => {});
    res.json({ ok: true, redirectTo: "/dashboard.html" });
  }

  try {
    // ─────────────────────────────────────────────────────────────────────────
    // PATH A: check checkout_post_tokens (set by webhook after org creation)
    // ─────────────────────────────────────────────────────────────────────────
    const dbClient = await pool.connect();
    let postToken: {
      org_id: string; email: string; pre_register_token: string | null;
      consumed_at: string | null; expires_at: string;
    } | null = null;
    try {
      const r = await dbClient.query(
        `SELECT org_id, email, pre_register_token, consumed_at, expires_at
         FROM checkout_post_tokens WHERE stripe_session_id = $1 LIMIT 1`,
        [sessionId]
      );
      if (r.rows.length > 0) postToken = r.rows[0];
    } finally {
      dbClient.release();
    }

    if (postToken) {
      // 409: already consumed (second call / replay attack)
      if (postToken.consumed_at) {
        logger.warn({ sessionId, orgId: postToken.org_id }, "[Auth/CheckoutComplete] Token already consumed — replay blocked");
        res.status(409).json({ error: "Session déjà utilisée.", alreadyCreated: true });
        return;
      }
      // 410: expired
      if (new Date(postToken.expires_at) < new Date()) {
        logger.warn({ sessionId }, "[Auth/CheckoutComplete] Post-checkout token expired");
        res.status(410).json({ error: "Session expirée. Veuillez vous connecter via le lien de bienvenue." });
        return;
      }
      // Valid: consume atomically then emit session
      const consumeClient = await pool.connect();
      try {
        const upd = await consumeClient.query(
          `UPDATE checkout_post_tokens SET consumed_at = NOW()
           WHERE stripe_session_id = $1 AND consumed_at IS NULL
           RETURNING org_id`,
          [sessionId]
        );
        if (upd.rowCount === 0) {
          // Race: another request consumed it first
          logger.warn({ sessionId }, "[Auth/CheckoutComplete] Token consumed by concurrent request");
          res.status(409).json({ error: "Session déjà utilisée.", alreadyCreated: true });
          return;
        }
      } finally {
        consumeClient.release();
      }
      logger.info({ sessionId, orgId: postToken.org_id }, "[Auth/CheckoutComplete] Token consumed (webhook path)");
      await emitSession(postToken.org_id);
      return;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PATH B: webhook not yet fired — verify directly with Stripe API
    // ─────────────────────────────────────────────────────────────────────────
    const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
    if (!stripeKey) {
      res.status(503).json({ error: "Service de paiement non configuré." });
      return;
    }

    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const isConfirmed = session.status === "complete" &&
      (session.payment_status === "paid" || session.payment_status === "no_payment_required");

    if (!isConfirmed) {
      logger.warn({ sessionId, status: session.status, paymentStatus: session.payment_status },
        "[Auth/CheckoutComplete] Session not yet confirmed (Stripe API fallback)");
      res.status(402).json({ error: "Paiement non encore confirmé. Réessayez dans quelques secondes." });
      return;
    }

    const meta = (session.metadata as Record<string, string>) ?? {};
    const preRegisterToken = meta["pre_register_token"] ?? "";
    const orgId = meta["orgId"] ?? "";

    if (!orgId) {
      logger.error({ sessionId }, "[Auth/CheckoutComplete] orgId missing from session metadata");
      res.status(400).json({ error: "Session invalide — identifiant organisation manquant." });
      return;
    }

    // Load pending_signups data (Stripe API path — webhook hasn't fired yet)
    type SignupRow = {
      email: string; first_name: string; last_name: string; company_name: string;
      country: string | null; address: string | null; city: string | null;
      postal_code: string | null; phone: string | null; vat: string | null;
    };
    let signupRow: SignupRow | null = null;
    if (preRegisterToken) {
      const srClient = await pool.connect();
      try {
        const r = await srClient.query(
          `SELECT email, first_name, last_name, company_name, country, address, city, postal_code, phone, vat
           FROM pending_signups WHERE token = $1 AND expires_at > NOW() LIMIT 1`,
          [preRegisterToken]
        );
        if (r.rows.length > 0) signupRow = r.rows[0] as SignupRow;
      } finally {
        srClient.release();
      }
    }

    // Create org (idempotent with webhook — first writer wins)
    const { upsertOrgSettings, loadOrgSettings: _loadExisting } = await import("../services/org-settings.js");
    const existing = await _loadExisting(orgId).catch(() => null);
    const customerId = session.customer ? String(session.customer) : undefined;

    if (!existing && signupRow) {
      await upsertOrgSettings(orgId, {
        email:              signupRow.email,
        name:               signupRow.company_name,
        firstName:          signupRow.first_name,
        lastName:           signupRow.last_name,
        country:            signupRow.country,
        city:               signupRow.city,
        address:            signupRow.address,
        postalCode:         signupRow.postal_code,
        subscriptionStatus: "active",
        stripeCustomerId:   customerId,
        locationConfigured: !!(signupRow.city || signupRow.address),
        locationSource:     "manual",
      });
      logger.info({ orgId }, "[Auth/CheckoutComplete] Org created (Stripe API fallback path)");
    } else if (existing) {
      if (existing.subscriptionStatus !== "active" && existing.subscriptionStatus !== "trialing") {
        await upsertOrgSettings(orgId, {
          subscriptionStatus: "active",
          stripeCustomerId:   customerId ?? (existing.stripeCustomerId ?? undefined),
        });
      }
    } else {
      logger.warn({ orgId, preRegisterToken }, "[Auth/CheckoutComplete] No pending_signups — creating minimal org");
      await upsertOrgSettings(orgId, { email: orgId, subscriptionStatus: "active", stripeCustomerId: customerId });
    }

    // Insert + immediately consume a checkout_post_tokens entry (idempotency + audit)
    const insertClient = await pool.connect();
    try {
      await insertClient.query(`
        INSERT INTO checkout_post_tokens
          (stripe_session_id, org_id, email, pre_register_token, expires_at, consumed_at)
        VALUES ($1, $2, $3, $4, NOW() + INTERVAL '1 minute', NOW())
        ON CONFLICT (stripe_session_id) DO UPDATE SET consumed_at = COALESCE(checkout_post_tokens.consumed_at, NOW())
      `, [sessionId, orgId, orgId, preRegisterToken || null]);
      // Also mark pending_signup consumed if it exists
      if (preRegisterToken) {
        await insertClient.query(
          `UPDATE pending_signups SET consumed_at = NOW() WHERE token = $1 AND consumed_at IS NULL`,
          [preRegisterToken]
        );
      }
    } finally {
      insertClient.release();
    }

    await emitSession(orgId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Stripe API errors (invalid session_id, no such resource) → 400, not 500
    const isStripeErr = err instanceof Error && (
      (err as Record<string, unknown>)["type"] === "StripeInvalidRequestError" ||
      msg.includes("No such") || msg.includes("no such") ||
      msg.includes("resource_missing") || msg.includes("invalid_request")
    );
    if (isStripeErr) {
      logger.warn({ err: msg, sessionId }, "[Auth/CheckoutComplete] Invalid Stripe session");
      res.status(400).json({ error: "Session de paiement introuvable ou invalide." });
      return;
    }
    logger.error({ err: msg, sessionId }, "[Auth/CheckoutComplete] Error");
    res.status(500).json({ error: "Erreur lors de la finalisation du compte. Réessayez." });
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

  // SECURITY (P0): Invalidate ALL existing sessions for this user before creating a new one.
  // Prevents session-bleeding when the same browser switches between accounts via magic link.
  await invalidateAllSessions(entry.email).catch((err) =>
    logger.warn({ err, email: entry.email }, "[Auth] login-verify: invalidateAllSessions failed (non-fatal)"),
  );

  const sessionToken = await createSession({
    userId: entry.email,
    orgId: entry.email,
    email: entry.email,
    // Direct magic-link login = org creator → owner.
    // Invited members who accept an invitation token get their role from team_members (see /team/accept).
    role: "owner",
  });

  logger.info({ email: entry.email }, "[Auth] Magic link verified — session started");

  const isProd = isDeployedProd();
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

  // P0: ensure org_settings row + Stripe customer exist for this org.
  // Fire-and-forget — never blocks the login response.
  const verifiedEmail = entry.email;
  (async () => {
    try {
      const { upsertOrgSettings: _upsert } = await import("../services/org-settings.js");
      await _upsert(verifiedEmail, { email: verifiedEmail });
    } catch (settingsErr) {
      logger.warn({ settingsErr, email: verifiedEmail }, "[Auth] login-verify: upsertOrgSettings failed (non-fatal)");
    }
    const stripeKey = process.env["STRIPE_LIVE_API_KEY"] ?? process.env["STRIPE_SECRET_KEY"] ?? "";
    if (!stripeKey) return;
    try {
      const { ensureStripeCustomer } = await import("../services/ensure-stripe-customer.js");
      await ensureStripeCustomer(verifiedEmail);
      logger.info({ email: verifiedEmail }, "[Auth] login-verify: Stripe customer ensured");
    } catch (stripeErr) {
      logger.warn({ stripeErr, email: verifiedEmail }, "[Auth] login-verify: ensureStripeCustomer failed (non-fatal)");
    }
  })();
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

  const rawPlan = String(req.query["plan"] ?? "");
  const selectedPlan = ["standard","pro","ultra"].includes(rawPlan) ? rawPlan : null;
  const rawRedirect = String(req.query["redirect_to"] ?? "");
  const redirectTo = rawRedirect.startsWith("/") ? rawRedirect : null;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
    state: Buffer.from(JSON.stringify({ ts: Date.now(), plan: selectedPlan, redirect_to: redirectTo })).toString("base64"),
  });

  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get("/auth/google/callback", async (req: Request, res: Response) => {
  const { code, error: oauthError } = req.query as { code?: string; error?: string };
  const publicUrl = getPublicUrl();

  if (oauthError) {
    res.redirect(`${publicUrl}/login.html?error=${encodeURIComponent(oauthError)}`);
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
      res.redirect(`${publicUrl}/login.html?error=access_denied`);
      return;
    }

    // SECURITY: store.me writes removed — user data must be read from DB, not global singleton.

    // Apply plan & redirect from OAuth state if present
    let redirectAfterLogin = `${publicUrl}/dashboard.html?provider=google`;
    let planFromState: string | null = null;
    try {
      const rawState = String(req.query["state"] ?? "");
      if (rawState) {
        const stateObj = JSON.parse(Buffer.from(rawState, "base64").toString("utf8")) as { plan?: string; redirect_to?: string | null };
        if (stateObj.plan && ["standard","pro","ultra"].includes(stateObj.plan)) {
          planFromState = stateObj.plan;
          logger.info({ plan: stateObj.plan }, "[Auth] Google login — plan set from OAuth state");
        }
        if (stateObj.redirect_to && stateObj.redirect_to.startsWith("/")) {
          redirectAfterLogin = `${publicUrl}${stateObj.redirect_to}`;
          logger.info({ redirect: redirectAfterLogin }, "[Auth] Google login — redirect after login set from OAuth state");
        }
      }
    } catch { /* state parse error — ignore */ }

    // Persist org settings (including plan) so /api/me returns correct plan after restart
    try {
      const { upsertOrgSettings, loadOrgSettings: _loadGoogleOrg } = await import("../services/org-settings.js");
      const _existingGoogleOrg = await _loadGoogleOrg(resolvedEmail).catch(() => null);
      if (_existingGoogleOrg) {
        // Existing account — update non-billing fields only (NEVER overwrite plan/trial/billing)
        await upsertOrgSettings(resolvedEmail, {
          email: resolvedEmail,
          firstName: _existingGoogleOrg.firstName || (user.name ? user.name.split(" ")[0] : undefined),
          plan: planFromState ? planFromState : (_existingGoogleOrg.plan ?? "standard"),
        });
        logger.info({ email: resolvedEmail }, "[Auth] Google login — existing org, billing data preserved");
      } else {
        // New account — pending_billing (trial not granted at signup)
        await upsertOrgSettings(resolvedEmail, {
          email: resolvedEmail,
          firstName: user.name ? user.name.split(" ")[0] : undefined,
          plan: planFromState ?? "standard",
          subscriptionStatus: "pending_billing",
          name: user.email ?? undefined,
        });
        logger.info({ email: resolvedEmail, plan: planFromState }, "[Auth] Google login — new org created with pending_billing");
      }
    } catch (err) {
      logger.warn({ err }, "[Auth] Google login — org_settings persist failed (non-fatal)");
    }

    logger.info({ email: user.email }, "[Auth] Google login successful");

    // Issue a unique per-session token and set it as an HttpOnly cookie.
    // Direct OAuth login = org creator → owner role.
    const sessionToken = await createSession({ userId: resolvedEmail, orgId: resolvedEmail, email: resolvedEmail, role: "owner" });
    const isProd = isDeployedProd();
    res.cookie("fp_token", sessionToken, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge: SESSION_TTL_MS,
      path: "/",
    });
    res.redirect(redirectAfterLogin);
  } catch (err) {
    logger.error({ err }, "[Auth] Google login callback failed");
    res.redirect(`${publicUrl}/login.html?error=google_auth_failed`);
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
    res.redirect(`${publicUrl}/login.html?error=${encodeURIComponent(oauthError || "missing_code")}`);
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
      res.redirect(`${publicUrl}/login.html?error=access_denied`);
      return;
    }

    // SECURITY: store.me.firstName write removed — global singleton causes cross-user data leakage.

    // Persist per-user org so /api/me returns correct data after restart
    try {
      const { upsertOrgSettings, loadOrgSettings: _loadGithubOrg } = await import("../services/org-settings.js");
      const _existingGithubOrg = await _loadGithubOrg(resolvedEmail).catch(() => null);
      if (_existingGithubOrg) {
        await upsertOrgSettings(resolvedEmail, {
          email: resolvedEmail,
          firstName: _existingGithubOrg.firstName || (user.name ? user.name.split(" ")[0] : (user.login ?? undefined)),
          plan: _existingGithubOrg.plan ?? "standard",
        });
        logger.info({ login: user.login }, "[Auth] GitHub login — existing org, billing data preserved");
      } else {
        await upsertOrgSettings(resolvedEmail, {
          email: resolvedEmail,
          firstName: user.name ? user.name.split(" ")[0] : (user.login ?? undefined),
          plan: "standard",
          subscriptionStatus: "pending_billing",
          name: user.login ?? undefined,
        });
        logger.info({ login: user.login }, "[Auth] GitHub login — new org created with pending_billing");
      }
    } catch (err) {
      logger.warn({ err }, "[Auth] GitHub login — org_settings persist failed (non-fatal)");
    }

    logger.info({ login: user.login }, "[Auth] GitHub login successful");

    // Issue a unique per-session token and set it as an HttpOnly cookie.
    // Direct OAuth login = org creator → owner role.
    const sessionToken = await createSession({ userId: resolvedEmail, orgId: resolvedEmail, email: resolvedEmail, role: "owner" });
    const isProd = isDeployedProd();
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
    res.redirect(`${publicUrl}/login.html?error=github_auth_failed`);
  }
});

// ── Session & Logout ──────────────────────────────────────────────────────────
router.get("/auth/session", async (req: Request, res: Response) => {
  const cookieToken: string = (req as unknown as { cookies?: Record<string, string> }).cookies?.fp_token ?? "";
  const session = cookieToken ? await getSession(cookieToken) : null;
  const authenticated = session !== null;

  // SECURITY: return only session-scoped data — never read from store.me (global singleton).
  res.json({
    authenticated,
    user: authenticated ? {
      email:     session.email,
      role:      session.role,
      firstName: session.email?.split("@")[0] ?? "User",
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

  const isProd = isDeployedProd();
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

// ── Dev-only session endpoint (Playwright / CI auth bypass) ──────────────────
// Requires ENABLE_DEV_AUTH=true AND non-production env. Returns 404 otherwise.
router.post("/auth/dev-session", async (req: Request, res: Response) => {
  const devEnabled = process.env["ENABLE_DEV_AUTH"] === "true";
  if (!devEnabled || isDeployedProd() || process.env["NODE_ENV"] === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const adminKey = (req.headers["x-admin-key"] as string) ?? "";
  const expectedKey = process.env["ADMIN_KEY"] ?? "";
  if (!expectedKey || adminKey !== expectedKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const { email = "test@flowpoint.pro", orgId = "default", role = "admin" } = (req.body as { email?: string; orgId?: string; role?: string }) || {};
  try {
    const token = await createSession({ userId: email, orgId, email, role });
    const isProd = isDeployedProd();
    res.cookie("fp_token", token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge: SESSION_TTL_MS,
      path: "/",
    });
    res.json({ ok: true, token, email, orgId, role });
  } catch (err) {
    logger.error({ err }, "[Auth] dev-session creation failed");
    res.status(500).json({ error: "Session creation failed" });
  }
});

// ── Dev-only GET login (Playwright / CI) — sets cookie then redirects ──────
// Usage: GET /api/auth/dev-login?key=ADMIN_KEY&redirect=/api/dashboard/
router.get("/auth/dev-login", async (req: Request, res: Response) => {
  const devEnabled = process.env["ENABLE_DEV_AUTH"] === "true";
  if (!devEnabled || isDeployedProd() || process.env["NODE_ENV"] === "production") {
    res.status(404).send("Not found");
    return;
  }
  const key      = (req.query["key"] as string) ?? "";
  const expected = process.env["ADMIN_KEY"] ?? "";
  if (!expected || key !== expected) { res.status(401).send("Unauthorized"); return; }
  const email    = (req.query["email"]  as string) || "test@flowpoint.pro";
  const orgId    = (req.query["orgId"]  as string) || "default";
  const role     = (req.query["role"]   as string) || "admin";
  const redirect = (req.query["redirect"] as string) || "/api/dashboard/";
  try {
    const token = await createSession({ userId: email, orgId, email, role });
    res.cookie("fp_token", token, {
      httpOnly: true, secure: false, sameSite: "lax",
      maxAge: SESSION_TTL_MS, path: "/",
    });
    res.redirect(redirect);
  } catch (err) {
    logger.error({ err }, "[Auth] dev-login failed");
    res.status(500).send("Session creation failed");
  }
});

router.get("/auth/providers", (_req: Request, res: Response) => {
  const googleConfigured = !!(process.env["GOOGLE_CLIENT_ID"] && process.env["GOOGLE_CLIENT_SECRET"]);
  // Apple requires CLIENT_ID + TEAM_ID + KEY_ID + a private key + callback route
  // Until all are present the button must stay hidden
  const appleConfigured  = !!(
    process.env["APPLE_CLIENT_ID"] &&
    process.env["APPLE_TEAM_ID"] &&
    process.env["APPLE_KEY_ID"]
  );
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
