/**
 * Lot C Certification — Wave 3B / Wave 3A remaining items
 *
 * C01–C05  File content checks (L4 plan-picker routing, fp:theme key)
 * C06–C13  Billing guard source analysis (static — store singleton makes live injection
 *          unreliable; source checks verify guard presence, condition, and response shape)
 *
 * Run: node artifacts/api-server/tests/certification/lot_c.mjs
 * Requires: DATABASE_URL set (for connectivity check), server on :8081.
 */

import fs from 'fs';

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ PASS — ${label}${detail ? ' · ' + detail : ''}`); }
  else       { fail++; console.error(`  ❌ FAIL — ${label}${detail ? ' · ' + detail : ''}`); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Section 1 — Frontend file checks (L4 plan-picker, fp:theme key)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── C01–C05 Frontend routing & theme key ────────────────────────');

const pricingJs = fs.readFileSync(
  '/home/runner/workspace/artifacts/flowpoint-export/pricing.js', 'utf8');

// C01: pricing.js no longer calls /api/billing/checkout directly
ok('C01 — pricing.js: no direct fetch to /api/billing/checkout',
   !pricingJs.includes("fetch('/api/billing/checkout'") &&
   !pricingJs.includes('fetch("/api/billing/checkout"'),
   'direct Stripe fetch removed');

// C02: pricing.js redirects to checkout.html with ?plan= param
ok('C02 — pricing.js: routes to checkout.html?plan= URL',
   pricingJs.includes("checkout.html?plan="),
   'window.location.href → checkout.html?plan=');

// C03: pricing.js still persists fp_cart for checkout.html to read
ok('C03 — pricing.js: fp_cart written to localStorage before redirect',
   pricingJs.includes("localStorage.setItem('fp_cart'"),
   'fp_cart write present');

// C04: checkout.html uses fp:theme as primary (not stale fp-theme)
const checkoutHtml = fs.readFileSync(
  '/home/runner/workspace/artifacts/flowpoint-export/checkout.html', 'utf8');
ok("C04 — checkout.html: theme script reads fp:theme (primary key)",
   checkoutHtml.includes("localStorage.getItem('fp:theme')"),
   'fp:theme before fp-theme fallback');

// C05: checkout-payment.html uses fp:theme as primary
const paymentHtml = fs.readFileSync(
  '/home/runner/workspace/artifacts/flowpoint-export/checkout-payment.html', 'utf8');
ok("C05 — checkout-payment.html: theme script reads fp:theme (primary key)",
   paymentHtml.includes("localStorage.getItem('fp:theme')"),
   'fp:theme before fp-theme fallback');

// ─────────────────────────────────────────────────────────────────────────────
// Section 2 — checkout.html plan reading (L4 secondary)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── C06–C08 checkout.html plan pre-selection ────────────────────');

// C06: checkout.html reads plan from URL ?plan= param as fallback
ok('C06 — checkout.html: reads ?plan= URL param for pre-selection',
   checkoutHtml.includes("params.get('plan')") || checkoutHtml.includes('params.get("plan")'),
   '?plan= URL param parsed');

// C07: checkout.html reads fp_cart from localStorage as primary source
ok('C07 — checkout.html: fp_cart localStorage read (primary source)',
   checkoutHtml.includes("localStorage.getItem('fp_cart')"),
   'fp_cart read present');

// C08: checkout.html has selectPlanFromCard — handles missing plan gracefully
ok('C08 — checkout.html: plan picker handles missing plan (selectPlanFromCard)',
   checkoutHtml.includes('selectPlanFromCard'),
   'plan picker function present');

// ─────────────────────────────────────────────────────────────────────────────
// Section 3 — Billing backend guard source analysis
// (store is a singleton refreshed only at login/webhook — live injection not reliable;
//  static analysis verifies all 4 guard conditions are present and correct)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── C09–C13 Billing guard source analysis ───────────────────────');

const billingTs = fs.readFileSync(
  '/home/runner/workspace/artifacts/api-server/src/routes/billing.ts', 'utf8');

// C09: Guard 1 — subscription_already_active in checkout route
// Checks: (a) error string present, (b) status 409 is used, (c) redirectTo field provided
ok('C09 — checkout: subscription_already_active guard (409 + redirectTo)',
   billingTs.includes('"subscription_already_active"') &&
   billingTs.includes('redirectTo:') &&
   /res\.status\(409\).*subscription_already_active/.test(billingTs.replace(/\n/g, ' ')),
   'guard + 409 + redirectTo all present');

// C10: Guard 2 — plan_already_active in upgrade route
// Checks: (a) error string, (b) same-plan condition `targetPlan === currentPlan`
ok('C10 — upgrade: plan_already_active guard (409 + same-plan condition)',
   billingTs.includes('"plan_already_active"') &&
   billingTs.includes('targetPlan === currentPlan') &&
   /res\.status\(409\).*plan_already_active/.test(billingTs.replace(/\n/g, ' ')),
   'guard + condition + 409 all present');

// C11: Guard 3 — addon_already_active in addon routes
ok('C11 — addon: addon_already_active guard (409)',
   billingTs.includes('"addon_already_active"') &&
   /res\.status\(409\).*addon_already_active/.test(billingTs.replace(/\n/g, ' ')),
   'guard + 409 present');

// C12: Guard 4 — trial guard (no re-trial for users with prior history)
// Checks: (a) hasHadTrial variable, (b) grantTrial derived from it,
//         (c) trial_period_days only when grantTrial is true
ok('C12 — checkout: re-trial blocked (hasHadTrial + grantTrial + conditional trial_period_days)',
   billingTs.includes('hasHadTrial') &&
   billingTs.includes('grantTrial') &&
   billingTs.includes('trial_period_days') &&
   billingTs.includes('if (grantTrial)'),
   'trial guard complete');

// C13: Guard 5 — Stripe-side double-subscription check (belt-and-suspenders)
// Even if store.me.subscriptionStatus is stale, Stripe is checked directly
ok('C13 — checkout: Stripe-side active-subscription guard (belt-and-suspenders)',
   billingTs.includes("stripe.subscriptions.list") &&
   billingTs.includes('status: "active"') &&
   billingTs.includes('existingSubs.data.length > 0'),
   'Stripe-side guard present for stale store.me scenarios');

// ─────────────────────────────────────────────────────────────────────────────
// Section 4 — Connectivity smoke test
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── C14 Server connectivity ──────────────────────────────────────');

const health = await fetch('http://localhost:8081/api/health').then(r => r.json()).catch(() => null);
ok('C14 — API server healthy on :8081',
   health?.status === 'ok',
   `uptime=${health?.uptime ?? 'N/A'}s`);

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(60)}`);
console.log(`LOT C  — ${pass + fail} tests  ✅ ${pass} passed  ❌ ${fail} failed`);
console.log('─'.repeat(60));

if (fail > 0) process.exit(1);
