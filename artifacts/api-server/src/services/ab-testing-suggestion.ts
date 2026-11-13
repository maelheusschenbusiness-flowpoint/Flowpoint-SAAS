export interface AbTestingSuggestion {
  hypothesis: string;
  variantBText: string;
  rationale: string;
  successMetric: string;
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(trimmed)) return null;
  return trimmed;
}

export function parseAbTestingSuggestion(raw: string): AbTestingSuggestion | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const hypothesis = boundedString(record["hypothesis"], 500);
    const variantBText = boundedString(record["variantBText"], 300);
    const rationale = boundedString(record["rationale"], 500);
    const successMetric = boundedString(record["successMetric"], 200);
    if (!hypothesis || !variantBText || !rationale || !successMetric) return null;
    return { hypothesis, variantBText, rationale, successMetric };
  } catch {
    return null;
  }
}
