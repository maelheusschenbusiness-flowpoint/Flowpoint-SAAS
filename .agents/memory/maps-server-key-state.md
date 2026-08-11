---
name: Maps server key state
description: Current key wiring — FLOWPOINT_MAP_BACKEND is the server key, aliased to GOOGLE_MAPS_API_KEY at startup; GOOGLE_MAPS_PUBLIC_KEY is browser-only and referer-restricted
---

# Maps key wiring (since 2026-08-11)

- `FLOWPOINT_MAP_BACKEND` = the real **server** key (unrestricted / IP-restricted). At startup, `index.ts` aliases it into `process.env.GOOGLE_MAPS_API_KEY` (FLOWPOINT_MAP_BACKEND takes priority), so all backend services keep consuming `GOOGLE_MAPS_API_KEY` unchanged.
- `GOOGLE_MAPS_PUBLIC_KEY` = the **browser** key, referer-restricted, served only via `/api/maps/config`. Never used server-side for REST calls.
- All 6 backend Maps surfaces certified live 2026-08-11: Geocoding, Nearby, Place Details, Photos proxy, Distance Matrix, Local SEO geocode (`local-maps-service.ts`) — all return real Google data with the server key.
- `POST /api/org/geocode` now uses Google primary; Nominatim only when `ALLOW_NOMINATIM_FALLBACK=true` (explicit error otherwise).

**Why:** old state had a single referer-restricted key breaking all backend REST calls (REQUEST_DENIED). Split keys fix that permanently.

**How to apply:** never log key values; startup logs presence only. Browser map failures on `*.replit.dev` are `RefererNotAllowedMapError` — a Google Cloud Console allowlist issue on the PUBLIC key, not a code bug.
