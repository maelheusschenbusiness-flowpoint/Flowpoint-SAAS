import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Certification beta : l'activation de marketIntelligence en mode TEST repondait 502 (stripe_error) car
 * aucune variable TEST n'etait lue et le prix LIVE etait envoye a un compte Stripe TEST.
 */
describe("marketIntelligence : prix TEST", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

  it("utilise STRIPE_TEST_PRICE_ID_ADDON_MARKET_INTELLIGENCE avec une cle sk_test_, jamais avec une cle live", async () => {
    vi.stubEnv("STRIPE_TEST_PRICE_ID_ADDON_MARKET_INTELLIGENCE", "price_test_market_intel");
    vi.resetModules();
    const plans = await import("./plans.js");
    expect(plans.getAddonPriceId("marketIntelligence", "sk_test_x")).toBe("price_test_market_intel");
    expect(plans.getAddonPriceId("marketIntelligence", "sk_live_x")).toBe(plans.ADDON_PRICE_IDS["marketIntelligence"]);
    expect(plans.getAddonPriceId("marketIntelligence", "sk_live_x")).not.toBe("price_test_market_intel");
  });

  it("sans variable TEST, comportement inchange (repli sur le prix configure)", async () => {
    vi.stubEnv("STRIPE_TEST_PRICE_ID_ADDON_MARKET_INTELLIGENCE", "");
    vi.resetModules();
    const plans = await import("./plans.js");
    expect(plans.ADDON_PRICE_IDS_TEST["marketIntelligence"] ?? "").toBe("");
  });
});
