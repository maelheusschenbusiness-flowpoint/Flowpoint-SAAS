/**
 * AI Provider Capabilities — what each provider supports.
 *
 * This is the single source of truth for feature support across providers.
 * Adding a new provider means adding one entry here.
 */

export type AIProviderId = "openai" | "anthropic" | "gemini";

export type AICapability =
  | "chat"
  | "streaming"
  | "vision"
  | "pdf"
  | "docx"
  | "xlsx"
  | "csv"
  | "html"
  | "markdown"
  | "json"
  | "image_generation"
  | "audio_input"
  | "audio_output";

export interface ProviderCapabilities {
  id: AIProviderId;
  name: string;
  defaultModel: string;
  models: string[];
  capabilities: AICapability[];
  costPer1kTokensIn: number;
  costPer1kTokensOut: number;
  maxTokens: number;
  streamingSupported: boolean;
  supportsTemperature: boolean;
  supportsJsonMode: boolean;
}

export const PROVIDER_CAPABILITIES: Record<AIProviderId, ProviderCapabilities> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    defaultModel: "gpt-5-mini",
    models: [
      "gpt-5-mini",
      "gpt-5",
      "gpt-5.4",
      "gpt-5.3-codex",
      "gpt-5.2",
      "gpt-image-1",
      "gpt-4o",
      "gpt-4o-mini",
      "o4-mini",
      "o3",
    ],
    capabilities: [
      "chat",
      "streaming",
      "vision",
      "pdf",
      "docx",
      "xlsx",
      "csv",
      "html",
      "markdown",
      "json",
      "image_generation",
      "audio_input",
      "audio_output",
    ],
    costPer1kTokensIn: 0.005,
    costPer1kTokensOut: 0.015,
    maxTokens: 8192,
    streamingSupported: true,
    supportsTemperature: false, // gpt-5 family doesn't support temperature
    supportsJsonMode: true,
  },
  anthropic: {
    id: "anthropic",
    name: "Claude",
    defaultModel: "claude-sonnet-4-6",
    models: [
      "claude-sonnet-4-6",
      "claude-sonnet-4-5",
      "claude-opus-4-8",
      "claude-opus-4-7",
      "claude-haiku-4-5",
    ],
    capabilities: [
      "chat",
      "streaming",
      "vision",
      "pdf",
      "docx",
      "xlsx",
      "csv",
      "html",
      "markdown",
      "json",
    ],
    costPer1kTokensIn: 0.003,
    costPer1kTokensOut: 0.015,
    maxTokens: 8192,
    streamingSupported: true,
    supportsTemperature: false, // Claude doesn't support temperature/top_p/top_k on newer models
    supportsJsonMode: true,
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    defaultModel: "gemini-3.1-pro-preview",
    models: [
      "gemini-3.1-pro-preview",
      "gemini-3-flash-preview",
      "gemini-3.5-flash",
      "gemini-3-pro-image-preview",
      "gemini-3.1-flash-image",
      "gemini-2.5-flash-image",
    ],
    capabilities: [
      "chat",
      "streaming",
      "vision",
      "pdf",
      "docx",
      "xlsx",
      "csv",
      "html",
      "markdown",
      "json",
      "image_generation",
    ],
    costPer1kTokensIn: 0.001,
    costPer1kTokensOut: 0.004,
    maxTokens: 8192,
    streamingSupported: true,
    supportsTemperature: true,
    supportsJsonMode: true,
  },
};

/** Check if a provider supports a given capability */
export function providerSupports(providerId: AIProviderId, capability: AICapability): boolean {
  return PROVIDER_CAPABILITIES[providerId]?.capabilities.includes(capability) ?? false;
}

/** Get the first provider that supports the given capability */
export function findProviderForCapability(capability: AICapability): AIProviderId | null {
  for (const [id, caps] of Object.entries(PROVIDER_CAPABILITIES)) {
    if (caps.capabilities.includes(capability)) return id as AIProviderId;
  }
  return null;
}
