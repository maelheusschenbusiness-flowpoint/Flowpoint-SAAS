/**
 * json-parser.ts — Parse JSON files from a Buffer.
 *
 * Handles:
 *   - JSON validation
 *   - Depth limit enforcement (returns error when exceeded)
 *   - Sensitive key redaction
 *   - Truncation to maxChars on serialised output
 */

export interface JsonParseResult {
  text:      string;
  truncated: boolean;
  charCount: number;
}

export interface JsonParseError {
  error: "ATTACHMENT_JSON_INVALID";
}

// Keys matching this pattern are redacted to "[REDACTED]"
const SENSITIVE_KEY_RE =
  /^(password|passwd|secret|token|api[_\-]?key|auth|credential|private[_\-]?key|access[_\-]?token|refresh[_\-]?token|client[_\-]?secret)/i;

/**
 * Compute the maximum nesting depth of a JSON value (iterative BFS).
 */
function computeJsonDepth(value: unknown): number {
  if (value === null || typeof value !== "object") return 0;

  let maxDepth = 1;
  const stack: Array<[unknown, number]> = [];

  const children = Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>);

  for (const child of children) {
    stack.push([child, 1]);
  }

  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    const [node, depth] = entry;
    if (depth > maxDepth) maxDepth = depth;

    if (node !== null && typeof node === "object") {
      const nodeChildren = Array.isArray(node)
        ? node
        : Object.values(node as Record<string, unknown>);
      for (const child of nodeChildren) {
        stack.push([child, depth + 1]);
      }
    }
  }

  return maxDepth;
}

/**
 * Recursively redact sensitive keys and truncate deeply nested objects.
 */
function redactSensitiveKeys(
  value:    unknown,
  depth:    number,
  maxDepth: number,
): unknown {
  if (depth > maxDepth) return "[MAX_DEPTH_EXCEEDED]";

  if (Array.isArray(value)) {
    return value.map(v => redactSensitiveKeys(v, depth + 1, maxDepth));
  }

  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_RE.test(key)
        ? "[REDACTED]"
        : redactSensitiveKeys(val, depth + 1, maxDepth);
    }
    return out;
  }

  return value;
}

/**
 * Parse a JSON buffer, redact sensitive keys, enforce depth, and truncate.
 */
export function parseJsonBuffer(
  buf:      Buffer,
  maxDepth: number,
  maxChars: number,
): JsonParseResult | JsonParseError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(buf.toString("utf-8")) as unknown;
  } catch {
    return { error: "ATTACHMENT_JSON_INVALID" };
  }

  const depth = computeJsonDepth(parsed);
  if (depth > maxDepth) {
    return { error: "ATTACHMENT_JSON_INVALID" };
  }

  const redacted  = redactSensitiveKeys(parsed, 0, maxDepth);
  const serialized = JSON.stringify(redacted, null, 2);

  const truncated = serialized.length > maxChars;
  const text      = truncated ? serialized.slice(0, maxChars) : serialized;

  return { text, truncated, charCount: text.length };
}
