/**
 * D3 : un lien direct /checkout.html?plan=… par un visiteur anonyme garde son plan a l'inscription
 * (panier estampille _v / _updatedAt). Parcours navigateur : tests/browser/certification/10-navigation-erreurs.cert.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CHECKOUT = readFileSync(join(process.cwd(), "../flowpoint-export/checkout.html"), "utf8");

describe("D3 checkout.html : lien direct ?plan= par un visiteur anonyme", () => {
  it("le panier cree depuis l'URL est estampille et le plan passe par une liste blanche", () => {
    expect(CHECKOUT).toContain("['standard', 'pro', 'ultra'].indexOf(earlyPlan) !== -1");
    expect(CHECKOUT).toMatch(/cart = \{ plan: earlyPlan, addons: earlyAddons, _v: 1, _updatedAt: Date\.now\(\) \}/);
  });
});
