/**
 * AI Config — Centralized provider pricing, model multipliers, feature costs.
 * Single source of truth for all AI credit & cost calculations.
 */

export type AIProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "mistral"
  | "grok"
  | "openrouter"
  | "deepseek";

export interface AIModelConfig {
  provider: AIProviderId;
  inputCostPer1k: number;   // EUR per 1k input tokens
  outputCostPer1k: number;  // EUR per 1k output tokens
  cacheCostPer1k: number;   // EUR per 1k cached tokens (0 if unsupported)
}

/** ── Provider definitions ─────────────────────────────────────────────── */
export const AI_PROVIDERS: Record<AIProviderId, { name: string; baseUrl?: string }> = {
  openai:     { name: "OpenAI" },
  anthropic:  { name: "Anthropic" },
  gemini:     { name: "Google Gemini" },
  mistral:    { name: "Mistral AI" },
  grok:       { name: "xAI Grok" },
  openrouter: { name: "OpenRouter" },
  deepseek:   { name: "DeepSeek" },
};

/** ── Model pricing (EUR per 1k tokens) — updated 2026-07-12 ──────────── */
export const AI_MODELS: Record<string, AIModelConfig> = {
  // OpenAI GPT-5 family
  "gpt-5":              { provider: "openai",    inputCostPer1k: 0.005,  outputCostPer1k: 0.015,  cacheCostPer1k: 0.00125 },
  "gpt-5-mini":         { provider: "openai",    inputCostPer1k: 0.0002, outputCostPer1k: 0.0008,  cacheCostPer1k: 0.00005 },
  "gpt-5-nano":         { provider: "openai",    inputCostPer1k: 0.00005,outputCostPer1k: 0.0002,  cacheCostPer1k: 0.00001 },
  "gpt-4o":             { provider: "openai",    inputCostPer1k: 0.0025, outputCostPer1k: 0.01,    cacheCostPer1k: 0.00125 },
  "gpt-4o-mini":        { provider: "openai",    inputCostPer1k: 0.00015,outputCostPer1k: 0.0006,  cacheCostPer1k: 0.000075 },
  "gpt-3.5-turbo":      { provider: "openai",    inputCostPer1k: 0.0003, outputCostPer1k: 0.0006,  cacheCostPer1k: 0 },

  // Anthropic Claude family
  "claude-4-sonnet":    { provider: "anthropic", inputCostPer1k: 0.003,  outputCostPer1k: 0.015,  cacheCostPer1k: 0.0003 },
  "claude-4-opus":      { provider: "anthropic", inputCostPer1k: 0.015,  outputCostPer1k: 0.075,  cacheCostPer1k: 0.0015 },
  "claude-3-5-sonnet":  { provider: "anthropic", inputCostPer1k: 0.003,  outputCostPer1k: 0.015,  cacheCostPer1k: 0.0003 },
  "claude-3-5-haiku":   { provider: "anthropic", inputCostPer1k: 0.00025,outputCostPer1k: 0.00125, cacheCostPer1k: 0.000025 },

  // Google Gemini family
  "gemini-2.5-pro":     { provider: "gemini",    inputCostPer1k: 0.00125,outputCostPer1k: 0.01,    cacheCostPer1k: 0 },
  "gemini-2.5-flash":   { provider: "gemini",    inputCostPer1k: 0.000075,outputCostPer1k: 0.0003, cacheCostPer1k: 0 },
  "gemini-2.0-flash":   { provider: "gemini",    inputCostPer1k: 0.0001, outputCostPer1k: 0.0004,  cacheCostPer1k: 0 },
  "gemini-1.5-pro":     { provider: "gemini",    inputCostPer1k: 0.00125,outputCostPer1k: 0.005,  cacheCostPer1k: 0 },
  "gemini-1.5-flash":   { provider: "gemini",    inputCostPer1k: 0.000075,outputCostPer1k: 0.0003, cacheCostPer1k: 0 },

  // Mistral (placeholder pricing — adjust when connected)
  "mistral-large":      { provider: "mistral",   inputCostPer1k: 0.002,  outputCostPer1k: 0.006,  cacheCostPer1k: 0 },
  "mistral-medium":     { provider: "mistral",   inputCostPer1k: 0.0005, outputCostPer1k: 0.0015,  cacheCostPer1k: 0 },
  "mistral-small":      { provider: "mistral",   inputCostPer1k: 0.0001, outputCostPer1k: 0.0003,  cacheCostPer1k: 0 },

  // xAI Grok (placeholder pricing)
  "grok-3":             { provider: "grok",      inputCostPer1k: 0.005,  outputCostPer1k: 0.015,  cacheCostPer1k: 0 },
  "grok-3-mini":        { provider: "grok",      inputCostPer1k: 0.0003, outputCostPer1k: 0.001,  cacheCostPer1k: 0 },

  // OpenRouter (placeholder — actual cost depends on routed model)
  "openrouter-default": { provider: "openrouter",inputCostPer1k: 0.002,  outputCostPer1k: 0.008,  cacheCostPer1k: 0 },

  // DeepSeek (placeholder pricing)
  "deepseek-v3":        { provider: "deepseek",  inputCostPer1k: 0.00014,outputCostPer1k: 0.00028, cacheCostPer1k: 0.000014 },
  "deepseek-r1":        { provider: "deepseek",  inputCostPer1k: 0.00055,outputCostPer1k: 0.00219, cacheCostPer1k: 0.00014 },
};

/** ── Model cost multipliers (applied to base feature cost) ────────────── */
export const MODEL_MULTIPLIERS: Record<string, number> = {
  // OpenAI
  "gpt-5":              1.5,
  "gpt-5-mini":         0.5,
  "gpt-5-nano":         0.2,
  "gpt-4o":             1.2,
  "gpt-4o-mini":        0.4,
  "gpt-3.5-turbo":      0.3,

  // Anthropic
  "claude-4-sonnet":    1.4,
  "claude-4-opus":      2.5,
  "claude-3-5-sonnet":  1.3,
  "claude-3-5-haiku":   0.3,

  // Gemini
  "gemini-2.5-pro":     1.0,
  "gemini-2.5-flash":   0.3,
  "gemini-2.0-flash":   0.35,
  "gemini-1.5-pro":     0.8,
  "gemini-1.5-flash":   0.25,

  // Others
  "mistral-large":      0.9,
  "mistral-medium":     0.4,
  "mistral-small":      0.2,
  "grok-3":             1.5,
  "grok-3-mini":        0.4,
  "openrouter-default": 1.0,
  "deepseek-v3":        0.25,
  "deepseek-r1":        0.6,
};

/** Fallback multiplier for unknown models */
export const DEFAULT_MODEL_MULTIPLIER = 1.0;

/** ── Feature base costs (credits per call) — unchanged user-facing values ─ */
export const FEATURE_BASE_COSTS: Record<string, number> = {
  chat:              800,
  strategist:       2400,
  report_gen:       1600,
  mission_auto:      600,
  cro_analysis:     1200,
  forecast:         2000,
  market_intel:     1800,
  behavior_analysis: 1000,
  revenue_leak:      900,
  audit_summary:     500,
};

/** ── Tool / image call costs (EUR per call) ──────────────────────────── */
export const IMAGE_COSTS: Record<string, number> = {
  "dall-e-3":         0.04,
  "dall-e-3-hd":      0.08,
  "stable-diffusion": 0.02,
  "midjourney-proxy": 0.10,
};

export const WEB_SEARCH_COSTS: Record<string, number> = {
  "perplexity":       0.005,
  "bing":             0.002,
  "serpapi":          0.003,
  "tavily":           0.001,
};

/** ── Credit-to-EUR conversion rate ─────────────────────────────────────
 *  1 AI Credit = 0.00005 EUR  (i.e. 1 EUR = 20,000 credits)
 *  This is an internal accounting rate, NOT a user-facing price.
 */
export const CREDIT_EUR_RATE = 0.00005;

/** ── Helpers ─────────────────────────────────────────────────────────── */

export function getModelConfig(model: string): AIModelConfig | null {
  return AI_MODELS[model] ?? null;
}

export function getModelMultiplier(model: string): number {
  return MODEL_MULTIPLIERS[model] ?? DEFAULT_MODEL_MULTIPLIER;
}

export function getFeatureBaseCost(feature: string): number {
  return FEATURE_BASE_COSTS[feature] ?? 500;
}

export function computeRealCostEur(opts: {
  model: string;
  tokensIn: number;
  tokensOut: number;
  cachedTokens?: number;
  imageCalls?: Array<{ model: string }>;
  webSearchCalls?: Array<{ provider: string }>;
}): number {
  const cfg = getModelConfig(opts.model);
  if (!cfg) return 0;

  const cached = opts.cachedTokens ?? 0;
  const baseCost =
    ((opts.tokensIn - cached) / 1000) * cfg.inputCostPer1k +
    (opts.tokensOut / 1000) * cfg.outputCostPer1k +
    (cached / 1000) * cfg.cacheCostPer1k;

  const imageCost = (opts.imageCalls ?? []).reduce(
    (sum, c) => sum + (IMAGE_COSTS[c.model] ?? 0),
    0
  );

  const searchCost = (opts.webSearchCalls ?? []).reduce(
    (sum, c) => sum + (WEB_SEARCH_COSTS[c.provider] ?? 0),
    0
  );

  return baseCost + imageCost + searchCost;
}

export function computeCreditsDebited(opts: {
  feature: string;
  model: string;
  realCostEur: number;
}): number {
  const baseCost = getFeatureBaseCost(opts.feature);
  const multiplier = getModelMultiplier(opts.model);
  const multiplied = Math.round(baseCost * multiplier);
  const realCostCredits = Math.round(opts.realCostEur / CREDIT_EUR_RATE);
  return Math.max(multiplied, realCostCredits);
}
