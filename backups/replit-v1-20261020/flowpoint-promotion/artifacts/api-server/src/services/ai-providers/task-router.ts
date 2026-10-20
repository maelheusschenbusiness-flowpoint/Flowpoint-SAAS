/**
 * Task Router — decides which provider to use based on the task type and user preferences.
 *
 * Default routing (can be overridden by explicit user selection):
 *   Chat → OpenAI (gpt-5-mini)
 *   Executive Reports → Anthropic (claude-sonnet-4-6)
 *   Mission generation → OpenAI (gpt-5-mini)
 *   Screenshot/Vision analysis → Gemini (gemini-2.5-flash)
 *   Image generation → OpenAI (gpt-image-1)
 *   SEO Audit analysis → Anthropic (claude-sonnet-4-6)
 *   Forecasting → OpenAI (gpt-5)
 */

import type { AIProviderId, AICapability } from "./capabilities.js";

export type AITaskType =
  | "chat"
  | "executive_report"
  | "mission_generation"
  | "vision_analysis"
  | "image_generation"
  | "seo_audit"
  | "forecasting"
  | "market_intel"
  | "behavior_analysis"
  | "revenue_leak"
  | "cro_analysis"
  | "audit_summary"
  | "strategist";

interface TaskRouting {
  defaultProvider: AIProviderId;
  defaultModel: string;
  requiredCapability?: AICapability;
}

const TASK_ROUTING: Record<AITaskType, TaskRouting> = {
  chat:              { defaultProvider: "openai",   defaultModel: "gpt-5-mini" },
  executive_report:  { defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-6" },
  mission_generation:{ defaultProvider: "openai",   defaultModel: "gpt-5-mini" },
  vision_analysis:   { defaultProvider: "gemini",   defaultModel: "gemini-2.5-flash", requiredCapability: "vision" },
  image_generation:  { defaultProvider: "openai",   defaultModel: "gpt-image-1", requiredCapability: "image_generation" },
  seo_audit:         { defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-6" },
  forecasting:       { defaultProvider: "openai",   defaultModel: "gpt-5" },
  market_intel:      { defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-6" },
  behavior_analysis: { defaultProvider: "openai",   defaultModel: "gpt-5-mini" },
  revenue_leak:      { defaultProvider: "openai",   defaultModel: "gpt-5-mini" },
  cro_analysis:      { defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-6" },
  audit_summary:     { defaultProvider: "openai",   defaultModel: "gpt-5-mini" },
  strategist:        { defaultProvider: "anthropic", defaultModel: "claude-sonnet-4-6" },
};

export function resolveTaskProvider(
  task: AITaskType,
  userPreference?: AIProviderId,
  capability?: AICapability
): { provider: AIProviderId; model: string } {
  const routing = TASK_ROUTING[task];
  if (!routing) {
    return { provider: userPreference ?? "openai", model: "gpt-5-mini" };
  }

  // If user explicitly chose a provider and it supports the required capability, respect it
  if (userPreference) {
    const { providerSupports } = require("./capabilities.js");
    if (!routing.requiredCapability || providerSupports(userPreference, routing.requiredCapability)) {
      return { provider: userPreference, model: getModelForProvider(userPreference, task) };
    }
  }

  return { provider: routing.defaultProvider, model: routing.defaultModel };
}

function getModelForProvider(provider: AIProviderId, task: AITaskType): string {
  const { PROVIDER_CAPABILITIES } = require("./capabilities.js");
  const caps = PROVIDER_CAPABILITIES[provider];
  if (!caps) return "gpt-5-mini";

  // If the default model for this task exists in the provider's model list, use it
  const routing = TASK_ROUTING[task];
  if (routing && caps.models.includes(routing.defaultModel)) {
    return routing.defaultModel;
  }

  // Otherwise fallback to the provider's default model
  return caps.defaultModel;
}
