/**
 * ai-multimodal.ts — Step 3C: build provider-native messages for multimodal requests.
 *
 * Centralizes the assembly of the final messages array when image attachments are present.
 * Provider is NEVER changed here. No fallback. No OCR. No credits debited.
 * base64 image data is NEVER logged.
 */

import type { NormalizedAttachment, NormalizedImageAttachment } from "../types/ai-attachments.js";
import type { ContentBlock } from "./ai-providers/multimodal-mappers.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MultimodalMessage = {
  role:    "system" | "user" | "assistant";
  content: string | ContentBlock[];
};

// ── buildProviderMessages ─────────────────────────────────────────────────────

/**
 * Build the final messages array for a provider-native request.
 *
 * Rules:
 *  - System message:   always plain string (no images in system prompt).
 *  - History messages: always plain strings.
 *  - User message:     text block first, then image blocks (per provider best practices).
 *  - Text-only path:   user message content stays a plain string (identical to Step 3B).
 *
 * The `provider` parameter is accepted for future per-provider customization;
 * all three providers currently use the same normalized ContentBlock format.
 */
export function buildProviderMessages({
  provider: _provider,
  systemPrompt,
  history,
  userMessage,
  imageAttachments,
}: {
  provider:         string;
  systemPrompt:     string;
  history:          Array<{ role: "system" | "user" | "assistant"; content: string }>;
  userMessage:      string;
  imageAttachments: NormalizedImageAttachment[];
}): MultimodalMessage[] {
  const messages: MultimodalMessage[] = [
    { role: "system", content: systemPrompt },
    ...history,
  ];

  if (imageAttachments.length === 0) {
    // Text-only path — plain string content (unchanged from Step 3B)
    messages.push({ role: "user", content: userMessage });
    return messages;
  }

  // Multimodal user message: text block first, then one block per image
  const userContent: ContentBlock[] = [
    { type: "text", text: userMessage },
    ...imageAttachments.map(img => ({
      type:       "image" as const,
      mimeType:   img.mimeType,
      dataBase64: img.image.dataBase64, // never logged
    })),
  ];

  messages.push({ role: "user", content: userContent });
  return messages;
}

// ── getImageUsageMetadata ─────────────────────────────────────────────────────

/**
 * Build image metadata to merge into ai_usage_logs.
 * Never includes file content or base64 data.
 */
export function getImageUsageMetadata(
  images: NormalizedImageAttachment[],
): Record<string, unknown> {
  if (images.length === 0) return {};
  return {
    hasImages:            true,
    imageCount:           images.length,
    imageFormats:         [...new Set(images.map(i => i.mimeType))],
    imageTotalBytes:      images.reduce((s, i) => s + i.metadata.sizeBytes, 0),
    imageEstimatedTokens: images.reduce((s, i) => s + i.estimatedTokens, 0),
  };
}

// ── isImageAttachment ─────────────────────────────────────────────────────────

/**
 * Type guard: check whether a parsed attachment is an image.
 * Discriminant is `category === "image"` (not present on NormalizedAttachment).
 */
export function isImageAttachment(
  att: NormalizedAttachment | NormalizedImageAttachment,
): att is NormalizedImageAttachment {
  return att.category === "image";
}
