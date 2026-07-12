/**
 * AI Preferences — reads org user_prefs and resolves provider+model based on
 * intensity, module gates, preferred provider, task type, and cost/quality bias.
 */

import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { resolveTaskProvider, type AITaskType } from "./ai-providers/task-router.js";
import { PROVIDER_CAPABILITIES, providerSupports, type AIProviderId } from "./ai-providers/capabilities.js";

export type AIIntensity = "Conservateur" | "Équilibré" | "Agressif";
export type AIModuleKey =
  | "dailyAI" | "aiAlerts" | "aiForecasting" | "aiReporting"
  | "aiCRO" | "aiStrategist" | "aiChurn" | "aiMarket";

/** Maps each frontend module key to the backend AI feature/task used */
const MODULE_TO_TASK: Record<AIModuleKey, AITaskType> = {
  dailyAI:        "audit_summary",
  aiAlerts:       "chat",
  aiForecasting:  "forecasting",
  aiReporting:    "executive_report",
  aiCRO:          "cro_analysis",
  aiStrategist:   "strategist",
  aiChurn:        "behavior_analysis",
  aiMarket:       "market_intel",
};

const INTENSITY_MAP: Record<AIIntensity, { quality: "fast" | "balanced" | "max"; tokenMult: number; bias: "cost" | "balanced" | "quality" }> = {
  "Conservateur": { quality: "fast",   tokenMult: 0.6, bias: "cost" },
  "Équilibré":    { quality: "balanced", tokenMult: 1.0, bias: "balanced" },
  "Agressif":     { quality: "max",    tokenMult: 1.5, bias: "quality" },
};

export interface OrgAIPrefs {
  aiIntensity: AIIntensity;
  aiModules: Record<string, boolean>;
  preferredProvider?: AIProviderId;
  preferredModel?: string;
}

export interface ResolvedAIConfig {
  provider: AIProviderId;
  model: string;
  maxTokens: number;
  quality: "fast" | "balanced" | "max";
  costPer1kTokens: number;
}

export async function loadOrgAIPrefs(orgId: string): Promise<OrgAIPrefs> {
  const client = await pool.connect();
  try {
    const r = await client.query<{ settings: Record<string, unknown> }>(
      `SELECT settings FROM user_prefs WHERE org_id = $1 LIMIT 1`,
      [orgId]
    );
    const s = r.rows[0]?.settings ?? {};
    return {
      aiIntensity:  (s.aiIntensity as AIIntensity)  ?? "Équilibré",
      aiModules:    (s.aiModules as Record<string, boolean>) ?? {},
      preferredProvider: (s.preferredProvider as AIProviderId)  ?? undefined,
      preferredModel:    (s.preferredModel as string) ?? undefined,
    };
  } catch (err) {
    logger.warn({ err, orgId }, "[AI Prefs] load failed — defaults");
    return { aiIntensity: "Équilibré", aiModules: {} };
  } finally {
    client.release();
  }
}

export function checkModuleEnabled(prefs: OrgAIPrefs, moduleKey: AIModuleKey): boolean {
  // Default enabled unless explicitly set to false
  return prefs.aiModules[moduleKey] !== false;
}

export function moduleDisabledResponse(moduleKey: AIModuleKey): { error: string; module: string; status: string } {
  return {
    error: `Le module ${moduleKey} est désactivé. Activez-le dans Settings → IA Config pour utiliser cette fonctionnalité.`,
    module: moduleKey,
    status: "disabled",
  };
}

/**
 * Resolve the best provider + model for a given AI feature and org preferences.
 * Takes into account: intensity, preferred provider, cost/quality bias, and capabilities.
 */
export function resolveAIModel(
  prefs: OrgAIPrefs,
  task: AITaskType,
  capability?: string
): ResolvedAIConfig {
  const intensity = INTENSITY_MAP[prefs.aiIntensity] ?? INTENSITY_MAP["Équilibré"];

  // 1. Hardcoded intensity contract per spec
  //    Conservateur → gpt-5-mini (OpenAI), Équilibré → task-router default, Agressif → best model
  //    This guard takes precedence over any provider/model override to guarantee spec compliance.
  if (prefs.aiIntensity === "Conservateur") {
    return { provider: "openai", model: "gpt-5-mini", maxTokens: 500, quality: "fast", costPer1kTokens: 0.001 };
  }

  // 2. Start from task router default
  let { provider, model } = resolveTaskProvider(task, prefs.preferredProvider, capability as any);

  // 3. Intensity overrides for provider selection
  if (intensity.bias === "cost" && !prefs.preferredProvider) {
    if (providerSupports("openai", capability as any ?? "chat")) {
      provider = "openai"; // keep OpenAI for consistent mini availability
    }
  }
  if (intensity.bias === "quality" && !prefs.preferredProvider) {
    // Quality-first: keep task-router default (usually Anthropic/OpenAI gpt-5)
  }

  // 4. Model selection based on intensity
  const caps = PROVIDER_CAPABILITIES[provider];
  if (!caps) {
    return { provider: "openai", model: "gpt-5-mini", maxTokens: 500, quality: intensity.quality, costPer1kTokens: 0.001 };
  }

  if (prefs.preferredModel && caps.models.includes(prefs.preferredModel)) {
    model = prefs.preferredModel;
  } else {
    if (intensity.quality === "fast") {
      const cheap = caps.models.find(m => /mini|flash|haiku/i.test(m));
      model = cheap ?? caps.defaultModel;
    } else if (intensity.quality === "max") {
      const best = caps.models.find(m =>
        /gpt-5(?!.*mini)|opus|pro(?!.*flash)/i.test(m)
      ) ?? caps.models.find(m => /sonnet|o3/i.test(m)) ?? caps.defaultModel;
      model = best;
    } else {
      model = caps.defaultModel;
    }
  }

  // 5. Token budget based on intensity
  const baseTokens = 800;
  const maxTokens = Math.max(200, Math.round(baseTokens * intensity.tokenMult));

  const costPer1kTokens = (caps.costPer1kTokensIn + caps.costPer1kTokensOut) / 2;

  return { provider, model, maxTokens, quality: intensity.quality, costPer1kTokens };
}

/**
 * Convenience: resolve by module key instead of task type.
 */
export function resolveAIModelForModule(
  prefs: OrgAIPrefs,
  moduleKey: AIModuleKey,
  capability?: string
): ResolvedAIConfig {
  const task = MODULE_TO_TASK[moduleKey] ?? "chat";
  return resolveAIModel(prefs, task, capability);
}

/**
 * Legacy wrapper: keeps the old selectOptimalModel signature but now
 * respects org preferences when orgId is provided.
 */
export async function selectOptimalModel(
  feature: string,
  orgId?: string
): Promise<{ model: string; provider: AIProviderId; maxTokens: number }> {
  if (!orgId) {
    return { model: "gpt-5-mini", provider: "openai", maxTokens: 800 };
  }
  const prefs = await loadOrgAIPrefs(orgId);
  const task: AITaskType =
    (Object.entries(MODULE_TO_TASK).find(([, t]) => t === feature)?.[1] as AITaskType)
    ?? (feature as AITaskType)
    ?? "chat";
  const cfg = resolveAIModel(prefs, task);
  return { model: cfg.model, provider: cfg.provider, maxTokens: cfg.maxTokens };
}
