import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Garde prix du lot 2 (etat independant : valable que 0, 1, 2, 3 ou 4 add-ons du lot soient presents,
// ce qui garde chaque commit d'add-on revertable seul).
const LOT2 = {
  agencyPortfolioPriorities: { live: "STRIPE_PRICE_ID_AGENCY_PORTFOLIO_PRIORITIES", test: "STRIPE_TEST_PRICE_ID_ADDON_AGENCY_PORTFOLIO_PRIORITIES", priceEur: 19 },
  localLandingOpportunities: { live: "STRIPE_PRICE_ID_LOCAL_LANDING_OPPORTUNITIES", test: "STRIPE_TEST_PRICE_ID_ADDON_LOCAL_LANDING", priceEur: 15 },
  localPresenceOptimizer: { live: "STRIPE_PRICE_ID_LOCAL_PRESENCE_OPTIMIZER", test: "STRIPE_TEST_PRICE_ID_ADDON_LOCAL_PRESENCE", priceEur: 9 },
  gbpPerformanceLeads: { live: "STRIPE_PRICE_ID_GBP_PERFORMANCE_LEADS", test: "STRIPE_TEST_PRICE_ID_ADDON_GBP_PERFORMANCE", priceEur: 15 },
} as const;
const KEYS = Object.keys(LOT2) as Array<keyof typeof LOT2>;

async function loadPlans(env: Record<string, string>) {
  vi.resetModules();
  for (const v of Object.values(LOT2)) {
    vi.stubEnv(v.live, env[v.live] ?? "");
    vi.stubEnv(v.test, env[v.test] ?? "");
  }
  vi.stubEnv("STRIPE_TEST_MODE", env["STRIPE_TEST_MODE"] ?? "");
  vi.stubEnv("STRIPE_TEST_KEY", env["STRIPE_TEST_KEY"] ?? "");
  return import("./plans.js");
}

describe("garde prix du lot 2", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("aucune variable : aucune cle du lot 2 dans aucune structure", async () => {
    const p = await loadPlans({});
    for (const key of KEYS) {
      expect(p.ADDON_DEFINITIONS[key]).toBeUndefined();
      expect(p.FLAG_ADDONS.has(key)).toBe(false);
      expect(p.ADDON_PRICE_IDS[key]).toBeUndefined();
      expect(p.getAddonPriceId(key, "sk_live_x")).toBeUndefined();
      for (const plan of ["standard", "pro", "ultra", "agency", "free"]) expect(p.isPlanAllowedAddon(plan, key)).toBe(false);
    }
  });

  it("variables LIVE du lot 2 : noms et prix attendus pour chaque cle declaree", async () => {
    const env: Record<string, string> = {};
    for (const v of Object.values(LOT2)) env[v.live] = `price_live_${v.live}`;
    const p = await loadPlans(env);
    for (const key of KEYS) {
      if (!p.isPriceGatedAddonKey(key)) continue;
      expect(p.PRICE_GATED_ADDONS[key]?.priceEnvVar).toBe(LOT2[key].live);
      expect(p.PRICE_GATED_ADDONS[key]?.testPriceEnvVars).toEqual([LOT2[key].test]);
      expect(p.ADDON_DEFINITIONS[key]).toMatchObject({ priceEur: LOT2[key].priceEur, oneTime: false, quantity: false });
      expect(p.ADDON_PRICE_IDS[key]).toBe(`price_live_${LOT2[key].live}`);
      expect(p.getAddonAvailability(key)).toBe("available");
    }
  });

  it("une variable ouvre uniquement sa propre cle, sans toucher aux add-ons existants", async () => {
    const base = await loadPlans({});
    const before = Object.keys(base.ADDON_DEFINITIONS);
    for (const key of KEYS) {
      const open = await loadPlans({ [LOT2[key].live]: "price_live_fixture" });
      for (const other of KEYS) {
        if (other !== key) expect(open.ADDON_DEFINITIONS[other]).toBeUndefined();
      }
      for (const k of before) expect(open.ADDON_DEFINITIONS[k]).toEqual(base.ADDON_DEFINITIONS[k]);
      for (const k of Object.keys(base.ADDON_PRICE_IDS)) expect(open.ADDON_PRICE_IDS[k]).toBe(base.ADDON_PRICE_IDS[k]);
      if (open.isPriceGatedAddonKey(key)) expect(Object.keys(open.ADDON_DEFINITIONS)).toEqual([...before, key]);
    }
  });

  it("un prix TEST seul n'ouvre rien hors mode test Stripe", async () => {
    const env: Record<string, string> = {};
    for (const v of Object.values(LOT2)) env[v.test] = "price_test_fixture";
    const p = await loadPlans(env);
    for (const key of KEYS) expect(p.ADDON_DEFINITIONS[key]).toBeUndefined();
  });

  it("mode test Stripe : un prix TEST ouvre la cle sans prix LIVE", async () => {
    const env: Record<string, string> = { STRIPE_TEST_MODE: "true", STRIPE_TEST_KEY: "sk_test_fixture" };
    for (const v of Object.values(LOT2)) env[v.test] = "price_test_fixture";
    const p = await loadPlans(env);
    for (const key of KEYS) {
      if (!p.isPriceGatedAddonKey(key)) continue;
      expect(p.ADDON_DEFINITIONS[key]).toBeDefined();
      expect(p.getAddonPriceId(key, "sk_test_fixture")).toBe("price_test_fixture");
      expect(p.getAddonPriceId(key, "sk_live_fixture")).toBeUndefined();
    }
  });
});
