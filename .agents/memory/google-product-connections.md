---
name: Google per-product connection semantics
description: Behavioral rules for GBP/GA4/GSC connect, disconnect, and status
---
Rules:
- One shared Google token covers GBP+GA4+GSC, so connected/disconnected state is per-product flags, not token presence alone.
- A successful OAuth (re)connect must reset all product flags to connected; otherwise a prior per-product disconnect makes the reconnect invisible.
- Selecting a product resource (GA4 property, GSC site) re-enables that product's flag.
- Org resolution must be identical across all Google routes (orgContext first, never a silent 'default' bucket).
**Why:** mismatched org buckets and token-presence-only checks caused "connected" state to vanish on refresh and made per-product disconnect impossible.
**How to apply:** any new Google-scoped feature or status surface must honor the per-product flags and the shared org resolver.
