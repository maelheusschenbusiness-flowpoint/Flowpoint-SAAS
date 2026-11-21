import { afterEach, describe, expect, it } from "vitest";
import {
  ADDON_DEFINITIONS,
  ADDON_PRICE_IDS,
  ADDON_PRICE_IDS_TEST,
  FLAG_ADDONS,
  PLAN_ALLOWED_ADDONS,
  PRICE_GATED_ADDONS,
  applyPriceGatedAddons,
  getAddonAvailability,
  isPlanAllowedAddon,
  isPriceGatedAddonKey,
} from "./plans.js";

const KEY = "__fixtureGatedAddon";

function cleanup() {
  delete PRICE_GATED_ADDONS[KEY];
  delete ADDON_DEFINITIONS[KEY];
  delete ADDON_PRICE_IDS[KEY];
  delete ADDON_PRICE_IDS_TEST[KEY];
  FLAG_ADDONS.delete(KEY);
  for (const set of Object.values(PLAN_ALLOWED_ADDONS)) (set as Set<string>).delete(KEY);
}

describe("garde prix des add-ons du lot 1", () => {
  afterEach(cleanup);

  function register() {
    PRICE_GATED_ADDONS[KEY] = {
      definition: { name: "Fixture", category: "SEO", description: "d", priceEur: 1, oneTime: false, quantity: false },
      priceEnvVar: "STRIPE_PRICE_ID_FIXTURE",
      testPriceEnvVars: ["STRIPE_TEST_PRICE_ID_ADDON_FIXTURE"],
    };
  }

  it("sans variable de prix : aucune structure ne contient la clé", () => {
    register();
    expect(applyPriceGatedAddons({}, false)).toEqual([]);
    expect(applyPriceGatedAddons({ STRIPE_PRICE_ID_FIXTURE: "   " }, false)).toEqual([]);
    expect(ADDON_DEFINITIONS[KEY]).toBeUndefined();
    expect(ADDON_PRICE_IDS[KEY]).toBeUndefined();
    expect(FLAG_ADDONS.has(KEY)).toBe(false);
    expect(isPlanAllowedAddon("ultra", KEY)).toBe(false);
    expect(isPlanAllowedAddon("standard", KEY)).toBe(false);
    expect(isPriceGatedAddonKey(KEY)).toBe(true);
  });

  it("un prix TEST seul n'ouvre pas la garde hors mode test Stripe", () => {
    register();
    expect(applyPriceGatedAddons({ STRIPE_TEST_PRICE_ID_ADDON_FIXTURE: "price_test_x" }, false)).toEqual([]);
    expect(ADDON_DEFINITIONS[KEY]).toBeUndefined();
  });

  it("avec le prix LIVE : l'add-on devient visible et achetable, disponible (ni beta ni coming_soon)", () => {
    register();
    expect(applyPriceGatedAddons({ STRIPE_PRICE_ID_FIXTURE: "price_live_x" }, false)).toEqual([KEY]);
    expect(ADDON_DEFINITIONS[KEY]?.name).toBe("Fixture");
    expect(ADDON_PRICE_IDS[KEY]).toBe("price_live_x");
    expect(FLAG_ADDONS.has(KEY)).toBe(true);
    expect(isPlanAllowedAddon("pro", KEY)).toBe(true);
    expect(getAddonAvailability(KEY)).toBe("available");
  });

  it("en mode test Stripe, un prix TEST ouvre la garde sans prix LIVE", () => {
    register();
    expect(applyPriceGatedAddons({ STRIPE_TEST_PRICE_ID_ADDON_FIXTURE: "price_test_x" }, true)).toEqual([KEY]);
    expect(ADDON_PRICE_IDS_TEST[KEY]).toBe("price_test_x");
    expect(ADDON_PRICE_IDS[KEY]).toBeUndefined();
  });
});
