import { describe, it, expect } from "vitest";
import { customerAddressFrom } from "./customer-address.js";

describe("customerAddressFrom — adresse du client Stripe (#466)", () => {
  it("inscription courte : pays seul, transmis tel quel", () => {
    expect(customerAddressFrom({ address: null, city: null, postal_code: null, country: "be" })).toEqual({ country: "BE" });
  });
  it("formulaire complet : adresse complete conservee", () => {
    expect(customerAddressFrom({ address: "1 rue de la Loi", city: "Bruxelles", postal_code: "1000", country: "BE" }))
      .toEqual({ line1: "1 rue de la Loi", city: "Bruxelles", postal_code: "1000", country: "BE" });
  });
  it("ancien remplissage Google : jamais transmis comme une vraie adresse", () => {
    expect(customerAddressFrom({ address: "—", city: "—", postal_code: "00000", country: "FR" })).toEqual({ country: "FR" });
  });
  it("adresse saisie au paiement : prioritaire sur la ligne en attente", () => {
    expect(customerAddressFrom({ address: null, country: "FR" }, { line1: "2 rue X", city: "Lyon", postal_code: "69001", country: "FR" }))
      .toEqual({ line1: "2 rue X", city: "Lyon", postal_code: "69001", country: "FR" });
  });
  it("rien d'exploitable ou pays invalide : aucune adresse", () => {
    expect(customerAddressFrom(null)).toBeNull();
    expect(customerAddressFrom({ address: "", country: "" })).toBeNull();
    expect(customerAddressFrom({ country: "France" })).toBeNull();
  });
});
