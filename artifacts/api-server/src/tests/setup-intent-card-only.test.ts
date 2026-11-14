/**
 * Garde de non-regression : le SetupIntent de l'essai gratuit n'accepte que la CARTE (promesse « carte bancaire obligatoire »).
 * Test statique du code de la route (comme tests/signin-mesure-tunnel.test.ts) : aucune dependance reseau.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(process.cwd(), "src/routes/public-billing.ts"), "utf8");

function bloc(depart: string): string {
  const i = SOURCE.indexOf(depart);
  expect(i, `${depart} introuvable`).toBeGreaterThan(-1);
  const fin = SOURCE.indexOf("}, {", i);
  return SOURCE.slice(i, fin).replace(/\/\*[\s\S]*?\*\//g, ""); // sans commentaires
}

describe("SetupIntent de l'essai : carte uniquement", () => {
  const setup = bloc("const si = await stripe.setupIntents.create({");
  it("restreint les moyens de paiement a la carte", () => {
    expect(setup).toMatch(/payment_method_types:\s*\["card"\]/);
  });
  it("n'utilise plus automatic_payment_methods (BLIK, Revolut Pay, SEPA, Link...)", () => {
    expect(setup).not.toMatch(/automatic_payment_methods/);
  });
  it("reste un SetupIntent hors session pour le debit automatique a J+14", () => {
    expect(setup).toMatch(/usage:\s*"off_session"/);
  });
});
