/**
 * pdf-parser.ts — Parse PDF files from a Buffer using pdf-parse.
 *
 * pdf-parse is a CJS module; esbuild and vitest both resolve CJS interop
 * automatically via the "default" export.
 *
 * Handles:
 *   - Text extraction with page limit
 *   - Empty / scanned PDF detection (no extractable text)
 *   - Encrypted PDF detection
 *   - Invalid PDF detection
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

export interface PdfParseError {
  error:
    | "ATTACHMENT_PDF_NO_EXTRACTABLE_TEXT"
    | "ATTACHMENT_PDF_ENCRYPTED"
    | "ATTACHMENT_PARSE_FAILED";
}

/**
 * Parse a PDF buffer and extract plain text up to maxPages pages.
 */
export async function parsePdfBuffer(
  buf:      Buffer,
  maxPages: number,
  maxChars: number,
): Promise<PdfParseResult | PdfParseError> {
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
