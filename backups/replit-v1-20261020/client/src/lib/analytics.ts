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
    if (window.localStorage.getItem("cookie_consent") !== "accepted") return;
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