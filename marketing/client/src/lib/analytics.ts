export type AnalyticsData = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: {
      track(name: string, data?: AnalyticsData): void;
    };
  }
}

export function trackEvent(name: string, data?: AnalyticsData): void {
  if (typeof window === "undefined") return;

  try {
    const localConsent = window.localStorage.getItem("cookie_consent") === "accepted";
    const cookieConsent =
      typeof document !== "undefined" &&
      document.cookie.split(";").some((cookie) => cookie.trim() === "fp_analytics_consent=accepted");
    if (!localConsent && !cookieConsent) return;
    window.umami?.track(name, data);
  } catch {
    // Analytics must never break the app.
  }
}

export function trackSignupCta(
  location: string,
  data?: AnalyticsData,
): void {
  trackEvent("signup_cta_clicked", { ...data, location });
}