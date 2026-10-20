import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";

const GA_MEASUREMENT_ID = "G-32HPNSRLEM";
const GA_SCRIPT_ID = "flowpoint-ga4-script";
const CONSENT_STORAGE_KEY = "cookie_consent";
const CONSENT_CHANGE_EVENT = "flowpoint-cookie-consent-change";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    __flowpointGa4Configured?: boolean;
  }
}

function hasAnalyticsConsent() {
  return window.localStorage.getItem(CONSENT_STORAGE_KEY) === "accepted";
}

function initializeGoogleAnalytics() {
  if (window.__flowpointGa4Configured) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    ((...args: unknown[]) => {
      window.dataLayer?.push(args);
    });

  window.gtag("js", new Date());
  window.gtag("config", GA_MEASUREMENT_ID, { send_page_view: false });
  window.__flowpointGa4Configured = true;

  if (document.getElementById(GA_SCRIPT_ID)) return;

  const script = document.createElement("script");
  script.id = GA_SCRIPT_ID;
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(script);
}

function stopGoogleAnalytics() {
  window.gtag?.("consent", "update", { analytics_storage: "denied" });
  document.getElementById(GA_SCRIPT_ID)?.remove();
  window.__flowpointGa4Configured = false;
}

function currentPagePath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function GoogleAnalytics() {
  const [location] = useLocation();
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const lastTrackedPage = useRef<string | null>(null);

  useEffect(() => {
    const syncConsent = () => {
      const accepted = hasAnalyticsConsent();
      setAnalyticsEnabled(accepted);
      if (!accepted) stopGoogleAnalytics();
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === CONSENT_STORAGE_KEY) syncConsent();
    };

    syncConsent();
    window.addEventListener(CONSENT_CHANGE_EVENT, syncConsent);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(CONSENT_CHANGE_EVENT, syncConsent);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => {
    if (!analyticsEnabled) {
      lastTrackedPage.current = null;
      return;
    }

    initializeGoogleAnalytics();

    const frame = window.requestAnimationFrame(() => {
      const pagePath = currentPagePath();
      if (lastTrackedPage.current === pagePath) return;

      window.gtag?.("event", "page_view", {
        page_location: window.location.href,
        page_path: pagePath,
        page_title: document.title,
      });
      lastTrackedPage.current = pagePath;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [analyticsEnabled, location]);

  return null;
}