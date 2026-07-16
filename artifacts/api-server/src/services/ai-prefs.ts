/**
 * AI Preferences — reads org user_prefs and resolves provider+model based on
 * intensity, module gates, preferred provider, task type, and cost/quality bias.
 *
 * RÈGLE FONDAMENTALE (Phase 2) :
 *   resolveAIModel() ne change JAMAIS le provider.
 *   Le provider vient de prefs.preferredProvider (source de vérité org).
 *   L'intensité ne modifie que le modèle à l'intérieur du provider fixé.
 */

import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { resolveTaskProvider, type AITaskType } from "./ai-providers/task-router.js";
import { PROVIDER_CAPABILITIES, type AIProviderId } from "./ai-providers/capabilities.js";
import { resolveIntensityConfig, normalizeIntensity } from "./ai-provider-matrix.js";

export type AIIntensity = "Conservateur" | "Équilibré" | "Performant" | "Agressif";
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
    // Normalize legacy "Agressif" → "Performant" on read
    const rawIntensity = (s.aiIntensity as string) ?? "Équilibré";
    const intensity = normalizeIntensity(rawIntensity) as AIIntensity;
    return {
      aiIntensity:       intensity,
      aiModules:         (s.aiModules as Record<string, boolean>) ?? {},
      preferredProvider: (s.preferredProvider as AIProviderId) ?? undefined,
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
 *
 * IMPORTANT : cette fonction ne change JAMAIS le provider.
 *   1. Provider = prefs.preferredProvider ?? task-router default
 *   2. Modèle = matrice intensity × provider (jamais de changement de provider)
 */
export function resolveAIModel(
  prefs: OrgAIPrefs,
  task: AITaskType,
  _capability?: string
): ResolvedAIConfig {
  const normalizedIntensity = normalizeIntensity(prefs.aiIntensity);

  // 1. Provider : preferredProvider > task-router default
  //    On respecte toujours le preferredProvider de l'org, quelle que soit la tâche.
  let provider: AIProviderId;
  if (prefs.preferredProvider) {
    provider = prefs.preferredProvider;
  } else {
    const taskDefault = resolveTaskProvider(task, undefined);
    provider = taskDefault.provider;
  }

  // 2. Modèle : matrice intensity × provider
  //    Si l'org a un preferredModel valide pour ce provider, on l'utilise.
  //    Sinon, la matrice décide du modèle selon l'intensité.
  const intensityCfg = resolveIntensityConfig(provider, normalizedIntensity);

  let model: string;
  if (
    prefs.preferredModel &&
    PROVIDER_CAPABILITIES[provider]?.models.includes(prefs.preferredModel)
  ) {
    model = prefs.preferredModel;
  } else {
    model = intensityCfg.model;
  }

  const maxTokens = intensityCfg.maxTokens;
  const caps = PROVIDER_CAPABILITIES[provider];
  const costPer1kTokens = caps ? (caps.costPer1kTokensIn + caps.costPer1kTokensOut) / 2 : 0.001;

  const qualityMap: Record<string, "fast" | "balanced" | "max"> = {
    Conservateur: "fast",
    Équilibré:    "balanced",
    Performant:   "max",
  };
  const quality = qualityMap[normalizedIntensity] ?? "balanced";

  return { provider, model, maxTokens, quality, costPer1kTokens };
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
