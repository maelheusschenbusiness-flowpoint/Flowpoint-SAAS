/**
 * plan-price-mode.test.ts
 *
 * P0 demontre en certification Stripe : en mode test, la creation d'abonnement
 * echouait car le prix du PLAN etait resolu depuis PLAN_PRICE_IDS, c'est-a-dire
 * les identifiants LIVE. Stripe refusait :
 *   No such price: 'price_1StW0A9…'; a similar object exists in live mode,
 *   but a test mode key was used to make this request.   (resource_missing)
 * PLAN_PRICE_IDS_TEST existait mais n'etait lu que par la resolution inverse
 * getPlanForPriceId(). Les add-ons avaient deja leur accesseur conscient du
 * mode (getAddonPriceId) ; les plans non.
 *
 * getPlanPriceId() comble cet ecart. Ces tests verrouillent la symetrie avec
 * les add-ons et le garde-fou du prefixe sk_test_.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const LIVE = { standard: "price_live_std", pro: "price_live_pro", ultra: "price_live_ultra" };
const TEST = { standard: "price_test_std", pro: "price_test_pro" }; // ultra volontairement absent

let saved: Record<string, string | undefined>;
const KEYS = [
  "STRIPE_TEST_MODE", "STRIPE_TEST_KEY", "STRIPE_TEST_SECRET_KEY",
  "STRIPE_SECRET_KEY", "STRIPE_LIVE_API_KEY",
  "STRIPE_PRICE_ID_STANDARD", "STRIPE_PRICE_ID_PRO", "STRIPE_PRICE_ID_ULTRA",
  "STRIPE_TEST_PRICE_ID_STANDARD", "STRIPE_TEST_PRICE_ID_PRO", "STRIPE_TEST_PRICE_ID_ULTRA",
];

async function load() {
  vi.resetModules();
  return await import("./plans.js");
}

beforeEach(() => {
  saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env["STRIPE_PRICE_ID_STANDARD"] = LIVE.standard;
  process.env["STRIPE_PRICE_ID_PRO"]      = LIVE.pro;
  process.env["STRIPE_PRICE_ID_ULTRA"]    = LIVE.ultra;
  process.env["STRIPE_TEST_PRICE_ID_STANDARD"] = TEST.standard;
  process.env["STRIPE_TEST_PRICE_ID_PRO"]      = TEST.pro;
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

describe("getPlanPriceId — resolution consciente du mode Stripe", () => {
  it("mode test actif : rend le prix de TEST", async () => {
    process.env["STRIPE_TEST_MODE"] = "true";
    process.env["STRIPE_TEST_SECRET_KEY"] = "sk_test_abc";
    const { getPlanPriceId } = await load();
    expect(getPlanPriceId("pro")).toBe(TEST.pro);
    expect(getPlanPriceId("standard")).toBe(TEST.standard);
  });

  it("mode test actif mais aucun prix de test pour ce plan : repli sur le prix live", async () => {
    process.env["STRIPE_TEST_MODE"] = "true";
    process.env["STRIPE_TEST_SECRET_KEY"] = "sk_test_abc";
    const { getPlanPriceId } = await load();
    // Mieux vaut un prix live refuse par Stripe qu'un undefined silencieux.
    expect(getPlanPriceId("ultra")).toBe(LIVE.ultra);
  });

  it("hors mode test : rend le prix LIVE meme si des prix de test sont configures", async () => {
    process.env["STRIPE_SECRET_KEY"] = "sk_live_xyz";
    const { getPlanPriceId } = await load();
    expect(getPlanPriceId("pro")).toBe(LIVE.pro);
  });

  it("garde-fou : STRIPE_TEST_MODE=true sans cle sk_test_ ne bascule PAS en test", async () => {
    process.env["STRIPE_TEST_MODE"] = "true";
    process.env["STRIPE_SECRET_KEY"] = "sk_live_xyz";   // aucune cle de test fournie
    const { getPlanPriceId } = await load();
    expect(getPlanPriceId("pro")).toBe(LIVE.pro);
  });

  it("la cle passee par l'appelant prime sur l'environnement", async () => {
    process.env["STRIPE_SECRET_KEY"] = "sk_live_xyz";
    const { getPlanPriceId } = await load();
    expect(getPlanPriceId("pro", "sk_test_explicite")).toBe(TEST.pro);
    expect(getPlanPriceId("pro", "sk_live_explicite")).toBe(LIVE.pro);
  });

  it("plan inconnu ou vide : undefined, jamais un prix d'un autre plan", async () => {
    process.env["STRIPE_SECRET_KEY"] = "sk_live_xyz";
    const { getPlanPriceId } = await load();
    expect(getPlanPriceId("inexistant")).toBeUndefined();
    expect(getPlanPriceId("")).toBeUndefined();
  });

  it("casse indifferente, comme les autres accesseurs de plan", async () => {
    process.env["STRIPE_TEST_MODE"] = "true";
    process.env["STRIPE_TEST_SECRET_KEY"] = "sk_test_abc";
    const { getPlanPriceId } = await load();
    expect(getPlanPriceId("PRO")).toBe(TEST.pro);
  });

  it("symetrie avec les add-ons : meme regle de bascule", async () => {
    process.env["STRIPE_TEST_MODE"] = "true";
    process.env["STRIPE_TEST_SECRET_KEY"] = "sk_test_abc";
    const { getPlanPriceId, getAddonPriceId } = await load();
    // getAddonPriceId prend la cle en argument ; getPlanPriceId sait aussi la
    // resoudre seul. Les deux doivent conclure identiquement sur le mode.
    expect(getPlanPriceId("pro", "sk_test_abc")).toBe(TEST.pro);
    expect(typeof getAddonPriceId("monitorsPack10", "sk_test_abc")).toBe("string");
  });
});
