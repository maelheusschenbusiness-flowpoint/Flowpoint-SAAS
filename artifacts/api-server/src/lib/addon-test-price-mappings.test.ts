import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it("maps all eight replacement add-ons to their dedicated TEST price variables", async () => {
  const expected = {
    gbpPerformanceLeads: "STRIPE_TEST_PRICE_ID_ADDON_GBP_PERFORMANCE",
    localPresenceOptimizer: "STRIPE_TEST_PRICE_ID_ADDON_LOCAL_PRESENCE",
    localLandingOpportunities: "STRIPE_TEST_PRICE_ID_ADDON_LOCAL_LANDING",
    conversionOpportunityEngine: "STRIPE_TEST_PRICE_ID_ADDON_CONVERSION_OPPORTUNITY",
    seoChangeImpact: "STRIPE_TEST_PRICE_ID_ADDON_SEO_CHANGE_IMPACT",
    agencyPortfolioPriorities: "STRIPE_TEST_PRICE_ID_ADDON_AGENCY_PORTFOLIO_PRIORITIES",
    technicalSeoFixVerification: "STRIPE_TEST_PRICE_ID_ADDON_TECHNICAL_SEO_FIX_VERIFICATION",
    organicCampaignTracker: "STRIPE_TEST_PRICE_ID_ADDON_ORGANIC_CAMPAIGN_TRACKER",
  };
  vi.stubEnv("STRIPE_TEST_MODE", "true");
  vi.stubEnv("STRIPE_TEST_KEY", "sk_test_addon_mapping_fixture");
  for (const [key, variable] of Object.entries(expected)) {
    vi.stubEnv(variable, `price_test_${key}`);
  }
  vi.resetModules();

  const { ADDON_PRICE_IDS_TEST, getAddonAvailability } = await import("./plans.js");
  for (const [key] of Object.entries(expected)) {
    expect(ADDON_PRICE_IDS_TEST[key]).toBe(`price_test_${key}`);
    expect(getAddonAvailability(key)).not.toBe("coming_soon");
  }
});
