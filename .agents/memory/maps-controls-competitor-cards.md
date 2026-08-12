---
name: Google Maps in Local SEO — durable lessons
description: Control flags, dual-owner container conflicts, async-center races, re-render destruction, local QA ceiling
---

# Google Maps — durable lessons

**Zoom-button removal:** the newer Maps renderer ships a camera widget with its own +/- — set `zoomControl:false` AND `cameraControl:false` AND `rotateControl:false` together. Guard enum objects (`ControlPosition` etc.) before dereferencing under async bootstrap.

**One container, one owner:** two init paths (legacy demo-marker init vs the real-data map module) can race for the same map div via cross-guard flags; whoever runs first wins and the loser's data never shows. Rule: route-gate the owners so each sub-page has exactly one initializer.

**Never trigger a full SPA re-render from a map data callback:** it replaces the container div, orphans the live map (`map.getDiv() !== current el`), and the re-init observer loops the load forever. Draw on the live map; lists pick up shared state on their own next render.

**Async center resolution must gate layer loads:** when the real center arrives asynchronously (geocoding a saved address), do NOT load data layers at a temporary center first — a slow temporary-center response resolving last overwrites correct data. Defer loads until the center resolves AND version every layer request per map instance so stale responses are dropped. **Why:** saved user address must beat GBP/dataset coords; normal latency ordering makes the race real, not theoretical.

**Shared shapes live on the instance:** any circle/marker that public controls (radius selector, toggles) mutate must be stored on the map instance at creation, or controls spawn duplicates instead of updating.

**Dark InfoWindows:** chrome is white by default; override `.gm-style-iw*` scoped to the container. Enrich competitor cards with Place Details only on marker click (photo via server proxy), never for all markers upfront.

**Local QA ceiling:** the browser key is production-referer-restricted, so tiles/native controls never render on localhost (RefererNotAllowedMapError is expected). Local pass = instance created + attached + centered + no page errors; tile/control/card certification must run against production with a minted session. When testing races locally, stub the network routes with controlled delays.
