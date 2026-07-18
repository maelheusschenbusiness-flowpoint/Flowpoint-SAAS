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

/** Returns the error code string without exposing any connection details. */
export function getErrorCode(err: unknown): string | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const code = (err as Record<string, unknown>)["code"];
  return typeof code === "string" ? code : undefined;
}

/**
 * Returns the error message string.
 * Never logs stack traces, connection strings, SQL queries, or credentials.
 */
export function getSafeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return "Unknown error";
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
        { code: getErrorCode(err) },
        `[startup] ${label} failed transiently — retry ${attempt}/${attempts}`,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastErr;
}

/**
 * Runs a CRITICAL startup step.
 *
 * On exhausted retries or a permanent error the exception propagates
 * unconditionally, preventing app.listen() and cron start.
 * Use for every step whose failure would leave the server in an unsafe
 * or broken state (missing tables, missing RLS policies, no DB access).
 */
export async function runCriticalStartupStep(
  label: string,
  operation: () => Promise<void>,
  options?: {
    attempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  },
): Promise<void> {
  await withStartupRetry(label, operation, options);
}

/**
 * Runs an OPTIONAL startup step.
 *
 * On failure the error is logged safely (label + code + message only —
 * no DATABASE_URL, no passwords, no SQL queries) and the bootstrap continues.
 *
 * A step may only be optional when its absence demonstrably does not break
 * any active route, any multi-tenant isolation boundary, or any write path.
 * Document the rationale inline at the call site.
 */
export async function runOptionalStartupStep(
  label: string,
  operation: () => Promise<void>,
  options?: {
    attempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  },
): Promise<void> {
  try {
    await withStartupRetry(label, operation, options);
  } catch (error) {
    logger.warn(
      {
        label,
        code: getErrorCode(error),
        message: getSafeErrorMessage(error),
      },
      "[startup] Optional step unavailable",
    );
  }
}
