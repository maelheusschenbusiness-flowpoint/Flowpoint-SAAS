import { describe, it, expect } from "vitest";
import { assertCleSecreteTest, assertClePubliableTest, assertSecretWebhookTest, assertEnvironnementSansCleLive, masquerSecrets, assertCompteTest, CleRefusee } from "./garde-cles.ts";

const SK_TEST = "sk_test_" + "a".repeat(30);
const SK_LIVE = "sk_live_" + "b".repeat(30);

describe("garde de cles Stripe : jamais de live", () => {
  it("accepte sk_test_", () => { expect(assertCleSecreteTest(SK_TEST)).toBe(SK_TEST); });
  it("refuse sk_live_, rk_live_, vide, autre prefixe, espaces", () => {
    for (const k of [SK_LIVE, "rk_live_" + "c".repeat(30), "", undefined, "pk_test_" + "d".repeat(30), "sk_" + "e".repeat(30), "sk_test_ court", "sk_test_" + "a b".repeat(10)]) {
      expect(() => assertCleSecreteTest(k as string | undefined)).toThrow(CleRefusee);
    }
  });
  it("le message d'erreur ne contient jamais la cle", () => {
    try { assertCleSecreteTest(SK_LIVE); } catch (e) { expect(String((e as Error).message)).not.toContain(SK_LIVE); expect(String((e as Error).message)).not.toContain("bbbbbbbb"); }
  });
  it("cle publiable : pk_test_ seulement", () => {
    expect(assertClePubliableTest("pk_test_" + "a".repeat(20))).toMatch(/^pk_test_/);
    expect(() => assertClePubliableTest("pk_live_" + "a".repeat(20))).toThrow(CleRefusee);
    expect(() => assertClePubliableTest(undefined)).toThrow(CleRefusee);
  });
  it("secret de webhook : format whsec_, refus s'il est identique a un secret de production de l'environnement", () => {
    const ok = "whsec_" + "x".repeat(20);
    expect(assertSecretWebhookTest(ok, {})).toBe(ok);
    expect(() => assertSecretWebhookTest("abc", {})).toThrow(CleRefusee);
    expect(() => assertSecretWebhookTest(undefined, {})).toThrow(CleRefusee);
    expect(() => assertSecretWebhookTest(ok, { STRIPE_WEBHOOK_SECRET: ok })).toThrow(/production/);
    expect(() => assertSecretWebhookTest(ok, { STRIPE_WEBHOOK_SECRET_RENDER: ok })).toThrow(/production/);
  });
  it("environnement contamine par une cle live : refuse", () => {
    expect(() => assertEnvironnementSansCleLive({ STRIPE_LIVE_API_KEY: SK_LIVE })).toThrow(CleRefusee);
    expect(() => assertEnvironnementSansCleLive({ STRIPE_SECRET_KEY: SK_LIVE })).toThrow(CleRefusee);
    expect(() => assertEnvironnementSansCleLive({ PUBLIC_STRIPE_API_KEY: "pk_live_" + "z".repeat(20) })).toThrow(CleRefusee);
    expect(() => assertEnvironnementSansCleLive({ STRIPE_TEST_SECRET_KEY: SK_TEST })).not.toThrow();
  });
  it("compte : livemode doit etre false", () => {
    expect(() => assertCompteTest({ livemode: false })).not.toThrow();
    expect(() => assertCompteTest({ livemode: true })).toThrow(CleRefusee);
    expect(() => assertCompteTest({})).toThrow(CleRefusee);
    expect(() => assertCompteTest(null)).toThrow(CleRefusee);
  });
  it("masquerSecrets retire cles, whsec et valeurs d'environnement", () => {
    const t = masquerSecrets(`erreur avec ${SK_TEST} et whsec_${"q".repeat(12)} et motdepasse-secret-123`, { MON_TOKEN: "motdepasse-secret-123" });
    expect(t).not.toContain(SK_TEST); expect(t).not.toContain("whsec_qqqq"); expect(t).not.toContain("motdepasse-secret-123");
  });
});
