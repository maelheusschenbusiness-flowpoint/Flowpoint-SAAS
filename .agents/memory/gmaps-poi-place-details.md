---
name: Google Maps key separation & POI behavior
description: Durable rules for Maps keys and POI popups in FlowPoint
---

- The server-side Places/Geocoding key (`GOOGLE_MAPS_API_KEY`) must NEVER be returned to the browser. The Maps JS SDK uses a separate, referrer-restricted public key (`GOOGLE_MAPS_PUBLIC_KEY`). If the public key is unset, the map shows its "not configured" state while server-side Maps features keep working.
- Google base-map POI clicks expose `ev.placeId`; call `ev.stop()` to suppress Google's native white InfoWindow and render a custom dark one instead. Place details/photos are fetched through server proxies so the secret key stays server-side.
- `audit_schedules.next_run`/`created_at` are bigint epoch ms — pg returns digit strings; never `new Date(row.next_run)` directly, parse `/^\d+$/` → Number first.

**Why:** the secret key was previously leaked via a config endpoint (review-blocked), and users saw jarring white Google popups in the dark UI.
**How to apply:** any new map surface or Maps endpoint must respect the public/secret key split and use the POI stop-and-proxy pattern.
