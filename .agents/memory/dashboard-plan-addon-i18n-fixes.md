---
name: Dashboard plan-change, addon gate, badge, i18n
description: Frontend patterns fixed 2026-08-02 — direct plan upgrade, pricing addon gate, AI badge sync, translation pass
---
- Plan change: subscribed (active/trialing) users call POST /api/billing/upgrade directly (fpGoToPricing + #billing-change-plan panel); response `url` → redirect (reactivation), `error` → toast; only non-subscribed go through pricing.html.
- Pricing addon gate: in pricing.html goToCheckout override, `(isSubscribed || !bs) && !targetPlan` → straight to checkout. **Why:** `window._fpBillingState` fetch can fail on pricing.html (per-tab token not restored) and the gate then wrongly asked subscribed users to pick a plan.
- Sidebar "6 URLs" bug was `STATE.audits?.length || 6` — never use literal fallbacks for counts.
- AI badge: dashboard.html hardcodes GPT-5; `window.fpSyncAiBadge()` (defined near applyLanguagePref, called on DOM ready + end of _doRender) syncs #fp-ai-badge/#fp-ai-chat-model-label from STATE.aiProvider.
- i18n: `window.fpApplyTranslations()` — FR→EN catalog FP_I18N_EN, TreeWalker over sidebar/page/topbar text nodes + placeholder/title attrs, runs at end of _doRender when language starts with 'en'. Extend the catalog, don't add per-page translation code.
- Gemini truncation: AI tool-loop rounds were maxTokens:1024 in routes/ai.ts (2 lines) → 4096.
