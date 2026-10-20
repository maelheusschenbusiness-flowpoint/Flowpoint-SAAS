/**
 * image-parser.ts — Step 3C: validate and normalise image attachments for AI multimodal.
 *
 * Validates binary magic bytes, MIME type, size limits, and pixel dimensions.
 * No OCR. No conversion. No external calls. No sharp dependency.
 * Dimension parsing: PNG IHDR, JPEG SOF markers, WebP VP8/VP8X headers.
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

// ── Dimension extraction (no external library) ────────────────────────────────
//
// PNG : IHDR chunk — width at bytes 16-19 (BE uint32), height at 20-23.
//       Minimum buffer: 24 bytes (magic + chunk_len + "IHDR" + width + height).
//
// JPEG: scan for SOF0/SOF1/SOF2 (FF C0/C1/C2) up to 64 KB.
//       height at marker_offset+5 (BE uint16), width at marker_offset+7.
//
// WebP: VP8  (lossy)    — width_and_scale(2LE) at bytes 26-27: bits 0-13 = width.
//                         height_and_scale(2LE) at bytes 28-29: bits 0-13 = height.
//       VP8X (extended) — canvas_width_minus_one (24-bit LE) at bytes 24-26; +1 for display.
//                         canvas_height_minus_one (24-bit LE) at bytes 27-29; +1 for display.
//       VP8L (lossless) — packed-bit bitstream; too complex without a full parser → skip.

function extractPngDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  const width  = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  return { width, height };
}

function extractJpegDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4) return null;
  let i = 2; // skip SOI marker (FF D8)
  const MAX_SCAN = Math.min(buf.length, 65536);
  while (i + 4 <= MAX_SCAN) {
    if (buf[i] !== 0xFF) return null; // lost sync
    const marker = buf[i + 1]!;
    if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
      // SOF0 / SOF1 / SOF2: [marker(2)] [len(2)] [precision(1)] [height(2)] [width(2)]
      if (i + 9 > buf.length) return null;
      const height = buf.readUInt16BE(i + 5);
      const width  = buf.readUInt16BE(i + 7);
      return { width, height };
    }
    // Skip 0xFF padding bytes before next marker
    if (marker === 0xFF) { i++; continue; }
    // Skip segment: 2-byte marker + 2-byte length (length includes itself)
    if (i + 3 >= MAX_SCAN) return null;
    const segLen = buf.readUInt16BE(i + 2);
    if (segLen < 2) return null; // malformed segment
    i += 2 + segLen;
  }
  return null;
}

function extractWebpDimensions(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 16) return null;
  const fourcc = buf.subarray(12, 16).toString("ascii");

  if (fourcc === "VP8 ") {
    // Lossy VP8 keyframe header layout (RFC 6386 §9):
    //   frame_tag(3) + start_code(3=0x9D012A) + width_and_scale(2LE) + height_and_scale(2LE)
    // bits 0-13 of width_and_scale = display_width (not width-1)
    if (buf.length < 30) return null;
    const width  = (buf[26]! | (buf[27]! << 8)) & 0x3FFF;
    const height = (buf[28]! | (buf[29]! << 8)) & 0x3FFF;
    return { width, height };
  }

  if (fourcc === "VP8X") {
    // Extended WebP container (WebP spec §Extended File Format):
    //   canvas_width_minus_one  (24-bit LE) at bytes 24-26
    //   canvas_height_minus_one (24-bit LE) at bytes 27-29
    if (buf.length < 30) return null;
    const width  = (buf[24]! | (buf[25]! << 8) | (buf[26]! << 16)) + 1;
    const height = (buf[27]! | (buf[28]! << 8) | (buf[29]! << 16)) + 1;
    return { width, height };
  }

  // VP8L (lossless): dimensions encoded in packed bitstream — skip to avoid incorrect reads.
  return null;
}

// Minimum buffer length below which we cannot reliably read the dimension header.
// Used to distinguish "truncated file" (too short) from "unknown VP8L sub-type" (OK, skip).
const MIN_DIM_BYTES: Record<ImageMime, number> = {
  "image/png":  24, // magic(8) + chunk_len(4) + "IHDR"(4) + width(4) + height(4)
  "image/jpeg": 12, // SOI(2) + SOF_marker(2) + seg_len(2) + prec(1) + height(2) + width(2)
  "image/webp": 30, // RIFF(4)+size(4)+WEBP(4)+fourcc(4)+chunk_size(4)+flags(4)+canvas(6)
};

function extractImageDimensions(buf: Buffer, mime: ImageMime): { width: number; height: number } | null {
  try {
    if (mime === "image/png")  return extractPngDimensions(buf);
    if (mime === "image/jpeg") return extractJpegDimensions(buf);
    if (mime === "image/webp") return extractWebpDimensions(buf);
    return null;
  } catch {
    return null;
  }
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

  // Dimension extraction and limit enforcement (no external library)
  const dims = extractImageDimensions(buf, realMime);

  // Truncated header: magic bytes passed but buffer too short to read dimension header.
  // Distinct from VP8L lossless WebP (which has a large-enough buffer but complex bitstream).
  if (dims === null && buf.length < MIN_DIM_BYTES[realMime]) {
    return {
      error:      "ATTACHMENT_IMAGE_INVALID",
      message:    "Le fichier image est tronqué ou corrompu (en-tête de dimensions incomplet).",
      httpStatus: 415,
    };
  }

  // Dimension limit (4096×4096 — limit accepted by OpenAI, Anthropic, and Gemini)
  if (dims !== null) {
    const { maxImageWidth, maxImageHeight } = AI_IMAGE_LIMITS;
    if (dims.width > maxImageWidth || dims.height > maxImageHeight) {
      return {
        error:      "ATTACHMENT_IMAGE_DIMENSIONS_TOO_LARGE",
        message:    `L'image (${dims.width}×${dims.height}px) dépasse la limite de ${maxImageWidth}×${maxImageHeight}px.`,
        httpStatus: 413,
      };
    }
  }

  const extractionMs    = Date.now() - start;
  const estimatedTokens = estimateImageTokens(sizeBytes);

  return {
    id,
    name,
    mimeType:  realMime,
    category:  "image",
    image: {
      dataBase64: contentBase64,
      ...(dims ? { width: dims.width, height: dims.height } : {}),
    },
    metadata: {
      sizeBytes,
      parser:       "image-native",
      truncated:    false,
      extractionMs,
    },
    estimatedTokens,
  } satisfies NormalizedImageAttachment;
}
