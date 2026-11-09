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

  const {
    ADDON_PRICE_IDS_TEST,
    ADDON_TEST_PRICE_ENV_VARS,
    VERIFIED_TEST_ADDON_PRICE_IDS,
    getAddonAvailability,
  } = await import("./plans.js");
  for (const [key, variable] of Object.entries(expected)) {
    // La variable d'environnement dediee reste bien celle qui est declaree...
    expect(ADDON_TEST_PRICE_ENV_VARS[key]).toContain(variable);
    // ...mais un identifiant VERIFIE dans le catalogue Stripe TEST (lecture seule)
    // prime sur la variable (plans.ts : `VERIFIED_TEST_ADDON_PRICE_IDS[key] ?? corrected`),
    // pour qu'une valeur Render perimee ne rende pas l'offre invendable. Le test
    // attendait a l'origine (#289) l'identifiant de la variable dans tous les cas.
    const attendu = VERIFIED_TEST_ADDON_PRICE_IDS[key] ?? `price_test_${key}`;
    expect(ADDON_PRICE_IDS_TEST[key]).toBe(attendu);
    expect(getAddonAvailability(key)).not.toBe("coming_soon");
  }
});
