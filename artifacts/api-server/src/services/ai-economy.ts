/**
 * ai-economy.ts — Progressive economy policy based on monthly AI usage.
 *
 * RÈGLES ABSOLUES :
 *   - Le PROVIDER ne change jamais (openai reste openai, anthropic reste anthropic, etc.)
 *   - Seuls le modèle, les tokens et la profondeur de contexte peuvent être réduits.
 *   - Aucune information de pourcentage n'est jamais acceptée depuis le frontend.
 *   - Les seuils par défaut sont centralisés ici (DEFAULT_THRESHOLDS).
 *
 * Intégration : uniquement POST /api/ai/chat dans cette étape.
 */

import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { getOrCreateMonthlyUsage } from "./ai-engine.js";
import type { AIProviderId } from "./ai-providers/capabilities.js";
import type { AIIntensityMode } from "./ai-provider-matrix.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type EconomyTier = "NORMAL" | "OPTIMIZED" | "ECONOMY" | "CRITICAL" | "EXHAUSTED";

export interface EconomyThresholds {
  optimizedAt: number;
  economyAt:   number;
  criticalAt:  number;
  exhaustedAt: number;
}

export interface OrgUsageStatus {
  used:         number;
  limit:        number;
  remaining:    number;
  usagePercent: number;
  economyTier:  EconomyTier;
}

export interface EconomyPolicy {
  provider:           AIProviderId;
  requestedModel:     string;
  effectiveModel:     string;
  requestedMode:      AIIntensityMode;
  effectiveMode:      AIIntensityMode;
  economyTier:        EconomyTier;
  usagePercent:       number;
  maxTokens:          number;
  contextFactor:      number;
  reasoningEffort?:   "low" | "medium" | "high";
  downgradeApplied:   boolean;
  optimizationApplied: boolean;
  reason:             string;
}

// ── Defaults ───────────────────────────────────────────────────────────────────

export const DEFAULT_THRESHOLDS: EconomyThresholds = {
  optimizedAt: 70,
  economyAt:   85,
  criticalAt:  95,
  exhaustedAt: 100,
};

export const CONTEXT_FACTORS: Record<EconomyTier, number> = {
  NORMAL:    1.00,
  OPTIMIZED: 0.85,
  ECONOMY:   0.60,
  CRITICAL:  0.35,
  EXHAUSTED: 0.35,
};

/**
 * Cheapest model per provider — must match capabilities.ts exactly.
 * Provider never changes; only the model is downgraded within the same provider.
 */
const ECONOMY_MODELS: Record<AIProviderId, string> = {
  openai:    "gpt-5-mini",
  anthropic: "claude-haiku-4-5",
  gemini:    "gemini-3-flash-preview",
};

// ── Pure functions (testable without DB) ───────────────────────────────────────

/**
 * Compute economy tier from a usage percentage.
 * Pure function — no DB access, fully deterministic. Use for unit tests.
 */
export function computeEconomyTier(
  usagePercent: number,
  thresholds: EconomyThresholds = DEFAULT_THRESHOLDS,
): EconomyTier {
  if (usagePercent >= thresholds.exhaustedAt) return "EXHAUSTED";
  if (usagePercent >= thresholds.criticalAt)  return "CRITICAL";
  if (usagePercent >= thresholds.economyAt)   return "ECONOMY";
  if (usagePercent >= thresholds.optimizedAt) return "OPTIMIZED";
  return "NORMAL";
}

/**
 * Validate and parse custom thresholds from user_prefs.settings.aiEconomyThresholds.
 * Returns DEFAULT_THRESHOLDS if absent or invalid.
 */
export function parseEconomyThresholds(raw: unknown): EconomyThresholds {
  if (!raw || typeof raw !== "object") return DEFAULT_THRESHOLDS;
  const t = raw as Record<string, unknown>;
  const o = Number(t["optimizedAt"]);
  const e = Number(t["economyAt"]);
  const c = Number(t["criticalAt"]);
  const x = Number(t["exhaustedAt"]);

  if (
    !isFinite(o) || !isFinite(e) || !isFinite(c) || !isFinite(x) ||
    o < 0 || e < 0 || c < 0 || x < 0 ||
    o > 100 || e > 100 || c > 100 || x > 100 ||
    !(o < e && e < c && c <= x)
  ) {
    logger.warn("[AI Economy] Invalid aiEconomyThresholds config — using defaults");
    return DEFAULT_THRESHOLDS;
  }
  return { optimizedAt: o, economyAt: e, criticalAt: c, exhaustedAt: x };
}

/**
 * Resolve economy policy for a given provider/model/mode + usage status.
 * Pure function — no DB access, fully deterministic.
 *
 * GARANTIE : provider ne change JAMAIS dans cette fonction.
 */
export function resolveEconomyPolicy(opts: {
  provider:       AIProviderId;
  requestedModel: string;
  requestedMode:  AIIntensityMode;
  baseMaxTokens:  number;
  usagePercent:   number;
  economyTier:    EconomyTier;
}): EconomyPolicy {
  const { provider, requestedModel, requestedMode, baseMaxTokens, usagePercent, economyTier } = opts;
  const economyModel = ECONOMY_MODELS[provider];

  switch (economyTier) {
    case "NORMAL":
      return {
        provider,
        requestedModel,
        effectiveModel:      requestedModel,
        requestedMode,
        effectiveMode:       requestedMode,
        economyTier,
        usagePercent,
        maxTokens:           baseMaxTokens,
        contextFactor:       1.0,
        downgradeApplied:    false,
        optimizationApplied: false,
        reason:              "NORMAL_USAGE",
      };

    case "OPTIMIZED": {
      const maxTokens = Math.round(baseMaxTokens * 0.85);
      return {
        provider,
        requestedModel,
        effectiveModel:      requestedModel,
        requestedMode,
        effectiveMode:       requestedMode,
        economyTier,
        usagePercent,
        maxTokens,
        contextFactor:       0.85,
        reasoningEffort:     provider === "openai" ? "medium" : undefined,
        downgradeApplied:    false,
        optimizationApplied: true,
        reason:              "MONTHLY_USAGE_THRESHOLD",
      };
    }

    case "ECONOMY": {
      const maxTokens       = Math.round(baseMaxTokens * 0.65);
      const effectiveModel  = economyModel;
      const downgradeApplied = effectiveModel !== requestedModel;
      const effectiveMode: AIIntensityMode = downgradeApplied ? "Conservateur" : requestedMode;
      return {
        provider,
        requestedModel,
        effectiveModel,
        requestedMode,
        effectiveMode,
        economyTier,
        usagePercent,
        maxTokens,
        contextFactor:       0.60,
        reasoningEffort:     provider === "openai" ? "low" : undefined,
        downgradeApplied,
        optimizationApplied: true,
        reason:              "MONTHLY_USAGE_THRESHOLD",
      };
    }

    case "CRITICAL": {
      const maxTokens      = Math.round(baseMaxTokens * 0.45);
      const effectiveModel = economyModel;
      const downgradeApplied = effectiveModel !== requestedModel;
      return {
        provider,
        requestedModel,
        effectiveModel,
        requestedMode,
        effectiveMode:       "Conservateur",
        economyTier,
        usagePercent,
        maxTokens,
        contextFactor:       0.35,
        reasoningEffort:     provider === "openai" ? "low" : undefined,
        downgradeApplied,
        optimizationApplied: true,
        reason:              "MONTHLY_USAGE_THRESHOLD",
      };
    }

    case "EXHAUSTED": {
      const effectiveModel   = economyModel;
      const downgradeApplied = effectiveModel !== requestedModel;
      return {
        provider,
        requestedModel,
        effectiveModel,
        requestedMode,
        effectiveMode:       "Conservateur",
        economyTier,
        usagePercent,
        maxTokens:           Math.round(baseMaxTokens * 0.45),
        contextFactor:       0.35,
        reasoningEffort:     provider === "openai" ? "low" : undefined,
        downgradeApplied,
        optimizationApplied: true,
        reason:              "QUOTA_EXHAUSTED",
      };
    }

    default:
      return {
        provider,
        requestedModel,
        effectiveModel:      requestedModel,
        requestedMode,
        effectiveMode:       requestedMode,
        economyTier:         "NORMAL",
        usagePercent,
        maxTokens:           baseMaxTokens,
        contextFactor:       1.0,
        downgradeApplied:    false,
        optimizationApplied: false,
        reason:              "NORMAL_USAGE",
      };
  }
}

// ── DB-backed functions ─────────────────────────────────────────────────────────

/**
 * Load org-specific economy thresholds from user_prefs.settings.aiEconomyThresholds.
 * Falls back to DEFAULT_THRESHOLDS if absent or invalid.
 */
export async function loadOrgEconomyThresholds(orgId: string): Promise<EconomyThresholds> {
  try {
    const client = await pool.connect();
    try {
      const { rows } = await client.query<{ settings: Record<string, unknown> }>(
        `SELECT settings FROM user_prefs WHERE org_id = $1 LIMIT 1`,
        [orgId]
      );
      return parseEconomyThresholds(rows[0]?.settings?.["aiEconomyThresholds"]);
    } finally {
      client.release();
    }
  } catch {
    return DEFAULT_THRESHOLDS;
  }
}

/**
 * Get org usage status from ai_monthly_usage + plan limits.
 * Uses credits (not tokens) as the reference metric.
 * Falls back to NORMAL tier if DB is unreachable (fail-open).
 */
export async function getOrgUsageStatus(
  orgId: string,
  thresholds: EconomyThresholds = DEFAULT_THRESHOLDS,
): Promise<OrgUsageStatus> {
  try {
    const usage = await getOrCreateMonthlyUsage(orgId);
    const totalAvailable = usage.creditsLimit + usage.creditsExtra;
    const usagePercent   = totalAvailable > 0
      ? Math.min((usage.creditsUsed / totalAvailable) * 100, 100)
      : 0;
    const remaining  = Math.max(0, totalAvailable - usage.creditsUsed);
    const economyTier = computeEconomyTier(usagePercent, thresholds);
    return {
      used:         usage.creditsUsed,
      limit:        totalAvailable,
      remaining,
      usagePercent,
      economyTier,
    };
  } catch (err) {
    logger.warn({ err, orgId }, "[AI Economy] getOrgUsageStatus failed — NORMAL fallback");
    return { used: 0, limit: 0, remaining: 999999, usagePercent: 0, economyTier: "NORMAL" };
  }
}
