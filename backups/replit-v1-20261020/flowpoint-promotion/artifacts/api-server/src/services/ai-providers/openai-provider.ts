/**
 * OpenAI Provider — implements the unified AIProvider interface.
 *
 * Uses the existing OpenAI SDK. Supports chat, streaming, JSON mode, and image generation.
 */

import OpenAI from "openai";
import type { AIProviderId } from "./capabilities.js";
export type { AIProviderId };
import { toOpenAIContentParts, isMultimodalContent, type ContentBlock } from "./multimodal-mappers.js";

export interface AIProviderChatOptions {
  systemPrompt: string;
  userPrompt?: string;  // optional when messages[] is provided
  model?: string;
  maxTokens?: number;
  temperature?: number;
  json?: boolean;
  messages?: Array<{ role: "system" | "user" | "assistant"; content: string | ContentBlock[] }>;
}

export interface AIProviderStreamChunk {
  content: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export interface AIProviderResult {
  text: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  model: string;
  provider: AIProviderId;
  latencyMs: number;
}

function isGpt5Family(model: string): boolean {
  return /^gpt-5/.test(model);
}

export class OpenAIProvider {
  readonly id: AIProviderId = "openai";
  private client: OpenAI;

  constructor(apiKey: string, baseURL?: string) {
    this.client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
  }

  async chat(opts: AIProviderChatOptions): Promise<AIProviderResult> {
    const start = Date.now();
    const model = opts.model ?? "gpt-5-mini";
    const tokenLimit = opts.maxTokens ?? 512;
    const messages = opts.messages ?? [
      { role: "system" as const, content: opts.systemPrompt },
      { role: "user" as const, content: opts.userPrompt ?? "" },
    ];

    const resp = await this.client.chat.completions.create({
      model,
      messages: messages.map(m => {
        const { role, content } = m;
        if (isMultimodalContent(content)) {
          return { role: "user" as const, content: toOpenAIContentParts(content) };
        }
        return { role, content };
      }) as OpenAI.ChatCompletionMessageParam[],
      ...(isGpt5Family(model)
        ? { max_completion_tokens: tokenLimit + 500, reasoning_effort: "low" as const }
        : { max_tokens: tokenLimit, temperature: opts.temperature ?? 0.7 }),
      ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
    });

    const text = resp.choices[0]?.message?.content ?? "";
    const usage = resp.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

    return {
      text,
      usage: {
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
        totalTokens: usage.total_tokens ?? 0,
      },
      model,
      provider: this.id,
      latencyMs: Date.now() - start,
    };
  }

  async *stream(opts: AIProviderChatOptions): AsyncGenerator<AIProviderStreamChunk, AIProviderResult, unknown> {
    const start = Date.now();
    const model = opts.model ?? "gpt-5-mini";
    const tokenLimit = opts.maxTokens ?? 512;
    const messages = opts.messages ?? [
      { role: "system" as const, content: opts.systemPrompt },
      { role: "user" as const, content: opts.userPrompt ?? "" },
    ];

    const stream = await this.client.chat.completions.create({
      model,
      messages: messages.map(m => {
        const { role, content } = m;
        if (isMultimodalContent(content)) {
          return { role: "user" as const, content: toOpenAIContentParts(content) };
        }
        return { role, content };
      }) as OpenAI.ChatCompletionMessageParam[],
      stream: true,
      stream_options: { include_usage: true },
      ...(isGpt5Family(model)
        ? { max_completion_tokens: tokenLimit + 500, reasoning_effort: "low" as const }
        : { max_tokens: tokenLimit, temperature: opts.temperature ?? 0.7 }),
      ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
    });

    let fullText = "";
    let finalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content ?? "";
      if (content) {
        fullText += content;
        yield { content, usage: undefined };
      }
      // Usage is included in the last chunk when stream_options.include_usage is set
      if (chunk.usage) {
        finalUsage = {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
          totalTokens: chunk.usage.total_tokens ?? 0,
        };
      }
    }

    return {
      text: fullText,
      usage: finalUsage,
      model,
      provider: this.id,
      latencyMs: Date.now() - start,
    };
  }

  async generateImage(prompt: string, size: string = "1024x1024"): Promise<{ b64_json: string }> {
    const resp = await this.client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: size as "1024x1024" | "1536x1024" | "1024x1536" | "auto",
      response_format: "b64_json",
    });
    const b64 = resp.data?.[0]?.b64_json ?? "";
    return { b64_json: b64 };
  }
}
