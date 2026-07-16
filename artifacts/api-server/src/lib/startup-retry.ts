import { logger } from "./logger.js";

/**
 * PostgreSQL error codes and Node.js errno codes that indicate a transient
 * network or server-side disconnect. These are safe to retry at startup.
 *
 * Do NOT retry:
 *  - SQL syntax errors (42xxx)
 *  - Permission denied (42501)
 *  - Undefined table/column (42P01, 42703)
 *  - Missing env vars / application logic errors
 */
const TRANSIENT_CODES = new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
]);

function isTransient(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const code = (err as Record<string, unknown>)["code"];
  return typeof code === "string" && TRANSIENT_CODES.has(code);
}

/**
 * Wraps a startup operation with exponential-backoff retry for transient
 * PostgreSQL / network errors.
 *
 * - Retries ONLY for ECONNABORTED, ECONNRESET, ETIMEDOUT, EPIPE, 57P01-03.
 * - Permanent errors (SQL syntax, permissions, schema issues, missing env) are
 *   re-thrown immediately without retry.
 * - After exhausting all attempts the last error is re-thrown so the caller
 *   decides whether to abort startup or continue.
 *
 * Default: 4 attempts, 500 ms base delay, 4 000 ms max delay.
 */
export async function withStartupRetry<T>(
  label: string,
  operation: () => Promise<T>,
  options?: {
    attempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  },
): Promise<T> {
  const attempts    = options?.attempts    ?? 4;
  const baseDelayMs = options?.baseDelayMs ?? 500;
  const maxDelayMs  = options?.maxDelayMs  ?? 4_000;

  let lastErr: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const result = await operation();
      if (attempt > 1) {
        logger.info(`[startup] ${label} recovered`);
      }
      return result;
    } catch (err) {
      lastErr = err;

      if (!isTransient(err) || attempt === attempts) {
        throw err;
      }

      const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      logger.warn(
        { code: (err as Record<string, unknown>)["code"] },
        `[startup] ${label} failed transiently — retry ${attempt}/${attempts}`,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastErr;
}
