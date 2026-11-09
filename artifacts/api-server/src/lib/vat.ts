/** Numero de TVA intracommunautaire : 2 lettres pays + 2 a 13 caracteres alphanumeriques. */
export function normalizeVat(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.replace(/[\s.-]/g, "").toUpperCase();
  return /^[A-Z]{2}[A-Z0-9]{2,13}$/.test(v) ? v : null;
}
