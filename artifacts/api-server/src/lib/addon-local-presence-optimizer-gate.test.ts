import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Add-on « Local Presence Optimizer » : invisible et non achetable tant que STRIPE_PRICE_ID_LOCAL_PRESENCE_OPTIMIZER
// n'est pas definie ; aucune cle existante du catalogue n'est touchee.
const KEY = "localPresenceOptimizer";
// Test-Replit classe cet add-on « Pro et plus » (_PRO_EXCLUSIVE) : non achetable sur Standard.
const PLANS = ["pro", "ultra", "agency"] as const;

async function loadPlans(env: Record<string, string>) {
  vi.resetModules();
  vi.stubEnv("STRIPE_PRICE_ID_LOCAL_PRESENCE_OPTIMIZER", env["STRIPE_PRICE_ID_LOCAL_PRESENCE_OPTIMIZER"] ?? "");
  vi.stubEnv("STRIPE_TEST_PRICE_ID_ADDON_LOCAL_PRESENCE", env["STRIPE_TEST_PRICE_ID_ADDON_LOCAL_PRESENCE"] ?? "");
  vi.stubEnv("STRIPE_TEST_MODE", env["STRIPE_TEST_MODE"] ?? "");
  vi.stubEnv("STRIPE_TEST_KEY", env["STRIPE_TEST_KEY"] ?? "");
  return import("./plans.js");
}

describe("Local Presence Optimizer : garde du prix LIVE", () => {
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
    for (const plan of [...PLANS, "standard"]) expect(p.isPlanAllowedAddon(plan, KEY)).toBe(false);
    expect(p.isPlanAllowedAddon("free", KEY)).toBe(false);
    for (const set of Object.values(p.PLAN_INCLUDED_ADDONS)) expect(set.has(KEY)).toBe(false);
  });

  it("variable vide ou blanche : toujours invisible", async () => {
    const p = await loadPlans({ "STRIPE_PRICE_ID_LOCAL_PRESENCE_OPTIMIZER": "  " });
    expect(p.ADDON_DEFINITIONS[KEY]).toBeUndefined();
  });

  it("variable LIVE definie : visible, 9 EUR/mois, achetable sur Pro, Ultra et Agency (pas Standard)", async () => {
    const p = await loadPlans({ "STRIPE_PRICE_ID_LOCAL_PRESENCE_OPTIMIZER": "price_live_fixture" });
    expect(p.ADDON_DEFINITIONS[KEY]).toMatchObject({ name: "Local Presence Optimizer", priceEur: 9, oneTime: false, quantity: false });
    expect(p.ADDON_PRICE_IDS[KEY]).toBe("price_live_fixture");
    expect(p.getAddonForPriceId("price_live_fixture")).toBe(KEY);
    expect(p.getAddonAvailability(KEY)).toBe("available");
    for (const plan of PLANS) expect(p.isPlanAllowedAddon(plan, KEY)).toBe(true);
    expect(p.isPlanAllowedAddon("standard", KEY)).toBe(false);
  });

  it("un prix TEST sans mode test Stripe n'ouvre rien", async () => {
    const p = await loadPlans({ "STRIPE_TEST_PRICE_ID_ADDON_LOCAL_PRESENCE": "price_test_fixture" });
    expect(p.ADDON_DEFINITIONS[KEY]).toBeUndefined();
  });

  it("mode test Stripe + prix TEST : ouvert en test uniquement, sans prix LIVE", async () => {
    const p = await loadPlans({ "STRIPE_TEST_PRICE_ID_ADDON_LOCAL_PRESENCE": "price_test_fixture", STRIPE_TEST_MODE: "true", STRIPE_TEST_KEY: "sk_test_fixture" });
    expect(p.ADDON_DEFINITIONS[KEY]).toBeDefined();
    expect(p.getAddonPriceId(KEY, "sk_test_fixture")).toBe("price_test_fixture");
    expect(p.getAddonPriceId(KEY, "sk_live_fixture")).toBeUndefined();
  });

  it("ne modifie aucun add-on existant (prix, noms, cles)", async () => {
    const base = await loadPlans({});
    const open = await loadPlans({ "STRIPE_PRICE_ID_LOCAL_PRESENCE_OPTIMIZER": "price_live_fixture" });
    const before = Object.keys(base.ADDON_DEFINITIONS);
    for (const k of before) expect(open.ADDON_DEFINITIONS[k]).toEqual(base.ADDON_DEFINITIONS[k]);
    expect(Object.keys(open.ADDON_DEFINITIONS)).toEqual([...before, KEY]);
    for (const k of Object.keys(base.ADDON_PRICE_IDS)) expect(open.ADDON_PRICE_IDS[k]).toBe(base.ADDON_PRICE_IDS[k]);
  });

  it("la route est montee derriere requireAddon(cle) : 402 sans droit, jamais de donnee", () => {
    const route = readFileSync(new URL("../routes/local-presence-optimizer.ts", import.meta.url), "utf8");
    expect(route).toMatch(/router\.use\([^\n]*requireAddon\("localPresenceOptimizer"/);
    const index = readFileSync(new URL("../routes/index.ts", import.meta.url), "utf8");
    expect(index).toContain("router.use(localPresenceOptimizerRouter);");
  });
});
