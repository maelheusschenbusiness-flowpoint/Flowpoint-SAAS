---
name: Maps JS double injection
description: Two loaders (dashboard.js loadGoogleMaps + fp-backend.js FP_MAPS_API.loadScript) must never both inject the Maps script
---

# Google Maps JS API double injection breaks google.maps

Both `dashboard.js` (`loadGoogleMaps`) and `fp-backend.js` (`FP_MAPS_API.loadScript`) can inject `maps.googleapis.com/maps/api/js`. If both fire, the second load resets the namespace mid-flight → `google.maps.Map is not a constructor`, plus "You have included the Google Maps JavaScript API multiple times" warnings and dead maps.

**Why:** two independent map systems (Local SEO map vs FP_MAPS_API heatmaps) each own a loader; SPA navigation can trigger both in one page life.

**How to apply:** before injecting, both loaders check `document.querySelector('script[src*="maps.googleapis.com/maps/api/js"]')`; if present, poll for `google.maps.Map` instead of adding a second script tag. Keep this guard in BOTH files whenever loaders are touched.
