export const MARKETING_THEME_MODES = ["system", "light", "dark"] as const;

export type MarketingThemeMode = (typeof MARKETING_THEME_MODES)[number];

export function normalizeMarketingThemeMode(
  mode: string | null | undefined,
): MarketingThemeMode | null {
  if (!mode) return null;
  const normalized = mode.trim().toLowerCase();
  return MARKETING_THEME_MODES.find((value) => value === normalized) ?? null;
}

export function readMarketingThemeCookie(
  cookieHeader: string | undefined,
): MarketingThemeMode | null {
  if (!cookieHeader) return null;

  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("flowpoint-theme="));
  if (!cookie) return null;

  let value = cookie.slice("flowpoint-theme=".length);
  try {
    value = decodeURIComponent(value);
  } catch {
    return null;
  }

  return normalizeMarketingThemeMode(value);
}

export function resolveMarketingThemeMode(
  cookieHeader: string | undefined,
): MarketingThemeMode {
  return readMarketingThemeCookie(cookieHeader) ?? "system";
}
