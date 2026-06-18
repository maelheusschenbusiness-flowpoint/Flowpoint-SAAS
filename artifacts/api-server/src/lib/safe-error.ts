/**
 * safeErrMsg — sanitize error messages for HTTP responses.
 * In production: always return a generic message (no internal details leaked).
 * In development: return the real error message for easier debugging.
 */
const IS_PROD = process.env["NODE_ENV"] === "production";

export function safeErrMsg(err: unknown): string {
  if (IS_PROD) return "Internal server error";
  return err instanceof Error ? err.message : String(err);
}

export function safeErrDetail(err: unknown): Record<string, unknown> | undefined {
  if (IS_PROD) return undefined;
  return {
    detail: err instanceof Error ? err.message : String(err),
    ...(err instanceof Error && err.stack
      ? { stack: err.stack.split("\n").slice(0, 4) }
      : {}),
  };
}
