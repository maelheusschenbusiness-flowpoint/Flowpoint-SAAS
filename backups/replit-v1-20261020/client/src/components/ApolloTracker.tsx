import { useEffect, useState } from "react";
import { useLocation } from "wouter";

const APOLLO_BOOTSTRAP_ID = "flowpoint-apollo-tracker-bootstrap";
const APOLLO_TRACKER_SRC = "https://assets.apollo.io/micro/website-tracker/tracker.iife.js";
const CONSENT_STORAGE_KEY = "cookie_consent";
const CONSENT_CHANGE_EVENT = "flowpoint-cookie-consent-change";

declare global {
  interface Window {
    __flowpointApolloTrackerInitialized?: boolean;
  }
}

// Official Apollo Website Visitor Tracker script supplied for FlowPoint.
const APOLLO_OFFICIAL_SCRIPT = `function initApollo(){var n=Math.random().toString(36).substring(7),o=document.createElement("script");
o.src="https://assets.apollo.io/micro/website-tracker/tracker.iife.js?nocache="+n,o.async=!0,o.defer=!0,
o.onload=function(){window.trackingFunctions.onLoad({appId:"6a6f40562eb92000180dc1c4"})},
document.head.appendChild(o)}initApollo();`;

function hasAnalyticsConsent() {
  return window.localStorage.getItem(CONSENT_STORAGE_KEY) === "accepted";
}

function injectApolloTracker() {
  if (window.__flowpointApolloTrackerInitialized) return;

  const bootstrapAlreadyAdded = document.getElementById(APOLLO_BOOTSTRAP_ID);
  const trackerAlreadyAdded = document.querySelector(`script[src^="${APOLLO_TRACKER_SRC}"]`);
  if (bootstrapAlreadyAdded || trackerAlreadyAdded) {
    window.__flowpointApolloTrackerInitialized = true;
    return;
  }

  const bootstrap = document.createElement("script");
  bootstrap.id = APOLLO_BOOTSTRAP_ID;
  bootstrap.textContent = APOLLO_OFFICIAL_SCRIPT;
  document.head.appendChild(bootstrap);
  window.__flowpointApolloTrackerInitialized = true;
}

function stopApolloTracker() {
  document.getElementById(APOLLO_BOOTSTRAP_ID)?.remove();
  document
    .querySelectorAll(`script[src^="${APOLLO_TRACKER_SRC}"]`)
    .forEach((script) => script.remove());
  window.__flowpointApolloTrackerInitialized = false;
}

export function ApolloTracker() {
  const [location] = useLocation();
  const [trackingEnabled, setTrackingEnabled] = useState(false);

  useEffect(() => {
    const syncConsent = () => {
      const accepted = hasAnalyticsConsent();
      setTrackingEnabled(accepted);
      if (!accepted) stopApolloTracker();
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
    if (trackingEnabled) {
      injectApolloTracker();
    } else {
      stopApolloTracker();
    }
  }, [trackingEnabled, location]);

  return null;
}