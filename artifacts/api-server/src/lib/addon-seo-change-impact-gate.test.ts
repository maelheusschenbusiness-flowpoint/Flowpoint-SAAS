import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Add-on « SEO Change Impact » : invisible et non achetable tant que STRIPE_PRICE_ID_SEO_CHANGE_IMPACT
// n'est pas definie ; aucune cle existante du catalogue n'est touchee.
const KEY = "seoChangeImpact";
const PLANS = ["standard", "pro", "ultra", "agency"] as const;

async function loadPlans(env: Record<string, string>) {
  vi.resetModules();
  vi.stubEnv("STRIPE_PRICE_ID_SEO_CHANGE_IMPACT", env["STRIPE_PRICE_ID_SEO_CHANGE_IMPACT"] ?? "");
  vi.stubEnv("STRIPE_TEST_PRICE_ID_ADDON_SEO_CHANGE_IMPACT", env["STRIPE_TEST_PRICE_ID_ADDON_SEO_CHANGE_IMPACT"] ?? "");
  vi.stubEnv("STRIPE_TEST_MODE", env["STRIPE_TEST_MODE"] ?? "");
  vi.stubEnv("STRIPE_TEST_KEY", env["STRIPE_TEST_KEY"] ?? "");
  return import("./plans.js");
}

describe("SEO Change Impact : garde du prix LIVE", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("variable absente : aucune trace dans le catalogue, les plans ni les prix", async () => {
    const p = await loadPlans({});
    expect(p.ADDON_DEFINITIONS[KEY]).toBeUndefined();
    expect(p.FLAG_ADDONS.has(KEY)).toBe(false);
    expect(p.ADDON_PRICE_IDS[KEY]).toBeUndefined();
    expect(p.getAddonPriceId(KEY, "sk_live_x")).toBeUndefined();
    expect(p.getAddonPriceId(KEY, "sk_test_x")).toBeUndefined();
    expect(p.getAddonForPriceId("")).toBeNull();
    for (const plan of PLANS) expect(p.isPlanAllowedAddon(plan, KEY)).toBe(false);
    expect(p.isPlanAllowedAddon("free", KEY)).toBe(false);
    for (const set of Object.values(p.PLAN_INCLUDED_ADDONS)) expect(set.has(KEY)).toBe(false);
  });

  it("variable vide ou blanche : toujours invisible", async () => {
    const p = await loadPlans({ "STRIPE_PRICE_ID_SEO_CHANGE_IMPACT": "  " });
    expect(p.ADDON_DEFINITIONS[KEY]).toBeUndefined();
  });

  it("variable LIVE definie : visible, 15 EUR/mois, achetable sur tous les plans payants", async () => {
    const p = await loadPlans({ "STRIPE_PRICE_ID_SEO_CHANGE_IMPACT": "price_live_fixture" });
    expect(p.ADDON_DEFINITIONS[KEY]).toMatchObject({ name: "SEO Change Impact", priceEur: 15, oneTime: false, quantity: false });
    expect(p.ADDON_PRICE_IDS[KEY]).toBe("price_live_fixture");
    expect(p.getAddonForPriceId("price_live_fixture")).toBe(KEY);
    expect(p.getAddonAvailability(KEY)).toBe("available");
    for (const plan of PLANS) expect(p.isPlanAllowedAddon(plan, KEY)).toBe(true);
  });

  it("un prix TEST sans mode test Stripe n'ouvre rien", async () => {
    const p = await loadPlans({ "STRIPE_TEST_PRICE_ID_ADDON_SEO_CHANGE_IMPACT": "price_test_fixture" });
    expect(p.ADDON_DEFINITIONS[KEY]).toBeUndefined();
  });

  it("mode test Stripe + prix TEST : ouvert en test uniquement, sans prix LIVE", async () => {
    const p = await loadPlans({ "STRIPE_TEST_PRICE_ID_ADDON_SEO_CHANGE_IMPACT": "price_test_fixture", STRIPE_TEST_MODE: "true", STRIPE_TEST_KEY: "sk_test_fixture" });
    expect(p.ADDON_DEFINITIONS[KEY]).toBeDefined();
    expect(p.getAddonPriceId(KEY, "sk_test_fixture")).toBe("price_test_fixture");
    expect(p.getAddonPriceId(KEY, "sk_live_fixture")).toBeUndefined();
  });

  it("ne modifie aucun add-on existant (prix, noms, cles)", async () => {
    const base = await loadPlans({});
    const open = await loadPlans({ "STRIPE_PRICE_ID_SEO_CHANGE_IMPACT": "price_live_fixture" });
    const before = Object.keys(base.ADDON_DEFINITIONS);
    for (const k of before) expect(open.ADDON_DEFINITIONS[k]).toEqual(base.ADDON_DEFINITIONS[k]);
    expect(Object.keys(open.ADDON_DEFINITIONS)).toEqual([...before, KEY]);
    for (const k of Object.keys(base.ADDON_PRICE_IDS)) expect(open.ADDON_PRICE_IDS[k]).toBe(base.ADDON_PRICE_IDS[k]);
  });
});
