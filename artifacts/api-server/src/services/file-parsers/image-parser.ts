/**
 * image-parser.ts — Step 3C: validate and normalise image attachments for AI multimodal.
 *
 * Validates binary magic bytes, MIME type, and size limits.
 * No OCR. No conversion. No external calls. No sharp dependency.
 * Width/height are not extracted (no heavy dependency available).
 * base64 content is NEVER logged.
 */

import { AI_IMAGE_LIMITS } from "../../config/ai-attachments.js";
import type { NormalizedImageAttachment } from "../../types/ai-attachments.js";

// ── Types ─────────────────────────────────────────────────────────────────────

type ImageMime = "image/png" | "image/jpeg" | "image/webp";

export type ImageParseFailure = {
  error:      "ATTACHMENT_IMAGE_INVALID" | "ATTACHMENT_IMAGE_MIME_MISMATCH" | "ATTACHMENT_IMAGE_TOO_LARGE" | "ATTACHMENT_IMAGE_DIMENSIONS_TOO_LARGE";
  message:    string;
  httpStatus: 400 | 413 | 415;
};

export type ImageParseResult = NormalizedImageAttachment | ImageParseFailure;

// ── Binary magic bytes ────────────────────────────────────────────────────────

const PNG_MAGIC  = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
const JPEG_MAGIC = [0xFF, 0xD8, 0xFF];
const WEBP_RIFF  = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_MARK  = [0x57, 0x45, 0x42, 0x50]; // "WEBP"

function matchBytes(buf: Buffer, offset: number, signature: number[]): boolean {
  if (buf.length < offset + signature.length) return false;
  return signature.every((b, i) => buf[offset + i] === b);
}

function detectMime(buf: Buffer): ImageMime | null {
  if (matchBytes(buf, 0, PNG_MAGIC))  return "image/png";
  if (matchBytes(buf, 0, JPEG_MAGIC)) return "image/jpeg";
  // WebP: bytes 0-3 = "RIFF", bytes 8-11 = "WEBP"
  if (matchBytes(buf, 0, WEBP_RIFF) && matchBytes(buf, 8, WEBP_MARK)) return "image/webp";
  return null;
}

function normalizeMime(mime: string): string {
  const m = mime.toLowerCase().trim();
  return m === "image/jpg" ? "image/jpeg" : m;
}

// ── Token estimation ──────────────────────────────────────────────────────────

/**
 * Conservative token cost estimate for an image attachment.
 *
 * OpenAI vision tiles images at 512×512 px (~170 tokens/tile) in "auto" mode.
 * Without knowing dimensions we use a size-based heuristic:
 *   tokens = max(85, min(ceil(sizeBytes / 4096), 2048))
 * The floor of 85 matches OpenAI's low-detail cost.
 * The cap of 2048 prevents extreme over-billing for large files.
 */
export function estimateImageTokens(sizeBytes: number): number {
  return Math.max(85, Math.min(Math.ceil(sizeBytes / 4096), 2048));
}

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * Validate and normalise a single image attachment.
 *
 * @param id               - attachment id (from team_files)
 * @param name             - sanitised filename
 * @param declaredMimeType - MIME type as stored in team_files
 * @param contentBase64    - raw base64 content (NO data-URI prefix)
 * @param sizeBytes        - decoded byte count (pre-computed by resolveAIAttachments)
 */
export async function parseImageBuffer(
  id:               string,
  name:             string,
  declaredMimeType: string,
  contentBase64:    string,
  sizeBytes:        number,
): Promise<ImageParseResult> {
  const start = Date.now();

  // Per-image size guard
  if (sizeBytes > AI_IMAGE_LIMITS.maxImageBytes) {
    return {
      error:      "ATTACHMENT_IMAGE_TOO_LARGE",
      message:    `L'image dépasse la limite de ${Math.round(AI_IMAGE_LIMITS.maxImageBytes / 1024 / 1024)} Mo.`,
      httpStatus: 413,
    };
  }

  // Decode base64 → Buffer for magic-byte check
  let buf: Buffer;
  try {
    buf = Buffer.from(contentBase64, "base64");
  } catch {
    return {
      error:      "ATTACHMENT_IMAGE_INVALID",
      message:    "Contenu de l'image corrompu (base64 invalide).",
      httpStatus: 400,
    };
  }

  // Magic-byte detection — rejects GIF, SVG, arbitrary binary
  const realMime = detectMime(buf);
  if (!realMime) {
    return {
      error:      "ATTACHMENT_IMAGE_INVALID",
      message:    "Le fichier ne correspond pas à une image PNG, JPEG ou WebP valide.",
      httpStatus: 415,
    };
  }

  // MIME consistency check
  if (normalizeMime(realMime) !== normalizeMime(declaredMimeType)) {
    return {
      error:      "ATTACHMENT_IMAGE_MIME_MISMATCH",
      message:    `Type déclaré "${declaredMimeType}" ≠ contenu réel "${realMime}".`,
      httpStatus: 400,
    };
  }

  const extractionMs    = Date.now() - start;
  const estimatedTokens = estimateImageTokens(sizeBytes);

  return {
    id,
    name,
    mimeType:  realMime,
    category:  "image",
    image: { dataBase64: contentBase64 }, // width/height: not extracted (no dep) — see spec
    metadata: {
      sizeBytes,
      parser:       "image-native",
      truncated:    false,
      extractionMs,
    },
    estimatedTokens,
  } satisfies NormalizedImageAttachment;
}
