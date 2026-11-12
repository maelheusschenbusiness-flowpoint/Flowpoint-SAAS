const SENSITIVE_HEADER = /authorization|api[-_]?key|token|secret|password|signature/i;

export function presentIntegration(
  value: Record<string, unknown>,
  revealNewSecret = false,
): Record<string, unknown> {
  const result = { ...value };
  const oneTimeSecret = value.secretKey ?? value.secret_key;
  delete result.secret_key;
  delete result.secretKey;

  if (revealNewSecret && typeof oneTimeSecret === "string") {
    result.secretKey = oneTimeSecret;
  }

  if (typeof result.endpoint_url === "string") {
    try {
      const endpoint = new URL(result.endpoint_url);
      result.endpoint_url = `${endpoint.origin}${endpoint.pathname === "/" ? "" : "/…"}`;
    } catch {
      delete result.endpoint_url;
    }
  }

  if (result.headers !== undefined) {
    try {
      const wasString = typeof result.headers === "string";
      const headers = wasString ? JSON.parse(result.headers as string) : result.headers;
      if (headers && typeof headers === "object" && !Array.isArray(headers)) {
        const masked = Object.fromEntries(Object.entries(headers).map(([key, headerValue]) => [
          key,
          SENSITIVE_HEADER.test(key) ? "••••••" : headerValue,
        ]));
        result.headers = wasString ? JSON.stringify(masked) : masked;
      } else {
        delete result.headers;
      }
    } catch {
      delete result.headers;
    }
  }
  return result;
}
