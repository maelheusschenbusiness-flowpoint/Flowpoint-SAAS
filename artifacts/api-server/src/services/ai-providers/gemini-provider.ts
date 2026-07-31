/**
 * Google Gemini Provider — implements the unified AIProvider interface.
 *
 * Uses the Google GenAI SDK. Supports chat, streaming, vision, and image generation.
 * Role mapping: "assistant" → "model" for Gemini.
 */

import { GoogleGenAI } from "@google/genai";
import type { AIProviderId, AIProviderChatOptions, AIProviderStreamChunk, AIProviderResult } from "./openai-provider.js";
import { toGeminiParts, type GeminiPart } from "./multimodal-mappers.js";

export class GeminiProvider {
  readonly id: AIProviderId = "gemini";
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async chat(opts: AIProviderChatOptions): Promise<AIProviderResult> {
    const start = Date.now();
    const model = opts.model ?? "gemini-2.5-flash";
    const { contents, systemInstruction } = this.buildContents(opts);

    const resp = await this.client.models.generateContent({
      model,
      contents,
      config: {
        maxOutputTokens: opts.maxTokens ?? 8192,
        ...(opts.json ? { responseMimeType: "application/json" } : {}),
        ...(systemInstruction ? { systemInstruction } : {}),
        // Disable thinking mode on gemini-2.5+ to avoid empty text responses
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    // Fallback: extract text from parts when resp.text() returns empty (thinking mode)
    const text = resp.text || resp.candidates?.[0]?.content?.parts
      ?.filter((p: { thought?: boolean; text?: string }) => !p.thought)
      .map((p: { text?: string }) => p.text ?? "")
      .join("") || "";
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
    const { contents, systemInstruction } = this.buildContents(opts);

    const stream = await this.client.models.generateContentStream({
      model,
      contents,
      config: {
        maxOutputTokens: opts.maxTokens ?? 8192,
        ...(opts.json ? { responseMimeType: "application/json" } : {}),
        ...(systemInstruction ? { systemInstruction } : {}),
        // Disable thinking mode on gemini-2.5+ to avoid empty delta chunks
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    let fullText = "";
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    for await (const chunk of stream) {
      // chunk.text getter can return "" when thinking tokens are present in parts
      // (happens even with thinkingBudget:0 on some Gemini 2.5 versions).
      // Fall back to manual extraction that filters out thought parts explicitly.
      const rawParts = (chunk.candidates?.[0]?.content?.parts ?? []) as Array<{
        thought?: boolean;
        text?: string;
      }>;
      const text =
        (rawParts.length > 0
          ? rawParts.filter(p => !p.thought).map(p => p.text ?? "").join("")
          : null) ??
        (chunk.text ?? "");
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

  private buildContents(opts: AIProviderChatOptions): {
    contents: Array<{ role: "user" | "model"; parts: GeminiPart[] }>;
    systemInstruction?: string;
  } {
    if (opts.messages) {
      // Extract system message — Gemini does not support "system" role in contents.
      // Pass it via config.systemInstruction to avoid consecutive "user" turns
      // (which cause truncated/corrupted streaming output).
      let systemInstruction: string | undefined;
      const conversationMsgs = opts.messages.filter(m => {
        if (m.role === "system") {
          systemInstruction = typeof m.content === "string" ? m.content : systemInstruction;
          return false;
        }
        return true;
      });

      // Merge consecutive same-role turns (Gemini requires strict user/model alternation).
      const merged: Array<{ role: "user" | "model"; parts: GeminiPart[] }> = [];
      for (const m of conversationMsgs) {
        const role = (m.role === "assistant" ? "model" : "user") as "user" | "model";
        const parts: GeminiPart[] = typeof m.content !== "string"
          ? toGeminiParts(m.content)
          : [{ text: m.content }];
        const last = merged[merged.length - 1];
        if (last && last.role === role) {
          // Concatenate into the previous same-role turn
          last.parts.push(...parts);
        } else {
          merged.push({ role, parts });
        }
      }

      // Gemini requires the conversation to start with a "user" turn
      if (merged.length === 0 || merged[0].role !== "user") {
        merged.unshift({ role: "user", parts: [{ text: " " }] });
      }

      return { contents: merged, systemInstruction };
    }

    // Fallback: single-turn with system+user merged
    return {
      contents: [{ role: "user", parts: [{ text: `${opts.systemPrompt ?? ""}\n\n${opts.userPrompt ?? ""}` }] }],
    };
  }
}
