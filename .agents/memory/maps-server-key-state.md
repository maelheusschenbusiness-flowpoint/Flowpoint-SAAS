---
name: Maps server key state
description: Final key wiring — GOOGLE_MAPS_API_KEY is the server key, GOOGLE_MAPS_PUBLIC_KEY the browser key; FLOWPOINT_MAP_BACKEND alias removed from code
---

# Maps key wiring (final, certified 2026-08-12)

- `GOOGLE_MAPS_API_KEY` = the **server** key (API-restricted, no referer restriction). Read directly by all backend Maps services. On Render this is the distinct server credential set by the user 2026-08-12.
- `GOOGLE_MAPS_PUBLIC_KEY` = the **browser** key, referer-restricted to app.flowpoint.pro, served ONLY via `/api/maps/config`. Never used server-side.
- The `FLOWPOINT_MAP_BACKEND` startup alias was REMOVED from `index.ts` (commit on Test-Replit, deployed). The secret may still exist in envs but nothing reads it; safe to delete.
- **Local workspace caveat:** the local `GOOGLE_MAPS_API_KEY` secret still equals the referer-restricted public key, so backend REST Maps calls FAIL locally (REQUEST_DENIED/404). This is NOT a production failure — production has the distinct key. To fix locally, paste the server key value into the local `GOOGLE_MAPS_API_KEY` secret.
- Photo proxy: Google `photo_reference` values run 400-700 chars; ref length guard is 1000.
- `POST /api/maps/distance` (singular) takes `{origins:["lat,lng"],destinations:["lat,lng"]}` string arrays; response is raw Google shape under `results.rows[0].elements[0]`.
- `SUPABASE_URL` in the workspace already ends with `/rest/v1` — do not append it again in PostgREST calls. `user_sessions` insert needs `user_id` (NOT NULL) in addition to `user_id_v2`.

## Frontend NaN-guard pattern (certified)
Every LatLng construction site in dashboard.js/fp-backend.js validates with `Number.isFinite(Number(v))` before building `{lat,lng}`:
- dashboard.js `initLocalSEOMap`: `_num()` helper for STATE.me.location + `_lastUserLat/Lng`; competitor list `.filter(finite)` before markers; `renderLocalSEOMap`/`renderCompetitorsMap` defLat/defLng finite-or-Paris.
- fp-backend.js `FP_MAPS_API._finite(v, fallback)` for dataset lat/lng; competitor + heatmap arrays filtered; `searchAddress` geocode result validated.
Invalid/absent coords → geocoding fallback or explicit empty state; never a NaN LatLng.

**Why:** raw Nearby Search results carried nested `geometry.location` while the frontend read flat `c.lat/c.lng` → `Marker.setPosition(NaN)` → InvalidValueError + broken map. Backend now flattens AND frontend now guards (two-layer defence).

**How to apply:** any new Maps surface must (1) consume flat, finite lat/lng from the backend, (2) filter/validate before Map/Marker/Circle/LatLng construction. Browser map failures on `*.replit.dev` are `RefererNotAllowedMapError` — a Google Cloud Console allowlist issue on the PUBLIC key, not a code bug.
