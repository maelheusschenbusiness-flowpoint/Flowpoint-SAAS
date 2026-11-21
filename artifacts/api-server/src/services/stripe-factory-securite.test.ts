import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getStripeKey, isStripeTestMode } from "./stripe-factory.js";

const KEYS = ["STRIPE_TEST_MODE", "STRIPE_TEST_KEY", "STRIPE_TEST_SECRET_KEY", "STRIPE_LIVE_API_KEY", "STRIPE_SECRET_KEY"] as const;
let saved: Record<string, string | undefined> = {};

beforeEach(() => { saved = {}; for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe("getStripeKey : un environnement TEST n'utilise jamais une cle LIVE", () => {
  it("mode test + cle de test valide : renvoie la cle de test", () => {
    process.env["STRIPE_TEST_MODE"] = "true";
    process.env["STRIPE_TEST_KEY"] = "sk_test_valide";
    process.env["STRIPE_LIVE_API_KEY"] = "sk_live_ne_doit_pas_servir";
    process.env["STRIPE_SECRET_KEY"] = "sk_live_ne_doit_pas_servir";
    expect(getStripeKey()).toBe("sk_test_valide");
  });

  it("mode test + cle de test ABSENTE : renvoie \"\" meme si des cles LIVE sont presentes", () => {
    process.env["STRIPE_TEST_MODE"] = "true";
    process.env["STRIPE_LIVE_API_KEY"] = "sk_live_a";
    process.env["STRIPE_SECRET_KEY"] = "sk_live_b";
    expect(getStripeKey()).toBe("");
  });

  it("mode test + cle de test INVALIDE (prefixe) : renvoie \"\" et jamais la cle LIVE", () => {
    process.env["STRIPE_TEST_MODE"] = "true";
    process.env["STRIPE_TEST_KEY"] = "sk_live_mal_nommee";
    process.env["STRIPE_SECRET_KEY"] = "sk_live_b";
    expect(getStripeKey()).toBe("");
    process.env["STRIPE_TEST_KEY"] = "pk_test_publiable";
    expect(getStripeKey()).toBe("");
  });

  it("cle de repli STRIPE_TEST_SECRET_KEY acceptee seulement si sk_test_", () => {
    process.env["STRIPE_TEST_MODE"] = "true";
    process.env["STRIPE_TEST_SECRET_KEY"] = "sk_test_repli";
    expect(getStripeKey()).toBe("sk_test_repli");
  });

  it("production (STRIPE_TEST_MODE absent ou autre que true) : comportement INCHANGE", () => {
    process.env["STRIPE_SECRET_KEY"] = "sk_live_prod";
    expect(isStripeTestMode()).toBe(false);
    expect(getStripeKey()).toBe("sk_live_prod");
    process.env["STRIPE_LIVE_API_KEY"] = "sk_live_prioritaire";
    expect(getStripeKey()).toBe("sk_live_prioritaire");
    process.env["STRIPE_TEST_MODE"] = "false";
    expect(getStripeKey()).toBe("sk_live_prioritaire");
    process.env["STRIPE_TEST_KEY"] = "sk_test_ignoree_hors_mode_test";
    expect(getStripeKey()).toBe("sk_live_prioritaire");
  });
});

describe("aucune lecture directe d'une cle LIVE hors de stripe-factory", () => {
  const racine = join(__dirname, "..");
  function fichiers(dir: string): string[] {
    return readdirSync(dir).flatMap((nom) => {
      const p = join(dir, nom);
      if (statSync(p).isDirectory()) return nom === "node_modules" ? [] : fichiers(p);
      return p.endsWith(".ts") && !p.endsWith(".test.ts") && !nom.startsWith("_scenario") ? [p] : [];
    });
  }
  it("les variables de cle LIVE ne sont lues que par stripe-factory.ts et lib/env.ts", () => {
    const autorises = new Set([join(racine, "services", "stripe-factory.ts"), join(racine, "lib", "env.ts")]);
    const motif = /process\.env(?:\[\s*["'](?:STRIPE_LIVE_API_KEY|STRIPE_SECRET_KEY)["']\s*\]|\.(?:STRIPE_LIVE_API_KEY|STRIPE_SECRET_KEY))/;
    const fautifs = fichiers(racine).filter((f) => !autorises.has(f) && motif.test(readFileSync(f, "utf8")));
    expect(fautifs.map((f) => f.slice(racine.length))).toEqual([]);
  });
});
