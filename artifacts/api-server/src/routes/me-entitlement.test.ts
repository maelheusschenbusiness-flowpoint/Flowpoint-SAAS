/**
 * Regression tests for the GET /api/me entitlement loader.
 *
 * P0 root cause: a transient billing/entitlement DB failure was swallowed by
 * `.catch(() => null)` and served as a fabricated Standard/unknown entitlement
 * (HTTP 200). These tests lock in the fail-closed contract:
 *
 *   - Any authoritative source that THROWS       → BillingDataUnavailableError.
 *   - org_addons that THROWS                       → BillingDataUnavailableError
 *     (never a suppressed empty array that undercounts qty-addon limits).
 *   - A genuine, valid org with all reads OK       → data returned unchanged.
 *
 * These exercise the extracted helper directly (no Express integration needed),
 * so they assert real branching behaviour rather than inspecting strings.
 */
import { describe, it, expect } from "vitest";
import type { OrgBillingData } from "../services/org-data.js";
import type { OrgSettings } from "../services/org-settings.js";
import {
  loadMeEntitlement,
  BillingDataUnavailableError,
  BILLING_DATA_UNAVAILABLE_CODE,
  type MeEntitlementDeps,
  type AddonRow,
} from "./me-entitlement.js";

const ORG = "0d9e2f6a-1b3c-4d5e-8f70-123456789abc";

// A valid Ultra org fixture — the "genuine data" happy path that must stay 200.
const ULTRA_BILLING: OrgBillingData = {
  plan: "ultra",
  subscriptionStatus: "active",
  stripeCustomerId: "cus_ultra",
  stripeSubscriptionId: "sub_ultra",
  trialEndsAt: null,
  trialConsumedAt: "2024-01-01T00:00:00.000Z",
  trialStartedAt: "2024-01-01T00:00:00.000Z",
  addons: {},
  pendingPlan: null,
  pendingPlanDate: null,
  email: "owner@ultra.example",
  firstName: "Ada",
  orgName: "Ultra Corp",
};

function deps(over: Partial<MeEntitlementDeps> = {}): MeEntitlementDeps {
  return {
    loadOrgData: async () => ULTRA_BILLING,
    loadOrgSettings: async () => null,
    loadAddons: async (): Promise<AddonRow[]> => [],
    ...over,
  };
}

describe("loadMeEntitlement — fail-closed on unavailable data", () => {
  it("throws BillingDataUnavailableError when organizations/billing lookup rejects", async () => {
    await expect(
      loadMeEntitlement(ORG, deps({ loadOrgData: async () => { throw new Error("db down"); } })),
    ).rejects.toBeInstanceOf(BillingDataUnavailableError);
  });

  it("throws BillingDataUnavailableError when org_settings lookup rejects", async () => {
    await expect(
      loadMeEntitlement(ORG, deps({ loadOrgSettings: async () => { throw new Error("db down"); } })),
    ).rejects.toBeInstanceOf(BillingDataUnavailableError);
  });

  it("throws BillingDataUnavailableError when org_addons lookup rejects (fails closed, no empty fallback)", async () => {
    await expect(
      loadMeEntitlement(ORG, deps({ loadAddons: async () => { throw new Error("db down"); } })),
    ).rejects.toBeInstanceOf(BillingDataUnavailableError);
  });

  it("the raised error carries a structured, retryable code", async () => {
    const err = await loadMeEntitlement(
      ORG,
      deps({ loadOrgData: async () => { throw new Error("db down"); } }),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(BillingDataUnavailableError);
    expect(err.code).toBe(BILLING_DATA_UNAVAILABLE_CODE);
    expect(err.retryable).toBe(true);
  });

  it("preserves the underlying error as `cause` for diagnostics", async () => {
    const root = new Error("connection reset");
    const err = await loadMeEntitlement(
      ORG,
      deps({ loadAddons: async () => { throw root; } }),
    ).catch((e) => e);
    expect(err.cause).toBe(root);
  });
});

describe("loadMeEntitlement — genuine valid data is unchanged", () => {
  it("returns valid Ultra billing data verbatim when every read succeeds", async () => {
    const addonRows: AddonRow[] = [
      { addon_key: "monitorsPack10", active: true, quantity: 2 },
    ];
    const result = await loadMeEntitlement(
      ORG,
      deps({
        loadOrgData: async () => ULTRA_BILLING,
        loadAddons: async () => addonRows,
      }),
    );
    expect(result.billingData).toBe(ULTRA_BILLING);
    expect(result.billingData?.plan).toBe("ultra");
    expect(result.dbData).toBeNull();
    expect(result.addonRows).toEqual(addonRows);
  });

  it("treats a genuinely absent row (null, no throw) as absence — not a failure", async () => {
    const result = await loadMeEntitlement(
      ORG,
      deps({ loadOrgData: async () => null, loadOrgSettings: async () => null }),
    );
    expect(result.billingData).toBeNull();
    expect(result.dbData).toBeNull();
    expect(result.addonRows).toEqual([]);
  });

  it("passes org_settings through when present alongside billing data", async () => {
    const settings = { orgId: ORG, plan: "ultra", firstName: "Ada" } as unknown as OrgSettings;
    const result = await loadMeEntitlement(
      ORG,
      deps({ loadOrgSettings: async () => settings }),
    );
    expect(result.dbData).toBe(settings);
  });
});
