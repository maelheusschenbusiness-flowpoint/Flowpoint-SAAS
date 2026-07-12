/**
 * Google Gemini Provider — implements the unified AIProvider interface.
 *
 * Uses the Google GenAI SDK. Supports chat, streaming, vision, and image generation.
 * Role mapping: "assistant" → "model" for Gemini.
 */

import { GoogleGenAI } from "@google/genai";
import type { AIProviderId, AIProviderChatOptions, AIProviderStreamChunk, AIProviderResult } from "./openai-provider.js";

export class GeminiProvider {
  readonly id: AIProviderId = "gemini";
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async chat(opts: AIProviderChatOptions): Promise<AIProviderResult> {
    const start = Date.now();
    const model = opts.model ?? "gemini-2.5-flash";
    const contents = this.buildContents(opts);

    const resp = await this.client.models.generateContent({
      model,
      contents,
      config: {
        maxOutputTokens: opts.maxTokens ?? 8192,
        ...(opts.json ? { responseMimeType: "application/json" } : {}),
      },
    });

    const text = resp.text ?? "";
    const usage = resp.usageMetadata ?? { promptTokenCount: 0, candidatesTokenCount: 0, totalTokenCount: 0 };

    return {
      text,
      usage: {
        promptTokens: usage.promptTokenCount ?? 0,
        completionTokens: usage.candidatesTokenCount ?? 0,
        totalTokens: usage.totalTokenCount ?? 0,
      },
      model,
      provider: this.id,
      latencyMs: Date.now() - start,
    };
  }

  async *stream(opts: AIProviderChatOptions): AsyncGenerator<AIProviderStreamChunk, AIProviderResult, unknown> {
    const start = Date.now();
    const model = opts.model ?? "gemini-2.5-flash";
    const contents = this.buildContents(opts);

    const stream = await this.client.models.generateContentStream({
      model,
      contents,
      config: {
        maxOutputTokens: opts.maxTokens ?? 8192,
        ...(opts.json ? { responseMimeType: "application/json" } : {}),
      },
    });

    let fullText = "";
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    for await (const chunk of stream) {
      const text = chunk.text ?? "";
      if (text) {
        fullText += text;
        yield { content: text, usage: undefined };
      }
      if (chunk.usageMetadata) {
        promptTokens = chunk.usageMetadata.promptTokenCount ?? promptTokens;
        completionTokens = chunk.usageMetadata.candidatesTokenCount ?? completionTokens;
        totalTokens = chunk.usageMetadata.totalTokenCount ?? totalTokens;
      }
    }

    return {
      text: fullText,
      usage: { promptTokens, completionTokens, totalTokens },
      model,
      provider: this.id,
      latencyMs: Date.now() - start,
    };
  }

  async generateImage(prompt: string): Promise<{ b64_json: string; mimeType: string }> {
    const resp = await this.client.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseModalities: ["image"],
      },
    });

    // Extract image from response
    const imagePart = resp.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (imagePart?.inlineData?.data) {
      return {
        b64_json: imagePart.inlineData.data,
        mimeType: imagePart.inlineData.mimeType ?? "image/png",
      };
    }
    throw new Error("Gemini image generation returned no image data");
  }

  private buildContents(opts: AIProviderChatOptions): Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> {
    if (opts.messages) {
      return opts.messages.map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
    }
    return [
      { role: "user", parts: [{ text: `${opts.systemPrompt}\n\n${opts.userPrompt}` }] },
    ];
  }
}
