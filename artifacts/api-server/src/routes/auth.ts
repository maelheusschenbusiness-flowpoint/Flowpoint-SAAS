import { Router, type Request, type Response } from "express";
import { randomBytes, randomUUID, createHash, createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from "crypto";

/** SHA-256 hex digest — used to hash checkout_post_tokens before DB storage. */
function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
import { store } from "../services/store.js";
import { logger } from "../lib/logger.js";
import { createSession, deleteSession, getSession, invalidateAllSessions, SESSION_TTL_MS } from "../services/sessions.js";
import { authRateLimit } from "../middlewares/rateLimiter.js";
import { requireAuth } from "../middlewares/requireAuth.js";
import { Resend } from "resend";
import { pool } from "@workspace/db";
import { loadOrgSettings } from "../services/org-settings.js";

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

/**
 * UUID v4 format pattern — used to guard DB queries on organizations.id (UUID column in prod).
 * Non-UUID orgIds (e.g. legacy email-as-orgId) must never reach organizations.id comparisons.
 */
const ORG_ID_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve or create a UUID-keyed organizations row for a legacy user.
 *
 * Called from:
 *   S3-legacy  — user not yet in `users` table (completely legacy)
 *   S6-fallback — user in `users` but no active organization_members entry
 *
 * Guarantees:
 *  - Returns a valid UUID orgId, NEVER an email string.
 *  - No ON CONFLICT anywhere — uses SELECT-then-INSERT for every write so the
 *    function works regardless of which UNIQUE constraints exist on the target DB.
 *    Avoids 42P10 ("no unique constraint matching ON CONFLICT specification").
 *  - Fully transactional: all writes run inside BEGIN … COMMIT on a single
 *    dedicated client. Any DB error triggers an explicit ROLLBACK before the
 *    client is released, leaving the DB in a clean state.
 *  - Concurrency: the S3/S6 paths are triggered only after a single-use magic
 *    link token is atomically consumed (S8), making two simultaneous calls for
 *    the same email impossible in practice.
 *
 * Throws on DB error → propagates to outer S2-S7 catch → 503.
 */
async function resolveOrCreateLegacyOrg({
  email,
  userUuid,
  orgSettings,
  authProvider = "magic_link",
}: {
  email: string;
  userUuid: string | undefined;
  orgSettings: {
    plan?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    subscriptionStatus?: string | null;
    orgName?: string | null;
  } | null;
  authProvider?: "magic_link" | "google";
}): Promise<{ orgId: string; userUuid: string }> {

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── Step A: ensure a users row exists and get its UUID ────────────────────
    // SELECT first — no ON CONFLICT (avoids 42P10 if users_email_unique absent).
    let resolvedUserUuid = userUuid;
    if (!resolvedUserUuid) {
      // S3-legacy path: user not yet in `users` — check then insert.
      const existingUser = await client.query<{ id: string }>(
        `SELECT id FROM users WHERE email = $1 LIMIT 1`,
        [email],
      );
      if (existingUser.rows.length > 0) {
        resolvedUserUuid = existingUser.rows[0].id;
      } else {
        const freshUuid = randomUUID();
        await client.query(
          `INSERT INTO users (id, email, status, email_verified, auth_provider)
           VALUES ($1::uuid, $2, 'active', true, $3)`,
          [freshUuid, email, authProvider],
        );
        resolvedUserUuid = freshUuid;
      }
    }

    // ── Step B: look for an existing UUID org keyed by owner_email ───────────
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM organizations
        WHERE owner_email = $1 AND status != 'deleted'
        LIMIT 1`,
      [email],
    );
    if (existing.rows.length > 0) {
      const orgId = existing.rows[0].id;
      // INSERT membership only if not already present — no ON CONFLICT.
      const existingMember = await client.query(
        `SELECT 1 FROM organization_members
          WHERE organization_id = $1 AND user_id = $2::uuid
          LIMIT 1`,
        [orgId, resolvedUserUuid],
      );
      if (existingMember.rows.length === 0) {
        await client.query(
          `INSERT INTO organization_members
             (id, organization_id, user_id, role, status, joined_at)
           VALUES (gen_random_uuid(), $1, $2::uuid, 'owner', 'active', NOW())`,
          [orgId, resolvedUserUuid],
        );
      }
      await client.query("COMMIT");
      return { orgId, userUuid: resolvedUserUuid };
    }

    // ── Step C: create a new UUID org + membership from org_settings data ─────
    // Fresh UUID — zero collision probability; no ON CONFLICT needed.
    const newOrgId = randomUUID();
    const slug = email.split("@")[0]!.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 63);
    await client.query(
      `INSERT INTO organizations
         (id, name, slug, owner_user_id, owner_email, status, plan,
          stripe_customer_id, stripe_subscription_id, subscription_status)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, $7, $8, $9)`,
      [
        newOrgId,
        orgSettings?.orgName || slug,
        slug,
        resolvedUserUuid,
        email,
        (orgSettings?.plan || "standard").toLowerCase(),
        orgSettings?.stripeCustomerId || null,
        orgSettings?.stripeSubscriptionId || null,
        orgSettings?.subscriptionStatus || "none",
      ],
    );
    // Fresh org — no pre-existing membership row possible.
    await client.query(
      `INSERT INTO organization_members
         (id, organization_id, user_id, role, status, joined_at)
       VALUES (gen_random_uuid(), $1, $2::uuid, 'owner', 'active', NOW())`,
      [newOrgId, resolvedUserUuid],
    );

    await client.query("COMMIT");
    return { orgId: newOrgId, userUuid: resolvedUserUuid };

  } catch (err) {
    // Explicit ROLLBACK — leaves the DB clean if any step above failed.
    try { await client.query("ROLLBACK"); } catch { /* ignore rollback error */ }
    throw err; // propagates to outer S2-S7 catch → 503
  } finally {
    client.release();
  }
}

/**
 * Atomically consume a magic-link token.
 *
 * Uses a single `UPDATE … WHERE token=$1 AND used=false AND expires_at>NOW() RETURNING email`
 * so that two concurrent requests for the same token cannot both succeed (TOCTOU eliminated).
 * If the UPDATE touches 0 rows, a follow-up SELECT distinguishes the reason.
 */
async function atomicConsumeToken(token: string): Promise<
  | { ok: true; email: string }
  | { ok: false; reason: "not_found" | "already_used" | "expired" }
> {
  const client = await pool.connect();
  try {
    // Step 1 — atomic consume: only marks used when token is valid AND unused AND not expired.
    const consumed = await client.query<{ email: string }>(
      `UPDATE magic_link_tokens
          SET used = true
        WHERE token = $1 AND used = false AND expires_at > NOW()
        RETURNING email`,
      [token]
    );
    if (consumed.rows[0]) return { ok: true, email: consumed.rows[0].email as string };

    // Step 2 — diagnose why: token may exist but be used or expired.
    const check = await client.query<{ used: boolean }>(
      `SELECT used FROM magic_link_tokens WHERE token = $1`,
      [token]
    );
    if (!check.rows[0]) return { ok: false, reason: "not_found" };
    if (check.rows[0].used) return { ok: false, reason: "already_used" };
    return { ok: false, reason: "expired" };
  } finally {
    client.release();
  }
}

/**
 * Read-only token peek — checks validity WITHOUT consuming.
 * Because the token is not marked used, any transient failure in the subsequent
 * pre-session checks leaves it available for retry.
 */
async function peekToken(token: string): Promise<
  | { ok: true; email: string }
  | { ok: false; reason: "not_found" | "already_used" | "expired" }
> {
  // Fetch token row; expiry is compared inside PostgreSQL to avoid JS/PG
  // timezone drift and pg-driver parsing differences between TIMESTAMP and
  // TIMESTAMPTZ columns.
  const check = await pool.query<{
    email: string;
    used: boolean;
    is_expired_sql: boolean; // authoritative: comparison done inside PostgreSQL
  }>(
    `SELECT email, used, expires_at <= NOW() AS is_expired_sql
     FROM magic_link_tokens WHERE token = $1`,
    [token]
  );

  if (!check.rows[0]) return { ok: false, reason: "not_found" };
  const row = check.rows[0];

  if (row.used) return { ok: false, reason: "already_used" };
  if (row.is_expired_sql) return { ok: false, reason: "expired" };

  return { ok: true, email: row.email as string };
}

/**
 * Atomic final consumption — called only after all pre-session checks have passed.
 * UPDATE … WHERE used=false prevents double-consumption if two concurrent requests
 * both survived the peek.
 */
async function finalConsumeToken(token: string): Promise<{ consumed: boolean }> {
  const result = await pool.query(
    `UPDATE magic_link_tokens SET used = true WHERE token = $1 AND used = false RETURNING email`,
    [token]
  );
  return { consumed: result.rows.length > 0 };
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
        id: dbData.orgId || orgId,
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
  const smtpPass  = process.env["SMTP_PASS"];
  const smtpHost  = process.env["SMTP_HOST"];

  if (!resendKey && (!smtpPass || !smtpHost)) {
    logger.warn("[Auth] No complete email transport (Resend, or SMTP_HOST + SMTP_PASS) — cannot send magic link");
    throw new Error("EMAIL_TRANSPORT_MISSING");
  }

  // Centralized transactional sender — override via RESEND_FROM or SMTP_FROM env var
  const fromEmail =
    process.env["RESEND_FROM"] ||
    process.env["SMTP_FROM"] ||
    `FlowPoint <${process.env["ALERT_EMAIL_FROM"] || "noreply@flowpoint.pro"}>`;

  logger.info({
    email,
    from: fromEmail,
    transport: resendKey ? "resend-sdk" : "smtp",
    publicBaseUrl: process.env["PUBLIC_BASE_URL"] || "(not set)",
  }, "[Auth] Sending magic link email");

  // ── Send via available transport ────────────────────────────────────────────
  const _emailSubject = "Votre lien de connexion FlowPoint";
  const _emailHtml = `<!DOCTYPE html>
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
</html>`;

  if (resendKey) {
    // ── Resend SDK path ──────────────────────────────────────────────────────
    const resendClient = new Resend(resendKey);
    let result: Awaited<ReturnType<typeof resendClient.emails.send>>;
    try {
      result = await resendClient.emails.send({
        from:    fromEmail,
        to:      email,
        subject: _emailSubject,
        html:    _emailHtml,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, email, from: fromEmail }, "[Auth] Resend SDK threw error");
      throw new Error("EMAIL_SEND_FAILED: " + msg);
    }
    if (result.error) {
      const errMsg = (result.error as { message?: string }).message || JSON.stringify(result.error);
      logger.error({ error: result.error, email }, "[Auth] Resend API error");
      if (
        errMsg.toLowerCase().includes("domain") ||
        errMsg.toLowerCase().includes("not verified") ||
        errMsg.toLowerCase().includes("sender")
      ) {
        throw new Error("DOMAIN_NOT_VERIFIED: " + errMsg);
      }
      throw new Error("RESEND_ERROR: " + errMsg);
    }
    logger.info({ email, id: result.data?.id, from: fromEmail }, "[Auth] Magic link sent (Resend SDK)");
  } else {
    // ── SMTP path (nodemailer) — used when RESEND_API_KEY absent ────────────
    const { createTransport } = await import("nodemailer");
    const smtp = createTransport({
      host:   smtpHost!,
      port:   parseInt(process.env["SMTP_PORT"] || "465", 10),
      secure: process.env["SMTP_SECURE"] !== "false",
      auth:   { user: process.env["SMTP_USER"] || "resend", pass: smtpPass! },
    });
    try {
      const info = await smtp.sendMail({ from: fromEmail, to: email, subject: _emailSubject, html: _emailHtml });
      logger.info({ messageId: info.messageId, email, from: fromEmail }, "[Auth] Magic link sent (SMTP)");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: msg, email, from: fromEmail }, "[Auth] SMTP send failed");
      throw new Error("EMAIL_SEND_FAILED: " + msg);
    }
  }
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

  // ── Guard: reject if no registered account, pending activation, or blocked ──
  // Checks both new architecture (users table) and legacy (org_settings).
  // If either DB check fails, we return 503 — never silently allow unknown accounts.
  try {
    const { pool: _guardPool } = await import("@workspace/db");

    // 1. Check new architecture — users table (authoritative for new signups)
    const userRow = await _guardPool.query<{ status: string }>(
      `SELECT status FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );

    if (userRow.rows.length > 0) {
      const userStatus = userRow.rows[0].status;
      if (userStatus === "pending") {
        logger.warn({ email }, "[Auth] login-request: user pending activation (Stripe not completed)");
        res.status(402).json({
          error: "Votre compte est en attente d'activation. Vérifiez votre email après avoir finalisé votre paiement sur /signin.html, ou complétez votre inscription.",
          redirectTo: "/signin.html",
        });
        return;
      }
      if (userStatus === "suspended") {
        logger.warn({ email }, "[Auth] login-request: user suspended");
        res.status(403).json({
          error: "Votre compte a été suspendu. Contactez le support.",
        });
        return;
      }
      if (userStatus !== "active") {
        logger.warn({ email, status: userStatus }, "[Auth] login-request: user not active");
        res.status(403).json({ error: "Votre compte n'est plus actif. Contactez le support." });
        return;
      }
      // User is active in new architecture — allow magic link
    } else {
      // 2. Fallback: legacy org_settings check for accounts not yet in users table
      const { loadOrgSettings: _checkAccount } = await import("../services/org-settings.js");
      const _existingAccount = await _checkAccount(email).catch(() => undefined);
      if (_existingAccount === null) {
        logger.warn({ email }, "[Auth] login-request: no account found — rejected");
        res.status(404).json({
          error: "Aucun compte trouvé pour cette adresse email. Créez votre compte sur /signin.html.",
          redirectTo: "/signin.html",
        });
        return;
      }
      if (_existingAccount && _existingAccount.subscriptionStatus === "pending_billing") {
        logger.warn({ email }, "[Auth] login-request: pending_billing account (legacy) — rejected");
        res.status(402).json({
          error: "Votre inscription est en attente de paiement. Veuillez finaliser votre abonnement.",
          redirectTo: "/signin.html",
        });
        return;
      }
    }
  } catch (_accountGuardErr) {
    logger.error({ err: _accountGuardErr, email }, "[Auth] login-request: DB unreachable during account guard — 503");
    res.status(503).json({
      error: "Service temporairement indisponible. Veuillez réessayer dans quelques instants.",
    });
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

  // ── Send via configured email transport ───────────────────────────────────────
  const resendKey = process.env["RESEND_API_KEY"];
  const isProduction = isDeployedProd();
  const isDevWorkspace = !!process.env["REPLIT_DEV_DOMAIN"];

  const smtpConfigured = !!(process.env["SMTP_HOST"] && process.env["SMTP_PASS"]);
  if (resendKey || smtpConfigured) {
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

      if (msg.startsWith("EMAIL_TRANSPORT_MISSING")) {
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
    logger.warn({ email, debugLink: verifyPath }, "[Auth] No configured email transport — returning debugLink");
    res.json({ ok: true, debugLink: verifyPath, message: "Mode debug\u00a0: lien retourné directement." });
  } else {
    logger.error("[Auth] RESEND_API_KEY not set in production");
    res.status(503).json({ error: "Service email non configuré. Connectez-vous avec Google." });
  }
});

// ── BLOCKED: /auth/register is no longer available. ──────────────────────────
// All new accounts must go through pending_signup → Stripe Checkout → webhook.
// Existing route is preserved as a 410 to avoid breaking old clients silently.
router.post("/auth/register", authRateLimit, (_req: Request, res: Response) => {
  logger.warn("[Auth] /auth/register called — BLOCKED (legacy path)");
  res.status(410).json({
    error: "Cette voie d'inscription n'est plus disponible. Créez votre compte sur /signin.html après paiement.",
    redirectTo: "/signin.html",
  });
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

    if (!_existing) {
      // SECURITY: New account creation via /auth/signup is BLOCKED.
      // All new accounts must go through: /auth/pre-register → Stripe Checkout → webhook → checkout_post_tokens.
      // This prevents creating accounts and sessions before Stripe payment is confirmed.
      logger.warn({ orgId }, "[Auth/Signup] New account creation BLOCKED — must use /signin.html + Stripe");
      res.status(410).json({
        error: "Les nouveaux comptes doivent être créés via /signin.html après paiement Stripe. Si vous avez déjà un compte, connectez-vous avec le lien reçu par email.",
        redirectTo: "/signin.html",
      });
      return;
    }

    // Existing account — update contact info ONLY, never touch billing data.
    await upsertOrgSettings(orgId, {
      firstName: fn  || _existing.firstName  || undefined,
      lastName:  ln  || _existing.lastName   || undefined,
      country:   country  ?? _existing.country  ?? null,
      city:      city?.trim()    ?? _existing.city    ?? null,
      address:   address?.trim() ?? _existing.address ?? null,
    }).catch((e) => logger.warn({ e }, "[Auth/Signup] contact-only upsert failed"));
    logger.info({ orgId, email: normalizedEmail }, "[Auth/Signup] Existing account detected — billing data preserved");
  } catch (err) {
    logger.warn({ err }, "[Auth/Signup] upsertOrgSettings failed (non-fatal)");
    // Non-fatal — still send the magic link for existing account
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
      orgId,
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

       // Do not send onboarding emails here. This endpoint creates only a
       // pre-registration/magic-link request; the account is not active until
       // Stripe activation succeeds. Sending a welcome here was the source of
       // delayed or misleading welcome messages after abandoned signups.
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

  // ── Guard: reject if the email is already tied to an active account ──────────
  // Checks three surfaces in priority order:
  //   1. users table (active status) — covers both owners and team members
  //   2. organization_members (active row) — invited users who completed sign-up
  //   3. org_settings (legacy table) — pre-migration accounts
  // Any positive match → redirect to /login.html so the user signs in normally
  // rather than accidentally creating a duplicate account or being shown the
  // pricing plan screen when they should land on the dashboard.
  try {
    const _activeUser = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM users WHERE email = $1 LIMIT 1`,
      [normalizedEmail]
    );
    if (_activeUser.rows.length > 0 && _activeUser.rows[0]?.status === "active") {
      res.status(409).json({
        error: "Un compte existe déjà avec cette adresse email. Veuillez vous connecter.",
        redirectTo: "/login.html",
      });
      return;
    }

    // Also catch invited team members who may have no org_settings row
    const _activeMember = await pool.query(
      `SELECT om.id FROM organization_members om
       JOIN users u ON u.id = om.user_id
       WHERE u.email = $1 AND om.status = 'active' LIMIT 1`,
      [normalizedEmail]
    );
    if (_activeMember.rows.length > 0) {
      res.status(409).json({
        error: "Cette adresse est déjà associée à une organisation FlowPoint. Veuillez vous connecter.",
        redirectTo: "/login.html",
      });
      return;
    }
  } catch (_activeCheckErr) {
    logger.warn({ err: _activeCheckErr, email: normalizedEmail }, "[Auth/PreRegister] active-user guard failed (non-fatal)");
  }

  // ── Guard: reject if account already exists in org_settings (legacy) ──────
  try {
    const { loadOrgSettings: _dupCheck } = await import("../services/org-settings.js");
    const _dup = await _dupCheck(normalizedEmail).catch(() => undefined);
    if (_dup?.orgId) {
      res.status(409).json({
        error: "Un compte existe déjà avec cette adresse email. Veuillez vous connecter sur /login.html.",
        redirectTo: "/login.html",
      });
      return;
    }
  } catch (_dupErr) {
    logger.warn({ err: _dupErr, email: normalizedEmail }, "[Auth/PreRegister] duplicate check failed (non-fatal)");
  }

  // ── Guard: handle existing pending checkout ──────────────────────────────────
  // Two distinct cases:
  //   A) Account already created (org_settings exists) → redirect to login.
  //   B) Pending signup exists but checkout was never completed (no org_settings)
  //      → invalidate the stale token so the user can retry immediately.
  //      This handles: browser closed mid-checkout, Stripe page didn't load, etc.
  {
    const _pendClient = await pool.connect();
    try {
      const _pend = await _pendClient.query(
        `SELECT token FROM pending_signups
         WHERE email = $1 AND expires_at > NOW() AND consumed_at IS NULL
         LIMIT 1`,
        [normalizedEmail]
      );
      if (_pend.rows.length > 0) {
        // Check if the account was actually created
        const { loadOrgSettings: _orgCheck } = await import("../services/org-settings.js");
        const _org = await _orgCheck(normalizedEmail).catch(() => undefined);
        if (_org?.orgId) {
          // Case A: real account exists → login
          res.status(409).json({
            error: "Un compte existe déjà avec cette adresse email. Veuillez vous connecter.",
            redirectTo: "/login.html",
          });
          return;
        }
        // Case B: checkout was abandoned — invalidate stale token, allow retry
        await _pendClient.query(
          `UPDATE pending_signups SET consumed_at = NOW()
           WHERE email = $1 AND consumed_at IS NULL`,
          [normalizedEmail]
        );
        logger.info({ email: normalizedEmail }, "[Auth/PreRegister] stale pending signup invalidated — user may retry");
      }
    } finally {
      _pendClient.release();
    }
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

  // Create users row with status='pending' — no session, no magic link yet.
  // Stripe webhook is the only path that activates this account.
  try {
    const { pool: pgPool } = await import("@workspace/db");
    await pgPool.query(
      `INSERT INTO users (email, first_name, last_name, auth_provider, email_verified, status)
       VALUES ($1, $2, $3, 'magic_link', FALSE, 'pending')
       ON CONFLICT (email) DO NOTHING`,
      [normalizedEmail, fn, ln]
    );
    logger.info({ email: normalizedEmail }, "[Auth/PreRegister] users row created (status=pending)");
  } catch (usersErr) {
    logger.warn({ usersErr, email: normalizedEmail }, "[Auth/PreRegister] users row creation failed (non-fatal)");
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
  /*
   * ══════════════════════════════════════════════════════════════════════════
   * NEW FLOW (2026-07): Stripe is the sole activation gate.
   *
   * This endpoint verifies the Stripe payment is confirmed, then returns a
   * "check your email" response. NO session is created here.
   *
   * The Stripe webhook (stripe-webhook.ts / checkout.session.completed) is
   * the ONLY path that activates the account and sends the magic link email.
   *
   * Sequence:
   *   1. User completes Stripe checkout → redirected here with ?session_id=…
   *   2. We verify the session is paid with Stripe API
   *   3. If already paid → webhook has fired (or will) → return { emailSent: true }
   *   4. User receives email with magic link → clicks it → login-verify (6 checks)
   * ══════════════════════════════════════════════════════════════════════════
   */
  const { session_id: sessionId } = req.query as { session_id?: string };
  if (!sessionId || typeof sessionId !== "string" || sessionId.length < 8) {
    res.status(400).json({ error: "session_id manquant ou invalide." });
    return;
  }

  try {
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
        "[Auth/CheckoutComplete] Session not yet confirmed");
      // Transient — frontend should poll briefly
      res.status(202).json({
        pending: true,
        message: "Paiement en cours de confirmation. Veuillez patienter quelques secondes.",
      });
      return;
    }

    const meta = (session.metadata as Record<string, string>) ?? {};
    const orgId = meta["orgId"] ?? "";
    const email = orgId || (session.customer_details?.email ?? "");

    logger.info({ sessionId, orgId, email }, "[Auth/CheckoutComplete] Stripe session confirmed — awaiting webhook");

    store.logActivity({
      type: "account",
      label: `Paiement confirmé — activation en cours : ${email || orgId}`,
      targetId: orgId || email,
      targetType: "user",
      orgId: orgId || undefined,
    }).catch(() => {});

    // Return immediately — the webhook will send the magic link email.
    // No session is created here.
    res.json({
      ok: true,
      emailSent: true,
      message: "Votre paiement est confirmé. Un lien de connexion vous a été envoyé par email. Vérifiez votre boîte de réception (et vos spams).",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isStripeErr = err instanceof Error && (
      (err as unknown as Record<string, unknown>)["type"] === "StripeInvalidRequestError" ||
      msg.includes("No such") || msg.includes("no such") ||
      msg.includes("resource_missing") || msg.includes("invalid_request")
    );
    if (isStripeErr) {
      logger.warn({ err: msg, sessionId }, "[Auth/CheckoutComplete] Invalid Stripe session");
      res.status(400).json({ error: "Session de paiement introuvable ou invalide." });
      return;
    }
    logger.error({ err: msg, sessionId }, "[Auth/CheckoutComplete] Error");
    res.status(500).json({ error: "Erreur lors de la finalisation. Réessayez ou contactez le support." });
  }
});

/** Shared handler — called by both GET and POST /auth/login-verify */
async function handleLoginVerify(tokenRaw: string | undefined, req: Request, res: Response): Promise<void> {
  // ── S0: Token guard ───────────────────────────────────────────────────────
  if (!tokenRaw || typeof tokenRaw !== "string" || !tokenRaw.trim()) {
    res.status(400).json({ error: "Token manquant" });
    return;
  }
  const token = tokenRaw.trim();

  // ── S1: Peek token (SELECT only — no UPDATE) ──────────────────────────────
  let peeked: Awaited<ReturnType<typeof peekToken>>;
  try {
    peeked = await peekToken(token);
  } catch (dbErr) {
    logger.error({ err: dbErr instanceof Error ? dbErr.message : String(dbErr) }, "login-verify: peekToken error");
    res.status(500).json({ error: "Erreur base de données. Veuillez réessayer." });
    return;
  }

  if (!peeked.ok) {
    switch (peeked.reason) {
      case "already_used":
        res.status(410).json({ error: "Ce lien a déjà été utilisé. Demandez un nouveau lien si nécessaire." });
        return;
      case "expired":
        res.status(401).json({ error: "Ce lien a expiré. Demandez un nouveau lien de connexion." });
        return;
      default:
        res.status(401).json({ error: "Lien invalide ou expiré." });
        return;
    }
  }

  const email = peeked.email;

  // ── S2: DB reads (users + organization_members) ───────────────────────────
  let sessionOrgId: string;
  let sessionRole: string;
  let sessionUserUuid: string | undefined;

  try {
    // S2a — users query
    let userRow: { rows: Array<{ id: string; status: string; email_verified: boolean }> };
    try {
      userRow = await pool.query<{ id: string; status: string; email_verified: boolean }>(
        `SELECT id, status, email_verified FROM users WHERE email = $1`,
        [email]
      ) as { rows: Array<{ id: string; status: string; email_verified: boolean }> };
    } catch (qErr) {
      logger.error({ err: qErr instanceof Error ? (qErr as Error).message : String(qErr) }, "login-verify: users query error");
      throw qErr; // re-throw to outer catch → 503
    }

    // S2b — organization_members JOIN organizations query
    let memberRow: { rows: Array<{ organization_id: string; role: string; status: string; org_status: string; subscription_status: string }> };
    try {
      memberRow = await pool.query<{
        organization_id: string; role: string; status: string; org_status: string; subscription_status: string;
      }>(
        `SELECT om.organization_id, om.role, om.status AS member_status,
                o.status AS org_status, o.subscription_status
         FROM organization_members om
         JOIN organizations o ON o.id::text = om.organization_id
         WHERE om.user_id = (SELECT id FROM users WHERE email = $1 LIMIT 1)
           AND om.status = 'active'
           AND o.status != 'deleted'
         ORDER BY om.joined_at ASC
         LIMIT 1`,
        [email]
      ) as { rows: Array<{ organization_id: string; role: string; status: string; org_status: string; subscription_status: string }> };
    } catch (qErr) {
      logger.error({ err: qErr instanceof Error ? (qErr as Error).message : String(qErr) }, "login-verify: org_members query error");
      throw qErr;
    }

    // ── S3: Check 2 — user existence ─────────────────────────────────────

    if (userRow.rows.length === 0) {
      // S3-legacy: user not in users table — try org_settings
      let orgCheck: Awaited<ReturnType<typeof loadOrgSettings>> | null;
      try {
        orgCheck = await loadOrgSettings(email).catch(() => null);
      } catch (osErr) {
        logger.error({ err: osErr instanceof Error ? osErr.message : String(osErr) }, "login-verify: S3-legacy loadOrgSettings error");
        throw osErr;
      }

      if (orgCheck === null) {
        res.status(404).json({ error: "Aucun compte associé à cette adresse email.", redirectTo: "/signin.html" });
        return;
      }
      if (orgCheck.subscriptionStatus === "pending_billing") {
        res.status(402).json({ error: "Votre compte n'est pas encore activé. Veuillez compléter votre inscription.", redirectTo: "/signin.html" });
        return;
      }
      // Resolve or create a UUID org — never store email as orgId.
      const s3Result = await resolveOrCreateLegacyOrg({
        email, userUuid: undefined, orgSettings: orgCheck,
      });
      sessionOrgId    = s3Result.orgId;
      sessionRole     = "owner";
      sessionUserUuid = s3Result.userUuid;

    } else {
      const user = userRow.rows[0]!;

      // ── S4: Check 3 — email verified ──────────────────────────────────
      if (!user.email_verified) {
        res.status(403).json({ error: "Adresse email non vérifiée. Vérifiez votre boîte mail." });
        return;
      }

      // ── S5: Check 4 — user active ─────────────────────────────────────
      if (user.status !== "active") {
        res.status(403).json({
          error: user.status === "suspended"
            ? "Votre compte a été suspendu. Contactez le support."
            : "Votre compte n'est plus actif.",
        });
        return;
      }

      // ── S6: Check 5 — org membership ─────────────────────────────────
      if (memberRow.rows.length === 0) {
        // S6-pending: check if this user has a pending (not-yet-accepted) invitation
        // before falling through to org_settings — invited members arrive here when
        // they click the magic-link before accepting their invite.
        let pendingInvite: { rows: Array<{ org_id: string; role: string }> } | null = null;
        try {
          pendingInvite = await pool.query<{ org_id: string; role: string }>(
            `SELECT org_id, role FROM org_members
             WHERE email = $1 AND status = 'pending'
               AND (expires_at IS NULL OR expires_at > NOW())
             LIMIT 1`,
            [email]
          ) as { rows: Array<{ org_id: string; role: string }> };
        } catch { /* non-fatal — table may use different schema */ }

        if (pendingInvite && pendingInvite.rows.length > 0) {
          // Promote invite to active so the member can log in immediately
          const inv = pendingInvite.rows[0]!;
          try {
            await pool.query(
              `UPDATE org_members SET status='active', joined_at=NOW(), accepted_at=NOW()
               WHERE email=$1 AND org_id=$2 AND status='pending'`,
              [email, inv.org_id]
            );
          } catch { /* non-fatal — fall through to log them in anyway */ }
          sessionOrgId    = inv.org_id;
          sessionRole     = inv.role || "member";
          sessionUserUuid = user.id;

        } else {
          // S6-fallback: user exists but no org_members row — try org_settings
          let orgFallback: Awaited<ReturnType<typeof loadOrgSettings>> | null;
          try {
            orgFallback = await loadOrgSettings(email).catch(() => null);
          } catch (osErr) {
            logger.error({ err: osErr instanceof Error ? osErr.message : String(osErr) }, "login-verify: S6-fallback loadOrgSettings error");
            throw osErr;
          }

          if (!orgFallback) {
            res.status(403).json({ error: "Votre compte n'est associé à aucune organisation active." });
            return;
          }
          if (orgFallback.subscriptionStatus === "pending_billing") {
            res.status(402).json({ error: "Votre compte n'est pas encore activé. Veuillez compléter votre inscription.", redirectTo: "/signin.html" });
            return;
          }
          // Resolve or create a UUID org — never store email as orgId.
          const s6Result = await resolveOrCreateLegacyOrg({
            email, userUuid: user.id, orgSettings: orgFallback,
          });
          sessionOrgId    = s6Result.orgId;
          sessionRole     = "owner";
          sessionUserUuid = s6Result.userUuid;
        }

      } else {
        const member = memberRow.rows[0]!;

        // ── S6b: role valid ───────────────────────────────────────────
        if (!["owner", "admin", "member", "viewer"].includes(member.role)) {
          res.status(403).json({ error: "Rôle invalide." });
          return;
        }

        sessionOrgId    = member.organization_id;
        sessionRole     = member.role;
        sessionUserUuid = user.id;
      }
    }

  } catch (guardErr) {
    logger.error({ err: guardErr instanceof Error ? guardErr.message : String(guardErr) }, "login-verify: guard error → 503");
    res.status(503).json({
      error: "Erreur temporaire. Veuillez réessayer en cliquant à nouveau sur le lien de connexion.",
    });
    return;
  }

  // ── S8: Atomic token consumption ──────────────────────────────────────────
  try {
    const { consumed } = await finalConsumeToken(token);
    if (!consumed) {
      res.status(410).json({ error: "Ce lien a déjà été utilisé. Demandez un nouveau lien si nécessaire." });
      return;
    }
  } catch (consumeErr) {
    logger.error({ err: consumeErr instanceof Error ? consumeErr.message : String(consumeErr) }, "login-verify: finalConsumeToken error");
    res.status(503).json({ error: "Erreur temporaire. Veuillez réessayer en cliquant à nouveau sur le lien de connexion." });
    return;
  }

  // ── S9: Invalidate existing sessions ─────────────────────────────────────
  await invalidateAllSessions(email).catch((err) => {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "login-verify: invalidateAllSessions failed (non-fatal)");
  });

  // ── S10: Create session ───────────────────────────────────────────────────
  let sessionToken: string;
  try {
    sessionToken = await createSession({
      userId:    sessionOrgId,
      orgId:     sessionOrgId,
      email,
      role:      sessionRole,
      userUuid:  sessionUserUuid,
       ipAddress: req.ip ?? undefined,
      userAgent: (req.headers["user-agent"] as string | undefined) ?? undefined,
    });
  } catch (sessErr) {
    logger.error({ err: sessErr instanceof Error ? sessErr.message : String(sessErr) }, "login-verify: createSession error");
    res.status(503).json({ error: "Erreur temporaire. Veuillez réessayer." });
    return;
  }

  // Update last_login_at (fire-and-forget)
  pool.query(`UPDATE users SET last_login_at = NOW() WHERE email = $1`, [email])
    .catch((err) => logger.warn({ err: err instanceof Error ? err.message : String(err) }, "login-verify: last_login_at update failed"));

  // ── S11: Set cookie ───────────────────────────────────────────────────────
  const isProd = isDeployedProd();
  res.cookie("fp_token", sessionToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "none" : "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });

  // ── S12: Send success response ────────────────────────────────────────────
  // Return the session token in the body so the frontend can store it
  // in sessionStorage (per-tab isolation) — prevents cross-user contamination
  // when two accounts are tested in the same browser simultaneously.
  res.json({ ok: true, email, message: "Connexion réussie", token: sessionToken });

  // Fire-and-forget: ensure Stripe customer (non-blocking, after response sent)
  (async () => {
    const stripeKey = process.env["STRIPE_LIVE_API_KEY"] ?? process.env["STRIPE_SECRET_KEY"] ?? "";
    if (!stripeKey) return;
    try {
      const { ensureStripeCustomer } = await import("../services/ensure-stripe-customer.js");
      await ensureStripeCustomer(sessionOrgId);
    } catch (stripeErr) {
      logger.warn({ err: stripeErr instanceof Error ? stripeErr.message : String(stripeErr) }, "login-verify: ensureStripeCustomer failed (non-fatal)");
    }
  })();
}

// GET — kept for backward compatibility (existing email links point to login-verify.html?token=...
// which makes the AJAX call). The static HTML file does the actual AJAX — email scanners
// pre-fetch the HTML page URL, not the API endpoint, so the risk is low.
// New deployments of login-verify.js use POST; GET still works atomically.
router.get("/auth/login-verify", (req: Request, res: Response) => {
  return handleLoginVerify(req.query["token"] as string | undefined, req, res);
});

// POST — preferred path; login-verify.js sends the token in the request body so that
// email-scanner prefetch (SafeLinks, Barracuda, etc.) cannot consume the token via GET.
router.post("/auth/login-verify", (req: Request, res: Response) => {
  const token = req.body?.token ?? req.query["token"];
  return handleLoginVerify(typeof token === "string" ? token : undefined, req, res);
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

    // Persist org settings (including plan) so /api/me returns correct plan after restart.
    // OAuth must also create a UUID-backed identity before issuing a session:
    // orgContext correctly rejects legacy email-as-orgId sessions.
    let googleIdentity: { orgId: string; userUuid: string };
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
        // New account — pending billing until Checkout activates it.
        await upsertOrgSettings(resolvedEmail, {
          email: resolvedEmail,
          firstName: user.name ? user.name.split(" ")[0] : undefined,
          plan: planFromState ?? "standard",
          subscriptionStatus: "pending_billing",
          orgName: user.email ?? undefined,
        });
        logger.info({ email: resolvedEmail, plan: planFromState }, "[Auth] Google login — new org created with pending_billing");
      }

      // Preserve the billing gate: an OAuth signup may create its identity, but
      // it must complete Checkout before a valid dashboard session is issued.
      const googleOrgSettings = await _loadGoogleOrg(resolvedEmail);
      if (googleOrgSettings?.subscriptionStatus === "pending_billing") {
        // Create a pending_signups record so checkout.html / checkout-payment.html
        // can complete the Stripe flow identically to the email signup path.
        // First, invalidate any stale pending token for this email.
        const googleFirstName = user.name ? user.name.split(" ")[0] : "Google";
        const googleLastName  = user.name && user.name.split(" ").length > 1
          ? user.name.split(" ").slice(1).join(" ")
          : "User";
        let googlePreRegToken = "";
        try {
          const _gpClient = await pool.connect();
          try {
            // Invalidate any existing non-consumed pending signup for this email
            await _gpClient.query(
              `UPDATE pending_signups SET consumed_at = NOW()
               WHERE email = $1 AND consumed_at IS NULL`,
              [resolvedEmail],
            );
            // Insert a fresh pending_signups row
            googlePreRegToken = generateToken();
            await _gpClient.query(
              `INSERT INTO pending_signups
                 (token, email, first_name, last_name, company_name, country, address, city, postal_code, created_at, expires_at)
               VALUES ($1,$2,$3,$4,$5,'FR','—','—','00000',NOW(),NOW() + INTERVAL '2 hours')
               ON CONFLICT (token) DO NOTHING`,
              [googlePreRegToken, resolvedEmail, googleFirstName, googleLastName, resolvedEmail],
            );
            logger.info({ email: resolvedEmail }, "[Auth] Google signup — pending_signups record created for checkout");
          } finally {
            _gpClient.release();
          }
        } catch (preRegErr) {
          logger.error({ err: preRegErr, email: resolvedEmail }, "[Auth] Google signup — pending_signups creation failed (fatal)");
          res.redirect(`${publicUrl}/signin.html?error=google_signup_retry`);
          return;
        }
        if (!googlePreRegToken) {
          logger.error({ email: resolvedEmail }, "[Auth] Google signup — pre_reg_token is empty after insert, aborting");
          res.redirect(`${publicUrl}/signin.html?error=google_signup_retry`);
          return;
        }
        const planParam = encodeURIComponent(planFromState ?? googleOrgSettings.plan ?? "standard");
        const emailParam = encodeURIComponent(resolvedEmail);
        const firstParam = encodeURIComponent(googleFirstName);
        const lastParam  = encodeURIComponent(googleLastName);
        const tokenParam = encodeURIComponent(googlePreRegToken);
        res.redirect(
          `${publicUrl}/signin.html?google_signup=1&plan=${planParam}&email=${emailParam}&first_name=${firstParam}&last_name=${lastParam}&pre_reg_token=${tokenParam}`,
        );
        return;
      }

      googleIdentity = await resolveOrCreateLegacyOrg({
        email: resolvedEmail,
        userUuid: undefined,
        orgSettings: googleOrgSettings,
        authProvider: "google",
      });
    } catch (err) {
      logger.error({ err }, "[Auth] Google login — identity provisioning failed");
      res.redirect(`${publicUrl}/login.html?error=google_auth_failed`);
      return;
    }

    logger.info({ email: user.email }, "[Auth] Google login successful");

    // Issue a unique per-session token and set it as an HttpOnly cookie.
    // Direct OAuth login = org creator → owner role.
    const sessionToken = await createSession({
      userId: googleIdentity.orgId, orgId: googleIdentity.orgId, userUuid: googleIdentity.userUuid,
      email: resolvedEmail, role: "owner",
       ipAddress: req.ip ?? undefined,
      userAgent: (req.headers["user-agent"] as string | undefined) ?? undefined,
    });
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
          orgName: user.login ?? undefined,
        });
        logger.info({ login: user.login }, "[Auth] GitHub login — new org created with pending_billing");
      }
    } catch (err) {
      logger.warn({ err }, "[Auth] GitHub login — org_settings persist failed (non-fatal)");
    }

    logger.info({ login: user.login }, "[Auth] GitHub login successful");

    // Issue a unique per-session token and set it as an HttpOnly cookie.
    // Direct OAuth login = org creator → owner role.
    const sessionToken = await createSession({
      userId: resolvedEmail, orgId: resolvedEmail, email: resolvedEmail, role: "owner",
       ipAddress: req.ip ?? undefined,
      userAgent: (req.headers["user-agent"] as string | undefined) ?? undefined,
    });
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

// ── Session restore ────────────────────────────────────────────────────────────
// Returns the raw fp_token from the cookie so the browser client can write it
// into sessionStorage (per-tab isolation).  Needed when the user opens a new
// dashboard tab (bookmark / address-bar navigation) where sessionStorage is empty
// but the HttpOnly cookie already carries a valid session.
// No requireAuth wrapper — this IS the auth-bootstrap call.
router.post("/auth/session-restore", async (req: Request, res: Response) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cookieToken: string | undefined = (req as any).cookies?.fp_token;
  const authHeader = req.headers["authorization"] ?? "";
  const bearerToken =
    typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : undefined;
  // Resolution order:
  //   1. Bearer token (per-tab sessionStorage) — validate it first.
  //   2. Cookie (fp_token) — fallback when Bearer is absent or stale.
  //      This is the critical recovery path: a hard refresh may still have
  //      a valid cookie even when the Bearer in sessionStorage has gone stale
  //      (e.g. after re-login from another tab invalidated the old session).
  //      Without this fallback the client gets an immediate 401 and bounces to login.
  let session = null;
  let provided: string | undefined;

  if (bearerToken) {
    session = await getSession(bearerToken);
    if (session) {
      provided = bearerToken;
    } else if (cookieToken && cookieToken !== bearerToken) {
      // Bearer stale — try cookie as fallback
      session = await getSession(cookieToken);
      if (session) provided = cookieToken;
    }
  } else if (cookieToken) {
    session = await getSession(cookieToken);
    if (session) provided = cookieToken;
  }

  if (!session || !provided) {
    // Neither token is valid — clear the cookie so the browser stops retrying
    const isProd = isDeployedProd();
    if (cookieToken) {
      res.clearCookie("fp_token", {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? "none" : "lax",
        path: "/",
      });
    }
    res.status(401).json({ error: "session_expired" });
    return;
  }
  // Return the canonical valid token so the client can (re)store it in sessionStorage.
  // If the Bearer was stale and the cookie was used, the client receives the cookie's
  // token and updates sessionStorage — recovering silently without a login redirect.
  res.json({ token: provided, email: session.email, orgId: session.orgId });
});

router.post("/auth/logout", async (req: Request, res: Response) => {
  // Resolve the session token from cookie first (primary), then Bearer header
  // (fallback for API clients and test harnesses that cannot set HttpOnly cookies).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cookieToken: string = (req as any).cookies?.fp_token ?? "";
  const authHeader  = req.headers["authorization"] ?? "";
  const bearerToken = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
  // Prefer the per-tab Bearer token. The HttpOnly cookie is shared by all tabs,
  // while Bearer is the session selected by this specific dashboard tab.
  const sessionToken = bearerToken || cookieToken;
  if (sessionToken) {
    await deleteSession(sessionToken);   // must await — response must not return before DB delete
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
    res.redirect("/login.html?error=apple_not_configured");
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

// ── Apple Sign In callback (POST — Apple uses form_post response_mode) ────────

/** Base64-URL encode a Buffer (no padding). */
function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/**
 * Build the ES256 client_secret JWT Apple requires for the code exchange.
 * Uses Node's built-in crypto — no extra packages needed.
 */
function buildAppleClientSecret(clientId: string, teamId: string, keyId: string, rawPem: string): string {
  const now    = Math.floor(Date.now() / 1000);
  const hdr    = b64url(Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId })));
  const ply    = b64url(Buffer.from(JSON.stringify({
    iss: teamId,
    iat: now,
    exp: now + 86_400,   // 24 h max
    aud: "https://appleid.apple.com",
    sub: clientId,
  })));
  const signingInput = Buffer.from(`${hdr}.${ply}`);
  const privKey      = createPrivateKey({ key: rawPem, format: "pem" });
  // ES256: SHA-256 + IEEE-P1363 (r||s) format
  const sig = cryptoSign("SHA256", signingInput, { key: privKey, dsaEncoding: "ieee-p1363" });
  return `${hdr}.${ply}.${b64url(sig)}`;
}

router.post("/auth/apple/callback", async (req: Request, res: Response) => {
  const publicUrl = getPublicUrl();
  const body      = req.body as Record<string, string | undefined>;
  const code      = body["code"]     ?? "";
  const idToken   = body["id_token"] ?? "";
  // Apple only sends `user` JSON on the VERY FIRST auth for this user+app pair
  const userJson  = body["user"]     ?? "";

  if (!code) {
    const appleError = body["error"] ?? "missing_code";
    logger.warn({ appleError }, "[Auth] Apple callback — missing code");
    res.redirect(`${publicUrl}/login.html?error=${encodeURIComponent(appleError)}`);
    return;
  }

  const clientId = process.env["APPLE_CLIENT_ID"] ?? "";
  if (!clientId) {
    res.redirect(`${publicUrl}/login.html?error=apple_not_configured`);
    return;
  }

  try {
    let appleEmail: string | undefined;
    let appleSub:   string | undefined;

    // ── Step 1: verify the id_token that Apple sent in the form_post body ──────
    if (idToken) {
      const parts = idToken.split(".");
      if (parts.length === 3) {
        try {
          const headerObj  = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as { kid?: string };
          const payloadObj = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
          // Fetch Apple's public JWKS
          const jwksRes = await fetch("https://appleid.apple.com/auth/keys");
          if (jwksRes.ok) {
            const jwks = await jwksRes.json() as { keys: Array<JsonWebKey & { kid?: string }> };
            const jwk  = jwks.keys.find((k) => k.kid === headerObj.kid);
            if (jwk) {
              const pubKey   = createPublicKey({ key: jwk as unknown as Parameters<typeof createPublicKey>[0] & object, format: "jwk" } as Parameters<typeof createPublicKey>[0]);
              const sigInput = Buffer.from(`${parts[0]}.${parts[1]}`);
              const valid    = cryptoVerify("SHA256", sigInput, pubKey, Buffer.from(parts[2], "base64url"));
              if (valid && payloadObj["aud"] === clientId) {
                appleEmail = typeof payloadObj["email"] === "string" ? payloadObj["email"] : undefined;
                appleSub   = typeof payloadObj["sub"]   === "string" ? payloadObj["sub"]   : undefined;
              }
            }
          }
        } catch (verifyErr) {
          logger.warn({ err: verifyErr }, "[Auth] Apple callback — id_token verify failed (non-fatal, will try code exchange)");
        }
      }
    }

    // ── Step 2: exchange code for tokens if we still don't have email/sub ──────
    if (!appleEmail && !appleSub) {
      const teamId     = process.env["APPLE_TEAM_ID"]     ?? "";
      const keyId      = process.env["APPLE_KEY_ID"]      ?? "";
      const rawPem     = (process.env["APPLE_PRIVATE_KEY"] ?? "").replace(/\\n/g, "\n");
      const redirectUri = process.env["APPLE_AUTH_REDIRECT_URI"] || `${publicUrl}/api/auth/apple/callback`;

      if (!teamId || !keyId || !rawPem) {
        throw new Error("Apple credentials incomplete (TEAM_ID / KEY_ID / PRIVATE_KEY missing)");
      }

      const clientSecret = buildAppleClientSecret(clientId, teamId, keyId, rawPem);
      const tokenRes     = await fetch("https://appleid.apple.com/auth/token", {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:    new URLSearchParams({
          client_id:     clientId,
          client_secret: clientSecret,
          code,
          grant_type:    "authorization_code",
          redirect_uri:  redirectUri,
        }),
      });
      const tokens = await tokenRes.json() as { id_token?: string; error?: string; error_description?: string };
      if (!tokenRes.ok || !tokens.id_token) {
        throw new Error(`Apple token exchange failed: ${tokens.error ?? "no id_token"} — ${tokens.error_description ?? ""}`);
      }
      // Decode payload (already issued by Apple, trust it after exchange)
      const tp = tokens.id_token.split(".");
      if (tp.length === 3) {
        const pl = JSON.parse(Buffer.from(tp[1], "base64url").toString("utf8")) as Record<string, unknown>;
        appleEmail = typeof pl["email"] === "string" ? pl["email"] : undefined;
        appleSub   = typeof pl["sub"]   === "string" ? pl["sub"]   : undefined;
      }
    }

    // ── Step 3: parse `user` JSON (name + email, only on first sign-in) ────────
    let appleFirstName: string | undefined;
    if (userJson) {
      try {
        const u = JSON.parse(userJson) as { name?: { firstName?: string }; email?: string };
        appleFirstName = u.name?.firstName;
        if (!appleEmail) appleEmail = u.email;
      } catch { /* ignore */ }
    }

    if (!appleEmail && !appleSub) {
      throw new Error("Could not determine Apple user identity — email and sub both missing");
    }

    // Apple private-relay addresses (privaterelay.appleid.com) are valid — accept them
    const resolvedEmail = (appleEmail ?? `${appleSub}@apple-sub.local`).toLowerCase().trim();

    if (!isEmailAllowed(resolvedEmail)) {
      logger.warn({ email: resolvedEmail }, "[Auth] Apple login rejected — email not on allowlist");
      res.redirect(`${publicUrl}/login.html?error=access_denied`);
      return;
    }

    // ── Step 4: persist org settings (same pattern as Google OAuth) ─────────────
    try {
      const { upsertOrgSettings, loadOrgSettings: _loadAppleOrg } = await import("../services/org-settings.js");
      const existing = await _loadAppleOrg(resolvedEmail).catch(() => null);
      if (existing) {
        await upsertOrgSettings(resolvedEmail, {
          email:     resolvedEmail,
          firstName: existing.firstName || appleFirstName,
        });
        logger.info({ email: resolvedEmail }, "[Auth] Apple login — existing org, billing preserved");
      } else {
        await upsertOrgSettings(resolvedEmail, {
          email:              resolvedEmail,
          firstName:          appleFirstName,
          plan:               "standard",
          subscriptionStatus: "pending_billing",
        });
        logger.info({ email: resolvedEmail }, "[Auth] Apple login — new org created with pending_billing");
      }
    } catch (orgErr) {
      logger.warn({ err: orgErr }, "[Auth] Apple login — org_settings persist failed (non-fatal)");
    }

    // ── Step 5: create session ──────────────────────────────────────────────────
    const sessionToken = await createSession({
      userId:    resolvedEmail,
      orgId:     resolvedEmail,
      email:     resolvedEmail,
      role:      "owner",
      ipAddress: req.ip ?? undefined,
      userAgent: (req.headers["user-agent"] as string | undefined) ?? undefined,
    });
    const isProd = isDeployedProd();
    res.cookie("fp_token", sessionToken, {
      httpOnly: true,
      secure:   isProd,
      sameSite: isProd ? "none" : "lax",
      maxAge:   SESSION_TTL_MS,
      path:     "/",
    });

    logger.info({ email: resolvedEmail }, "[Auth] Apple login successful");
    res.redirect(`${publicUrl}/dashboard.html?provider=apple`);

  } catch (err) {
    logger.error({ err }, "[Auth] Apple callback failed");
    res.redirect(`${publicUrl}/login.html?error=apple_auth_failed`);
  }
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
    const token = await createSession({
      userId: email, orgId, email, role,
      ipAddress: req.ip ?? undefined,
      userAgent: (req.headers["user-agent"] as string | undefined) ?? undefined,
    });
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
  const redirect = (req.query["redirect"] as string) || "/dashboard.html";
  try {
    const token = await createSession({
      userId: email, orgId, email, role,
      ipAddress: req.ip ?? undefined,
      userAgent: (req.headers["user-agent"] as string | undefined) ?? undefined,
    });
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
