---
name: Stripe dahlia refund payloads
description: Stripe API 2026-04-22.dahlia omits key charge and invoice references from webhook payloads.
---

# Stripe 2026-04-22.dahlia refund payloads

**Rule:** Do not assume a `charge.refunded` payload contains `invoice`, `payment_intent`, or an expanded `refunds.data` list. For a charge-level event, use `amount_refunded` rather than the charge's `amount`; resolve the attributed payment from available Stripe IDs first and use the already-resolved organization as the ledger fallback. Retrieve the real refund ID from Stripe when the payload only exposes the charge ID.

**Why:** The live Stripe TEST E2E showed that the dahlia webhook payload omitted those references. Treating the charge amount as the refund amount converted a 50% refund into a 100% commission reversal.

**How to apply:** Keep refund handling idempotent on the real `re_...` refund ID, preserve the append-only ledger, and test both partial refunds and charge-level payloads with unexpanded fields.