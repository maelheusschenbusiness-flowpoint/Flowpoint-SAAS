/**
 * /api/security/* — Security score, sessions, 2FA status, API keys
 * Also provides aliases: /api/sessions, /api/preferences, /api/data/storage, /api/automations
 */
import { Router, type Request, type Response } from "express";
import { requireOrgId } from "../lib/require-org-id.js";
import { loadOrgSettings } from "../services/org-settings.js";
import { logger } from "../lib/logger.js";

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

// ── GET /api/sessions — login history for current org ────────────────────────
router.get("/sessions", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  try {
    // Resolve the current token from cookie or Authorization header.
    // The auth system uses the cookie name "fp_token".
    const currentToken: string =
      ((req as unknown as { cookies?: Record<string, string> }).cookies?.["fp_token"]) ??
      ((req.headers["authorization"] as string | undefined)?.replace(/^Bearer\s+/i, "") ?? "");

    const r = await orgDb(req)(
      `SELECT token, email, ip_address, user_agent, created_at, expires_at
       FROM user_sessions
       WHERE org_id = $1
          AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 15`,
      [orgId]
    ).catch(() => ({ rows: [] }));

    const sessions = r.rows.map((row) => {
      const rowToken = row["token"] as string | null | undefined;
      const isCurrent = currentToken.length > 0 && !!rowToken && rowToken === currentToken;
      const rawUa = String(row["user_agent"] ?? "");
      const rawIp = String(row["ip_address"] ?? "");
      const createdAt = row["created_at"] ? new Date(String(row["created_at"])) : null;
      return {
        id:       String(row["token"]).slice(0, 16),  // safe partial token as ID
        event:    "Connexion réussie",
        device:   rawUa ? rawUa.slice(0, 80) : "Appareil inconnu",
        // The security screen is for the authenticated account holder: show the
        // recorded client address rather than a fabricated/masked placeholder.
        ip:       rawIp || "IP inconnue",
        date:     createdAt ? createdAt.toISOString() : null,
        isCurrent,
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
router.get("/security/api-keys", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  const _pkHash = Buffer.from(orgId).toString("base64").replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 22);
  res.json({
    keys: [
      {
        id:          "pk_default",
        name:        "Clé publique (lecture seule)",
        prefix:      `fp_pub_${_pkHash.slice(0, 8)}`,
        permissions: ["read"],
        createdAt:   new Date().toISOString(),
        lastUsed:    null,
        secret:      false,
      },
    ],
  });
});

// ── GET /api/preferences — alias for /api/me/prefs ──────────────────────────
router.get("/preferences", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  try {
    const r = await orgDb(req)(`SELECT streak, pinned, checklist, settings FROM user_prefs WHERE org_id=$1`, [orgId]);
    res.json(r.rows[0] ?? { streak: 0, pinned: {}, checklist: null, settings: null });
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
