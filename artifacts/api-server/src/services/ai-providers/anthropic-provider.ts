/**
 * Anthropic Claude Provider — implements the unified AIProvider interface.
 *
 * Uses the Anthropic SDK. Supports chat, streaming, and vision.
 * Note: temperature/top_p/top_k are deprecated on newer Claude models.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AIProviderId, AIProviderChatOptions, AIProviderStreamChunk, AIProviderResult } from "./openai-provider.js";

export class AnthropicProvider {
  readonly id: AIProviderId = "anthropic";
  private client: Anthropic;

  constructor(apiKey: string, baseURL?: string) {
    this.client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
  }

  async chat(opts: AIProviderChatOptions): Promise<AIProviderResult> {
    const start = Date.now();
    const model = opts.model ?? "claude-sonnet-4-6";
    const messages = this.buildMessages(opts);

    const resp = await this.client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 8192,
      system: opts.systemPrompt,
      messages,
    });

    const text = resp.content
      .filter((c): c is Anthropic.TextBlock => c.type === "text")
      .map(c => c.text)
      .join("");

    return {
      text,
      usage: {
        promptTokens: resp.usage?.input_tokens ?? 0,
        completionTokens: resp.usage?.output_tokens ?? 0,
        totalTokens: (resp.usage?.input_tokens ?? 0) + (resp.usage?.output_tokens ?? 0),
      },
      model,
      provider: this.id,
      latencyMs: Date.now() - start,
    };
  }

  async *stream(opts: AIProviderChatOptions): AsyncGenerator<AIProviderStreamChunk, AIProviderResult, unknown> {
    const start = Date.now();
    const model = opts.model ?? "claude-sonnet-4-6";
    const messages = this.buildMessages(opts);

    const stream = this.client.messages.stream({
      model,
      max_tokens: opts.maxTokens ?? 8192,
      system: opts.systemPrompt,
      messages,
    });

    let fullText = "";
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        const text = event.delta.text;
        fullText += text;
        yield { content: text, usage: undefined };
      }
      if (event.type === "message_start" && event.message.usage) {
        inputTokens = event.message.usage.input_tokens ?? 0;
      }
      if (event.type === "message_delta" && event.usage) {
        outputTokens = event.usage.output_tokens ?? 0;
      }
    }

    return {
      text: fullText,
      usage: {
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      model,
      provider: this.id,
      latencyMs: Date.now() - start,
    };
  }

  private buildMessages(opts: AIProviderChatOptions): Anthropic.MessageParam[] {
    if (opts.messages) {
      return opts.messages.map(m => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));
    }
    return [
      { role: "user", content: opts.userPrompt },
    ];
  }
}
