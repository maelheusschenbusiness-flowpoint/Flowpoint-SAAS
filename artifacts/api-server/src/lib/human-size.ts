// ── humanSize ─────────────────────────────────────────────────────────────────
// Formats a raw byte count into a short, human-readable string.
// Examples: 1536 → "1.5 KB", 10485760 → "10 MB", 0 → "0 B".
// Decimals are trimmed when the value is whole (10 MB, not 10.0 MB).

const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes)) return "0 B";

  const negative = bytes < 0;
  let value      = Math.abs(bytes);
  let unitIndex  = 0;

  while (value >= 1024 && unitIndex < UNITS.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  const rounded   = Math.round(value * 10) / 10;
  const formatted = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);

  return `${negative ? "-" : ""}${formatted} ${UNITS[unitIndex]}`;
}
