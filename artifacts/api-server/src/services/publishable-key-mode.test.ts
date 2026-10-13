/**
 * publishable-key-mode.test.ts
 *
 * La cle publiable renvoyee au navigateur doit toujours appartenir au MEME
 * mode que la cle secrete qui a cree l'intent. Une pk_live_ laisse Stripe.js
 * se charger mais empeche un SetupIntent de TEST de produire un Payment
 * Element utilisable (et inversement) : l'echec se produit dans le navigateur,
 * loin de sa cause.
 *
 * Constate en certification : trois routes lisaient
 * `STRIPE_PUBLISHABLE_KEY ?? PUBLIC_STRIPE_API_KEY` SANS tenir compte du mode
 * (routes/index.ts, deux routes de billing.ts), tandis que le parcours public
 * avait son propre helper conscient du mode. Un operateur en mode test avec une
 * pk_live_ de production livrait donc une cle live avec un intent de test.
 *
 * getPublishableKey() centralise la selection et GARANTIT la concordance des
 * prefixes : en cas de desaccord elle rend "", ce que le front traite par un
 * message explicite, au lieu d'une cle du mauvais mode qui echouerait en
 * silence dans Stripe.js.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const PK_TEST = "pk_test_51AbCdEf";
const PK_LIVE = "pk_live_51AbCdEf";
const SK_TEST = "sk_test_51AbCdEf";
const SK_LIVE = "sk_live_51AbCdEf";

const KEYS = [
  "STRIPE_TEST_MODE", "STRIPE_TEST_KEY", "STRIPE_TEST_SECRET_KEY",
  "STRIPE_SECRET_KEY", "STRIPE_LIVE_API_KEY",
  "STRIPE_PUBLISHABLE_KEY", "PUBLIC_STRIPE_API_KEY", "STRIPE_TEST_PUBLISHABLE_KEY",
];
let saved: Record<string, string | undefined>;

async function load() {
  vi.resetModules();
  return await import("./stripe-factory.js");
}

beforeEach(() => {
  saved = {};
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

/** Active le mode test comme le fait la configuration documentee. */
function testMode(pub?: string) {
  process.env["STRIPE_TEST_MODE"] = "true";
  process.env["STRIPE_TEST_SECRET_KEY"] = SK_TEST;
  if (pub !== undefined) process.env["STRIPE_TEST_PUBLISHABLE_KEY"] = pub;
}
function liveMode(pub?: string) {
  process.env["STRIPE_SECRET_KEY"] = SK_LIVE;
  if (pub !== undefined) process.env["STRIPE_PUBLISHABLE_KEY"] = pub;
}

describe("getPublishableKey — mode TEST", () => {
  it("rend la cle publiable de test", async () => {
    testMode(PK_TEST);
    const { getPublishableKey } = await load();
    expect(getPublishableKey()).toBe(PK_TEST);
  });

  it("ne rend JAMAIS une pk_live_ avec une cle secrete de test", async () => {
    testMode(PK_LIVE);
    const { getPublishableKey } = await load();
    expect(getPublishableKey()).toBe("");
  });

  it("ignore la cle publiable LIVE meme si elle est la seule configuree", async () => {
    testMode();
    process.env["STRIPE_PUBLISHABLE_KEY"] = PK_LIVE;
    process.env["PUBLIC_STRIPE_API_KEY"]  = PK_LIVE;
    const { getPublishableKey } = await load();
    expect(getPublishableKey()).toBe("");
  });

  it("aucune cle de test configuree : rend \"\" plutot qu'une cle d'un autre mode", async () => {
    testMode();
    const { getPublishableKey } = await load();
    expect(getPublishableKey()).toBe("");
  });
});

describe("getPublishableKey — mode LIVE", () => {
  it("rend la cle publiable live", async () => {
    liveMode(PK_LIVE);
    const { getPublishableKey } = await load();
    expect(getPublishableKey()).toBe(PK_LIVE);
  });

  it("repli sur PUBLIC_STRIPE_API_KEY quand STRIPE_PUBLISHABLE_KEY est absente", async () => {
    liveMode();
    process.env["PUBLIC_STRIPE_API_KEY"] = PK_LIVE;
    const { getPublishableKey } = await load();
    expect(getPublishableKey()).toBe(PK_LIVE);
  });

  it("ne rend JAMAIS une pk_test_ avec une cle secrete live", async () => {
    liveMode(PK_TEST);
    const { getPublishableKey } = await load();
    expect(getPublishableKey()).toBe("");
  });

  it("ignore une pk_test_ posee dans PUBLIC_STRIPE_API_KEY", async () => {
    liveMode();
    process.env["PUBLIC_STRIPE_API_KEY"] = PK_TEST;
    const { getPublishableKey } = await load();
    expect(getPublishableKey()).toBe("");
  });
});

describe("getPublishableKey — cle explicite de l'appelant", () => {
  it("la cle secrete passee en argument determine le mode", async () => {
    process.env["STRIPE_TEST_PUBLISHABLE_KEY"] = PK_TEST;
    process.env["STRIPE_PUBLISHABLE_KEY"]      = PK_LIVE;
    process.env["STRIPE_SECRET_KEY"]           = SK_LIVE;
    const { getPublishableKey } = await load();
    expect(getPublishableKey(SK_TEST)).toBe(PK_TEST);
    expect(getPublishableKey(SK_LIVE)).toBe(PK_LIVE);
  });

  it("une cle secrete de forme inconnue est traitee comme LIVE (la cle de test n'est pas distribuee)", async () => {
    process.env["STRIPE_PUBLISHABLE_KEY"]      = PK_LIVE;
    process.env["STRIPE_TEST_PUBLISHABLE_KEY"] = PK_TEST;
    const { getPublishableKey } = await load();
    expect(getPublishableKey("rk_other_xxx")).toBe(PK_LIVE);
  });
});

describe("getStripeKeyPairMode — diagnostic sans secret", () => {
  it("signale la concordance en mode test", async () => {
    testMode(PK_TEST);
    const { getStripeKeyPairMode } = await load();
    expect(getStripeKeyPairMode()).toEqual({ secretMode: "TEST", publishableMode: "TEST", coherent: true });
  });

  it("signale la concordance en mode live", async () => {
    liveMode(PK_LIVE);
    const { getStripeKeyPairMode } = await load();
    expect(getStripeKeyPairMode()).toEqual({ secretMode: "LIVE", publishableMode: "LIVE", coherent: true });
  });

  it("signale l'incoherence : cle live posee en mode test", async () => {
    testMode(PK_LIVE);
    const { getStripeKeyPairMode } = await load();
    const r = getStripeKeyPairMode();
    expect(r.secretMode).toBe("TEST");
    expect(r.publishableMode).toBe("MISSING");
    expect(r.coherent).toBe(false);
  });

  it("ne renvoie aucune valeur de cle", async () => {
    testMode(PK_TEST);
    const { getStripeKeyPairMode } = await load();
    const serialized = JSON.stringify(getStripeKeyPairMode());
    expect(serialized).not.toContain(PK_TEST);
    expect(serialized).not.toContain(SK_TEST);
  });
});
