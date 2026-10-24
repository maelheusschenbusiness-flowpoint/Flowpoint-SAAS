/**
 * plans-prix-test-manquants.test.ts
 *
 * MESURE DU 18/10/2026 sur l'environnement de test deploye, qui tourne bien en
 * mode test (`/api/billing/config` renvoie un `pk_test_`) :
 *
 *   GET /api/billing/plans
 *     standard → price_1UAt5K9e…   (distinct du live : variable de test posee)
 *     pro      → price_1StW0A9e…   = PLAN_PRICE_IDS.pro   — prix LIVE
 *     ultra    → price_1StW109e…   = PLAN_PRICE_IDS.ultra — prix LIVE
 *
 * Stripe refuse un prix live presente avec une cle `sk_test_` :
 *   « No such price … a similar object exists in live mode, but a test mode key
 *     was used to make this request. »
 * La creation d'une session Checkout etait donc impossible pour `pro` et
 * `ultra`, et rien ne le signalait avant l'echec cote Stripe.
 *
 * Le repli sur le prix live reste un choix assume (`plan-price-mode.test.ts`).
 * Ce qui manquait, c'est de le dire. `plansRepliantSurPrixLive()` le dit, et
 * nomme la variable a poser.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const LIVE = { standard: "price_live_std", pro: "price_live_pro", ultra: "price_live_ultra" };

const CLES = [
  "STRIPE_TEST_MODE", "STRIPE_TEST_KEY", "STRIPE_TEST_SECRET_KEY",
  "STRIPE_SECRET_KEY", "STRIPE_LIVE_API_KEY",
  "STRIPE_PRICE_ID_STANDARD", "STRIPE_PRICE_ID_PRO", "STRIPE_PRICE_ID_ULTRA",
  "STRIPE_TEST_PRICE_ID_STANDARD", "STRIPE_TEST_PRICE_ID_PRO", "STRIPE_TEST_PRICE_ID_ULTRA",
];
let sauve: Record<string, string | undefined>;

async function charger() {
  vi.resetModules();
  return await import("./plans.js");
}

beforeEach(() => {
  sauve = {};
  for (const k of CLES) { sauve[k] = process.env[k]; delete process.env[k]; }
  process.env["STRIPE_PRICE_ID_STANDARD"] = LIVE.standard;
  process.env["STRIPE_PRICE_ID_PRO"]      = LIVE.pro;
  process.env["STRIPE_PRICE_ID_ULTRA"]    = LIVE.ultra;
});

afterEach(() => {
  for (const k of CLES) {
    if (sauve[k] === undefined) delete process.env[k]; else process.env[k] = sauve[k];
  }
  vi.resetModules();
});

describe("plansRepliantSurPrixLive", () => {
  it("reproduit la configuration mesuree : standard pose, pro et ultra absents", async () => {
    process.env["STRIPE_TEST_MODE"] = "true";
    process.env["STRIPE_TEST_KEY"] = "sk_test_abc";
    process.env["STRIPE_TEST_PRICE_ID_STANDARD"] = "price_test_std";
    const { plansRepliantSurPrixLive } = await charger();

    const replis = plansRepliantSurPrixLive();
    expect(replis.map((r) => r.plan).sort()).toEqual(["pro", "ultra"]);
    expect(replis.map((r) => r.variableAttendue).sort())
      .toEqual(["STRIPE_TEST_PRICE_ID_PRO", "STRIPE_TEST_PRICE_ID_ULTRA"]);
    // L'identifiant signale est bien le prix live, celui que Stripe refusera.
    expect(replis.find((r) => r.plan === "pro")?.priceIdLive).toBe(LIVE.pro);
  });

  it("les trois variables de test posees : plus rien a signaler", async () => {
    process.env["STRIPE_TEST_MODE"] = "true";
    process.env["STRIPE_TEST_KEY"] = "sk_test_abc";
    process.env["STRIPE_TEST_PRICE_ID_STANDARD"] = "price_test_std";
    process.env["STRIPE_TEST_PRICE_ID_PRO"]      = "price_test_pro";
    process.env["STRIPE_TEST_PRICE_ID_ULTRA"]    = "price_test_ultra";
    const { plansRepliantSurPrixLive } = await charger();
    expect(plansRepliantSurPrixLive()).toEqual([]);
  });

  it("aucune variable de test : les trois plans sont signales", async () => {
    process.env["STRIPE_TEST_MODE"] = "true";
    process.env["STRIPE_TEST_KEY"] = "sk_test_abc";
    const { plansRepliantSurPrixLive } = await charger();
    expect(plansRepliantSurPrixLive().map((r) => r.plan).sort())
      .toEqual(["pro", "standard", "ultra"]);
  });

  it("hors mode test, rien n'est signale — un prix live y est correct", async () => {
    process.env["STRIPE_SECRET_KEY"] = "sk_live_xyz";
    const { plansRepliantSurPrixLive } = await charger();
    expect(plansRepliantSurPrixLive()).toEqual([]);
  });

  it("STRIPE_TEST_MODE=true sans cle sk_test_ ne declenche rien : le mode n'a pas basculé", async () => {
    process.env["STRIPE_TEST_MODE"] = "true";
    process.env["STRIPE_SECRET_KEY"] = "sk_live_xyz";   // aucune cle de test
    const { plansRepliantSurPrixLive } = await charger();
    expect(plansRepliantSurPrixLive()).toEqual([]);
  });

  it("la cle peut etre fournie explicitement, sans dependre de l'environnement", async () => {
    process.env["STRIPE_TEST_PRICE_ID_STANDARD"] = "price_test_std";
    const { plansRepliantSurPrixLive } = await charger();
    expect(plansRepliantSurPrixLive("sk_live_x")).toEqual([]);
    expect(plansRepliantSurPrixLive("sk_test_x").map((r) => r.plan).sort())
      .toEqual(["pro", "ultra"]);
  });

  it("coherence avec getPlanPriceId : un prix TEST manquant ne resout jamais vers LIVE", async () => {
    process.env["STRIPE_TEST_MODE"] = "true";
    process.env["STRIPE_TEST_KEY"] = "sk_test_abc";
    process.env["STRIPE_TEST_PRICE_ID_STANDARD"] = "price_test_std";
    const { plansRepliantSurPrixLive, getPlanPriceId } = await charger();
    for (const r of plansRepliantSurPrixLive()) {
      expect(getPlanPriceId(r.plan), `${r.plan} ne resout pas vers le prix signale`)
        .toBeUndefined();
    }
    // et le plan correctement configure ne doit pas etre signale
    expect(getPlanPriceId("standard")).toBe("price_test_std");
  });
});
