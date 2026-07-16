/**
 * docx-parser.ts — Parse DOCX files from a Buffer using mammoth.
 *
 * Handles:
 *   - Plain text extraction (mammoth extractRawText)
 *   - Empty document detection → ATTACHMENT_DOCX_EMPTY
 *   - Invalid DOCX detection   → ATTACHMENT_DOCX_INVALID (distinct from generic failed)
 *   - Truncation to maxChars
 */

import mammoth from "mammoth";

export interface DocxParseResult {
  text:      string;
  truncated: boolean;
  charCount: number;
}

export type DocxParseErrorCode = "ATTACHMENT_DOCX_EMPTY" | "ATTACHMENT_DOCX_INVALID";

export interface DocxParseError {
  error: DocxParseErrorCode;
}

/**
 * Parse a DOCX buffer and extract plain text.
 */
export async function parseDocxBuffer(
  buf:      Buffer,
  maxChars: number,
): Promise<DocxParseResult | DocxParseError> {
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
