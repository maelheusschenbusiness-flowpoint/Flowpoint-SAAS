import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Regression : en mode TEST, l'item d'abonnement d'add-on porte le prix TEST
// (getAddonPriceId). La reconciliation du webhook retrouve la cle par
// getAddonForPriceId : elle doit donc aussi connaitre les prix TEST, sinon tous
// les add-ons payants sont desactives des qu'un 2e add-on est ajoute.
async function loadPlans(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import("./plans.js");
}

describe("getAddonForPriceId : prix TEST", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("retrouve la cle d'un add-on a partir de son prix TEST (zapier, ldm, pack)", async () => {
    const p = await loadPlans({
      STRIPE_TEST_PRICE_ID_ADDON_ZAPIER: "price_test_zap",
      STRIPE_TEST_PRICE_ID_ADDON_LOCAL_DOMINATION_MAPS: "price_test_ldm",
      STRIPE_TEST_PRICE_ID_ADDON_AUDITS200: "price_test_a200",
    });
    expect(p.getAddonForPriceId("price_test_zap")).toBe("zapierIntegration");
    expect(p.getAddonForPriceId("price_test_ldm")).toBe("localDominationMaps");
    expect(p.getAddonForPriceId("price_test_a200")).toBe("auditsPack200");
  });

  it("la recherche par prix LIVE et le cas vide/inconnu sont inchanges", async () => {
    const p = await loadPlans({ STRIPE_TEST_PRICE_ID_ADDON_ZAPIER: "price_test_zap" });
    const [key, liveId] = Object.entries(p.ADDON_PRICE_IDS).find(([, v]) => !!v)!;
    expect(p.getAddonForPriceId(liveId)).toBe(key);
    expect(p.getAddonForPriceId("")).toBeNull();
    expect(p.getAddonForPriceId("price_inconnu")).toBeNull();
  });
});
