---
name: Google Maps server key state
description: GOOGLE_MAPS_API_KEY currently holds the referer-restricted browser key; all backend Maps REST calls fail REQUEST_DENIED until a real server key is provided
---

# Google Maps server key — current state (2026-08-11)

**Rule:** backend code is correct and canonical — every server-side Maps call (Geocoding, Nearby, Place Details, Photos, Distance Matrix) reads only `GOOGLE_MAPS_API_KEY`; `GOOGLE_MAPS_PUBLIC_KEY` is frontend-only via `/api/maps/config`. Do NOT change the code when Maps backend calls fail.

**Why:** the secret `GOOGLE_MAPS_API_KEY` currently contains the *same value* as the public browser key, which is HTTP-referer-restricted. Google rejects all REST calls with `REQUEST_DENIED: "API keys with referer restrictions cannot be used with this API"`. The fix is a new unrestricted-referer server key in Google Cloud (API-restricted only), then update the secret — no code change.

**How to apply:**
- Backend Maps endpoints returning "Address not found" / "Place not found" / 0 results / REQUEST_DENIED → check the raw Google status first; it's the key, not the code.
- IP restriction on the server key is BLOCKED on Replit: Autoscale/Reserved VM have no guaranteed static egress IP (confirmed via Replit docs). Restrict by API only.
- Nominatim fallback in local-maps-service.ts is opt-in via `ALLOW_NOMINATIM_FALLBACK=true` (off by default); failure logs `[local-maps] Google geocoding rejected...` with googleStatus, never the key value.
- `org_settings` location columns are `address`, `city`, `latitude`, `longitude` (NOT business_address); local-maps geocodes when lat/lng NULL and caches back.
- `POST /api/org/geocode` (routes/location.ts) still calls Nominatim directly — known inconsistency, follow-up task filed.
