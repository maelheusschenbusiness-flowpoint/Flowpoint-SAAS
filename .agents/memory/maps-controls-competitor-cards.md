---
name: Maps controls & competitor cards
description: Durable rules for Google Maps controls, ownership, async centering, competitor cards, and local QA
---

# Google Maps — durable lessons

## Control configuration

The newer Maps renderer ships a camera widget with embedded zoom buttons. To
remove the +/- controls, set `zoomControl:false`, `cameraControl:false`, and
`rotateControl:false` together. Keep `fullscreenControl:true`.

When enabling map type controls, guard `google.maps.ControlPosition` and
`MapTypeControlStyle` before dereferencing them because async bootstrap can
leave those enums undefined and crash map initialization. The supported map
types are roadmap, satellite, and terrain.

## Ownership and rendering

Two initialization paths must never race for the same map container. Route-gate
the owners so each sub-page has exactly one initializer.

Never trigger a full SPA re-render from a map data callback: it replaces the
container, orphans the live map, and can make the re-init observer loop forever.
Draw on the live map; let lists update through their own render path.

Any circle or marker mutated by public controls (radius selectors, toggles) must
be stored on the map instance at creation, otherwise controls create duplicates
instead of updating the existing shape.

## Saved-address centering and async layers

Resolve the business center from saved `STATE.me.location` coordinates first,
then dataset coordinates, then the fallback location. If only an address is
saved, geocode it and re-center the map, marker, and circle.

Do not load data layers at a temporary center while saved-address geocoding is
pending. Defer loads until the center resolves and version each layer request
per map instance so stale responses are discarded. This prevents a slower
temporary-center response from overwriting the correct saved-address result.

## Dark controls and competitor cards

Google's native controls and InfoWindows render with white chrome by default.
Inject dark CSS once per page, scoped to the map containers, covering
`.gm-style-mtc`, `.gm-fullscreen-control`, `.gm-style-cc`, and `.gm-style-iw*`.
Skip this injection in light theme.

Render competitor cards immediately from Nearby Search fields. On marker click,
upgrade the card with Place Details and photo-proxy data such as exact rating,
open/closed status, phone, and website. Never fetch details for every marker
up front. Forward the search keyword to Nearby Search so markers match the
selected sector.

## Local QA ceiling

The browser key is production-referer-restricted, so tiles and native controls
do not render reliably on localhost (`RefererNotAllowedMapError` is expected).
Local validation means the map object is created, attached, centered, and the
page has no errors. Tile, control, and card certification must run against
production with a minted session; race tests can stub routes with controlled
delays.
