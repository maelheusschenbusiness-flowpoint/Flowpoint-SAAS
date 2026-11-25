import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// crmIntegration / aiGbpPosting : en mode TEST, le prix doit venir de STRIPE_TEST_PRICE_ID_ADDON_*,
// jamais de l'id LIVE code en dur (Stripe TEST repond « No such price » -> activation 502).
async function loadPlans(env: Record<string, string>) {
  vi.resetModules();
  for (const k of ["STRIPE_TEST_PRICE_ID_ADDON_CRM_INTEGRATION", "STRIPE_TEST_PRICE_ID_ADDON_AI_GBP_POSTING"]) {
    vi.stubEnv(k, env[k] ?? "");
  }
  return import("./plans.js");
}

describe("prix TEST des add-ons CRM et AI GBP Posting", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("variables TEST posees : getAddonPriceId les renvoie avec une cle sk_test_", async () => {
    const p = await loadPlans({
      STRIPE_TEST_PRICE_ID_ADDON_CRM_INTEGRATION: "price_test_crm",
      STRIPE_TEST_PRICE_ID_ADDON_AI_GBP_POSTING: "price_test_gbp",
    });
    expect(p.getAddonPriceId("crmIntegration", "sk_test_x")).toBe("price_test_crm");
    expect(p.getAddonPriceId("aiGbpPosting", "sk_test_x")).toBe("price_test_gbp");
  });

  it("une cle LIVE n'utilise jamais le prix TEST", async () => {
    const p = await loadPlans({
      STRIPE_TEST_PRICE_ID_ADDON_CRM_INTEGRATION: "price_test_crm",
      STRIPE_TEST_PRICE_ID_ADDON_AI_GBP_POSTING: "price_test_gbp",
    });
    expect(p.getAddonPriceId("crmIntegration", "sk_live_x")).not.toBe("price_test_crm");
    expect(p.getAddonPriceId("aiGbpPosting", "sk_live_x")).not.toBe("price_test_gbp");
  });

  it("variables TEST absentes : comportement inchange (repli sur la table LIVE)", async () => {
    const p = await loadPlans({});
    expect(p.getAddonPriceId("crmIntegration", "sk_test_x")).toBe(p.ADDON_PRICE_IDS["crmIntegration"]);
  });
});
