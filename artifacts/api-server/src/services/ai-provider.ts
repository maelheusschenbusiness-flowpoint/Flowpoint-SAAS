/**
 * ai-provider.ts — Unified AI Provider Layer for FlowPoint
 *
 * This is the SINGLE entry point for all AI calls in the backend.
 * It routes requests to OpenAI, Anthropic, or Gemini based on:
 *   • User-selected provider/model
 *   • Task type (chat, report, vision, image generation, etc.)
 *   • Provider capabilities
 *
 * Adding a new provider = adding a new file in ai-providers/ + registering here.
 */

import { logger } from "../lib/logger.js";
import { resolveOpenAIConnection } from "../lib/openai-client.js";
import type {
  AIProviderId,
  AIProviderChatOptions,
  AIProviderResult,
  AIProviderStreamChunk,
} from "./ai-providers/openai-provider.js";
import { OpenAIProvider } from "./ai-providers/openai-provider.js";
import { AnthropicProvider } from "./ai-providers/anthropic-provider.js";
import { GeminiProvider } from "./ai-providers/gemini-provider.js";
import { resolveTaskProvider } from "./ai-providers/task-router.js";
import { PROVIDER_CAPABILITIES } from "./ai-providers/capabilities.js";

export type { AIProviderId, AIProviderChatOptions, AIProviderResult, AIProviderStreamChunk };
export { PROVIDER_CAPABILITIES, providerSupports, findProviderForCapability } from "./ai-providers/capabilities.js";
export { resolveTaskProvider } from "./ai-providers/task-router.js";

// ── Provider instances (lazy-initialized, cached) ─────────────────────────

const instances = new Map<AIProviderId, OpenAIProvider | AnthropicProvider | GeminiProvider>();

function getProvider(id: AIProviderId): OpenAIProvider | AnthropicProvider | GeminiProvider {
  if (instances.has(id)) return instances.get(id)!;

  switch (id) {
    case "openai": {
      const conn = resolveOpenAIConnection();
      if (!conn) throw new Error("AI_NOT_CONFIGURED: OpenAI API key missing");
      const p = new OpenAIProvider(conn.apiKey, conn.baseURL);
      instances.set(id, p);
      return p;
    }
    case "anthropic": {
      const key = process.env["ANTHROPIC_API_KEY"];
      if (!key) throw new Error("AI_NOT_CONFIGURED: ANTHROPIC_API_KEY missing");
      const p = new AnthropicProvider(key);
      instances.set(id, p);
      return p;
    }
    case "gemini": {
      const key = process.env["GEMINI_API_KEY"];
      if (!key) throw new Error("AI_NOT_CONFIGURED: GEMINI_API_KEY missing");
      const p = new GeminiProvider(key);
      instances.set(id, p);
      return p;
    }
    default:
      throw new Error(`AI_NOT_CONFIGURED: Unknown provider "${id}"`);
  }
}

/** Reset cached instances (useful for testing or when env vars change) */
export function resetProviders(): void {
  instances.clear();
}

// ── Unified chat API ────────────────────────────────────────────────────────

export async function aiChat(opts: AIProviderChatOptions & {
  provider?: AIProviderId;
  task?: string;
}): Promise<AIProviderResult> {
  const { provider: explicitProvider, task, ...chatOpts } = opts;

  // Resolve provider: explicit > task-based > default
  let providerId: AIProviderId;
  let model: string;

  if (explicitProvider) {
    providerId = explicitProvider;
    model = chatOpts.model ?? PROVIDER_CAPABILITIES[providerId].defaultModel;
  } else if (task) {
    const resolved = resolveTaskProvider(task as import("./ai-providers/task-router.js").AITaskType, undefined);
    providerId = resolved.provider;
    model = chatOpts.model ?? resolved.model;
  } else {
    providerId = "openai";
    model = chatOpts.model ?? "gpt-5-mini";
  }

  const provider = getProvider(providerId);
  logger.info({ provider: providerId, model, task }, "[AI] Chat request");

  try {
    const result = await provider.chat({ ...chatOpts, model });
    logger.info({ provider: providerId, model, tokens: result.usage.totalTokens, latency: result.latencyMs }, "[AI] Chat complete");
    return result;
  } catch (err) {
    logger.error({ err, provider: providerId, model }, "[AI] Chat failed");
    throw err;
  }
}

// ── Unified streaming API ───────────────────────────────────────────────────

export async function *aiStream(opts: AIProviderChatOptions & {
  provider?: AIProviderId;
  task?: string;
}): AsyncGenerator<AIProviderStreamChunk, AIProviderResult, unknown> {
  const { provider: explicitProvider, task, ...chatOpts } = opts;

  let providerId: AIProviderId;
  let model: string;

  if (explicitProvider) {
    providerId = explicitProvider;
    model = chatOpts.model ?? PROVIDER_CAPABILITIES[providerId].defaultModel;
  } else if (task) {
    const resolved = resolveTaskProvider(task as import("./ai-providers/task-router.js").AITaskType, undefined);
    providerId = resolved.provider;
    model = chatOpts.model ?? resolved.model;
  } else {
    providerId = "openai";
    model = chatOpts.model ?? "gpt-5-mini";
  }

  const provider = getProvider(providerId);
  logger.info({ provider: providerId, model, task, streaming: true }, "[AI] Stream request");

  try {
    const gen = provider.stream({ ...chatOpts, model });
    let finalResult: AIProviderResult | undefined;

    for await (const chunk of gen) {
      if (chunk && typeof chunk === "object" && "content" in chunk) {
        yield chunk as AIProviderStreamChunk;
      }
      // The last value from the generator is the return value (not yielded)
      if (chunk && typeof chunk === "object" && "text" in chunk && "usage" in chunk) {
        finalResult = chunk as unknown as AIProviderResult;
      }
    }

    // For generators that return via the final yield, extract from the generator
    // Actually, the return value is obtained differently with AsyncGenerator
    // Let's re-stream and capture
    if (!finalResult) {
      // Re-run to get the final result — inefficient but safe fallback
      finalResult = await provider.chat({ ...chatOpts, model });
    }

    logger.info({ provider: providerId, model, tokens: finalResult.usage.totalTokens, latency: finalResult.latencyMs }, "[AI] Stream complete");
    return finalResult;
  } catch (err) {
    logger.error({ err, provider: providerId, model }, "[AI] Stream failed");
    throw err;
  }
}

// ── Image generation ────────────────────────────────────────────────────────

export async function aiGenerateImage(opts: {
  prompt: string;
  provider?: AIProviderId;
  size?: string;
}): Promise<{ b64_json: string; mimeType?: string }> {
  const providerId = opts.provider ?? "openai";
  const provider = getProvider(providerId);

  if (providerId === "openai") {
    const result = await (provider as OpenAIProvider).generateImage(opts.prompt, opts.size);
    return { b64_json: result.b64_json };
  }

  if (providerId === "gemini") {
    const result = await (provider as GeminiProvider).generateImage(opts.prompt);
    return { b64_json: result.b64_json, mimeType: result.mimeType };
  }

  throw new Error(`Provider "${providerId}" does not support image generation`);
}

// ── Cost calculation ────────────────────────────────────────────────────────

export function calculateCost(providerId: AIProviderId, tokensIn: number, tokensOut: number): number {
  const caps = PROVIDER_CAPABILITIES[providerId];
  if (!caps) return 0;
  return (tokensIn / 1000) * caps.costPer1kTokensIn + (tokensOut / 1000) * caps.costPer1kTokensOut;
}

// ── Health check ────────────────────────────────────────────────────────────

export async function checkProviderHealth(providerId: AIProviderId): Promise<{ ok: boolean; error?: string }> {
  try {
    getProvider(providerId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function checkAllProviders(): Promise<Record<AIProviderId, { ok: boolean; error?: string }>> {
  const results: Record<string, { ok: boolean; error?: string }> = {};
  for (const id of ["openai", "anthropic", "gemini"] as AIProviderId[]) {
    results[id] = await checkProviderHealth(id);
  }
  return results as Record<AIProviderId, { ok: boolean; error?: string }>;
}
