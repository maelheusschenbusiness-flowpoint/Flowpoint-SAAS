/**
 * Google Gemini Provider — implements the unified AIProvider interface.
 *
 * Uses the Google GenAI SDK. Supports chat, streaming, vision, and image generation.
 * Role mapping: "assistant" → "model" for Gemini.
 *
 * Key policy: GEMINI_API_KEY must always be passed explicitly to the constructor.
 * GOOGLE_API_KEY is reserved for Google Maps and must never be selected by the SDK.
 * We mask GOOGLE_API_KEY during client construction to prevent the SDK's
 * getApiKeyFromEnv() from auto-selecting the Maps key (SDK @google/genai ≥ 2.11
 * always calls getApiKeyFromEnv() in the constructor regardless of explicit apiKey).
 *
 * Model policy: the canonical default model is defined in capabilities.ts
 * (PROVIDER_CAPABILITIES.gemini.defaultModel). No other fallback is accepted.
 */

import { GoogleGenAI } from "@google/genai";
import type { AIProviderId, AIProviderChatOptions, AIProviderStreamChunk, AIProviderResult } from "./openai-provider.js";
import { toGeminiParts, type GeminiPart } from "./multimodal-mappers.js";
import { PROVIDER_CAPABILITIES } from "./capabilities.js";
import { logger } from "../../lib/logger.js";

/** Single source of truth for the Gemini model used across chat and streaming. */
const GEMINI_DEFAULT_MODEL = PROVIDER_CAPABILITIES.gemini.defaultModel;

// ── finishReason normalisation ────────────────────────────────────────────────

export interface GeminiFinishReasonResult {
  /** Text to append to the response. null = nothing to append (normal completion). */
  appendText: string | null;
  /** Log level to use for the server-side log entry. */
  logLevel: "info" | "warn" | "error";
  /** Server-side log message (technical, never shown to user). */
  logMessage: string;
}

/**
 * Pure function — maps a Gemini finishReason to a user-facing append string and
 * a log entry. Exported so it can be tested independently (QA fixtures + unit tests).
 *
 * Rules:
 *  - STOP / null / undefined → normal; no append, info log.
 *  - MAX_TOKENS   → truncation notice; warn log.
 *  - SAFETY       → content-blocked notice; warn log.
 *  - RECITATION   → copyright notice; warn log.
 *  - ERROR        → provider error notice; error log (not warn).
 *  - ABORTED      → interruption notice (only if textSoFar non-empty); warn log.
 *  - anything else → unknown-reason notice; warn log.
 *
 * Messages are deliberately user-friendly (French) — no technical details exposed.
 */
export function normalizeGeminiFinishReason(
  reason: string | null | undefined,
  textSoFar: string
): GeminiFinishReasonResult {
  switch (reason) {
    case "STOP":
    case undefined:
    case null:
      return {
        appendText: null,
        logLevel: "info",
        logMessage: "[Gemini] Stream completed normally",
      };

    case "MAX_TOKENS":
      return {
        appendText: "\n\nJe n'ai pas pu terminer cette réponse. Demandez-moi de continuer à partir du dernier point si vous le souhaitez.",
        logLevel: "warn",
        logMessage: "[Gemini] Stream ended with MAX_TOKENS — response is incomplete",
      };

    case "SAFETY":
      return {
        appendText: "\n\nJe ne peux pas répondre à cette demande. Essayez de la reformuler différemment.",
        logLevel: "warn",
        logMessage: "[Gemini] Stream ended with SAFETY — content blocked by safety filters",
      };

    case "RECITATION":
      return {
        appendText: "\n\nJe ne peux pas reproduire ce contenu tel quel. Demandez-moi de l'exprimer avec mes propres mots si vous le souhaitez.",
        logLevel: "warn",
        logMessage: "[Gemini] Stream ended with RECITATION — possible copyright content detected",
      };

    case "ERROR":
      return {
        appendText: "\n\nUne erreur est survenue. Réessayez dans quelques instants ou changez de modèle.",
        logLevel: "error",
        logMessage: "[Gemini] Stream ended with ERROR — provider-side error",
      };

    case "ABORTED":
      return {
        // Only append if there is already some text — avoids phantom empty responses.
        appendText: textSoFar.length > 0 ? "\n\nLa génération a été interrompue." : null,
        logLevel: "warn",
        logMessage: "[Gemini] Stream ABORTED — client disconnected or request cancelled",
      };

    default:
      return {
        appendText: "\n\nLa réponse n'a pas pu être complétée. Essayez de reformuler votre question.",
        logLevel: "warn",
        logMessage: `[Gemini] Stream ended with unknown finishReason: ${reason}`,
      };
  }
}

export class GeminiProvider {
  readonly id: AIProviderId = "gemini";
  private client: GoogleGenAI;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error("GeminiProvider: GEMINI_API_KEY must be provided explicitly — never rely on SDK env-var auto-selection");
    }
    // Temporarily mask GOOGLE_API_KEY so the SDK's getApiKeyFromEnv() cannot
    // auto-select the Maps key. We restore it immediately after construction.
    const savedGoogleKey = process.env["GOOGLE_API_KEY"];
    delete process.env["GOOGLE_API_KEY"];
    try {
      this.client = new GoogleGenAI({ apiKey });
    } finally {
      if (savedGoogleKey !== undefined) {
        process.env["GOOGLE_API_KEY"] = savedGoogleKey;
      }
    }
  }

  async chat(opts: AIProviderChatOptions): Promise<AIProviderResult> {
    const start = Date.now();
    const model = opts.model ?? GEMINI_DEFAULT_MODEL;
    const { contents, systemInstruction } = this.buildContents(opts);

    const resp = await this.client.models.generateContent({
      model,
      contents,
      config: {
        maxOutputTokens: opts.maxTokens ?? 8192,
        ...(opts.json ? { responseMimeType: "application/json" } : {}),
        ...(systemInstruction ? { systemInstruction } : {}),
        // Note: do NOT set thinkingConfig.thinkingBudget:0 — gemini-3.x-pro models
        // require thinking mode and reject budget:0. Thinking tokens are transparently
        // filtered in the response via the !p.thought guard below.
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
    const model = opts.model ?? GEMINI_DEFAULT_MODEL;
    const { contents, systemInstruction } = this.buildContents(opts);

    const stream = await this.client.models.generateContentStream({
      model,
      contents,
      config: {
        // Use a generous default so long responses (>1000 words) are never truncated.
        // Gemini 2.5 Pro/Flash support up to 65536 output tokens; 16384 is safe and fast.
        maxOutputTokens: opts.maxTokens ?? 16384,
        ...(opts.json ? { responseMimeType: "application/json" } : {}),
        ...(systemInstruction ? { systemInstruction } : {}),
        // Note: do NOT set thinkingConfig.thinkingBudget:0 — gemini-3.x-pro models
        // require thinking mode and reject budget:0. Thinking tokens are filtered
        // via the rawParts.filter(p => !p.thought) guard in the streaming loop below.
      },
    });

    let fullText = "";
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let lastFinishReason: string | undefined;

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
      // Track finishReason from each candidate chunk — last non-empty value wins
      const fr = (chunk.candidates?.[0] as Record<string, unknown> | undefined)?.finishReason as string | undefined;
      if (fr && fr !== "FINISH_REASON_UNSPECIFIED" && fr !== "0") {
        lastFinishReason = fr;
      }
    }

    // ── Normalisation finishReason ────────────────────────────────────────────
    // Délégué à normalizeGeminiFinishReason (exported pure function, testable).
    const frResult = normalizeGeminiFinishReason(lastFinishReason, fullText);
    if (frResult.appendText !== null) {
      fullText += frResult.appendText;
      yield { content: frResult.appendText, usage: undefined };
    }
    logger[frResult.logLevel]({ model, finishReason: lastFinishReason ?? "none", textLength: fullText.length },
      frResult.logMessage);

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
