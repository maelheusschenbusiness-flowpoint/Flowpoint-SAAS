const SUPPORTED_MARKETING_LANGUAGES = new Set([
  "fr",
  "en",
  "es",
  "de",
  "it",
  "pt",
  "pt-br",
  "nl",
  "pl",
  "sv",
  "ro",
  "cs",
  "ru",
  "uk",
  "hu",
  "da",
  "no",
  "fi",
  "el",
  "tr",
  "ar",
  "he",
  "hi",
  "zh-cn",
  "zh-tw",
  "ja",
  "ko",
  "th",
  "vi",
  "id",
  "ms",
]);

export function normalizeMarketingLanguage(
  language: string | null | undefined,
): string | null {
  if (!language) return null;
  const normalized = language.trim().toLowerCase();
  return SUPPORTED_MARKETING_LANGUAGES.has(normalized) ? normalized : null;
}

function readDisplayedLanguageCookie(cookieHeader: string): string | null {
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("googtrans="));
  if (!cookie) return null;

  let value = cookie.slice("googtrans=".length);
  try {
    value = decodeURIComponent(value);
  } catch {
    return null;
  }

  const match = value.match(/^\/[^/]+\/([^/]+)$/);
  return normalizeMarketingLanguage(match?.[1]);
}

export function findMarketingLanguage(
  search: string,
  cookieHeader: string | undefined,
  fallback?: string | null,
): string | null {
  let searchParams: URLSearchParams;
  try {
    searchParams = new URL(search, "https://flowpoint.pro").searchParams;
  } catch {
    searchParams = new URLSearchParams(search);
  }
  const queryLanguage = normalizeMarketingLanguage(
    searchParams.get("lang"),
  );
  if (queryLanguage) return queryLanguage;

  const cookieLanguage = readDisplayedLanguageCookie(cookieHeader || "");
  if (cookieLanguage) return cookieLanguage;

  return normalizeMarketingLanguage(fallback);
}

export function resolveMarketingLanguage(
  search: string,
  cookieHeader: string | undefined,
  fallback?: string | null,
): string {
  return findMarketingLanguage(search, cookieHeader, fallback) || "en";
}
