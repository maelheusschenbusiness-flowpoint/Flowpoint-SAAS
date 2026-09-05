import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const apiRoot = process.cwd();
const dashboardSource = readFileSync(resolve(apiRoot, "../../src/frontend/dashboard.js"), "utf8");
const dashboardExport = readFileSync(resolve(apiRoot, "../flowpoint-export/dashboard.js"), "utf8");
const backend = readFileSync(resolve(apiRoot, "../flowpoint-export/fp-backend.js"), "utf8");
const config = readFileSync(resolve(apiRoot, "../flowpoint-export/fp-config.js"), "utf8");
const checkoutReturn = readFileSync(resolve(apiRoot, "../flowpoint-export/checkout-return.html"), "utf8");
const billing = readFileSync(resolve(apiRoot, "src/routes/billing.ts"), "utf8");

describe("dashboard account/session isolation contracts", () => {
  it("ships the same dashboard source that production export serves", () => {
    expect(dashboardExport).toBe(dashboardSource);
  });

  it("fails closed before /api/me confirms the account namespace", () => {
    expect(dashboardSource).toContain("var _FP_ORG_NS = '';");
    expect(dashboardSource).toContain("return _FP_ORG_NS ? 'fp:' + _FP_ORG_NS + ':' + bare : '';");
    expect(dashboardSource).not.toContain("localStorage.getItem('fp:last-org-id') || ''");
  });

  it("partitions GET caches by per-tab session and rejects stale responses", () => {
    expect(dashboardSource).toContain("return identity + '\\n' + path;");
    expect(dashboardSource).toContain("_fpSessionFingerprint() !== _requestIdentity");
    expect(backend).toContain("_fpBackendCacheIdentity() + '\\n' + path");
    expect(backend).toContain("restoreGeneration === _fpSessionGeneration");
  });

  it("resets navigation and tenant caches when the authenticated account changes", () => {
    expect(dashboardSource).toContain("fp:last-account-id");
    expect(dashboardSource).toContain("if (_sameAccount)");
    expect(dashboardSource).toContain("history.replaceState(");
    expect(dashboardSource).toContain("_fpResetDashboardCaches();");
  });

  it("does not use shared localStorage auth or a bare PSI cache", () => {
    expect(config).toContain("sessionStorage.getItem('fp_session_token')");
    expect(config).not.toContain("localStorage.getItem('token')");
    expect(config).not.toContain("localStorage.getItem('fp_token')");
    expect(checkoutReturn).toContain("sessionStorage.getItem('fp_session_token')");
    expect(checkoutReturn).not.toContain("localStorage.getItem('fp_token')");
    expect(dashboardSource).not.toContain("localStorage.getItem('fp-psi-last')");
    expect(dashboardSource).not.toContain("localStorage.setItem('fp-psi-last'");
  });
});

describe("dashboard Stripe reactivation contracts", () => {
  it("anchors reactivation on organizations.stripe_customer_id", () => {
    expect(billing).toContain("SELECT stripe_customer_id FROM organizations WHERE id::text = $1 LIMIT 1");
    expect(billing).toContain("customer:    billingCtx.stripeCustomerId");
    expect(billing).toContain("customerReused: true");
  });

  it("allows same-plan renewal and clears cancel_at_period_end in Stripe", () => {
    expect(billing).toContain("const isRenewalCanceled = sub.cancel_at_period_end === true;");
    expect(billing).toContain("if (targetPlan === currentPlan && !isRenewalCanceled)");
    expect(billing).toContain("...(isRenewalCanceled ? { cancel_at_period_end: false } : {})");
    expect(billing).toContain("...(isRenewalCanceled ? { reactivated: true } : {})");
    expect(billing).toContain("const clearPendingCancellation = async (): Promise<void>");
    expect((billing.match(/await clearPendingCancellation\(\);/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(dashboardSource).toContain("const _renewalCanceledUp = !!STATE.billing?.cancelAtPeriodEnd;");
  });

  it("routes every dashboard plan action through upgrade and preserves trial cancellation", () => {
    expect(billing).toContain("cancel_url:  `${publicUrl}/dashboard.html#billing/plans`");
    expect(dashboardSource).toContain("'/api/billing/cancel-trial'");
    expect(dashboardSource).toContain("window.location.href = r.checkoutUrl");
    expect(dashboardSource).toContain("changePlan(String(targetPlan).toLowerCase());");
    expect(backend).not.toContain("apiAction('POST', '/api/billing/checkout'");
    expect((backend.match(/apiAction\('POST', '\/api\/billing\/upgrade'/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(checkoutReturn).toContain("isAlreadyLoggedIn ? '/dashboard.html#billing/plans' : '/pricing.html'");
  });
});