import { Router, type Request, type Response } from "express";
import { getAIUsageStats, consumeAICredits, AI_FEATURES, type AIFeature } from "../services/ai-engine.js";
import { enforcePaidAccess } from "../middlewares/requirePaidAccess.js";

const router = Router();

function usageResponse(stats: Awaited<ReturnType<typeof getAIUsageStats>>) {
  const { monthly } = stats;
  const totalAvailable = monthly.creditsLimit + monthly.creditsExtra;
  const resetAt = monthly.resetAt.toISOString();
  return {
    ...stats,
    // Keep both shapes while dashboard clients converge on the monthly contract.
    used: monthly.creditsUsed,
    limit: monthly.creditsLimit,
    extra: monthly.creditsExtra,
    requestCount: monthly.requestCount,
    resetAt,
    resetDate: resetAt,
    remaining: Math.max(0, totalAvailable - monthly.creditsUsed),
  };
}

router.get("/ai-credits", async (req: Request, res: Response) => {
  const orgId = req.orgId ?? "default";
  try {
    const stats = await getAIUsageStats(orgId);
    res.json(usageResponse(stats));
  } catch {
    res.status(500).json({ error: "Failed to fetch AI credits" });
  }
});

// Alias: /api/ai/credits → same handler (spec compatibility)
router.get("/ai/credits", async (req: Request, res: Response) => {
  const orgId = req.orgId ?? "default";
  try {
    const stats = await getAIUsageStats(orgId);
    res.json(usageResponse(stats));
  } catch {
    res.status(500).json({ error: "Failed to fetch AI credits" });
  }
});

router.get("/ai-credits/usage", async (req: Request, res: Response) => {
  const orgId = req.orgId ?? "default";
  try {
    const stats = await getAIUsageStats(orgId);
    res.json(usageResponse(stats));
  } catch {
    res.status(500).json({ error: "Failed to fetch usage stats" });
  }
});

router.get("/ai-credits/alerts", async (req: Request, res: Response) => {
  const orgId = req.orgId ?? "default";
  try {
    const stats = await getAIUsageStats(orgId);
    res.json({ alerts: stats.alerts });
  } catch {
    res.status(500).json({ error: "Failed to fetch AI alerts" });
  }
});

// ── POST /ai-credits/consume ─────────────────────────────────────────────────
// Debit manuel de credits IA par une fonctionnalite d'analyse. Le prefixe /ai-credits est exempte
// du middleware global d'abonnement (la LECTURE du solde doit rester possible pour racheter) : le
// debit, lui, applique explicitement la garde d'abonnement.
//  - utilisateur humain authentifie (cle API / credential de service refuses), role owner/admin/member
//    (un viewer ne depense pas les credits de l'organisation) ;
//  - organisation resolue par l'authentification, jamais fournie par le client ;
//  - `feature` borne a la liste canonique ; le montant est celui du bareme serveur, jamais fourni
//    par le client ; `metadata` objet JSON borne ;
//  - debit atomique (UPDATE conditionnel dans la meme transaction que le journal d'usage) ;
//  - refus 402 AI_CREDITS_EXHAUSTED au plafond.
const CONSUME_ROLES = new Set(["owner", "admin", "member"]);
const MAX_METADATA_CHARS = 2000;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_.:-]{8,128}$/;

router.post("/ai-credits/consume", async (req: Request, res: Response) => {
  const ctx = req.orgContext;
  const orgId = req.orgId;
  const userId = ctx?.userId ?? req.userId;
  if (!ctx || !orgId || orgId === "default" || !userId) {
    res.status(401).json({ ok: false, error: "Authentification requise.", code: "AUTH_REQUIRED" });
    return;
  }
  if (userId === "service" || String(userId).startsWith("apikey:")) {
    res.status(403).json({ ok: false, error: "Seul un utilisateur connecté peut consommer des crédits IA.", code: "HUMAN_USER_REQUIRED" });
    return;
  }
  if (!ctx.role || !CONSUME_ROLES.has(ctx.role)) {
    res.status(403).json({ ok: false, error: "Votre rôle ne permet pas de consommer des crédits IA.", code: "ROLE_NOT_ALLOWED" });
    return;
  }
  if (!(await enforcePaidAccess(req, res))) return;

  const body = (req.body ?? {}) as { feature?: unknown; metadata?: unknown };
  const feature = body.feature;
  if (typeof feature !== "string" || !(AI_FEATURES as readonly string[]).includes(feature)) {
    res.status(400).json({ ok: false, error: "feature invalide.", code: "INVALID_FEATURE", supported: AI_FEATURES });
    return;
  }
  let clientMetadata: Record<string, unknown> | undefined;
  if (body.metadata !== undefined && body.metadata !== null) {
    const m = body.metadata;
    if (typeof m !== "object" || Array.isArray(m) || JSON.stringify(m).length > MAX_METADATA_CHARS) {
      res.status(400).json({ ok: false, error: "metadata doit être un objet JSON de petite taille.", code: "INVALID_METADATA" });
      return;
    }
    clientMetadata = m as Record<string, unknown>;
  }
  const rawKey = req.header("idempotency-key");
  if (rawKey !== undefined && !IDEMPOTENCY_KEY_RE.test(rawKey)) {
    res.status(400).json({ ok: false, error: "Idempotency-Key invalide (8 à 128 caractères alphanumériques, _ . : -).", code: "INVALID_IDEMPOTENCY_KEY" });
    return;
  }

  try {
    const result = await consumeAICredits({
      feature: feature as AIFeature,
      orgId,
      userId: String(userId),
      // Journal d'usage : la provenance est posee par le serveur, les metadonnees client sont isolees.
      metadata: { source: "api:/ai-credits/consume", role: ctx.role, clientMetadata },
      requestId: rawKey ? `consume:${userId}:${rawKey}` : undefined,
    });
    if (!result.allowed) {
      if (result.reason === "quota_exhausted") {
        res.status(402).json({
          ok: false, allowed: false, code: "AI_CREDITS_EXHAUSTED",
          error: "Plafond de crédits IA atteint. Rachetez un pack ou attendez le renouvellement.",
          remaining: result.remaining,
        });
        return;
      }
      res.status(503).json({
        ok: false, allowed: false, code: "AI_USAGE_UNAVAILABLE", retryable: true,
        error: "Le suivi des crédits IA est momentanément indisponible. Réessayez.",
      });
      return;
    }
    res.json({ ok: true, ...result });
  } catch {
    res.status(500).json({ ok: false, error: "Failed to consume credits" });
  }
});

export default router;
