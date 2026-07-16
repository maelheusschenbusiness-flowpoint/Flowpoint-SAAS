/**
 * text-parser.ts — Parse TXT and Markdown files from a Buffer.
 *
 * Handles:
 *   - UTF-8 with and without BOM
 *   - Truncation to maxChars
 *   - Binary content rejection (>10 % non-printable chars in first 2 000 bytes)
 */

export interface TextParseResult {
  text:      string;
  truncated: boolean;
  charCount: number;
}

export interface TextParseError {
  error: "binary_content";
}

/**
 * Parse a UTF-8 text buffer (TXT or MD).
 * Returns a TextParseResult or TextParseError when the content looks binary.
 */
export function parseTextBuffer(
  buf:      Buffer,
  maxChars: number,
): TextParseResult | TextParseError {
  let text = buf.toString("utf-8");

  // Remove UTF-8 BOM (U+FEFF)
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  // Reject binary content: sample up to 2 000 chars and count non-printable bytes.
  // Tab (0x09), LF (0x0A), CR (0x0D) are allowed as whitespace.
  const sampleLen = Math.min(text.length, 2_000);
  let nonPrintable = 0;
  for (let i = 0; i < sampleLen; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x20 && c !== 0x09 && c !== 0x0A && c !== 0x0D) {
      nonPrintable++;
    }
  }
  if (sampleLen > 0 && nonPrintable / sampleLen > 0.1) {
    return { error: "binary_content" };
  }

  const truncated = text.length > maxChars;
  if (truncated) {
    text = text.slice(0, maxChars);
  }

  return { text, truncated, charCount: text.length };
}
