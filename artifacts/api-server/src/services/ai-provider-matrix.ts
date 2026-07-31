/**
 * ai-provider-matrix.ts — Source de vérité unique pour la sélection du modèle.
 *
 * Règle absolue :
 *   - Le PROVIDER vient toujours du choix utilisateur (jamais de ce fichier).
 *   - Ce fichier résout uniquement le MODÈLE et les paramètres d'appel
 *     à l'intérieur d'un provider déjà fixé.
 *
 * Les modes Conservateur / Équilibré / Performant ne changent JAMAIS le provider.
 */

import { PROVIDER_CAPABILITIES, type AIProviderId } from "./ai-providers/capabilities.js";

export type AIIntensityMode = "Conservateur" | "Équilibré" | "Performant";
export const VALID_PROVIDERS: AIProviderId[] = ["openai", "anthropic", "gemini"];

export interface IntensityConfig {
  model: string;
  maxTokens: number;
  reasoningEffort?: "low" | "medium" | "high";
  contextDepth: "shallow" | "standard" | "deep";
}

/**
 * Matrice centrale provider × mode → config.
 * Tous les modèles référencés ici doivent être présents dans capabilities.ts.
 *
 * OpenAI    : Conservateur = gpt-5-mini, Équilibré = gpt-5, Performant = gpt-5 (budget élargi)
 * Anthropic : Conservateur = claude-haiku-4-5, Équilibré = claude-sonnet-4-6, Performant = claude-opus-4-8
 * Gemini    : Conservateur = gemini-3-flash-preview, Équilibré = gemini-3-flash-preview, Performant = gemini-3.1-pro-preview
 *
 * Gemini Flash strategy (2026-07-31 bench — 3 questions, direct SDK):
 *   gemini-3-flash-preview : avgTTFT=2773ms avgTotal=3023ms  ← FASTEST flash
 *   gemini-3.5-flash       : avgTTFT=3865ms avgTotal=4156ms  ← slightly slower
 *   gemini-3.1-pro-preview : avgTTFT=7351ms avgTotal=7937ms  ← thinking model, Performant only
 */
const MATRIX: Record<AIProviderId, Record<AIIntensityMode, IntensityConfig>> = {
  openai: {
    Conservateur: { model: "gpt-5-mini", maxTokens: 500,  reasoningEffort: "low",    contextDepth: "shallow" },
    Équilibré:    { model: "gpt-5",      maxTokens: 800,  reasoningEffort: "medium", contextDepth: "standard" },
    Performant:   { model: "gpt-5",      maxTokens: 1400, reasoningEffort: "high",   contextDepth: "deep" },
  },
  anthropic: {
    Conservateur: { model: "claude-haiku-4-5",  maxTokens: 500,  contextDepth: "shallow" },
    Équilibré:    { model: "claude-sonnet-4-6", maxTokens: 800,  contextDepth: "standard" },
    Performant:   { model: "claude-opus-4-8",   maxTokens: 1400, contextDepth: "deep" },
  },
  gemini: {
    // gemini-3-flash-preview wins on latency: TTFT ~2.8s, full ~3s on simple questions.
    // gemini-3.1-pro-preview reserved for Performant: thinking model, TTFT ~7-10s.
    Conservateur: { model: "gemini-3-flash-preview",  maxTokens: 500,  contextDepth: "shallow" },
    Équilibré:    { model: "gemini-3-flash-preview",  maxTokens: 900,  contextDepth: "standard" },
    Performant:   { model: "gemini-3.1-pro-preview",  maxTokens: 1400, contextDepth: "deep" },
  },
};

/** Normalise "Agressif" (alias legacy) → "Performant". Défaut : "Équilibré". */
export function normalizeIntensity(raw: string | undefined): AIIntensityMode {
  if (raw === "Agressif") return "Performant";
  if (raw === "Conservateur" || raw === "Équilibré" || raw === "Performant") return raw;
  return "Équilibré";
}

/**
 * Résout le modèle et les paramètres d'appel pour un provider + mode donnés.
 * Le provider n'est jamais modifié ici.
 */
export function resolveIntensityConfig(
  provider: AIProviderId,
  intensity: string | undefined,
): IntensityConfig {
  const mode = normalizeIntensity(intensity);
  return MATRIX[provider]?.[mode] ?? MATRIX.openai["Équilibré"];
}

/** Vérifie qu'un provider est valide. */
export function isValidProvider(p: unknown): p is AIProviderId {
  return VALID_PROVIDERS.includes(p as AIProviderId);
}

/**
 * Vérifie qu'un modèle appartient bien au provider indiqué.
 * Retourne false si la combinaison est invalide.
 */
export function isModelValidForProvider(provider: AIProviderId, model: string): boolean {
  return PROVIDER_CAPABILITIES[provider]?.models.includes(model) ?? false;
}
