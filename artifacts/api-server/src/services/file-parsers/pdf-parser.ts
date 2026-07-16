/**
 * pdf-parser.ts — Parse PDF files from a Buffer using pdf-parse.
 *
 * pdf-parse is a CJS module; esbuild and vitest both resolve CJS interop
 * automatically via the "default" export.
 *
 * Handles:
 *   - %PDF- binary signature check (ATTACHMENT_PARSE_FAILED if absent)
 *   - Text extraction with page limit
 *   - Empty / scanned PDF detection (no extractable text → ATTACHMENT_PDF_NO_EXTRACTABLE_TEXT)
 *   - Encrypted PDF detection (ATTACHMENT_PDF_ENCRYPTED)
 *   - Invalid PDF detection (ATTACHMENT_PARSE_FAILED)
 *   - Truncation to maxChars
 */

// pdf-parse ships as CJS — import via default to support both ESM and CJS callers.
import pdfParse from "pdf-parse";

export interface PdfParseResult {
  text:      string;
  pageCount: number;
  truncated: boolean;
  charCount: number;
}

export type PdfParseErrorCode =
  | "ATTACHMENT_PDF_NO_EXTRACTABLE_TEXT"
  | "ATTACHMENT_PDF_ENCRYPTED"
  | "ATTACHMENT_PARSE_FAILED";

export interface PdfParseError {
  error: PdfParseErrorCode;
}

// The canonical %PDF- magic bytes (ASCII).
const PDF_SIGNATURE = Buffer.from("%PDF-", "ascii");

function hasPdfSignature(buf: Buffer): boolean {
  if (buf.length < PDF_SIGNATURE.length) return false;
  return buf.slice(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE);
}

/**
 * Parse a PDF buffer and extract plain text up to maxPages pages.
 *
 * Step 1: Verify %PDF- magic bytes — non-PDF content returns ATTACHMENT_PARSE_FAILED
 *         before touching pdf-parse, preventing garbage-in attacks.
 * Step 2: Call pdf-parse with page limit.
 * Step 3: Check for empty text (scanned PDF / image-only).
 */
export async function parsePdfBuffer(
  buf:      Buffer,
  maxPages: number,
  maxChars: number,
): Promise<PdfParseResult | PdfParseError> {
  // ── Signature check ───────────────────────────────────────────────────────
  if (!hasPdfSignature(buf)) {
    return { error: "ATTACHMENT_PARSE_FAILED" };
  }

  // ── Parse ─────────────────────────────────────────────────────────────────
  let parsed: { text: string; numpages: number };
  try {
    parsed = await pdfParse(buf, { max: maxPages });
  } catch (err: unknown) {
    const msg = String((err as Error)?.message ?? "").toLowerCase();
    if (msg.includes("encrypt") || msg.includes("password")) {
      return { error: "ATTACHMENT_PDF_ENCRYPTED" };
    }
    return { error: "ATTACHMENT_PARSE_FAILED" };
  }

  // ── Empty / scanned PDF ───────────────────────────────────────────────────
  const text = (parsed.text ?? "").trim();
  if (!text) {
    return { error: "ATTACHMENT_PDF_NO_EXTRACTABLE_TEXT" };
  }

  const truncated = text.length > maxChars;
  return {
    text:      truncated ? text.slice(0, maxChars) : text,
    pageCount: parsed.numpages,
    truncated,
    charCount: Math.min(text.length, maxChars),
  };
}
