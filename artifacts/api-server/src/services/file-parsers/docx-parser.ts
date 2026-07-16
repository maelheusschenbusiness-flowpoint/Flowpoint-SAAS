/**
 * docx-parser.ts — Parse DOCX files from a Buffer using mammoth.
 *
 * mammoth is loaded lazily (dynamic import) so it is never bundled into
 * dist/index.mjs and never initialised at server startup.
 *
 * Handles:
 *   - Dynamic module load failure (ATTACHMENT_PARSER_UNAVAILABLE / HTTP 503)
 *   - Plain text extraction (mammoth extractRawText)
 *   - Empty document           (ATTACHMENT_DOCX_EMPTY)
 *   - Invalid DOCX             (ATTACHMENT_DOCX_INVALID)
 *   - Truncation to maxChars
 */

export interface DocxParseResult {
  text:      string;
  truncated: boolean;
  charCount: number;
}

export type DocxParseErrorCode =
  | "ATTACHMENT_DOCX_EMPTY"
  | "ATTACHMENT_DOCX_INVALID"
  | "ATTACHMENT_PARSER_UNAVAILABLE";

export interface DocxParseError {
  error: DocxParseErrorCode;
}

// ── Lazy loader ───────────────────────────────────────────────────────────────

type MammothModule = { extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }> };

/**
 * Load mammoth on first use — NOT at module import time.
 * Returns the mammoth API or throws if the module is unavailable.
 */
async function loadMammoth(): Promise<MammothModule> {
  const mod = await import("mammoth");
  const m   = (mod.default ?? mod) as unknown;
  if (typeof (m as MammothModule)?.extractRawText !== "function") {
    throw new TypeError("mammoth: extractRawText is not a function");
  }
  return m as MammothModule;
}

// ── Main parse function ───────────────────────────────────────────────────────

/**
 * Parse a DOCX buffer and extract plain text.
 *
 * Lazy-loads mammoth on first call — returns ATTACHMENT_PARSER_UNAVAILABLE (503)
 * if the module cannot be loaded.
 */
export async function parseDocxBuffer(
  buf:      Buffer,
  maxChars: number,
): Promise<DocxParseResult | DocxParseError> {
  // ── Lazy module load ───────────────────────────────────────────────────────
  let mammoth: MammothModule;
  try {
    mammoth = await loadMammoth();
  } catch {
    return { error: "ATTACHMENT_PARSER_UNAVAILABLE" };
  }

  // ── Parse ──────────────────────────────────────────────────────────────────
  let extracted: { value: string };
  try {
    extracted = await mammoth.extractRawText({ buffer: buf });
  } catch {
    return { error: "ATTACHMENT_DOCX_INVALID" };
  }

  const text = (extracted.value ?? "").trim();
  if (!text) {
    return { error: "ATTACHMENT_DOCX_EMPTY" };
  }

  const truncated = text.length > maxChars;
  return {
    text:      truncated ? text.slice(0, maxChars) : text,
    truncated,
    charCount: Math.min(text.length, maxChars),
  };
}
