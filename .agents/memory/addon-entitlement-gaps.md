---
name: Add-on server enforcement gaps
description: Which sold add-ons have real server-side gates vs. just DB flags
---

## Rule
Only 4 add-on keys have verified server-side enforcement via planGate middleware:
- whiteLabel → requireWhiteLabel (planGate.ts:169)
- customDomain → white-label route test confirmed
- ssoEnterprise → requireSSO/requireSAML (planGate.ts:164-165)
- crmIntegration → requireCRM (planGate.ts:167)
- aiCreditsPack* → enforced via ai_monthly_usage.credits_extra on every /ai/* route

Quantity add-ons (monitorsPack10/50, auditsPack200/1000, extraSeats, gbpSlots10, pdfPack200, exportsPack1000)
expose limits via /api/me but monitors.ts POST and audits.ts POST do NOT enforce the quota at creation time.

25 other add-ons (globalMonitoring, slaMonitoring, advancedSeoLab, etc.) have no API consumer at all.

**Why:** Add-on entitlement was designed as "expose limits, let frontend enforce" for most keys.
The only hard gates are where a specific middleware was wired (planGate.ts aliases).

**How to apply:** Before selling/promoting a new add-on, verify whether a requireFeature/addon gate
exists in the relevant route. If not, the purchase changes DB state but the feature is unblocked
server-side. Quantity add-ons need a quota check in the relevant POST route using limits from /api/me.
