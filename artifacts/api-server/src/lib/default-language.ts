/**
 * Resolve the dashboard locale without treating the legacy database default
 * (French) as an explicit user preference.
 */
export function resolveDashboardLanguage(
  settingsLanguage: unknown,
  legacyLanguage: unknown,
): string {
  const explicit = typeof settingsLanguage === "string" ? settingsLanguage.trim() : "";
  if (explicit) return explicit;

  const legacy = typeof legacyLanguage === "string" ? legacyLanguage.trim() : "";
  const legacyBase = legacy.split(/[-_]/, 1)[0]?.toLowerCase();
  return legacy && legacyBase !== "fr" ? legacy : "en";
}
