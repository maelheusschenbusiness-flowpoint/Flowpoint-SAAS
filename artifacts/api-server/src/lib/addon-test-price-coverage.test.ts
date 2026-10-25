import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadPlans(env: Record<string, string> = {}) {
  vi.stubEnv("STRIPE_TEST_MODE", "true");
  vi.stubEnv("STRIPE_TEST_KEY", "sk_test_addon_coverage_fixture");
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.resetModules();
  return import("./plans.js");
}

it("every purchasable add-on declares an explicit TEST price variable", async () => {
  const plans = await loadPlans();
  const missing = Object.keys(plans.ADDON_DEFINITIONS).filter(
    (key) =>
      !plans.REMOVED_ADDONS.has(key) &&
      !plans.RETIRED_ADDONS.has(key) &&
      plans.getAddonAvailability(key) !== "coming_soon" &&
      !(plans.ADDON_TEST_PRICE_ENV_VARS[key]?.length > 0),
  );
  expect(missing).toEqual([]);
});

it("never uses a LIVE price in TEST mode, and blocks the purchase when no TEST price is set", async () => {
  const plans = await loadPlans();
  for (const key of Object.keys(plans.ADDON_DEFINITIONS)) {
    expect(plans.getAddonPriceId(key, "sk_test_addon_coverage_fixture")).toBeUndefined();
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
