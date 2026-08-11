---
name: Maps browser key boundary
description: Only dedicated browser keys may reach the browser via /maps/config; server Maps keys never
---

# Google Maps browser key boundary

**Rule:** `/api/maps/config` may ONLY serialize `GOOGLE_MAPS_PUBLIC_KEY ?? GOOGLE_MAPS_BROWSER_KEY`. `GOOGLE_MAPS_API_KEY` and `GOOGLE_API_KEY` are server-side bearer credentials (Geocoding/Places/Distance Matrix/photo proxy) and must NEVER be sent to the browser — any API enabled on the key travels with it; "Maps-scoped" is not an enforceable boundary and a referrer restriction is only a recommendation. A fallback to the server key was attempted once and rejected in code review as a credential-exposure regression.

**How to apply:** if no browser key is configured, return `apiKey:""` + `missingBrowserKey:true` and let the frontend show the visible "Carte non configurée" error card instructing the user to create a referrer-restricted Maps JS key as `GOOGLE_MAPS_PUBLIC_KEY`.

**Frontend error states (fp-backend.js `FP_MAPS_API`):** `_showMapError(title, detail)` replaces `#fp-gmap-skeleton` / `#fp-competitors-map-skeleton` content. Triggered on: no key from config (init + MutationObserver `self._key === ''` path), script `onerror`, and `window.gm_authFailure` (key rejected by Google).

**GA4 loaders:** `_fpLoadWatchdog(stateName, ms=20000)` in dashboard.js forces `{loading:false, error}` + render() for the six sub-page states (`_fpAnalyticsState`, `_fpTrafficState`, `_fpCampaignsState`, `_fpAudienceState`, `_fpConversionState`, `_fpLiveState`) — no skeleton can hang forever.
