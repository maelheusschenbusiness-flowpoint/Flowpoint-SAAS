(() => {
  "use strict";

  const CONSENT_COOKIE = "fp_analytics_consent";
  const VISITOR_KEY = "fp_funnel_visitor_id";
  const ALLOWED_SOURCES = new Set(["smartlead", "google", "direct", "social", "other_campaign"]);
  const TRACKED_API_PATHS = new Set([
    "/api/auth/pre-register",
    "/api/public/checkout-session",
    "/api/public/payment-intent",
  ]);

  function hasConsent() {
    return document.cookie.split(";").some((part) =>
      part.trim() === `${CONSENT_COOKIE}=accepted`,
    );
  }

  function visitorId() {
    if (!hasConsent()) return null;
    try {
      const previous = localStorage.getItem(VISITOR_KEY);
      if (previous) return previous;
      const value = crypto.randomUUID();
      localStorage.setItem(VISITOR_KEY, value);
      return value;
    } catch {
      return null;
    }
  }

  function source() {
    const raw = new URLSearchParams(location.search).get("utm_source");
    return raw && ALLOWED_SOURCES.has(raw) ? raw : "direct";
  }

  function send(step) {
    const id = visitorId();
    if (!id) return;
    void window.fetch("/api/public/funnel-event", {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ etape: step, visiteurId: id, source: source() }),
    }).catch(() => {});
  }

  const pathname = location.pathname.toLowerCase();
  if (pathname === "/") send("landing_vue");
  if (pathname.endsWith("/pricing.html")) send("tarifs_vus");
  if (pathname.endsWith("/checkout.html")) send("signup_started");

  if (pathname.endsWith("/pricing.html")) {
    document.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("a,button") : null;
      if (!target) return;
      const href = target instanceof HTMLAnchorElement ? target.getAttribute("href") || "" : "";
      if (/checkout|signup/i.test(href) || target.matches("[data-funnel-cta]")) {
        send("cta_clique");
      }
    });
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    if (!hasConsent() || typeof input !== "string" || typeof init.body !== "string") {
      return originalFetch(input, init);
    }
    let url;
    try {
      url = new URL(input, location.href);
    } catch {
      return originalFetch(input, init);
    }
    if (!TRACKED_API_PATHS.has(url.pathname)) return originalFetch(input, init);

    try {
      const body = JSON.parse(init.body);
      const id = visitorId();
      if (id && body && typeof body === "object" && !Array.isArray(body)) {
        init = {
          ...init,
          credentials: "include",
          body: JSON.stringify({ ...body, visiteurId: id, source: source() }),
        };
      }
    } catch {
      // Leave non-JSON or malformed requests unchanged.
    }
    return originalFetch(input, init);
  };
})();
