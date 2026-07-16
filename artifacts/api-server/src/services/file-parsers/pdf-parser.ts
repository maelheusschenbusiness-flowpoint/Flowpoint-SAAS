/**
 * pdf-parser.ts — Parse PDF files from a Buffer using pdf-parse.
 *
 * pdf-parse is loaded lazily (dynamic import) so it is never bundled into
 * dist/index.mjs and never initialised at server startup.
 *
 * Handles:
 *   - %PDF- binary signature check (ATTACHMENT_PARSE_FAILED if absent — no module load)
 *   - Dynamic module load failure  (ATTACHMENT_PARSER_UNAVAILABLE / HTTP 503)
 *   - Text extraction with page limit
 *   - Empty / scanned PDF         (ATTACHMENT_PDF_NO_EXTRACTABLE_TEXT)
 *   - Encrypted PDF               (ATTACHMENT_PDF_ENCRYPTED)
 *   - Invalid PDF                 (ATTACHMENT_PARSE_FAILED)
 *   - Truncation to maxChars
 */

export interface PdfParseResult {
  text:      string;
  pageCount: number;
  truncated: boolean;
  charCount: number;
}

export type PdfParseErrorCode =
  | "ATTACHMENT_PDF_NO_EXTRACTABLE_TEXT"
  | "ATTACHMENT_PDF_ENCRYPTED"
  | "ATTACHMENT_PARSE_FAILED"
  | "ATTACHMENT_PARSER_UNAVAILABLE";

export interface PdfParseError {
  error: PdfParseErrorCode;
}

// ── PDF magic-byte check ──────────────────────────────────────────────────────

const PDF_SIGNATURE = Buffer.from("%PDF-", "ascii");

function hasPdfSignature(buf: Buffer): boolean {
  if (buf.length < PDF_SIGNATURE.length) return false;
  return buf.slice(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE);
}

// ── Lazy loader ───────────────────────────────────────────────────────────────

type PdfParseType = (data: Buffer, options?: { max?: number }) => Promise<{ text: string; numpages: number }>;

/**
 * Load pdf-parse on first use — NOT at module import time.
 * Returns the parse function or throws if the module is unavailable.
 */
async function loadPdfParse(): Promise<PdfParseType> {
  const mod = await import("pdf-parse");
  const fn  = (mod.default ?? mod) as unknown;
  if (typeof fn !== "function") {
    throw new TypeError("pdf-parse: default export is not a function");
  }
  return fn as PdfParseType;
}

// ── Main parse function ───────────────────────────────────────────────────────

/**
 * Parse a PDF buffer and extract plain text up to maxPages pages.
 *
 * Step 1: Verify %PDF- magic bytes — non-PDF returns ATTACHMENT_PARSE_FAILED
 *         before touching any module (prevents garbage-in attacks and saves
 *         the dynamic-import overhead for clearly invalid data).
 * Step 2: Lazy-load pdf-parse — returns ATTACHMENT_PARSER_UNAVAILABLE (503)
 *         if the module cannot be loaded.
 * Step 3: Parse and classify errors.
 */
export async function parsePdfBuffer(
  buf:      Buffer,
  maxPages: number,
  maxChars: number,
): Promise<PdfParseResult | PdfParseError> {
  // ── 1. Signature check (no module load needed) ────────────────────────────
  if (!hasPdfSignature(buf)) {
    return { error: "ATTACHMENT_PARSE_FAILED" };
  }

  // ── 2. Lazy module load ───────────────────────────────────────────────────
  let pdfParse: PdfParseType;
  try {
    pdfParse = await loadPdfParse();
  } catch {
    return { error: "ATTACHMENT_PARSER_UNAVAILABLE" };
  }

  // ── 3. Parse ──────────────────────────────────────────────────────────────
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
