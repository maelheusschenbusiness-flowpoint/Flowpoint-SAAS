export type FunnelStep =
  | "landing_vue"
  | "tarifs_vus"
  | "cta_clique"
  | "signup_started";

const CONSENT_KEY = "cookie_consent";
const VISITOR_KEY = "flowpoint_funnel_visitor";
const SOURCE_KEY = "flowpoint_funnel_source";
const ATTRIBUTION_KEY = "flowpoint_funnel_attribution";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;
const TEST_API_BASE_URL = "https://flowpoint-test.onrender.com";
const PRODUCTION_APP_ORIGIN = "https://app.flowpoint.pro";
const TEST_APP_ORIGIN = "https://flowpoint-test.onrender.com";
const SHARED_ID_COOKIES = ["fp_visitor_id", "fp_source"] as const;
const SOCIAL_SOURCES = new Set([
  "facebook",
  "instagram",
  "linkedin",
  "twitter",
  "x",
  "tiktok",
  "youtube",
  "pinterest",
  "threads",
  "reddit",
]);
const SOCIAL_DOMAINS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "pinterest.com",
  "threads.net",
  "reddit.com",
  "t.co",
];

let volatileVisitorId: string | null = null;

function readConsent(): string | null {
  try {
    return window.localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
}

export function hasFunnelConsent(): boolean {
  return typeof window !== "undefined" && readConsent() === "accepted";
}

export function clearFunnelIdentity(): void {
  volatileVisitorId = null;
  try {
    window.localStorage.removeItem(VISITOR_KEY);
    window.localStorage.removeItem(SOURCE_KEY);
    window.localStorage.removeItem(ATTRIBUTION_KEY);
  } catch {
    // Consent withdrawal must still stop transmission if storage is blocked.
  }

  if (typeof document === "undefined") return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const host = window.location.hostname.toLowerCase();
  const sharedDomain =
    host === "flowpoint.pro" || host.endsWith(".flowpoint.pro")
      ? "; Domain=.flowpoint.pro"
      : "";

  for (const name of SHARED_ID_COOKIES) {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${sharedDomain}${secure}`;
    // Also clear a host-only copy if an earlier version created one.
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  }
}

function safeStoredValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeStoreValue(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Restricted storage must not interfere with the page or navigation.
  }
}

function currentSource(): string {
  const params = new URLSearchParams(window.location.search);
  const utmSource = (params.get("utm_source") || "").trim().toLowerCase();
  const normalizedSource = utmSource.split(/[._-]/, 1)[0] || "";
  const utmMedium = (params.get("utm_medium") || "").trim().toLowerCase();
  const paidMedium = /^(cpc|ppc|paid|ads|paid-social)$/.test(utmMedium);

  if (/smartlead/.test(utmSource)) return "smartlead";
  if (SOCIAL_SOURCES.has(normalizedSource) || /^(social|social-paid|social-organic)$/.test(utmMedium)) {
    return "social";
  }
  if (normalizedSource === "google" && !paidMedium) return "google";
  if (utmSource || utmMedium || params.has("utm_campaign") || params.has("gclid") || params.has("fbclid")) {
    return "other_campaign";
  }

  const referrer = document.referrer;
  if (!referrer) return "direct";

  try {
    const host = new URL(referrer).hostname.toLowerCase();
    if (/smartlead/.test(host)) return "smartlead";
    if (/(^|\.)google\.[a-z.]+$/.test(host)) return "google";
    if (SOCIAL_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
      return "social";
    }
    return "other_campaign";
  } catch {
    return "direct";
  }
}

type FunnelAttribution = Partial<Record<(typeof UTM_KEYS)[number], string>>;

function getCurrentAttribution(): FunnelAttribution {
  const params = new URLSearchParams(window.location.search);
  const attribution: FunnelAttribution = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key)?.trim();
    if (value) attribution[key] = value.slice(0, 200);
  }
  return attribution;
}

function getStoredAttribution(): FunnelAttribution {
  const raw = safeStoredValue(ATTRIBUTION_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const attribution: FunnelAttribution = {};
    for (const key of UTM_KEYS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) {
        attribution[key] = value.trim().slice(0, 200);
      }
    }
    return attribution;
  } catch {
    return {};
  }
}

export function getFunnelAttribution(): FunnelAttribution {
  if (!hasFunnelConsent()) return {};

  const current = getCurrentAttribution();
  if (Object.keys(current).length > 0) {
    safeStoreValue(ATTRIBUTION_KEY, JSON.stringify(current));
    return current;
  }
  return getStoredAttribution();
}

export function getFunnelSource(): string {
  if (!hasFunnelConsent()) return "direct";

  const currentAttribution = getCurrentAttribution();
  if (Object.keys(currentAttribution).length > 0) {
    const source = currentSource();
    safeStoreValue(SOURCE_KEY, source);
    return source;
  }

  const stored = safeStoredValue(SOURCE_KEY);
  if (stored) return stored;

  const source = currentSource();
  safeStoreValue(SOURCE_KEY, source);
  return source;
}

export function getFunnelVisitorId(): string | null {
  if (!hasFunnelConsent()) return null;

  const stored = safeStoredValue(VISITOR_KEY);
  if (stored) return stored;
  if (volatileVisitorId) return volatileVisitorId;

  try {
    volatileVisitorId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `fp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  } catch {
    volatileVisitorId = `fp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  safeStoreValue(VISITOR_KEY, volatileVisitorId);
  return volatileVisitorId;
}

function apiEndpoint(): string | null {
  if (import.meta.env.DEV) {
    return `${TEST_API_BASE_URL}/api/public/funnel-event`;
  }

  const configuredBaseUrl =
    import.meta.env.VITE_FUNNEL_API_BASE_URL?.trim() || PRODUCTION_APP_ORIGIN;
  return `${configuredBaseUrl.replace(/\/+$/, "")}/api/public/funnel-event`;
}

export function sendFunnelEvent(etape: FunnelStep): void {
  if (!hasFunnelConsent()) return;

  const visiteurId = getFunnelVisitorId();
  const endpoint = apiEndpoint();
  if (!visiteurId || !endpoint) return;

  try {
    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ etape, visiteurId, source: getFunnelSource() }),
      keepalive: true,
      credentials: "omit",
    }).catch(() => {
      // Tracking is best-effort and must never block navigation.
    });
  } catch {
    // Older or restricted browser contexts can reject fetch synchronously.
  }
}

export function addFunnelAttributionToSignupLink(anchor: HTMLAnchorElement): void {
  if (!hasFunnelConsent()) return;

  try {
    const url = new URL(anchor.href);
    if (url.origin === PRODUCTION_APP_ORIGIN && import.meta.env.DEV) {
      const testOrigin = new URL(TEST_APP_ORIGIN);
      url.protocol = testOrigin.protocol;
      url.hostname = testOrigin.hostname;
      url.port = testOrigin.port;
    } else if (url.origin !== PRODUCTION_APP_ORIGIN && url.origin !== TEST_APP_ORIGIN) {
      return;
    }

    const visitorId = getFunnelVisitorId();
    if (!visitorId) return;

    url.searchParams.set("fp_vid", visitorId);
    url.searchParams.set("fp_source", getFunnelSource());
    for (const [key, value] of Object.entries(getFunnelAttribution())) {
      url.searchParams.set(key, value);
    }
    anchor.href = url.toString();
  } catch {
    // Invalid or unavailable URLs must not prevent the original click.
  }
}

export function isLikelyHumanPageView(): boolean {
  if (typeof navigator === "undefined" || typeof document === "undefined") return false;
  if (navigator.webdriver || document.visibilityState !== "visible") return false;
  return !/(bot|crawler|spider|headless|preview|slurp|facebookexternalhit|monitoring)/i.test(
    navigator.userAgent,
  );
}
