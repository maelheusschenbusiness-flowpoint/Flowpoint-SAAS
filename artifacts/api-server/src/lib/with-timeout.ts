/** Largest delay Node accepts; anything above is silently coerced to 1ms. */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Race an operation against a deadline without leaving a live timer when the
 * operation settles first.
 *
 * `Infinity` means "no deadline"; a finite delay above the platform maximum is
 * capped instead of firing on the next tick; a non-positive delay rejects right
 * away and a non-numeric delay is a programming error.
 */
export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  timeoutError: Error,
): Promise<T> {
  if (typeof timeoutMs !== "number" || Number.isNaN(timeoutMs)) {
    throw new TypeError(`withTimeout: timeoutMs must be a number, received ${String(timeoutMs)}`);
  }
  if (timeoutMs === Number.POSITIVE_INFINITY) {
    return await operation;
  }
  if (timeoutMs <= 0) {
    throw timeoutError;
  }

  const delay = Math.min(timeoutMs, MAX_TIMEOUT_MS);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(timeoutError), delay);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
