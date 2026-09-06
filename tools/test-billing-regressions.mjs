import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';
const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const dashboard = read('artifacts/flowpoint-export/dashboard.js');
assert.equal(dashboard, read('src/frontend/dashboard.js'));
const goToPricing = dashboard.slice(dashboard.indexOf('async function fpGoToPricing('), dashboard.indexOf('\nfunction navigate(', dashboard.indexOf('async function fpGoToPricing(')));
for (const status of ['canceled', 'ended', 'expired', 'none', '']) {
  let visited = false;
  let changedPlan = null;
  const context = vm.createContext({
    STATE: {billing: {plan: 'ultra', subscriptionStatus: status}},
    window: {fpGoToBillingPlans() { visited = true; }},
    changePlan(plan) { changedPlan = plan; visited = true; },
    showToast() {},
  });
  vm.runInContext(goToPricing, context);
  await context.fpGoToPricing('standard');
  assert.equal(visited, true);
  assert.equal(changedPlan, 'standard');
}
// Execute the production handler, transpiled only to remove TypeScript syntax.
let billing = read('artifacts/api-server/src/routes/billing.ts');
let handler = billing.slice(billing.indexOf('router.post("/billing/upgrade"'), billing.indexOf('\nrouter.', billing.indexOf('router.post("/billing/upgrade"') + 1));
handler = handler.replace('await import("@workspace/db")', '({pool: billingPoolMock})');
handler = ts.transpileModule(handler, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText;
for (const status of ['canceled', 'ended']) for (const plan of ['standard', 'pro', 'ultra']) {
  let route, result, created;
  const stripe = {subscriptions: {list: async () => ({data: []})}, checkout: {sessions: {
    list: async () => ({data: []}), create: async params => { created = params; return {id: 'cs_QA', url: 'https://checkout.stripe.com/test'}; }
  }}};
  const context = vm.createContext({router: {post(_path, ...fns) { route = fns.at(-1); }}, billingCheckoutRateLimit() {}, ownerOnly() {},
    parsePlan: x => x, loadBillingContext: async () => ({plan: 'ultra', subscriptionStatus: status, stripeCustomerId: 'cus_STALE'}),
    billingPoolMock: {query: async () => ({rows: [{stripe_customer_id: 'cus_EXISTING'}]})},
    getStripeKey: () => 'sk_test_fake', process: {env: {PUBLIC_URL: 'https://example.test'}},
    logger: {info() {}, warn() {}, error() {}}, ADDON_PRICE_IDS: {}, PLAN_INCLUDED_ADDONS: {}, PLAN_PRICE_IDS: {standard: 'price_s', pro: 'price_p', ultra: 'price_u'},
    createStripeClient: async () => stripe,
  });
  vm.runInContext(handler, context);
  const res = {json(body) {result = body;}, status() {return this;}};
  await route({body: {plan}, orgId: '10000000-0000-4000-8000-000000000003', userId: 'qa-user'}, res);
  assert.equal(result.reactivation, true, JSON.stringify(result));
  assert.equal(created.customer, 'cus_EXISTING');
  assert.equal(created.mode, 'subscription');
  assert.equal(created.cancel_url, 'https://example.test/dashboard.html#billing/plans');
  assert.equal(created.subscription_data.metadata.orgId, '10000000-0000-4000-8000-000000000003');
}
let shown = 0;
const onboarding = dashboard.slice(dashboard.indexOf('function showOnboarding()'), dashboard.indexOf('// openOnboardingManually()', dashboard.indexOf('function showOnboarding()')));
const context = vm.createContext({STATE: {me: null, onboardingComplete: false}, $: () => ({removeAttribute() { shown++; }, querySelector() {return null;}}), _fpRenderOnboardingModal() {}, setTimeout() {}});
vm.runInContext(onboarding, context);
context.showOnboarding(); assert.equal(shown, 0);
context.STATE.me = {onboardingCompletedAt: null}; context.showOnboarding(); assert.equal(shown, 1);
context.STATE.me = {onboardingCompletedAt: '2026-09-05'}; context.showOnboarding(); assert.equal(shown, 1);
console.log('PASS: 5 dashboard routing states, 6 production billing handler scenarios, 3 first-login onboarding states, byte-for-byte frontend equality. Stripe mocked; no live payment.');
const admin = read('artifacts/api-server/src/routes/admin.ts');
let cleanup = admin.slice(admin.indexOf('router.delete("/admin/purge-account"'), admin.indexOf('\n});', admin.indexOf('router.delete("/admin/purge-account"')) + 4);
cleanup = cleanup.replace('await import("../services/account-deletion.js")', '({deleteAccount: deleteAccountMock})');
cleanup = ts.transpileModule(cleanup, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText;
for (const scenario of ['real', 'shared', 'multi-org', 'mismatch', 'preview', 'wrong-confirmation', 'delete']) {
  let route, result, deleted = false;
  const context = vm.createContext({router: {delete(_path, fn) {route = fn;}}, requireAdminKey: () => true,
    process: {env: {QA_CLEANUP_EMAILS: scenario === 'real' ? '' : 'disposable@example.test'}}, safeErrMsg: e => e.message,
    pool: {query: async sql => ({rows: sql.includes('SELECT id FROM organizations') ? [] : sql.includes('SELECT stripe_customer_id FROM org_settings') ? [] : sql.includes('FROM organizations') ? [{id: 'qa-org', owner_email: 'disposable@example.test', stripe_customer_id: 'cus_QA', is_internal_qa: false}]
      : sql.includes('SELECT u.id') ? [{id: 'qa-user', email: scenario === 'shared' ? 'real@example.test' : 'disposable@example.test'}]
      : scenario === 'multi-org' ? [{organization_id: 'real-org'}] : []})},
    deleteAccountMock: async () => {deleted = true; return {committed: true, survivors: []};}
  });
  vm.runInContext(cleanup, context);
  const res = {json(body) {result = body;}, status() {return this;}};
  await route({body: {email: 'disposable@example.test', orgId: scenario === 'mismatch' ? 'other-org' : 'qa-org', dryRun: scenario === 'preview', confirmEmail: scenario === 'wrong-confirmation' ? '' : 'disposable@example.test'}}, res);
  assert.equal(deleted, scenario === 'delete', scenario + ': ' + JSON.stringify(result));
}
console.log('PASS: 7 production QA cleanup guard scenarios; no database or Stripe deletion performed.');
