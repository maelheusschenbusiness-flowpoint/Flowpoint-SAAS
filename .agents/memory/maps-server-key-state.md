---
name: Maps server key state
description: Current key wiring — FLOWPOINT_MAP_BACKEND is the server key, aliased to GOOGLE_MAPS_API_KEY at startup; GOOGLE_MAPS_PUBLIC_KEY is browser-only and referer-restricted
---

# Maps key wiring (since 2026-08-11, re-certified 2026-08-12)

- `FLOWPOINT_MAP_BACKEND` = the real **server** key (unrestricted / IP-restricted). At startup, `index.ts` aliases it into `process.env.GOOGLE_MAPS_API_KEY` (FLOWPOINT_MAP_BACKEND takes priority), so all backend services keep consuming `GOOGLE_MAPS_API_KEY` unchanged. Still REQUIRED as of 2026-08-12: the raw `GOOGLE_MAPS_API_KEY` secret equals `GOOGLE_MAPS_PUBLIC_KEY` (referer-restricted), so removing FLOWPOINT_MAP_BACKEND would break all backend REST calls. To retire it, the user must first paste the server key value into the `GOOGLE_MAPS_API_KEY` secret itself.
- `GOOGLE_MAPS_PUBLIC_KEY` = the **browser** key, referer-restricted, served only via `/api/maps/config`. Never used server-side for REST calls.
- All 6 backend Maps surfaces re-certified live 2026-08-12 on BOTH local and production (app.flowpoint.pro, same commit): Geocoding, Nearby, Place Details, Photos proxy, Distance Matrix, Local SEO geocode — real Google data.
- Photo proxy: Google `photo_reference` values run 644-671 chars; the `/maps/photo` ref length guard is 1000 (was 600, silently 400'd every Nearby ref).
- `POST /api/org/geocode` uses Google primary; Nominatim only when `ALLOW_NOMINATIM_FALLBACK=true` (explicit error otherwise).
- Production env gap 2026-08-12: Render deployment has NO `GOOGLE_MAPS_PUBLIC_KEY` (`/api/maps/config` → configured:false, missingBrowserKey:true), so prod shows the intentional "Carte non configurée" card. Browser key must be added to Render env.
- `SUPABASE_URL` in the workspace already ends with `/rest/v1` — do not append it again in PostgREST calls.

**Why:** old state had a single referer-restricted key breaking all backend REST calls (REQUEST_DENIED). Split keys fix that permanently.

**How to apply:** never log key values; startup logs presence only. Browser map failures on `*.replit.dev` are `RefererNotAllowedMapError` — a Google Cloud Console allowlist issue on the PUBLIC key (the dev domain must be allowlisted), not a code bug.
