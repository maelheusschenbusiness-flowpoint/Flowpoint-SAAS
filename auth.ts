import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { store } from "../services/store.js";
import { logger } from "../lib/logger.js";
import { createSession, deleteSession, getSession, SESSION_TTL_MS } from "../services/sessions.js";
import { authRateLimit } from "../middlewares/rateLimiter.js";

const router = Router();

interface MagicToken {
  email: string;
  expiresAt: number;
  used: boolean;
}

const magicTokens = new Map<string, MagicToken>();

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Allowlist check — gates who may authenticate.
 *
 * Configure at least one of:
 *   ALLOWED_EMAILS       comma-separated list of exact emails
 *   ALLOWED_EMAIL_DOMAIN single domain (e.g. "acme.com"); all addresses on that domain are permitted
 *
 * In production, if neither variable is set, every login attempt is rejected
 * (fail-closed). In development/test, the check is skipped so local work
 * remains frictionless.
 */
function isEmailAllowed(email: string): boolean {
  const allowedEmails = process.env["ALLOWED_EMAILS"];
  const allowedDomain = process.env["ALLOWED_EMAIL_DOMAIN"];
  const isProduction  = process.env["NODE_ENV"] === "production";

  if (!allowedEmails && !allowedDomain) {
    // No allowlist configured — open in dev, closed in production.
    return !isProduction;
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

function cleanExpired() {
  const now = Date.now();
  for (const [token, data] of magicTokens) {
    if (data.expiresAt < now || data.used) magicTokens.delete(token);
  }
}

async function sendMagicEmail(email: string, link: string): Promise<void> {
  const resendKey = process.env["RESEND_API_KEY"];
  if (!resendKey) return;

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(resendKey);
    await resend.emails.send({
      from: process.env["FROM_EMAIL"] || "noreply@flowpoint.pro",
      to: email,
      subject: "Votre lien de connexion FlowPoint",
      html: `
        <div style="font-family:Inter,system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#070b18;color:#eaf0ff;border-radius:18px;">
          <h2 style="margin:0 0 12px;font-size:22px;font-weight:800;letter-spacing:-.02em;">Connexion FlowPoint</h2>
          <p style="margin:0 0 18px;color:rgba(234,240,255,.75);line-height:1.6;">Clique sur le bouton ci-dessous pour te connecter à FlowPoint. Ce lien expire dans 15 minutes.</p>
          <a href="${link}" style="display:inline-block;padding:14px 28px;border-radius:14px;background:linear-gradient(180deg,#2f5bff,#2449ff);color:#fff;font-weight:800;text-decoration:none;font-size:15px;">Se connecter</a>
          <p style="margin:18px 0 0;font-size:13px;color:rgba(234,240,255,.50);">Si tu n'as pas demandé ce lien, ignore cet email.</p>
        </div>
      `,
    });
  } catch (err) {
    logger.warn({ err }, "[Auth] Failed to send magic link email");
  }
}

router.post("/auth/login-request", authRateLimit, async (req: Request, res: Response) => {
  const { email } = req.body as { email?: string };
  if (!email || !String(email).includes("@")) {
    res.status(400).json({ error: "Email valide requis" });
    return;
  }

  if (!isEmailAllowed(String(email))) {
    logger.warn({ email }, "[Auth] Login rejected — email not on allowlist");
    // Return a generic 200 so as not to enumerate valid addresses
    res.json({ ok: true, message: "Lien envoyé par email" });
    return;
  }

  cleanExpired();

  const token = generateToken();
  magicTokens.set(token, { email: String(email).toLowerCase().trim(), expiresAt: Date.now() + 15 * 60_000, used: false });

  const publicUrl = process.env["PUBLIC_URL"] || "";
  const verifyPath = `${publicUrl}/login-verify.html?token=${token}`;
  const resendKey = process.env["RESEND_API_KEY"];
  const isProduction = process.env["NODE_ENV"] === "production";

  if (resendKey) {
    await sendMagicEmail(email, verifyPath);
    logger.info({ email }, "[Auth] Magic link email sent");
    res.json({ ok: true, message: "Lien envoyé par email" });
  } else if (!isProduction) {
    logger.warn({ email }, "[Auth] No RESEND_API_KEY — returning debugLink (dev only)");
    res.json({ ok: true, debugLink: verifyPath, message: "Mode debug: lien retourné directement" });
  } else {
    logger.error("[Auth] RESEND_API_KEY not set in production — cannot send magic link");
    res.status(503).json({ error: "Email service not configured" });
  }
});

router.post("/auth/register", authRateLimit, async (req: Request, res: Response) => {
  const { email, firstName, companyName, plan } = req.body as { email?: string; firstName?: string; companyName?: string; plan?: string };

  if (!email || !String(email).includes("@")) {
    res.status(400).json({ error: "Email valide requis" });
    return;
  }

  if (!isEmailAllowed(String(email))) {
    logger.warn({ email }, "[Auth] Registration rejected — email not on allowlist");
    // Return a generic 200 so as not to enumerate valid addresses
    res.json({ ok: true, message: "Compte créé. Lien envoyé par email." });
    return;
  }

  if (firstName && String(firstName).trim()) {
    store.me.firstName = String(firstName).trim();
  }
  if (companyName && String(companyName).trim()) {
    store.me.org = { name: String(companyName).trim() };
  }
  if (plan && ["standard","pro","ultra"].includes(String(plan))) {
    store.me.plan = String(plan);
  }

  cleanExpired();
  const token = generateToken();
  magicTokens.set(token, { email: String(email).toLowerCase().trim(), expiresAt: Date.now() + 15 * 60_000, used: false });

  const publicUrl = process.env["PUBLIC_URL"] || "";
  const verifyPath = `${publicUrl}/login-verify.html?token=${token}`;
  const resendKey = process.env["RESEND_API_KEY"];
  const isProduction = process.env["NODE_ENV"] === "production";

  if (resendKey) {
    await sendMagicEmail(email, verifyPath);
    res.json({ ok: true, message: "Compte créé. Lien envoyé par email." });
  } else if (!isProduction) {
    res.json({ ok: true, debugLink: verifyPath, message: "Mode debug: lien retourné directement" });
  } else {
    logger.error("[Auth] RESEND_API_KEY not set in production — cannot send magic link");
    res.status(503).json({ error: "Email service not configured" });
  }
});

router.get("/auth/login-verify", (req: Request, res: Response) => {
  const { token } = req.query as { token?: string };
  if (!token) {
    res.status(400).json({ error: "Token manquant" });
    return;
  }

  cleanExpired();
  const entry = magicTokens.get(String(token));

  if (!entry) {
    res.status(401).json({ error: "Lien invalide ou expiré" });
    return;
  }
  if (entry.used) {
    res.status(401).json({ error: "Lien déjà utilisé" });
    return;
  }
  if (entry.expiresAt < Date.now()) {
    magicTokens.delete(String(token));
    res.status(401).json({ error: "Lien expiré" });
    return;
  }

  entry.used = true;

  // Issue a unique per-session token bound to this user. The API_SECRET_KEY
  // is never used as a session credential for browser clients.
  // In this single-tenant deployment every verified login is an owner/admin.
  const sessionToken = createSession({ email: entry.email, role: "admin" });

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
  const redirectUri = process.env["GOOGLE_AUTH_REDIRECT_URI"] || `${process.env["PUBLIC_URL"] || ""}/api/auth/google/callback`;

  if (!clientId) {
    res.status(503).json({ error: "Google OAuth not configured" });
    return;
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
    state: Buffer.from(JSON.stringify({ ts: Date.now() })).toString("base64"),
  });

  res.json({ ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
});

router.get("/auth/google/callback", async (req: Request, res: Response) => {
  const { code, error: oauthError } = req.query as { code?: string; error?: string };
  const publicUrl = process.env["PUBLIC_URL"] || "";

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

    if (user.name) store.me.firstName = user.name.split(" ")[0];
    if (user.email && !store.me.org?.name) store.me.org = { name: user.email };

    logger.info({ email: user.email }, "[Auth] Google login successful");

    // Issue a unique per-session token and set it as an HttpOnly cookie.
    // In this single-tenant deployment every OAuth login is an owner/admin.
    const sessionToken = createSession({ email: resolvedEmail, role: "admin" });
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
  res.json({ ok: true, url });
});

router.get("/auth/github/callback", async (req: Request, res: Response) => {
  const { code, error: oauthError } = req.query as { code?: string; error?: string };
  const publicUrl = process.env["PUBLIC_URL"] || "";

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

    if (user.name || user.login) store.me.firstName = (user.name || user.login || "").split(" ")[0];

    logger.info({ login: user.login }, "[Auth] GitHub login successful");

    // Issue a unique per-session token and set it as an HttpOnly cookie.
    // In this single-tenant deployment every OAuth login is an owner/admin.
    const sessionToken = createSession({ email: resolvedEmail, role: "admin" });
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
    res.redirect(`${publicUrl}/login.html?error=github_auth_failed`);
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

router.get("/auth/providers", (_req: Request, res: Response) => {
  const googleConfigured = !!(process.env["GOOGLE_CLIENT_ID"] && process.env["GOOGLE_CLIENT_SECRET"]);
  const githubConfigured = !!(process.env["GITHUB_CLIENT_ID"] && process.env["GITHUB_CLIENT_SECRET"]);

  res.json({
    providers: [
      { id: "google", name: "Google", configured: googleConfigured, loginUrl: "/api/auth/google/login" },
      { id: "github", name: "GitHub", configured: githubConfigured, loginUrl: "/api/auth/github/login" },
      { id: "magic-link", name: "Email (Magic Link)", configured: true, loginUrl: "/api/auth/login-request" },
    ],
  });
});

export default router;
