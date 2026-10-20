import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  addFunnelAttributionToSignupLink,
  clearFunnelIdentity,
  getFunnelSource,
  getFunnelVisitorId,
  hasFunnelConsent,
  isLikelyHumanPageView,
  sendFunnelEvent,
} from "@/lib/funnel-tracking";

const CONSENT_CHANGE_EVENT = "flowpoint-cookie-consent-change";
const HUMAN_VISIT_DELAY_MS = 1_500;
const PRICING_VISIBLE_PIXELS = 120;

export function FunnelTracking() {
  const [location] = useLocation();
  const [consented, setConsented] = useState(false);

  useEffect(() => {
    const syncConsent = () => {
      const accepted = hasFunnelConsent();
      setConsented(accepted);
      if (!accepted) clearFunnelIdentity();
    };

    syncConsent();
    window.addEventListener(CONSENT_CHANGE_EVENT, syncConsent);
    window.addEventListener("storage", syncConsent);
    return () => {
      window.removeEventListener(CONSENT_CHANGE_EVENT, syncConsent);
      window.removeEventListener("storage", syncConsent);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const schedulePageEvent = () => {
      if (!consented || !isLikelyHumanPageView()) return;

      const path = window.location.pathname;
      if (path !== "/" && path !== "/tarifs") return;

      timer = window.setTimeout(() => {
        if (cancelled || !isLikelyHumanPageView()) return;
        sendFunnelEvent(path === "/" ? "landing_vue" : "tarifs_vus");
      }, HUMAN_VISIT_DELAY_MS);
    };

    schedulePageEvent();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [consented, location]);

  useEffect(() => {
    const handleSignupClick = (event: MouseEvent) => {
      if (event.type === "auxclick" && event.button !== 1) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;

      const url = new URL(anchor.href, window.location.href);
      const isAppLink =
        url.origin === "https://app.flowpoint.pro" ||
        (import.meta.env.DEV && url.origin === "https://flowpoint-test.onrender.com");
      if (!isAppLink) return;

      const originalHref = anchor.href;
      addFunnelAttributionToSignupLink(anchor);
      const attributedHref = anchor.href;
      sendFunnelEvent("cta_clique");

      if (attributedHref !== originalHref) {
        // A React rerender may restore the original href after this event.
        // Navigate using the consented URL captured before that can happen.
        event.preventDefault();
        const target = anchor.target || "_self";
        if (target === "_self") {
          window.location.assign(attributedHref);
        } else {
          window.open(attributedHref, target, "noopener,noreferrer");
        }
      }
    };

    // Run after React's target-level handlers so a component rerender cannot
    // overwrite the attributed href before the browser follows it.
    document.addEventListener("click", handleSignupClick);
    document.addEventListener("auxclick", handleSignupClick);
    return () => {
      document.removeEventListener("click", handleSignupClick);
      document.removeEventListener("auxclick", handleSignupClick);
    };
  }, []);

  useEffect(() => {
    if (window.location.pathname !== "/" || !consented || !isLikelyHumanPageView()) {
      return;
    }

    const section = document.getElementById("pricing");
    if (!section || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting && entry.intersectionRect.height >= PRICING_VISIBLE_PIXELS)) {
          sendFunnelEvent("tarifs_vus");
          observer.disconnect();
        }
      },
      { threshold: 0 },
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, [consented, location]);

  // Warm the source and anonymous identity only after consent; never include raw UTMs.
  useEffect(() => {
    if (consented) {
      getFunnelSource();
      getFunnelVisitorId();
    }
  }, [consented, location]);

  return null;
}
