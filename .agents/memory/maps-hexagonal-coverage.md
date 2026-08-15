---
name: Maps hexagonal coverage formula
description: The correct formula for full-disk competitor search using the Google Places API 50km hard limit per request.
---

# Maps hexagonal coverage formula

## Problem
Google Places nearbySearch is capped at 50 km per request. To cover a 100 km disk, a single search is insufficient. A 5-point cardinal grid (center + N/S/E/W) leaves diagonal corners uncovered.

## Solution: 7-point hexagonal grid
Center + 6 surrounding points at `ring_radius = R × √3/2`.

**Proof:** For ring radius = R√3/2 and 6 points at 60° intervals, the worst-case point is on the R perimeter at 30° from the nearest ring point. By law of cosines:
```
d² = (R√3/2)² + R² − 2·(R√3/2)·R·cos(30°)
   = 3R²/4 + R² − 2·(R√3/2)·R·(√3/2)
   = 3R²/4 + R² − 3R²/2
   = R²/4  →  d = R/2
```
So for R=100 km, d = 50 km exactly. Every point in the disk is within 50 km of at least one of the 7 centres.

## Implementation (maps-service.ts)
```typescript
const RING_M = EFF_RADIUS * Math.sqrt(3) / 2;
const cosLat = Math.max(0.3, Math.cos(lat * Math.PI / 180));
const centres = [{ lat, lng }]; // center
if (EFF_RADIUS > 50000) {
  for (let i = 0; i < 6; i++) {
    const ang = (i * Math.PI) / 3;
    centres.push({
      lat: lat + (RING_M / 111_000) * Math.sin(ang),
      lng: lng + (RING_M / (111_000 * cosLat)) * Math.cos(ang),
    });
  }
}
// Promise.all all centres, deduplicate by placeId, filter to EFF_RADIUS, sort by distance
```

## Route cap
`maps.ts`: `Math.min(100000, radius)` — allows up to 100 km from the route handler.
