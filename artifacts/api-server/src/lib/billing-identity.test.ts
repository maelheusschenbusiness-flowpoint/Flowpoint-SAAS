import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeVat, stripeBillingFields, taxDecision, stripeTaxParams, sellerVatStatus } from "./billing-identity.js";
import { PLAN_PRICE_IDS } from "./plans.js";

describe("normalizeVat — format seulement, jamais une preuve", () => {
  it.each([
    ["BE 0123.456.789", "BE", "BE0123456789", "BE"],
    ["be123456789", "BE", "BE0123456789", "BE"],          // ancien format belge
    ["FR 12 345678901", "FR", "FR12345678901", "FR"],
    ["12345678901", "FR", "FR12345678901", "FR"],          // sans prefixe : pays du client
    ["EL123456789", "GR", "EL123456789", "GR"],
    ["NL123456789B01", "NL", "NL123456789B01", "NL"],
  ])("%s → %s", (raw, country, value, iso) => {
    const r = normalizeVat(raw, country);
    expect(r).toMatchObject({ value, country: iso, formatValid: true, reason: null });
  });
  it("vide, prefixe inconnu, mauvais format, pays incoherent", () => {
    expect(normalizeVat("", "FR").reason).toBe("empty");
    expect(normalizeVat("XX123", null).reason).toBe("unknown_prefix");
    expect(normalizeVat("BE12345", "BE").reason).toBe("bad_format");
    expect(normalizeVat("BE0123456789", "FR")).toMatchObject({ formatValid: true, reason: "country_mismatch" });
  });
});

describe("stripeBillingFields — nom, adresse si elle existe, pays, TVA", () => {
  it("inscription courte : nom de la personne, pays seul, pas de TVA", () => {
    expect(stripeBillingFields({ firstName: "Camille", lastName: "Martin", country: "be" }))
      .toMatchObject({ name: "Camille Martin", address: { country: "BE" } });
    expect(stripeBillingFields({ firstName: "Camille", lastName: "Martin", country: "BE" }).taxId).toBeUndefined();
  });
  it("entreprise et TVA valide : nom de l'entreprise, eu_vat normalise", () => {
    const f = stripeBillingFields({ firstName: "A", lastName: "B", companyName: "Atelier SRL", country: "BE",
      address: "1 rue de la Loi", city: "Bruxelles", postalCode: "1000", vat: "be 0123 456 789" });
    expect(f.name).toBe("Atelier SRL");
    expect(f.address).toEqual({ line1: "1 rue de la Loi", city: "Bruxelles", postal_code: "1000", country: "BE" });
    expect(f.taxId).toEqual({ type: "eu_vat", value: "BE0123456789" });
  });
  it("TVA au mauvais format : jamais transmise", () => {
    expect(stripeBillingFields({ country: "FR", vat: "FR123" }).taxId).toBeUndefined();
  });
  it("valeurs de remplissage Google : jamais une adresse", () => {
    expect(stripeBillingFields({ country: "FR", address: "—", city: "—", postalCode: "00000" }).address)
      .toEqual({ country: "FR" });
  });
});

describe("taxDecision — d'abord le statut reel du vendeur", () => {
  it("statut inconnu : aucun traitement, aucun calcul, quel que soit le client", () => {
    for (const c of ["BE", "FR", "US"]) {
      expect(taxDecision("unknown", { country: c, vatVerified: true }, true))
        .toEqual({ treatment: "undetermined_seller_status", automaticTax: false, invoiceNote: null });
    }
  });
  it("franchise belge : pas de TVA, mention obligatoire", () => {
    const d = taxDecision("be_small_business_exempt", { country: "FR", vatVerified: true }, true);
    expect(d.treatment).toBe("be_franchise_no_vat");
    expect(d.automaticTax).toBe(false);
    expect(d.invoiceNote).toMatch(/franchise/);
  });
  it("immatricule : Belgique, France B2B verifiee, France B2C/non verifiee, hors UE", () => {
    expect(taxDecision("be_vat_registered", { country: "BE" }, true).treatment).toBe("be_domestic_vat");
    expect(taxDecision("be_vat_registered", { country: "FR", vatVerified: true }, true))
      .toMatchObject({ treatment: "eu_b2b_reverse_charge", invoiceNote: expect.stringMatching(/Autoliquidation/) });
    // un format valide ne suffit pas : seule la verification officielle compte
    expect(taxDecision("be_vat_registered", { country: "FR", vatVerified: false }, true).treatment).toBe("eu_b2c_or_unverified");
    expect(taxDecision("be_vat_registered", { country: "FR", vatVerified: null }, true).treatment).toBe("eu_b2c_or_unverified");
    expect(taxDecision("be_vat_registered", { country: "CH" }, true).treatment).toBe("outside_eu");
  });
});

describe("stripeTaxParams — desactive par defaut", () => {
  it("rien sans statut confirme ET activation explicite", () => {
    expect(stripeTaxParams({})).toEqual({});
    expect(stripeTaxParams({ STRIPE_AUTOMATIC_TAX: "on" })).toEqual({});
    expect(stripeTaxParams({ STRIPE_AUTOMATIC_TAX: "on", FLOWPOINT_SELLER_VAT_STATUS: "be_small_business_exempt" })).toEqual({});
    expect(stripeTaxParams({ FLOWPOINT_SELLER_VAT_STATUS: "be_vat_registered" })).toEqual({});
    expect(stripeTaxParams({ STRIPE_AUTOMATIC_TAX: "on", FLOWPOINT_SELLER_VAT_STATUS: "be_vat_registered" }))
      .toEqual({ automatic_tax: { enabled: true } });
  });
  it("statut inconnu par defaut, valeur inattendue = inconnu", () => {
    expect(sellerVatStatus({})).toBe("unknown");
    expect(sellerVatStatus({ FLOWPOINT_SELLER_VAT_STATUS: "registered" })).toBe("unknown");
  });
});

describe("tous les parcours Stripe passent par stripeTaxParams (Standard, Pro, Ultra, add-ons, essai, reactivation)", () => {
  const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
  it.each([
    ["../routes/public-billing.ts", 6], ["../routes/billing.ts", 8],
    ["../services/billing-service.ts", 1], ["../services/reactivate-subscription.ts", 1],
    ["../services/addon-stripe-sync.ts", 1],
  ])("%s", (file, n) => {
    const src = read(file);
    expect(src.match(/\.\.\.stripeTaxParams\(\)/g)?.length ?? 0).toBe(n);
    const creates = (src.match(/(?<!billingPortal\.)(?:subscriptions|checkout\.sessions)\.create\(/g) ?? []).length;
    expect(creates).toBeGreaterThan(0);
  });
  it("les prix de base ne sont pas touches", () => {
    expect(Object.keys(PLAN_PRICE_IDS).sort()).toEqual(expect.arrayContaining(["pro", "standard", "ultra"]));
    for (const f of ["./billing-identity.ts"]) {
      expect(read(f)).not.toMatch(/prices\.(create|update)|unit_amount/);
    }
  });
});
