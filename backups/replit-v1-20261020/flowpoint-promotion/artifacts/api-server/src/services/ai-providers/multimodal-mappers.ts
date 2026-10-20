/**
 * multimodal-mappers.ts — Step 3C: normalized content blocks + per-provider translators.
 *
 * ContentBlock is the internal, provider-agnostic representation of a message part.
 * Each provider adapter calls the appropriate mapper to produce its native format.
 *
 * base64 image data is NEVER logged by any function here.
 */

// ── Normalized content blocks (provider-agnostic) ─────────────────────────────

export type TextContentBlock = {
  type: "text";
  text: string;
};

export type ImageContentBlock = {
  type:       "image";
  mimeType:   "image/png" | "image/jpeg" | "image/webp";
  dataBase64: string;   // raw base64, never logged
};

export type ContentBlock = TextContentBlock | ImageContentBlock;

// ── Type guard ────────────────────────────────────────────────────────────────

export function isMultimodalContent(c: string | ContentBlock[]): c is ContentBlock[] {
  return Array.isArray(c);
}

// ── OpenAI Chat Completions format ────────────────────────────────────────────
// https://platform.openai.com/docs/guides/vision

export type OpenAITextPart  = { type: "text";      text: string };
export type OpenAIImagePart = { type: "image_url"; image_url: { url: string; detail: "auto" } };
export type OpenAIContentPart = OpenAITextPart | OpenAIImagePart;

export function toOpenAIContentParts(blocks: ContentBlock[]): OpenAIContentPart[] {
  return blocks.map(b =>
    b.type === "text"
      ? { type: "text" as const, text: b.text }
      : {
          type:       "image_url" as const,
          image_url:  { url: `data:${b.mimeType};base64,${b.dataBase64}`, detail: "auto" as const },
        }
  );
}

// ── Anthropic format ──────────────────────────────────────────────────────────
// https://docs.anthropic.com/en/api/messages

export type AnthropicTextPart  = { type: "text"; text: string };
export type AnthropicImagePart = {
  type:   "image";
  source: { type: "base64"; media_type: "image/png" | "image/jpeg" | "image/webp"; data: string };
};
export type AnthropicContentPart = AnthropicTextPart | AnthropicImagePart;

export function toAnthropicContentParts(blocks: ContentBlock[]): AnthropicContentPart[] {
  return blocks.map(b =>
    b.type === "text"
      ? { type: "text" as const, text: b.text }
      : {
          type:   "image" as const,
          source: { type: "base64" as const, media_type: b.mimeType, data: b.dataBase64 },
        }
  );
}

// ── Gemini format ─────────────────────────────────────────────────────────────
// https://ai.google.dev/gemini-api/docs/vision

export type GeminiTextPart   = { text: string };
export type GeminiInlinePart = { inlineData: { mimeType: string; data: string } };
export type GeminiPart       = GeminiTextPart | GeminiInlinePart;

export function toGeminiParts(blocks: ContentBlock[]): GeminiPart[] {
  return blocks.map(b =>
    b.type === "text"
      ? { text: b.text }
      : { inlineData: { mimeType: b.mimeType, data: b.dataBase64 } }
  );
}
