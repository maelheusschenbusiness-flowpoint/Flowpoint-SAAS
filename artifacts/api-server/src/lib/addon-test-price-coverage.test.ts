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
  vi.stubEnv("CUSTOM_DOMAIN_RENDER_API_ENABLED", "false");
  vi.stubEnv("RENDER_API_KEY", "");
  vi.stubEnv("CUSTOM_DOMAIN_RENDER_SERVICE_ID", "");
  vi.stubEnv("CUSTOM_DOMAIN_RENDER_EXPECTED_SERVICE_NAME", "");
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

it("enables Custom Domain beta only on a configured TEST target and keeps it Ultra-only", async () => {
  const disabled = await loadPlans();
  expect(disabled.getAddonAvailability("customDomain")).toBe("coming_soon");

  const plans = await loadPlans({
    CUSTOM_DOMAIN_RENDER_API_ENABLED: "true",
    RENDER_API_KEY: "render-test-fixture",
    CUSTOM_DOMAIN_RENDER_SERVICE_ID: "srv-testfixture",
    CUSTOM_DOMAIN_RENDER_EXPECTED_SERVICE_NAME: "flowpoint-test",
    STRIPE_TEST_PRICE_ID_ADDON_CD: "price_test_custom_domain_fixture",
  });
  const { FEATURE_FLAGS } = await import("./config.js");

  expect(plans.getAddonAvailability("customDomain")).toBe("beta");
  expect(plans.COMING_SOON_ADDONS.has("customDomain")).toBe(false);
  expect(plans.BETA_ADDONS.has("customDomain")).toBe(true);
  expect(plans.PLAN_INCLUDED_ADDONS.ultra.has("customDomain")).toBe(true);
  expect(plans.PLAN_INCLUDED_ADDONS.pro.has("customDomain")).toBe(false);
  expect(FEATURE_FLAGS.ultra.customDomain).toBe(true);
  expect(FEATURE_FLAGS.pro.customDomain).toBe(false);
  expect(plans.getAddonPurchaseStatus("customDomain")).toBe("not_sold_separately");
  expect(plans.getAddonSeparateSalePlans("customDomain")).toEqual([]);
  expect(plans.getAddonPurchasablePlans("customDomain")).toEqual([]);
  expect(plans.isPlanAllowedAddon("standard", "customDomain")).toBe(false);
  expect(plans.isPlanAllowedAddon("pro", "customDomain")).toBe(false);
  expect(plans.isPlanAllowedAddon("ultra", "customDomain")).toBe(false);

  // Opening this beta must not release unrelated roadmap add-ons.
  expect(plans.getAddonAvailability("aiContentStrategist")).toBe("coming_soon");
  expect(plans.getAddonAvailability("ssoEnterprise")).toBe("coming_soon");
  expect(plans.getAddonAvailability("aiWorkspaceLaunch")).toBe("coming_soon");

  const { createBillingQuote } = await import("../services/billing-quote.js");
  for (const plan of ["standard", "pro"]) {
    expect(() => createBillingQuote({
      plan: "",
      inclusionPlan: plan,
      addons: { customDomain: true },
      trialEligible: false,
    })).toThrow("ADDON_NOT_SOLD_SEPARATELY");
  }
  const ultraQuote = createBillingQuote({
    plan: "",
    inclusionPlan: "ultra",
    addons: { customDomain: true },
    trialEligible: false,
  });
  expect(ultraQuote.lines.find((line) => line.key === "customDomain")).toMatchObject({
    kind: "addon",
    includedInPlan: true,
    amountMinor: 0,
  });
});

it("keeps Custom Domain Coming Soon on a LIVE Stripe key even with Render configuration", async () => {
  const plans = await loadPlans({
    NODE_ENV: "production",
    STRIPE_TEST_MODE: "false",
    STRIPE_TEST_KEY: "",
    STRIPE_LIVE_API_KEY: "sk_live_custom_domain_fixture",
    CUSTOM_DOMAIN_RENDER_API_ENABLED: "true",
    RENDER_API_KEY: "render-test-fixture",
    CUSTOM_DOMAIN_RENDER_SERVICE_ID: "srv-testfixture",
    CUSTOM_DOMAIN_RENDER_EXPECTED_SERVICE_NAME: "flowpoint-test",
  });
  expect(plans.getAddonAvailability("customDomain")).toBe("coming_soon");
  expect(plans.BETA_ADDONS.has("customDomain")).toBe(false);
});

it("corrects the stale Local Presence Optimizer TEST price only when configured", async () => {
  const unconfigured = await loadPlans();
  expect(unconfigured.getAddonPriceId("localPresenceOptimizer")).toBeUndefined();
  expect(unconfigured.getAddonPurchaseStatus("localPresenceOptimizer")).toBe("validation_required");

  const plans = await loadPlans({
    STRIPE_TEST_PRICE_ID_ADDON_LOCAL_PRESENCE: "price_1UUTPc9eqtbj6iPB5PEFUk5",
  });
  expect(plans.getAddonPriceId("localPresenceOptimizer")).toBe("price_1UUTPc9eqtbj6iPBb5PEFUk5");
  const { createBillingQuote } = await import("../services/billing-quote.js");
  const quote = createBillingQuote({
    plan: "",
    inclusionPlan: "standard",
    addons: { localPresenceOptimizer: true },
    trialEligible: false,
  });
  expect(quote.lines.find((line) => line.key === "localPresenceOptimizer")).toMatchObject({
    kind: "addon",
    priceId: "price_1UUTPc9eqtbj6iPBb5PEFUk5",
    amountMinor: 900,
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
    purchaseStatus: string;
  };
  const entries = new Map<string, CatalogAddon>(
    response.body.addons.map((entry: CatalogAddon) => [entry.key, entry]),
  );
  const keyword = entries.get("keywordDomination")!;
  const behavioral = entries.get("behavioralAI")!;

  expect(keyword).toMatchObject({ availability: "available", allowedPlans: [] });
  expect(behavioral).toMatchObject({ availability: "coming_soon", allowedPlans: [] });
  expect(keyword.purchaseStatus).toBe("price_unavailable");
  expect(behavioral.purchaseStatus).toBe("coming_soon");
  expect(behavioral.includedByPlan).toEqual({ ultra: true });
  expect(plans.PLAN_INCLUDED_ADDONS.ultra.has("behavioralAI")).toBe(true);
  expect(plans.getAddonStatus("behavioralAI", { included: true })).toBe("coming_soon");
});

it("keeps offer lifecycle separate from active-mode purchase readiness", async () => {
  const plans = await loadPlans();
  expect(plans.getAddonAvailability("monitorsPack10")).toBe("available");
  expect(plans.getAddonPurchaseStatus("monitorsPack10")).toBe("price_unavailable");
  expect(plans.getAddonAvailability("backlinkIntelligence")).toBe("beta");
  expect(plans.getAddonPurchaseStatus("backlinkIntelligence")).toBe("not_sold_separately");
  expect(plans.getAddonPurchaseStatus("customDomain")).toBe("coming_soon");
  expect(plans.getAddonPurchaseStatus("whiteLabel")).toBe("included");
  expect(plans.getAddonPurchaseStatus("advancedWebhooks")).toBe("retired");
});

it("keeps historical packs absent and unpriced TEST purchases blocked", async () => {
  const plans = await loadPlans();
  const missingOffers = [
    "monitorsPack10",
    "monitorsPack50",
    "extraSeats",
    "auditsPack200",
    "auditsPack1000",
    "pdfPack200",
    "exportsPack1000",
    "advancedSeoLab",
    "keywordDomination",
    "backlinkIntelligence",
    "retention90d",
    "retention365d",
    "aiCreditsPack50k",
    "aiCreditsPack200k",
    "aiCreditsPack500k",
  ];
  for (const key of missingOffers) {
    const expectedStatus = plans.RETIRED_ADDONS.has(key)
      ? "retired"
      : ["advancedSeoLab", "backlinkIntelligence"].includes(key)
        ? "not_sold_separately"
        : "price_unavailable";
    expect(plans.getAddonPurchaseStatus(key), key).toBe(expectedStatus);
    expect(plans.getAddonPurchasablePlans(key), key).toEqual([]);
  }

  const app = express();
  const { default: plansRouter } = await import("../routes/plans.js");
  const { default: billingRouter } = await import("../routes/public-billing.js");
  app.use(plansRouter);
  app.use(billingRouter);
  const [catalog, billing] = await Promise.all([
    request(app).get("/plans/catalog").expect(200),
    request(app).get("/billing/plans").expect(200),
  ]);
  for (const key of missingOffers) {
    if (plans.RETIRED_ADDONS.has(key)) {
      expect(catalog.body.retiredAddonKeys).toContain(key);
      expect(catalog.body.addons.find((addon: { key: string }) => addon.key === key)).toBeUndefined();
      expect(billing.body.addons.find((addon: { id: string }) => addon.id === key)).toBeUndefined();
      continue;
    }
    expect(catalog.body.addons.find((addon: { key: string }) => addon.key === key))
      .toMatchObject({
        purchaseStatus: ["advancedSeoLab", "backlinkIntelligence"].includes(key)
            ? "not_sold_separately"
            : "price_unavailable",
        allowedPlans: [],
      });
    expect(billing.body.addons.find((addon: { id: string }) => addon.id === key))
      .toMatchObject({
        purchaseStatus: ["advancedSeoLab", "backlinkIntelligence"].includes(key)
            ? "not_sold_separately"
            : "price_unavailable",
        allowedPlans: [],
      });
  }
});

it("advertises a TEST add-on for purchase only after a TEST price is configured", async () => {
  const plans = await loadPlans({
    STRIPE_TEST_PRICE_ID_ADDON_KDE: "price_test_keyword",
  });
  expect(plans.getAddonPurchasablePlans("keywordDomination")).toEqual(["standard", "pro", "ultra"]);
  expect(plans.getAddonPurchasablePlans("aiCreditsPack50k")).toEqual([]);
});

it("publishes identical mode-aware purchasable tiers from both catalogue APIs", async () => {
  const baseline = await loadPlans();
  const fixtures = [
    "keywordDomination",
    "behavioralAI",
    "aiForecasting",
    "retention90d",
    "retention365d",
    "customDomain",
    "whiteLabel",
    "advancedWebhooks",
    "aiCreditsPack50k",
  ];
  const env = Object.fromEntries(fixtures.map((key) => {
    const priceVariable = baseline.ADDON_TEST_PRICE_ENV_VARS[key]?.[0];
    expect(priceVariable, `${key} has a TEST price variable`).toBeTruthy();
    return [priceVariable!, `price_test_${key}`];
  }));
  const plans = await loadPlans(env);

  expect(plans.getAddonPurchasablePlans("keywordDomination")).toEqual(["standard", "pro", "ultra"]);
  expect(plans.getAddonPurchasablePlans("behavioralAI")).toEqual([]);
  expect(plans.getAddonPurchasablePlans("aiForecasting")).toEqual([]);
  expect(plans.getAddonPurchaseStatus("behavioralAI")).toBe("coming_soon");
  expect(plans.getAddonPurchaseStatus("aiForecasting")).toBe("coming_soon");
  expect(plans.getAddonPurchasablePlans("retention90d")).toEqual(["standard"]);
  expect(plans.getAddonPurchasablePlans("retention365d")).toEqual(["standard", "pro"]);
  expect(plans.getAddonPurchasablePlans("customDomain")).toEqual([]);
  expect(plans.getAddonPurchasablePlans("whiteLabel")).toEqual([]);
  expect(plans.getAddonPurchasablePlans("advancedWebhooks")).toEqual([]);
  expect(plans.getAddonPurchasablePlans("aiCreditsPack50k")).toEqual(["standard", "pro", "ultra"]);

  const { default: plansRouter } = await import("../routes/plans.js");
  const { default: publicBillingRouter } = await import("../routes/public-billing.js");
  const app = express();
  app.use(plansRouter);
  app.use(publicBillingRouter);

  const [catalogResponse, billingResponse] = await Promise.all([
    request(app).get("/plans/catalog").expect(200),
    request(app).get("/billing/plans").expect(200),
  ]);
  const billingByKey = new Map(
    billingResponse.body.addons.map((addon: {
      id: string;
      allowedPlans: string[];
      purchaseStatus: string;
    }) => [
      addon.id,
      { allowedPlans: addon.allowedPlans, purchaseStatus: addon.purchaseStatus },
    ]),
  );
  for (const addon of catalogResponse.body.addons as Array<{
    key: string;
    allowedPlans: string[];
    purchaseStatus: string;
  }>) {
    expect(billingByKey.get(addon.key), `${addon.key} eligibility matches in TEST mode`).toEqual({
      allowedPlans: addon.allowedPlans,
      purchaseStatus: addon.purchaseStatus,
    });
  }
  const plansById = new Map(
    billingResponse.body.plans.map((plan: { id: string; includedAddons: string[] }) => [
      plan.id,
      plan.includedAddons,
    ]),
  );
  expect(plansById.get("standard")).toContain("whiteLabel");
  expect(plansById.get("pro")).toEqual(expect.arrayContaining([
    "whiteLabel",
    "advancedWebhooks",
    "retention90d",
    "advancedSeoLab",
    "backlinkIntelligence",
    "enterprisePermissions",
  ]));
  expect(plansById.get("ultra")).toEqual(expect.arrayContaining([
    "customDomain",
    "behavioralAI",
    "aiForecasting",
    "retention365d",
  ]));
  const proPlan = billingResponse.body.plans.find((plan: { id: string }) => plan.id === "pro");
  expect(proPlan.addons).toEqual(["whiteLabel", "extraSeats", "monitorsPack50"]);
  expect(proPlan.addons).not.toEqual(proPlan.includedAddons);
  expect(catalogResponse.body.addons.find((addon: { key: string }) => addon.key === "customDomain"))
    .toMatchObject({ availability: "coming_soon", includedByPlan: { ultra: true }, purchaseStatus: "coming_soon" });
  expect(catalogResponse.body.addons.some((addon: { key: string }) => addon.key === "advancedWebhooks")).toBe(false);
  expect(catalogResponse.body.plans.find((plan: { id: string }) => plan.id === "pro").includedAddons)
    .toContain("advancedWebhooks");
  expect(catalogResponse.body.plans.find((plan: { id: string }) => plan.id === "pro").includedAddons)
    .toContain("enterprisePermissions");
});

it("marks Advanced SEO Lab and Backlink Intelligence as bundled, not separately sold", async () => {
  const baseline = await loadPlans();
  const env = Object.fromEntries(["advancedSeoLab", "backlinkIntelligence"].map((key) => {
    const priceVariable = baseline.ADDON_TEST_PRICE_ENV_VARS[key]?.[0];
    expect(priceVariable, `${key} has a TEST price variable`).toBeTruthy();
    return [priceVariable!, `price_test_${key}`];
  }));
  const plans = await loadPlans(env);

  for (const key of ["advancedSeoLab", "backlinkIntelligence"]) {
    expect(plans.getAddonPriceId(key)).toBe(`price_test_${key}`);
    expect(plans.getAddonSeparateSalePlans(key)).toEqual([]);
    expect(plans.getAddonPurchasablePlans(key)).toEqual([]);
    expect(plans.getAddonPurchaseStatus(key)).toBe("not_sold_separately");
  }
  expect(plans.getAddonPurchaseStatus("keywordDomination")).toBe("price_unavailable");
});
