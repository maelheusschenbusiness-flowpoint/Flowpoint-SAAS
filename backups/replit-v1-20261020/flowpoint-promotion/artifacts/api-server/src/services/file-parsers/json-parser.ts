/**
 * json-parser.ts — Parse JSON files from a Buffer.
 *
 * Handles:
 *   - JSON validation (ATTACHMENT_JSON_INVALID on syntax error)
 *   - Depth limit enforcement (ATTACHMENT_JSON_TOO_DEEP when exceeded — distinct code)
 *   - Sensitive key redaction via explicit normalised-key matching
 *   - Truncation to maxChars on serialised output
 *
 * Redaction strategy (not regex-based):
 *   Keys are normalised to lowercase with separators stripped.
 *   Only exact normalised matches against SENSITIVE_NORMALIZED_KEYS are redacted.
 *   This prevents false positives on non-sensitive keys like:
 *     tokenCount, cookieBanner, authorizationStatus, secretariat, passport
 */

export interface JsonParseResult {
  text:      string;
  truncated: boolean;
  charCount: number;
}

export type JsonParseErrorCode = "ATTACHMENT_JSON_INVALID" | "ATTACHMENT_JSON_TOO_DEEP";

export interface JsonParseError {
  error: JsonParseErrorCode;
}

// ── Sensitive key normalisation ───────────────────────────────────────────────
// Normalise: lowercase + remove [-_] separators (camelCase → lower, snake_case → lower)
function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, "");
}

// Exact normalised matches — no prefix matching, no glob.
// Covers:  password, passwd, secret, token, accessToken, access_token,
//          refreshToken, refresh-token, apiKey, api_key, authorization,
//          Authorization, cookie, Cookie, privateKey, private_key,
//          clientSecret, client_secret, credential, credentials
const SENSITIVE_NORMALISED_KEYS = new Set([
  "password",
  "passwd",
  "secret",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "authorization",
  "cookie",
  "privatekey",
  "clientsecret",
  "credential",
  "credentials",
]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_NORMALISED_KEYS.has(normaliseKey(key));
}

// ── Depth computation ─────────────────────────────────────────────────────────

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

// ── Sensitive-key redaction ───────────────────────────────────────────────────

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
      out[key] = isSensitiveKey(key)
        ? "[REDACTED]"
        : redactSensitiveKeys(val, depth + 1, maxDepth);
    }
    return out;
  }

  return value;
}

// ── Main parse function ───────────────────────────────────────────────────────

/**
 * Parse a JSON buffer, redact sensitive keys, enforce depth, and truncate.
 *
 * Returns JsonParseError with:
 *   "ATTACHMENT_JSON_INVALID"  — syntax error (JSON.parse threw)
 *   "ATTACHMENT_JSON_TOO_DEEP" — nesting exceeds maxDepth (distinct from invalid)
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
    return { error: "ATTACHMENT_JSON_TOO_DEEP" };
  }

  const redacted   = redactSensitiveKeys(parsed, 0, maxDepth);
  const serialized = JSON.stringify(redacted, null, 2);

  const truncated = serialized.length > maxChars;
  const text      = truncated ? serialized.slice(0, maxChars) : serialized;

  return { text, truncated, charCount: text.length };
}
