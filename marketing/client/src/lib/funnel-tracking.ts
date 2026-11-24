import { getActiveFpLid } from "./fp-lid";
import { findMarketingLanguage } from "@shared/marketing-language";
import { isProductionMarketingHostname } from "@shared/marketing-host";

export type FunnelStep =
  | "landing_vue"
  | "cta_clique";

const CONSENT_KEY = "cookie_consent";
const VISITOR_KEY = "flowpoint_funnel_visitor";
const SOURCE_KEY = "flowpoint_funnel_source";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"] as const;
const ATTRIBUTION_STORAGE_KEY = "flowpoint:marketing:attribution";
const FP_LID_STORAGE_KEY = "flowpoint:marketing:fp_lid";
const FP_LID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const UTM_PATTERN = /^[a-z0-9._-]{1,64}$/;
const ALLOWED_FP_SOURCES = new Set([
  "smartlead",
  "google",
  "direct",
  "social",
  "other_campaign",
]);
const CONSENT_COOKIE = "fp_analytics_consent";
const PRODUCTION_APP_ORIGIN = "https://app.flowpoint.pro";
const SHARED_ID_COOKIES = ["fp_visitor_id", "fp_source"] as const;
const SENT_EVENT_KEY_PREFIX = "flowpoint_funnel_sent";
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
const volatileSentEvents = new Set<string>();

function readConsent(): string | null {
  try {
    if (window.localStorage.getItem(CONSENT_KEY) === "accepted") return "accepted";
  } catch {
    // The explicit shared consent cookie remains available if localStorage is blocked.
  }
  return typeof document !== "undefined" && document.cookie
    .split(";")
    .some((cookie) => cookie.trim() === `${CONSENT_COOKIE}=accepted`)
    ? "accepted"
    : null;
}

export function hasFunnelConsent(): boolean {
  return typeof window !== "undefined" && readConsent() === "accepted";
}

export function clearFunnelIdentity(): void {
  volatileVisitorId = null;
  try {
    window.localStorage.removeItem(VISITOR_KEY);
    window.localStorage.removeItem(SOURCE_KEY);
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

type MarketingAttribution = FunnelAttribution & {
  fp_lid?: string;
  fp_source?: string;
  fp_ref?: string;
};

function safeSessionGet(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSessionSet(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // Session persistence is best-effort; the current URL remains available.
  }
}

function safeSessionRemove(key: string): void {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Session persistence is best-effort.
  }
}

function isValidUtm(value: string | null): value is string {
  return value !== null && UTM_PATTERN.test(value);
}

function readMarketingAttribution(): MarketingAttribution {
  const raw = safeSessionGet(ATTRIBUTION_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const source = parsed as Record<string, unknown>;
    const result: MarketingAttribution = {};
    for (const key of UTM_KEYS) {
      const value = source[key];
      if (typeof value === "string" && isValidUtm(value)) result[key] = value;
    }
    if (typeof source.fp_lid === "string" && FP_LID_PATTERN.test(source.fp_lid)) {
      result.fp_lid = source.fp_lid;
    }
    if (typeof source.fp_source === "string" && ALLOWED_FP_SOURCES.has(source.fp_source)) {
      result.fp_source = source.fp_source;
    }
    if (typeof source.fp_ref === "string" && source.fp_ref.length > 0) {
      result.fp_ref = source.fp_ref;
    }
    return result;
  } catch {
    return {};
  }
}

function saveMarketingAttribution(attribution: MarketingAttribution): void {
  safeSessionSet(ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution));
}

/**
 * Capture only values supplied on the current marketing URL, keeping valid
 * values in sessionStorage so internal marketing navigation can preserve them.
 */
export function captureMarketingAttribution(): void {
  if (typeof window === "undefined") return;
  if (!isProductionMarketingHostname(window.location.hostname)) return;
  const params = new URLSearchParams(window.location.search);
  const attribution = readMarketingAttribution();
  let changed = false;

  for (const key of UTM_KEYS) {
    if (!params.has(key)) continue;
    const raw = params.get(key) || "";
    const normalized = raw.toLowerCase();
    if (isValidUtm(normalized)) attribution[key] = normalized;
    else delete attribution[key];
    changed = true;
  }

  if (params.has("fp_lid")) {
    const fpLid = params.get("fp_lid") || "";
    if (FP_LID_PATTERN.test(fpLid)) {
      attribution.fp_lid = fpLid;
      safeSessionSet(FP_LID_STORAGE_KEY, fpLid);
    } else {
      delete attribution.fp_lid;
      safeSessionRemove(FP_LID_STORAGE_KEY);
    }
    changed = true;
  } else {
    const fpLid = safeSessionGet(FP_LID_STORAGE_KEY);
    if (fpLid && FP_LID_PATTERN.test(fpLid)) {
      attribution.fp_lid = fpLid;
      changed = true;
    }
  }

  if (params.has("fp_source")) {
    const fpSource = params.get("fp_source") || "";
    if (ALLOWED_FP_SOURCES.has(fpSource)) attribution.fp_source = fpSource;
    else delete attribution.fp_source;
    changed = true;
  }
  if (params.has("fp_ref")) {
    const fpRef = params.get("fp_ref") || "";
    if (fpRef) attribution.fp_ref = fpRef;
    else delete attribution.fp_ref;
    changed = true;
  }

  if (changed) saveMarketingAttribution(attribution);
}

export function getDisplayedMarketingLanguage(): string | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  return findMarketingLanguage(
    window.location.search || "",
    document.cookie || "",
    document.documentElement.dataset.language || document.documentElement.lang,
  );
}

function getCurrentPageAttribution(): MarketingAttribution {
  const params = new URLSearchParams(
    typeof window !== "undefined" ? window.location?.search || "" : "",
  );
  const attribution: MarketingAttribution = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key);
    const normalized = value?.toLowerCase() ?? null;
    if (isValidUtm(normalized)) attribution[key] = normalized;
  }
  const fpLid = params.get("fp_lid");
  if (fpLid && FP_LID_PATTERN.test(fpLid)) attribution.fp_lid = fpLid;
  const fpSource = params.get("fp_source");
  if (fpSource && ALLOWED_FP_SOURCES.has(fpSource)) attribution.fp_source = fpSource;
  const fpRef = params.get("fp_ref");
  if (fpRef) attribution.fp_ref = fpRef;
  return attribution;
}

function getCurrentAttribution(): MarketingAttribution {
  const current = getCurrentPageAttribution();
  const stored = readMarketingAttribution();
  return {
    ...stored,
    ...current,
  };
}

export function getFunnelAttribution(): MarketingAttribution {
  if (
    typeof window === "undefined" ||
    !isProductionMarketingHostname(window.location.hostname)
  ) {
    return {};
  }
  const current = getCurrentAttribution();
  return current;
}

export function getFunnelSource(): string {
  if (
    !hasFunnelConsent() ||
    !isProductionMarketingHostname(window.location.hostname)
  ) {
    return "direct";
  }

  const attributedSource = readMarketingAttribution().fp_source;
  if (attributedSource) return attributedSource;
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
  if (
    !hasFunnelConsent() ||
    !isProductionMarketingHostname(window.location.hostname)
  ) {
    return null;
  }

  const stored = safeStoredValue(VISITOR_KEY);
  if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(stored)) {
    return stored;
  }
  if (stored) {
    try {
      window.localStorage.removeItem(VISITOR_KEY);
    } catch {
      // Regenerate an invalid legacy identifier even if removal is unavailable.
    }
  }
  if (volatileVisitorId) return volatileVisitorId;

  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      volatileVisitorId = crypto.randomUUID();
    } else if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      volatileVisitorId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    } else {
      volatileVisitorId = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
        const value = Math.floor(Math.random() * 16);
        return (char === "x" ? value : (value & 0x3) | 0x8).toString(16);
      });
    }
  } catch {
    volatileVisitorId = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
      const value = Math.floor(Math.random() * 16);
      return (char === "x" ? value : (value & 0x3) | 0x8).toString(16);
    });
  }

  safeStoreValue(VISITOR_KEY, volatileVisitorId);
  return volatileVisitorId;
}

function apiEndpoint(): string | null {
  return `${PRODUCTION_APP_ORIGIN}/api/public/funnel-event`;
}

export function sendFunnelEvent(etape: FunnelStep): void {
  if (etape !== "landing_vue" && etape !== "cta_clique") return;
  if (
    !hasFunnelConsent() ||
    !isProductionMarketingHostname(window.location.hostname)
  ) return;

  const visiteurId = getFunnelVisitorId();
  const endpoint = apiEndpoint();
  if (!visiteurId || !endpoint) return;

  const day = new Date().toISOString().slice(0, 10);
  const dedupeKey = `${visiteurId}:${etape}:${day}`;
  const dedupeStorageKey = `${SENT_EVENT_KEY_PREFIX}:${dedupeKey}`;
  if (volatileSentEvents.has(dedupeKey) || safeStoredValue(dedupeStorageKey) === "1") return;
  volatileSentEvents.add(dedupeKey);
  safeStoreValue(dedupeStorageKey, "1");

  try {
    const attribution = getFunnelAttribution();
    const fpLid = attribution.fp_lid || getActiveFpLid();
    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        etape,
        visiteurId,
        source: getFunnelSource(),
        ...(fpLid ? { fp_lid: fpLid } : {}),
        ...Object.fromEntries(
          UTM_KEYS.flatMap((key) =>
            attribution[key] ? [[key, attribution[key]]] : [],
          ),
        ),
      }),
      keepalive: true,
      credentials: "include",
    }).catch(() => {
      // Tracking is best-effort and must never block navigation.
    });
  } catch {
    // Older or restricted browser contexts can reject fetch synchronously.
  }
}

const pendingOwnHrefMutations = new WeakMap<HTMLAnchorElement, Array<string | null>>();

function rememberOwnHrefMutation(anchor: HTMLAnchorElement, oldValue: string | null) {
  const pending = pendingOwnHrefMutations.get(anchor) || [];
  pending.push(oldValue);
  pendingOwnHrefMutations.set(anchor, pending);
}

function consumeOwnHrefMutation(record: MutationRecord): boolean {
  if (
    record.type !== "attributes" ||
    record.attributeName !== "href" ||
    !(record.target instanceof HTMLAnchorElement)
  ) {
    return false;
  }

  const anchor = record.target;
  const pending = pendingOwnHrefMutations.get(anchor);
  if (!pending) return false;

  const index = pending.indexOf(record.oldValue);
  if (index === -1) return false;
  pending.splice(index, 1);
  if (pending.length === 0) pendingOwnHrefMutations.delete(anchor);
  return true;
}

export function addFunnelAttributionToSignupLink(anchor: HTMLAnchorElement): void {
  try {
    const url = new URL(anchor.href);
    if (url.origin !== PRODUCTION_APP_ORIGIN) return;
    if (typeof window === "undefined") return;

    const productionHost = isProductionMarketingHostname(window.location.hostname);
    const attribution = productionHost ? getFunnelAttribution() : {};
    const language = getDisplayedMarketingLanguage();
    if (language) url.searchParams.set("lang", language);
    else url.searchParams.delete("lang");

    if (productionHost) {
      const fpLid = attribution.fp_lid || getActiveFpLid();
      if (fpLid && FP_LID_PATTERN.test(fpLid)) url.searchParams.set("fp_lid", fpLid);
      else url.searchParams.delete("fp_lid");

      for (const key of UTM_KEYS) {
        const value = attribution[key];
        if (value && isValidUtm(value)) url.searchParams.set(key, value);
        else url.searchParams.delete(key);
      }
      for (const key of ["fp_source", "fp_ref"] as const) {
        const value = attribution[key];
        if (value) url.searchParams.set(key, value);
        else url.searchParams.delete(key);
      }
      if (hasFunnelConsent()) {
        const visitorId = getFunnelVisitorId();
        if (visitorId) url.searchParams.set("fp_vid", visitorId);
        else url.searchParams.delete("fp_vid");
      } else {
        url.searchParams.delete("fp_vid");
      }
    } else {
      url.searchParams.delete("fp_lid");
      for (const key of UTM_KEYS) url.searchParams.delete(key);
      for (const key of ["fp_source", "fp_ref"] as const) url.searchParams.delete(key);
      url.searchParams.delete("fp_vid");
    }

    const nextHref = url.toString();
    if (anchor.href !== nextHref) {
      const oldHref =
        typeof anchor.getAttribute === "function"
          ? anchor.getAttribute("href")
          : anchor.href;
      rememberOwnHrefMutation(anchor, oldHref);
      anchor.href = nextHref;
    }
  } catch {
    // Invalid or unavailable URLs must not prevent the original click.
  }
}

export function installMarketingAppLinkPropagation(
  targetDocument: Document = document,
  updateLink: (anchor: HTMLAnchorElement) => void = addFunnelAttributionToSignupLink,
): () => void {
  const update = (anchor: HTMLAnchorElement) => updateLink(anchor);
  const updateAll = () =>
    targetDocument
      .querySelectorAll<HTMLAnchorElement>('a[href^="https://app.flowpoint.pro/"]')
      .forEach(update);

  captureMarketingAttribution();

  const observer =
    typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver((records) => {
          for (const record of records) {
            if (consumeOwnHrefMutation(record)) continue;
            if (record.type === "attributes" && record.target instanceof HTMLAnchorElement) {
              update(record.target);
            }
            record.addedNodes.forEach((node) => {
              if (node instanceof HTMLAnchorElement) update(node);
              if (node instanceof Element) {
                node.querySelectorAll<HTMLAnchorElement>('a[href^="https://app.flowpoint.pro/"]')
                  .forEach(update);
              }
            });
          }
        });
  observer?.observe(targetDocument.body, {
    attributes: true,
    attributeFilter: ["href"],
    childList: true,
    subtree: true,
          attributeOldValue: true,
  });

  updateAll();

  const handleActivation = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest<HTMLAnchorElement>('a[href^="https://app.flowpoint.pro/"]');
    if (anchor) update(anchor);
  };
  targetDocument.addEventListener("click", handleActivation, true);
  targetDocument.addEventListener("auxclick", handleActivation, true);
  window.addEventListener("flowpoint-cookie-consent-change", updateAll);

  return () => {
    observer?.disconnect();
    targetDocument.removeEventListener("click", handleActivation, true);
    targetDocument.removeEventListener("auxclick", handleActivation, true);
    window.removeEventListener("flowpoint-cookie-consent-change", updateAll);
  };
}

export function isLikelyHumanPageView(): boolean {
  if (typeof navigator === "undefined" || typeof document === "undefined") return false;
  if (navigator.webdriver || document.visibilityState !== "visible") return false;
  return !/(bot|crawler|spider|headless|preview|slurp|facebookexternalhit|monitoring)/i.test(
    navigator.userAgent,
  );
}
