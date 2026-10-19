(() => {
  "use strict";

  const CONSENT_COOKIE = "fp_analytics_consent";
  const VISITOR_KEY = "fp_funnel_visitor_id";
  const VISITOR_COOKIE = "fp_visitor_id";
  const SOURCE_KEY = "fp_funnel_source";
  const SOURCE_COOKIE = "fp_source";
  const VISITOR_ID_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|fp-[a-z0-9]+-[a-z0-9]+)$/i;
  const ALLOWED_SOURCES = new Set(["smartlead", "google", "direct", "social", "other_campaign"]);
  const APP_ORIGIN = "https://app.flowpoint.pro";
  const TRACKED_API_PATHS = new Set([
    "/api/auth/pre-register",
    "/api/public/checkout-session",
    "/api/public/payment-intent",
  ]);

  function cookieValue(name) {
    const prefix = `${name}=`;
    const part = document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix));
    if (!part) return null;
    try { return decodeURIComponent(part.slice(prefix.length)); } catch { return null; }
  }

  function setSharedCookie(name, value) {
    const host = location.hostname.toLowerCase();
    const domain = host === "flowpoint.pro" || host.endsWith(".flowpoint.pro")
      ? "; Domain=.flowpoint.pro"
      : "";
    document.cookie = `${name}=${encodeURIComponent(value)}${domain}; Path=/; Max-Age=15552000; SameSite=Lax; Secure`;
  }

  function hasConsent() {
    return cookieValue(CONSENT_COOKIE) === "accepted";
  }

  function visitorId() {
    if (!hasConsent()) return null;
    try {
      const params = new URLSearchParams(location.search);
      const handedOff = params.get("fp_vid") || params.get("fp_visitor_id");
      const candidates = [handedOff, cookieValue(VISITOR_COOKIE), localStorage.getItem(VISITOR_KEY)];
      const value = candidates.find((candidate) => typeof candidate === "string" && VISITOR_ID_RE.test(candidate))
        || crypto.randomUUID();
      localStorage.setItem(VISITOR_KEY, value);
      setSharedCookie(VISITOR_COOKIE, value);
      return value;
    } catch {
      return null;
    }
  }

  function source() {
    if (!hasConsent()) return null;
    const params = new URLSearchParams(location.search);
    let stored = null;
    try { stored = localStorage.getItem(SOURCE_KEY); } catch {}
    const raw = params.get("fp_source") || params.get("utm_source") || cookieValue(SOURCE_COOKIE) || stored;
    const value = raw && ALLOWED_SOURCES.has(raw) ? raw : "direct";
    try { localStorage.setItem(SOURCE_KEY, value); } catch {}
    setSharedCookie(SOURCE_COOKIE, value);
    return value;
  }

  function carryAttributionToAppLink(anchor) {
    if (!hasConsent()) return;
    try {
      const url = new URL(anchor.href, location.href);
      if (url.hostname.toLowerCase() !== "app.flowpoint.pro") return;
      const id = visitorId();
      if (!id) return;
      url.searchParams.set("fp_vid", id);
      const attributionSource = source();
      if (attributionSource) url.searchParams.set("fp_source", attributionSource);
      anchor.href = url.toString();
    } catch {}
  }

  function send(step) {
    const id = visitorId();
    if (!id) return;
    const endpoint = location.hostname === "flowpoint.pro" || location.hostname === "www.flowpoint.pro"
      ? `${APP_ORIGIN}/api/public/funnel-event`
      : "/api/public/funnel-event";
    void window.fetch(endpoint, {
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
      if (target instanceof HTMLAnchorElement) carryAttributionToAppLink(target);
      const href = target instanceof HTMLAnchorElement ? target.getAttribute("href") || "" : "";
      if (/checkout|signup/i.test(href) || target.matches("[data-funnel-cta]")) {
        send("cta_clique");
      }
    });
  }

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (target instanceof HTMLAnchorElement) carryAttributionToAppLink(target);
  });

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
