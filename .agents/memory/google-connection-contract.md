---
name: Google connection & site-ownership invariants
description: Durable rules for GA4/GSC/GBP connected state and Google resource authorization
---

# Google connection & site-ownership invariants

**Rule 1 — connection state is backend-only.** The frontend must read the per-product connected flags from the backend status endpoints. Data presence (nonempty listings, rows, arrays) is NEVER connection evidence, and connected-with-no-data must render as "no data", not a connect prompt.

**Why:** treating nonempty data as "connected" produced both false connect prompts and false connected badges depending on sync timing.

**Rule 2 — row presence is not ownership.** Any Google resource identifier a request ends up using (caller override OR stored active default) must have verified provenance: either it was written from Google's own listing for the org's token, or it passes a live token check at request time. Fail closed: unverifiable rows are quarantined and rejected before any Google data call. This applies to background/sync paths too, not just user-facing routes.

**Why:** an ownership table that accepts caller input (or contains pre-gate legacy rows) lets a tenant query arbitrary third-party properties with the org's token.

**How to apply:** any new route or job that accepts or resolves a Google property/site/location must prove token-verified ownership first, and reused stored rows must carry provenance or be re-verified — never trusted because they exist.
