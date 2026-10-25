import { afterEach, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadPlans(env: Record<string, string> = {}) {
  // Isolate fixtures from price variables injected into the workspace runtime.
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("STRIPE_TEST_PRICE")) vi.stubEnv(key, "");
  }
  vi.stubEnv("STRIPE_TEST_MODE", "true");
  vi.stubEnv("STRIPE_TEST_KEY", "sk_test_addon_coverage_fixture");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.resetModules();
  return import("./plans.js");
}

it("every purchasable add-on declares an explicit TEST price source", async () => {
  const plans = await loadPlans();
  const missing = Object.keys(plans.ADDON_DEFINITIONS).filter(
    (key) =>
      !plans.REMOVED_ADDONS.has(key) &&
      !plans.RETIRED_ADDONS.has(key) &&
      plans.getAddonAvailability(key) !== "coming_soon" &&
      !(plans.ADDON_TEST_PRICE_ENV_VARS[key]?.length > 0) &&
      !plans.VERIFIED_TEST_ADDON_PRICE_IDS[key],
  );
  expect(missing).toEqual([]);
});

it("never uses a LIVE price in TEST mode and blocks add-ons without a TEST price source", async () => {
  const plans = await loadPlans();
  for (const key of Object.keys(plans.ADDON_DEFINITIONS)) {
    expect(plans.getAddonPriceId(key, "sk_test_addon_coverage_fixture")).toBe(
      plans.VERIFIED_TEST_ADDON_PRICE_IDS[key],
    );
  }
});

it("resolves a configured TEST price and no other add-on", async () => {
  const plans = await loadPlans({ STRIPE_TEST_PRICE_ID_ADDON_BEHAVAI: "price_test_behavioral" });
  expect(plans.getAddonPriceId("behavioralAI", "sk_test_addon_coverage_fixture")).toBe("price_test_behavioral");
  expect(plans.getAddonPriceId("revenueLeak", "sk_test_addon_coverage_fixture")).toBeUndefined();
});

it("uses distinct TEST variable names per add-on", async () => {
  const plans = await loadPlans();
  const names = Object.values(plans.ADDON_TEST_PRICE_ENV_VARS).flat();
  expect(new Set(names).size).toBe(names.length);
});

it("uses the verified Conversion Opportunity Engine TEST price over a stale environment value", async () => {
  const plans = await loadPlans({
    STRIPE_TEST_PRICE_ID_ADDON_CONVERSION_OPPORTUNITY: "price_test_conversion",
  });
  expect(plans.FLAG_ADDONS.has("conversionOpportunityEngine")).toBe(true);
  const { createBillingQuote } = await import("../services/billing-quote.js");
  const quote = createBillingQuote({
    plan: "",
    inclusionPlan: "standard",
    addons: { conversionOpportunityEngine: true },
    trialEligible: false,
  });
  expect(quote.lines.find((line) => line.key === "conversionOpportunityEngine")).toMatchObject({
    kind: "addon",
    priceId: plans.VERIFIED_TEST_ADDON_PRICE_IDS.conversionOpportunityEngine,
    amountMinor: 1200,
  });
});

it("builds quote-only lines for all eight replacement add-ons with TEST price mappings", async () => {
  const variables: Record<string, string> = {
    gbpPerformanceLeads: "STRIPE_TEST_PRICE_ID_ADDON_GBP_PERFORMANCE",
    localPresenceOptimizer: "STRIPE_TEST_PRICE_ID_ADDON_LOCAL_PRESENCE",
    localLandingOpportunities: "STRIPE_TEST_PRICE_ID_ADDON_LOCAL_LANDING",
    conversionOpportunityEngine: "STRIPE_TEST_PRICE_ID_ADDON_CONVERSION_OPPORTUNITY",
    seoChangeImpact: "STRIPE_TEST_PRICE_ID_ADDON_SEO_CHANGE_IMPACT",
    agencyPortfolioPriorities: "STRIPE_TEST_PRICE_ID_ADDON_AGENCY_PORTFOLIO_PRIORITIES",
    technicalSeoFixVerification: "STRIPE_TEST_PRICE_ID_ADDON_TECHNICAL_SEO_FIX_VERIFICATION",
    organicCampaignTracker: "STRIPE_TEST_PRICE_ID_ADDON_ORGANIC_CAMPAIGN_TRACKER",
  };
  const env = Object.fromEntries(
    Object.keys(variables).map((key) => [variables[key]!, `price_test_${key}`]),
  );
  const plans = await loadPlans(env);
  const { createBillingQuote } = await import("../services/billing-quote.js");

  for (const key of Object.keys(variables)) {
    const quote = createBillingQuote({
      plan: "",
      inclusionPlan: "standard",
      addons: { [key]: true },
      trialEligible: false,
    });
    expect(quote.checkoutType).toBe("addon_only");
    expect(quote.lines.find((line) => line.key === key)).toMatchObject({
      kind: "addon",
      priceId: plans.VERIFIED_TEST_ADDON_PRICE_IDS[key] ?? `price_test_${key}`,
    });
  }
});

it("does not advertise an unpriced TEST add-on as purchasable and keeps bundled access", async () => {
  const plans = await loadPlans();
  const app = express();
  const { default: plansRouter } = await import("../routes/plans.js");
  app.use(plansRouter);

  const response = await request(app).get("/plans/catalog").expect(200);
  type CatalogAddon = {
    key: string;
    availability: string;
    allowedPlans: string[];
    includedByPlan: Record<string, boolean>;
  };
  const entries = new Map<string, CatalogAddon>(
    response.body.addons.map((entry: CatalogAddon) => [entry.key, entry]),
  );
  const keyword = entries.get("keywordDomination")!;
  const behavioral = entries.get("behavioralAI")!;

  expect(keyword).toMatchObject({ availability: "available", allowedPlans: [] });
  expect(behavioral).toMatchObject({ availability: "beta", allowedPlans: [] });
  expect(behavioral.includedByPlan).toEqual({ ultra: true });
  expect(plans.PLAN_INCLUDED_ADDONS.ultra.has("behavioralAI")).toBe(true);
  expect(plans.getAddonStatus("behavioralAI", { included: true })).toBe("included");
});

it("advertises a TEST add-on for purchase only after a TEST price is configured", async () => {
  const plans = await loadPlans({
    STRIPE_TEST_PRICE_ID_ADDON_KDE: "price_test_keyword",
  });
  expect(plans.getAddonPurchasablePlans("keywordDomination")).toEqual(["standard", "pro", "ultra"]);
  expect(plans.getAddonPurchasablePlans("aiCreditsPack50k")).toEqual([]);
});
