---
name: Add-on catalogue — single source of truth
description: Where add-on names/prices/billing-type legitimately live, and why every other table must derive from it
---

# Canonical add-on catalogue

`ADDON_DEFINITIONS` in `api-server/src/lib/plans.ts` is the ONLY place an add-on
name, description, `priceEur`, `oneTime` or `quantity` may be stated.
Stripe collection is driven by `ADDON_PRICE_IDS` in the same file; the two must
stay key-aligned — an add-on exposed publicly with no entry in `ADDON_PRICE_IDS`
cannot be collected at checkout.

Every other surface must DERIVE:
- the public catalogue served by `GET /api/billing/plans`
- the display map used by the add-ons service
- the PaymentIntent amount computation for pre-registration checkout

**Why:** parallel hand-maintained tables silently drift into "displayed X /
charged Y" bugs. Two were found live in one audit: an add-on advertised at 14 €
while the canonical price billed 35 €, and a catalogue entry whose id existed in
no price-id map at all (so it displayed a price but could never be charged).
Neither was caught by tests because each table was internally consistent.

**How to apply:** when adding or repricing an add-on, edit `ADDON_DEFINITIONS`
only. If a surface needs presentation-only extras (icon, unit label, colour),
keep a separate map holding *just* those fields, keyed by the canonical add-on
key, and join it to `ADDON_DEFINITIONS` at module load — never copy the price or
the name into it. Log and omit unknown keys rather than falling back to a
hardcoded default, so a typo surfaces instead of inventing a price.
