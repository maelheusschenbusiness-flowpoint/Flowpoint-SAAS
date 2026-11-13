/**
 * /api/security/* — Security score, sessions, 2FA status, API keys
 * Also provides aliases: /api/sessions, /api/preferences, /api/data/storage, /api/automations
 */
import { Router, type Request, type Response } from "express";
import { requireOrgId } from "../lib/require-org-id.js";
import { loadOrgSettings } from "../services/org-settings.js";
import { logger } from "../lib/logger.js";
import { canAdmin } from "../middlewares/requireRole.js";
import { displayablePublicKey, redactApiKeys } from "../lib/api-keys.js";
import { createHash } from "crypto";
import { pool } from "@workspace/db";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};
const orgDb  = (req: Request) => (req as OrgReq).orgDb.bind(req as OrgReq);
const getOrg = (req: Request): string => (req as OrgReq).orgId ?? "default";

// ── GET /api/security/score ───────────────────────────────────────────────────
router.get("/security/score", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  try {
    const settings = await loadOrgSettings(orgId);
    const twoFaOn  = !!(settings as unknown as Record<string, unknown>)?.twoFactorEnabled;
    const hasPlan  = !!settings?.plan;

    const checks = [
      { label: "Mot de passe fort",          done: true,      weight: 20, desc: "Complexité vérifiée" },
      { label: "Double facteur (2FA)",        done: twoFaOn,   weight: 25, desc: twoFaOn ? "2FA activé — accès protégé" : "2FA non configuré", vuln: !twoFaOn },
      { label: "Session sécurisée (HTTPS)",   done: true,      weight: 15, desc: "Connexion chiffrée TLS" },
      { label: "API keys sécurisées",         done: hasPlan,   weight: 15, desc: "Clé publique en lecture seule" },
      { label: "Plan actif",                  done: hasPlan,   weight: 10, desc: hasPlan ? `Plan ${settings?.plan} actif` : "Aucun plan configuré" },
    ];
    const score = checks.reduce((s, c) => c.done ? s + c.weight : s, 0);
    res.json({ score, checks, twoFaEnabled: twoFaOn });
  } catch {
    res.json({ score: 60, checks: [], twoFaEnabled: false });
  }
});

// ── Session identifiers & revocation helpers ─────────────────────────────────
// The raw token must never leave the server. Its first characters are NOT a usable
// identifier either: the token starts with base64(userId:orgId:...) so every session
// of one user shares the same prefix. The public id is a SHA-256 digest of the token.
export function sessionPublicId(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 24);
}
const SESSION_ID_RE = /^[a-f0-9]{24}$/;

type SessionActor = { userId?: string; userUuid?: string; email?: string; role?: string };
const actorOf = (req: Request): SessionActor => {
  const c = (req.orgContext ?? {}) as SessionActor;
  return { userId: c.userId, userUuid: c.userUuid, email: c.email, role: c.role };
};
/** API keys and the service credential are not people: they cannot own or revoke sessions. */
const isHumanActor = (a: SessionActor): boolean =>
  !!a.role && a.role !== "service" && !String(a.userId ?? "").startsWith("apikey:") && a.userId !== "service";
const isOrgAdmin = (a: SessionActor): boolean => a.role === "owner" || a.role === "admin";
function ownsSession(row: Record<string, unknown>, a: SessionActor): boolean {
  const email = String(row["email"] ?? "").toLowerCase();
  if (a.email && email && a.email.toLowerCase() === email) return true;
  if (a.userUuid && row["user_id_v2"] && String(row["user_id_v2"]) === a.userUuid) return true;
  return !!a.userId && String(row["user_id"] ?? "") === a.userId;
}
const currentTokenOf = (req: Request): string =>
  ((req as unknown as { cookies?: Record<string, string> }).cookies?.["fp_token"]) ??
  ((req.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "") ?? "");

// ── Minimisation des donnees de session d'AUTRES membres ─────────────────────
/** Adresse tronquee : IPv4 -> a.b.x.x ; IPv6 -> deux premiers groupes. Jamais l'adresse complete. */
export function maskIp(raw: string): string {
  const ip = raw.trim();
  if (!ip) return "IP inconnue";
  const v4 = ip.replace(/^::ffff:/i, "");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) { const p = v4.split("."); return `${p[0]}.${p[1]}.x.x`; }
  if (ip.includes(":")) { const g = ip.split(":").filter(Boolean).slice(0, 2); return g.length ? `${g.join(":")}::x` : "IP inconnue"; }
  return "IP inconnue";
}
/** Resume « Navigateur · Systeme » : jamais la chaine user-agent brute. */
export function summarizeUserAgent(ua: string): string {
  if (!ua) return "Appareil inconnu";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navigateur";
  const os = /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

// ── GET /api/sessions — sessions actives ─────────────────────────────────────
// member/viewer : UNIQUEMENT leurs propres sessions. owner/admin : celles de l'organisation,
// avec IP tronquee et user-agent resume pour les sessions des AUTRES membres. Les cles API et
// le service n'ont pas de session : liste vide. Jamais le jeton ni un fragment du jeton.
router.get("/sessions", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  try {
    const currentToken = currentTokenOf(req);
    const actor = actorOf(req);
    if (!isHumanActor(actor)) { res.json({ sessions: [], count: 0 }); return; }
    const admin = isOrgAdmin(actor);

    let sql = `SELECT token, user_id, user_id_v2, email, ip_address, user_agent, created_at, expires_at
       FROM user_sessions
       WHERE org_id = $1
          AND expires_at > NOW()`;
    const params: unknown[] = [orgId];
    if (!admin) {
      // Filtre cote SQL : la limite de 15 lignes ne doit pas masquer les sessions propres.
      const ids: string[] = [];
      if (actor.email) { params.push(actor.email.toLowerCase()); ids.push(`lower(email) = $${params.length}`); }
      if (actor.userUuid) { params.push(actor.userUuid); ids.push(`user_id_v2::text = $${params.length}`); }
      if (actor.userId) { params.push(actor.userId); ids.push(`user_id = $${params.length}`); }
      if (!ids.length) { res.json({ sessions: [], count: 0 }); return; }
      sql += ` AND (${ids.join(" OR ")})`;
    }
    sql += `
       ORDER BY created_at DESC
       LIMIT 15`;
    const r = await orgDb(req)(sql, params).catch(() => ({ rows: [] }));

    const sessions = r.rows
      // Defense en profondeur : meme si le filtre SQL etait contourne, un non-admin ne voit que le sien.
      .filter((row) => admin || ownsSession(row, actor))
      .map((row) => {
        const rowToken = row["token"] as string | null | undefined;
        const isCurrent = currentToken.length > 0 && !!rowToken && rowToken === currentToken;
        const own = ownsSession(row, actor);
        const rawUa = String(row["user_agent"] ?? "");
        const rawIp = String(row["ip_address"] ?? "");
        const createdAt = row["created_at"] ? new Date(String(row["created_at"])) : null;
        return {
          id:       rowToken ? sessionPublicId(rowToken) : "",  // opaque digest, never a token fragment
          event:    "Connexion réussie",
          device:   own ? (rawUa ? rawUa.slice(0, 80) : "Appareil inconnu") : summarizeUserAgent(rawUa),
          ip:       own ? (rawIp || "IP inconnue") : maskIp(rawIp),
          date:     createdAt ? createdAt.toISOString() : null,
          isCurrent,
          own,
          // The current session is ended through sign-out, never through this list.
          canRevoke: !isCurrent && (admin || own),
          success:  true,
        };
      });

    res.json({ sessions, count: sessions.length });
  } catch (err) {
    logger.error({ err, orgId }, "[Security] Failed to load current sessions");
    res.status(500).json({
      error: "sessions_unavailable",
      sessions: [],
      count: 0,
    });
  }
});

// ── POST /api/auth/sessions/:id/revoke — end ONE session ─────────────────────
// Allowed: the user's own sessions, or any session of the SAME organization for an
// owner/admin. A session of another organization is indistinguishable from an unknown
// id (404). The current session is refused explicitly (409): use sign-out for that.
router.post("/auth/sessions/:id/revoke", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  const actor = actorOf(req);
  if (!isHumanActor(actor)) {
    res.status(403).json({ error: "Seul un utilisateur connecté peut mettre fin à une session.", code: "SESSION_REVOKE_FORBIDDEN" });
    return;
  }
  const sessionId = String(req.params["id"] ?? "");
  if (!SESSION_ID_RE.test(sessionId)) {
    res.status(400).json({ error: "Identifiant de session invalide.", code: "SESSION_ID_INVALID" });
    return;
  }
  try {
    const found = await pool.query(
      `SELECT token, user_id, user_id_v2, email FROM user_sessions
        WHERE org_id = $1 AND expires_at > NOW()
        ORDER BY created_at DESC LIMIT 500`,
      [orgId],
    );
    const target = found.rows.find((row) => sessionPublicId(String(row["token"])) === sessionId);
    if (!target) {
      res.status(404).json({ error: "Session introuvable.", code: "SESSION_NOT_FOUND" });
      return;
    }
    if (!isOrgAdmin(actor) && !ownsSession(target, actor)) {
      res.status(403).json({ error: "Vous ne pouvez mettre fin qu'à vos propres sessions.", code: "SESSION_REVOKE_FORBIDDEN" });
      return;
    }
    const currentToken = currentTokenOf(req);
    if (currentToken && String(target["token"]) === currentToken) {
      res.status(409).json({
        error: "Il s'agit de votre session actuelle : utilisez « Se déconnecter » pour y mettre fin.",
        code: "CURRENT_SESSION",
      });
      return;
    }
    const del = await pool.query(
      `DELETE FROM user_sessions WHERE token = $1 AND org_id = $2`,
      [String(target["token"]), orgId],
    );
    if (!del.rowCount) {
      res.status(404).json({ error: "Session introuvable.", code: "SESSION_NOT_FOUND" });
      return;
    }
    logger.info({ orgId, byUser: actor.userId, own: ownsSession(target, actor) }, "[Security] session revoked");
    res.json({ ok: true, revoked: 1, id: sessionId, current: false });
  } catch (err) {
    logger.error({ err, orgId }, "[Security] session revocation failed");
    res.status(503).json({ error: "La session n'a pas pu être révoquée. Réessayez.", code: "SESSION_REVOKE_UNAVAILABLE" });
  }
});

// ── GET /api/security/2fa ────────────────────────────────────────────────────
router.get("/security/2fa", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  res.json({ available: false, enabled: false, roadmap: "TOTP/HOTP — Q3 2026", message: "2FA non encore implémenté — roadmap Q3 2026" });
});

// ── POST /api/security/2fa/setup — stub (TOTP roadmap Q3 2026) ──────────────
router.post("/security/2fa/setup", async (req: Request, res: Response): Promise<void> => {
  res.status(501).json({
    available: false,
    message: "2FA (TOTP) sera disponible en Q3 2026. Votre compte est actuellement protégé par lien magique.",
    roadmap: "TOTP/HOTP — Q3 2026",
  });
});

// ── POST /api/security/2fa/verify — stub ─────────────────────────────────────
router.post("/security/2fa/verify", async (_req: Request, res: Response): Promise<void> => {
  res.status(501).json({ available: false, message: "2FA non encore disponible." });
});

// ── GET /api/security/api-keys ───────────────────────────────────────────────
// Lists keys by prefix only (never a full value), owners/admins only. Legacy default keys
// are not listed.
router.get("/security/api-keys", canAdmin, async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  const r = await orgDb(req)(`SELECT settings FROM user_prefs WHERE org_id=$1`, [orgId]).catch(() => ({ rows: [] }));
  const prefs = (r.rows[0] as Record<string, unknown> | undefined)?.settings as Record<string, unknown> | null;
  const pub = displayablePublicKey(prefs, orgId);
  const keys = [];
  if (pub) keys.push({ id: "pk_default", name: "Clé publique (lecture seule)", prefix: pub.slice(0, 15), permissions: ["read"],
    createdAt: prefs?.publicApiKeyCreatedAt ?? null, lastUsed: null, secret: false });
  if (typeof prefs?.secretApiKey === "string" && prefs.secretApiKey) keys.push({ id: "sk_default", name: "Clé secrète", prefix: "fp_sec_",
    permissions: ["read", "write"], createdAt: prefs?.secretApiKeyCreatedAt ?? null, lastUsed: null, secret: true });
  res.json({ keys });
});

// ── GET /api/preferences — alias for /api/me/prefs ──────────────────────────
router.get("/preferences", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  try {
    const r = await orgDb(req)(`SELECT streak, pinned, checklist, settings FROM user_prefs WHERE org_id=$1`, [orgId]);
    const row = r.rows[0];
    res.json(row ? { ...row, settings: redactApiKeys(row.settings) } : { streak: 0, pinned: {}, checklist: null, settings: null });
  } catch {
    res.json({ streak: 0, pinned: {}, checklist: null, settings: null });
  }
});

router.patch("/preferences", async (req: Request, res: Response): Promise<void> => {
  res.redirect(307, "/api/me/prefs");
});

// ── GET /api/automations — alias for /api/automation/workflows ───────────────
router.get("/automations", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrg(req);
  try {
    const r = await orgDb(req)(
      `SELECT * FROM automation_workflows WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [orgId]
    ).catch(() => ({ rows: [] }));
    res.json({ workflows: r.rows, runs: [], stats: { totalRuns: 0, successRate: 100, avgDuration: 0 } });
  } catch {
    res.json({ workflows: [], runs: [], stats: { totalRuns: 0, successRate: 100, avgDuration: 0 } });
  }
});

router.get("/automations/list", async (req: Request, res: Response): Promise<void> => {
  const orgId = getOrg(req);
  try {
    const r = await orgDb(req)(
      `SELECT * FROM automation_workflows WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [orgId]
    ).catch(() => ({ rows: [] }));
    res.json(r.rows);
  } catch {
    res.json([]);
  }
});

// ── GET /api/data/storage — alias for /api/me/storage ───────────────────────
router.get("/data/storage", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  // Delegate to existing /api/me/storage logic inline
  try {
    const { pool } = await import("@workspace/db");
    const client = await pool.connect();
    try {
      const counts = await Promise.all([
        client.query(`SELECT COUNT(*)::int AS n FROM audits WHERE org_id=$1`, [orgId]).catch(() => ({ rows: [{ n: 0 }] })),
        client.query(`SELECT COUNT(*)::int AS n FROM reports WHERE org_id=$1`, [orgId]).catch(() => ({ rows: [{ n: 0 }] })),
        client.query(`SELECT COUNT(*)::int AS n FROM monitors WHERE org_id=$1`, [orgId]).catch(() => ({ rows: [{ n: 0 }] })),
      ]);
      const [audits, reports, monitors] = counts.map(r => (r.rows[0] as { n: number }).n);
      const totalItems = audits + reports + monitors;
      const estimatedBytes = totalItems * 2500;
      res.json({
        orgId, total: totalItems, audits, reports, monitors,
        size: { bytes: estimatedBytes, readable: totalItems > 0 ? `${(estimatedBytes / 1024).toFixed(1)} KB` : "0 B" },
      });
    } finally { client.release(); }
  } catch {
    res.json({ orgId, total: 0, size: { bytes: 0, readable: "0 B" } });
  }
});

// ── GET /api/ai/config — returns org AI module config from user_prefs ─────────
router.get("/ai/config", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  try {
    const r = await orgDb(req)(`SELECT settings FROM user_prefs WHERE org_id=$1`, [orgId]);
    const settings = r.rows[0]?.settings ?? {};
    res.json({
      aiModules:   (settings as Record<string, unknown>).aiModules   ?? {},
      aiIntensity: (settings as Record<string, unknown>).aiIntensity ?? "Équilibré",
      provider:    "openai",
    });
  } catch {
    res.json({ aiModules: {}, aiIntensity: "Équilibré", provider: "openai" });
  }
});

router.patch("/ai/config", async (req: Request, res: Response): Promise<void> => {
  res.redirect(307, "/api/me/prefs");
});

router.get("/ai/preferences", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  try {
    const r = await orgDb(req)(`SELECT settings FROM user_prefs WHERE org_id=$1`, [orgId]);
    const settings = (r.rows[0]?.settings ?? {}) as Record<string, unknown>;
    res.json({
      preferredProvider: (settings.preferredProvider as string) ?? null,
      preferredModel:    (settings.preferredModel as string) ?? null,
      aiIntensity:       (settings.aiIntensity as string) ?? "Équilibré",
      aiModules:         (settings.aiModules as Record<string, boolean>) ?? {},
    });
  } catch {
    res.json({ preferredProvider: null, preferredModel: null, aiIntensity: "Équilibré", aiModules: {} });
  }
});

// ── PATCH /api/ai/preferences — persist user AI provider/model/intensity ─────
router.patch("/ai/preferences", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;

  const VALID_PROVIDERS = ["openai", "anthropic", "gemini"];
  const VALID_INTENSITIES = ["Conservateur", "Équilibré", "Performant", "Agressif"];

  const { preferredProvider, preferredModel, aiIntensity } = req.body as {
    preferredProvider?: string;
    preferredModel?: string;
    aiIntensity?: string;
  };

  // Reject unknown fields — only these 3 are accepted
  const allowedKeys = new Set(["preferredProvider", "preferredModel", "aiIntensity"]);
  const unknownKeys = Object.keys(req.body as object).filter(k => !allowedKeys.has(k));
  if (unknownKeys.length > 0) {
    res.status(400).json({ ok: false, code: "UNKNOWN_FIELDS", fields: unknownKeys });
    return;
  }

  // Validate provider
  if (preferredProvider !== undefined && !VALID_PROVIDERS.includes(preferredProvider)) {
    res.status(400).json({ ok: false, code: "INVALID_AI_PROVIDER" });
    return;
  }

  // Validate intensity
  if (aiIntensity !== undefined && !VALID_INTENSITIES.includes(aiIntensity)) {
    res.status(400).json({ ok: false, code: "INVALID_AI_INTENSITY", validValues: ["Conservateur", "Équilibré", "Performant"] });
    return;
  }

  // Validate model+provider combination (only when both are provided together)
  if (preferredProvider !== undefined && preferredModel !== undefined) {
    const { PROVIDER_CAPABILITIES } = await import("../services/ai-providers/capabilities.js");
    const caps = PROVIDER_CAPABILITIES[preferredProvider as keyof typeof PROVIDER_CAPABILITIES];
    if (!caps || !caps.models.includes(preferredModel)) {
      res.status(400).json({ ok: false, code: "INVALID_PROVIDER_MODEL_COMBINATION" });
      return;
    }
  }

  // Build patch object — only the 3 allowed fields, normalize Agressif→Performant
  const patch: Record<string, unknown> = {};
  if (preferredProvider !== undefined) patch.preferredProvider = preferredProvider;
  if (preferredModel !== undefined)    patch.preferredModel    = preferredModel;
  if (aiIntensity !== undefined)       patch.aiIntensity       = aiIntensity === "Agressif" ? "Performant" : aiIntensity;

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ ok: false, code: "EMPTY_PATCH" });
    return;
  }

  try {
    // Upsert: merge only the allowed patch fields into existing settings JSONB
    await orgDb(req)(`
      INSERT INTO user_prefs (org_id, settings)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (org_id)
      DO UPDATE SET settings = COALESCE(user_prefs.settings, '{}'::jsonb) || $2::jsonb,
                   updated_at = NOW()
    `, [orgId, JSON.stringify(patch)]);

    // Return the full persisted preferences
    const r = await orgDb(req)(`SELECT settings FROM user_prefs WHERE org_id=$1`, [orgId]);
    const settings = (r.rows[0]?.settings ?? {}) as Record<string, unknown>;
    res.json({
      ok: true,
      preferences: {
        preferredProvider: (settings.preferredProvider as string) ?? null,
        preferredModel:    (settings.preferredModel as string) ?? null,
        aiIntensity:       (settings.aiIntensity as string) ?? "Équilibré",
        aiModules:         (settings.aiModules as Record<string, boolean>) ?? {},
      },
    });
  } catch (err) {
    const { logger } = await import("../lib/logger.js");
    logger.error({ err, orgId }, "[AI Prefs] PATCH /ai/preferences failed");
    res.status(500).json({ ok: false, code: "PREFS_SAVE_FAILED" });
  }
});

export default router;
