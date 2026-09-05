/**
 * Regression contract for the authenticated payment-intent Customer anchor.
 *
 * publicBillingRouter is registered before orgContext, so authenticated
 * dashboard requests must resolve their session explicitly before creating a
 * PaymentIntent/SetupIntent. This protects the one-Customer invariant at the
 * source, rather than weakening finalize-checkout's mismatch check.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routeSource = readFileSync(
  resolve(process.cwd(), "src/routes/public-billing.ts"),
  "utf8",
);

describe("authenticated payment-intent Customer anchor", () => {
  it("resolves the session even when a plan is present", () => {
    const start = routeSource.indexOf('let _piReqOrgId =');
    const end = routeSource.indexOf('if (!plan && !preRegisterToken', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const resolutionBlock = routeSource.slice(start, end);
    expect(resolutionBlock).toContain(
      'if (!preRegisterToken && (!_piReqOrgId || _piReqOrgId === "default"))',
    );
    expect(resolutionBlock).not.toContain(
      'if (!plan && !preRegisterToken && (!_piReqOrgId || _piReqOrgId === "default"))',
    );
  });

  it("anchors authenticated Stripe resolution to the session org", () => {
    const start = routeSource.indexOf('if (!preRegCustomerId && !preRegisterToken)');
    const end = routeSource.indexOf('// A0 — Closed-tab webhook recovery', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);

    const customerBlock = routeSource.slice(start, end);
    expect(customerBlock).toContain("const _authOrgId = _piReqOrgId;");
    expect(customerBlock).toContain("ensureStripeCustomer");
  });
});