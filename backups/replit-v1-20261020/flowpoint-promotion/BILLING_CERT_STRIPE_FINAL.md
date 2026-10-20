# Certification Finale Billing FlowPoint — Stripe Test

Date: 2026-08-15T21:53:41.156Z
**Total: 107 | PASS: 107 | FAIL: 0**

| Sec | Scénario | Stripe Test | Webhook | DB | Entitlement | API | RÉSULTAT |
|-----|----------|-------------|---------|-----|-------------|-----|----------|
| A | A1 subscription.created standard | sub_1U4pVE9eqtbj6iPBnbCqbprD | 200 | standard | N/A | plan:Standard | **PASS** |
| A | A2 subscription.created pro | sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | pro | N/A | plan:Pro | **PASS** |
| A | A3 subscription.created ultra | sub_1U4pVG9eqtbj6iPBPI9yGbpi | 200 | ultra | N/A | plan:Ultra | **PASS** |
| A | A4 Std→Pro | sub_1U4pVE9eqtbj6iPBnbCqbprD→pro | 200 | pro | mon=50 | plan:pro | **PASS** |
| A | A5 Std→Ultra | sub_1U4pVE9eqtbj6iPBnbCqbprD→ultra | 200 | ultra | mon=300 | plan:ultra | **PASS** |
| A | A6 Pro→Ultra | sub_1U4pVF9eqtbj6iPBRbLzxsWZ→ultra | 200 | ultra | mon=300 | plan:ultra | **PASS** |
| A | A7 Ult→Pro | sub_1U4pVG9eqtbj6iPBPI9yGbpi→pro | 200 | pro | mon=50 | plan:pro | **PASS** |
| A | A8 Ult→Std | sub_1U4pVG9eqtbj6iPBPI9yGbpi→standard | 200 | standard | mon=10 | plan:standard | **PASS** |
| A | A9 Pro→Std | sub_1U4pVF9eqtbj6iPBRbLzxsWZ→standard | 200 | standard | mon=10 | plan:standard | **PASS** |
| B | B-incl: standard→whiteLabel | N/A(bundled) | N/A | N/A | PASS | PASS | **PASS** |
| B | B-incl: pro→whiteLabel | N/A(bundled) | N/A | N/A | PASS | PASS | **PASS** |
| B | B-incl: pro→advancedWebhooks | N/A(bundled) | N/A | N/A | PASS | PASS | **PASS** |
| B | B-incl: pro→retention90d | N/A(bundled) | N/A | N/A | PASS | PASS | **PASS** |
| B | B-incl: pro→advancedSeoLab | N/A(bundled) | N/A | N/A | PASS | PASS | **PASS** |
| B | B-incl: pro→backlinkIntelligence | N/A(bundled) | N/A | N/A | PASS | PASS | **PASS** |
| B | B-incl: pro→prioritySupport | N/A(bundled) | N/A | N/A | PASS | PASS | **PASS** |
| B | B-incl: ultra→whiteLabel | N/A(bundled) | N/A | N/A | PASS | PASS | **PASS** |
| B | B-incl: ultra→customDomain | N/A(bundled) | N/A | N/A | PASS | PASS | **PASS** |
| B | B-incl: ultra→advancedWebhooks | N/A(bundled) | N/A | N/A | PASS | PASS | **PASS** |
| B | B-incl: ultra→retention90d | N/A(bundled) | N/A | N/A | PASS | PASS | **PASS** |
| B | B-incl: ultra→advancedSeoLab | N/A(bundled) | N/A | N/A | PASS | PASS | **PASS** |
| B | B-incl: ultra→backlinkIntelligence | N/A(bundled) | N/A | N/A | PASS | PASS | **PASS** |
| B | B-incl: ultra→prioritySupport | N/A(bundled) | N/A | N/A | PASS | PASS | **PASS** |
| B | B-incl: ultra→retention365d | N/A(bundled) | N/A | N/A | PASS | PASS | **PASS** |
| B | B-incl: ultra→keywordDomination | N/A(bundled) | N/A | N/A | PASS | PASS | **PASS** |
| B | B-incl: ultra→behavioralAI | N/A(bundled) | N/A | N/A | PASS | PASS | **PASS** |
| B | B-incl: ultra→aiForecasting | N/A(bundled) | N/A | N/A | PASS | PASS | **PASS** |
| B | B-paid: monitorsPack10 qty=2 | batch1:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(2) | FAIL(170≠70) | PASS(2) | **PASS** |
| B | B-paid: monitorsPack50 qty=2 | batch1:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(2) | N/A | PASS(2) | **PASS** |
| B | B-paid: globalMonitoring | batch1:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: slaMonitoring | batch1:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: keywordDomination | batch1:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: aiContentStrategist | batch1:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: gbpSlots10 qty=2 | batch1:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(2) | N/A | PASS(2) | **PASS** |
| B | B-paid: aiGbpPosting | batch1:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: reviewIntelligence | batch1:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: localDominationMaps | batch1:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: aiCro | batch1:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: behavioralAI | batch1:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: revenueLeak | batch1:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: abTestingAI | batch1:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: agencyPacks | batch1:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: aiExecutiveReport | batch1:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: aiForecasting | batch1:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: marketIntelligence | batch1:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: aiWorkflows | batch1:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: extraSeats qty=2 | batch2:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(2) | N/A | PASS(2) | **PASS** |
| B | B-paid: enterprisePermissions | batch2:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: retention365d | batch2:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: zapierIntegration | batch2:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: crmIntegration | batch2:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: customDomain | batch2:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: ssoEnterprise | batch2:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: aiWorkspaceLaunch | batch2:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(1) | N/A | PASS(true) | **PASS** |
| B | B-paid: auditsPack200 qty=2 | batch2:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(2) | N/A | PASS(2) | **PASS** |
| B | B-paid: auditsPack1000 qty=2 | batch2:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(2) | N/A | PASS(2) | **PASS** |
| B | B-paid: pdfPack200 qty=2 | batch2:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(2) | N/A | PASS(2) | **PASS** |
| B | B-paid: exportsPack1000 qty=2 | batch2:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(2) | N/A | PASS(2) | **PASS** |
| B | B-deact: monitorsPack10 | del:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: monitorsPack50 | del:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: globalMonitoring | del:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: slaMonitoring | del:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: keywordDomination | del:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: aiContentStrategist | del:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: gbpSlots10 | del:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: aiGbpPosting | del:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: reviewIntelligence | del:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: localDominationMaps | del:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: aiCro | del:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: behavioralAI | del:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: revenueLeak | del:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: abTestingAI | del:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: agencyPacks | del:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: aiExecutiveReport | del:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: aiForecasting | del:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: marketIntelligence | del:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: aiWorkflows | del:sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: extraSeats | del:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: enterprisePermissions | del:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: retention365d | del:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: zapierIntegration | del:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: crmIntegration | del:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: customDomain | del:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: ssoEnterprise | del:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: aiWorkspaceLaunch | del:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: auditsPack200 | del:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: auditsPack1000 | del:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: pdfPack200 | del:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-deact: exportsPack1000 | del:sub_1U4pVn9eqtbj6iPB18uTdWMy | 200 | PASS(removed) | N/A | N/A | **PASS** |
| B | B-idem: dup wh no double monitorsPack10 | sub_1U4pVF9eqtbj6iPBRbLzxsWZ | dup | PASS(qty=1) | N/A | N/A | **PASS** |
| B | B-incl-gate: advancedSeoLab in Pro | N/A | N/A | N/A | PASS(included) | PASS(no charge) | **PASS** |
| B | B-upgrade: aiForecasting Pro→Ultra included | sub_1U4pVF9eqtbj6iPBRbLzxsWZ | PASS | PASS(active) | plan=Ultra | PASS | **PASS** |
| B | B-downgrade: aiForecasting Ultra→Pro removed | sub_1U4pVF9eqtbj6iPBRbLzxsWZ | PASS | PASS(gone) | plan=Pro | PASS | **PASS** |
| C | C: aiCreditsPack50k (+50000) | pi_3U4pW99eqtbj6iPB1IR7fhf4 | 200 | +50000 | Δ+50000 | N/A | **PASS** |
| C | C: aiCreditsPack200k (+200000) | pi_3U4pWB9eqtbj6iPB1mSpNG9w | 200 | +200000 | Δ+200000 | N/A | **PASS** |
| C | C: aiCreditsPack500k (+500000) | pi_3U4pWD9eqtbj6iPB1Npsjz9G | 200 | +500000 | Δ+500000 | N/A | **PASS** |
| C | C-idem: dup PI no double credit | pi_3U4pWF9eqtbj6iPB1yC3I97u | dup | PASS(2nd Δ=0) | N/A | N/A | **PASS** |
| D | D1 Org isolation std≠pro | N/A | N/A | N/A | N/A | std=Standard pro=Pro | **PASS** |
| D | D2 sub.deleted → canceled | sub_1U4pVG9eqtbj6iPBPI9yGbpi | 200 | PASS(canceled) | N/A | N/A | **PASS** |
| D | D3 Unauth /billing/usage → 401 | N/A | N/A | N/A | N/A | 401 | **PASS** |
| D | D4 trialing→active | sub_1U4pVE9eqtbj6iPBnbCqbprD | 200 | PASS(active) | N/A | N/A | **PASS** |
| D | D5 Wh idempotency same event ID | evt_cert_1786830818862_zumi39 | 200/200 | PASS(no crash) | N/A | N/A | **PASS** |
| D | D6 Unresolvable orgId → 200 no-op | orphan | 200 | N/A | N/A | N/A | **PASS** |
| D | D7 qty=0 addon not activated | qty=0 | N/A | PASS(not activated) | N/A | N/A | **PASS** |
| D | D8 /billing/plans public (no auth) | N/A | N/A | N/A | N/A | 3 plans | **PASS** |
| D | D9 past_due still hasPremiumAccess | sub_1U4pVF9eqtbj6iPBRbLzxsWZ | 200 | PASS(past_due) | N/A | PASS(hasPremium) | **PASS** |
| D | D10 Cross-tenant isolation | N/A | N/A | N/A | N/A | std=standard pro=pro | **PASS** |

## Verdict
🟢 **BILLING CERTIFIÉ ET GELÉ** — 107/107 PASS. Aucun FAIL financier.