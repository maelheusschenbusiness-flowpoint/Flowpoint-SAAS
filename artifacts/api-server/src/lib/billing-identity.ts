/**
 * Identite de facturation et preparation fiscale Stripe — module unique pour
 * l'inscription, l'abonnement, la reactivation et les add-ons.
 *
 * PRINCIPES (decision du 2026-11-17)
 *  - Prix de base 29 / 79 / 149 EUR HT : aucun prix Stripe n'est modifie ici.
 *  - Statut TVA du vendeur INCONNU tant qu'un comptable ne l'a pas confirme :
 *    aucun calcul fiscal n'est active par defaut, aucune immatriculation n'est
 *    supposee ni declaree.
 *  - Un numero de TVA au bon FORMAT n'est pas un numero VALIDE : l'autoliquidation
 *    exige une verification officielle (VIES), que Stripe fait de facon
 *    asynchrone (`tax_id.verification.status`). Seul `verified` compte.
 *
 * ACTIVATION EXPLICITE
 *  - FLOWPOINT_SELLER_VAT_STATUS : `unknown` (defaut) | `be_vat_registered` |
 *    `be_small_business_exempt`.
 *  - STRIPE_AUTOMATIC_TAX : `on` pour demander a Stripe Tax de calculer. Sans
 *    effet tant que le statut est `unknown`. Stripe Tax exige aussi une
 *    immatriculation declaree dans le tableau de bord ; ce module n'en cree jamais.
 */

export type SellerVatStatus = "unknown" | "be_vat_registered" | "be_small_business_exempt";

export const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU",
  "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);

/* Formats VIES par pays (sans le prefixe). Format seulement : jamais une preuve. */
const VAT_FORMATS: Record<string, RegExp> = {
  AT: /^U\d{8}$/, BE: /^[01]\d{9}$/, BG: /^\d{9,10}$/, CY: /^\d{8}[A-Z]$/, CZ: /^\d{8,10}$/,
  DE: /^\d{9}$/, DK: /^\d{8}$/, EE: /^\d{9}$/, ES: /^[A-Z0-9]\d{7}[A-Z0-9]$/, FI: /^\d{8}$/,
  FR: /^[A-HJ-NP-Z0-9]{2}\d{9}$/, GR: /^\d{9}$/, HR: /^\d{11}$/, HU: /^\d{8}$/,
  IE: /^\d{7}[A-W][A-I]?$|^\d[A-Z+*]\d{5}[A-W]$/, IT: /^\d{11}$/, LT: /^(\d{9}|\d{12})$/,
  LU: /^\d{8}$/, LV: /^\d{11}$/, MT: /^\d{8}$/, NL: /^\d{9}B\d{2}$/, PL: /^\d{10}$/,
  PT: /^\d{9}$/, RO: /^\d{2,10}$/, SE: /^\d{12}$/, SI: /^\d{8}$/, SK: /^\d{10}$/,
};
/* Grece : prefixe TVA « EL », code pays ISO « GR ». */
const VAT_PREFIX: Record<string, string> = { GR: "EL" };

export interface VatCheck {
  value: string | null;        // normalise, prefixe compris (ex. BE0123456789)
  country: string | null;      // pays ISO deduit du prefixe
  formatValid: boolean;
  reason: null | "empty" | "unknown_prefix" | "bad_format" | "country_mismatch";
}

export function normalizeVat(raw: unknown, customerCountry?: string | null): VatCheck {
  const text = String(raw ?? "").toUpperCase().replace(/[\s.\-/]/g, "");
  if (!text) return { value: null, country: null, formatValid: false, reason: "empty" };
  const iso = (customerCountry || "").toUpperCase();
  let prefix = text.slice(0, 2);
  let body = text.slice(2);
  let country = prefix === "EL" ? "GR" : prefix;
  if (!VAT_FORMATS[country]) {
    // Numero saisi sans prefixe : on prend le pays du client s'il est connu.
    if (iso && VAT_FORMATS[iso]) {
      country = iso; prefix = VAT_PREFIX[iso] ?? iso; body = text;
    } else {
      return { value: text, country: null, formatValid: false, reason: "unknown_prefix" };
    }
  }
  if (country === "BE" && /^\d{9}$/.test(body)) body = "0" + body;   // ancien format belge
  const value = (VAT_PREFIX[country] ?? country) + body;
  if (!VAT_FORMATS[country]!.test(body)) return { value, country, formatValid: false, reason: "bad_format" };
  if (iso && iso !== country) return { value, country, formatValid: true, reason: "country_mismatch" };
  return { value, country, formatValid: true, reason: null };
}

export interface SignupBillingInput {
  firstName?: string | null; lastName?: string | null; companyName?: string | null; email?: string | null;
  country?: string | null; address?: string | null; city?: string | null; postalCode?: string | null;
  vat?: string | null;
}

const PLACEHOLDERS = new Set(["", "—", "-", "00000"]);
const clean = (v: unknown) => {
  const t = typeof v === "string" ? v.trim() : "";
  return PLACEHOLDERS.has(t) ? undefined : t;
};

export interface StripeBillingFields {
  name?: string;
  address?: { line1?: string; city?: string; postal_code?: string; country?: string };
  /** A poser avec customers.createTaxId (non bloquant) : format valide seulement. */
  taxId?: { type: "eu_vat"; value: string };
  vat: VatCheck;
}

/** Nom de facturation (entreprise sinon personne), adresse si elle existe, pays, TVA. */
export function stripeBillingFields(input: SignupBillingInput): StripeBillingFields {
  const person = [clean(input.firstName), clean(input.lastName)].filter(Boolean).join(" ");
  const company = clean(input.companyName);
  const name = company && company !== person ? company : person || company || undefined;
  const country = clean(input.country)?.toUpperCase();
  const address: StripeBillingFields["address"] = {};
  const line1 = clean(input.address); if (line1) address.line1 = line1;
  const city = clean(input.city); if (city) address.city = city;
  const postal = clean(input.postalCode); if (postal) address.postal_code = postal;
  if (country && /^[A-Z]{2}$/.test(country)) address.country = country;
  const vat = normalizeVat(input.vat, country);
  return {
    ...(name ? { name } : {}),
    ...(Object.keys(address).length ? { address } : {}),
    ...(vat.formatValid && vat.value && vat.country && EU_COUNTRIES.has(vat.country)
      ? { taxId: { type: "eu_vat" as const, value: vat.value } } : {}),
    vat,
  };
}

export type TaxTreatment =
  | "undetermined_seller_status"   // statut vendeur inconnu : aucun traitement automatique
  | "be_franchise_no_vat"          // franchise des petites entreprises : pas de TVA, mention obligatoire
  | "be_domestic_vat"              // client belge : TVA belge
  | "eu_b2b_reverse_charge"        // client UE hors BE, TVA VERIFIEE : autoliquidation
  | "eu_b2c_or_unverified"         // client UE hors BE sans TVA verifiee : TVA selon regles B2C/OSS
  | "outside_eu";                  // hors UE : regles d'exportation de services

export interface TaxDecision {
  treatment: TaxTreatment;
  automaticTax: boolean;           // demander le calcul a Stripe Tax
  invoiceNote: string | null;      // mention a porter sur la facture, si elle est certaine
}

/**
 * Le traitement depend d'abord du statut REEL du vendeur, ensuite du client.
 * `vatVerified` ne vaut true que pour une verification officielle reussie.
 */
export function taxDecision(
  seller: SellerVatStatus,
  customer: { country?: string | null; vatVerified?: boolean | null },
  automaticTaxRequested = false,
): TaxDecision {
  const country = (customer.country || "").toUpperCase();
  if (seller === "unknown") {
    return { treatment: "undetermined_seller_status", automaticTax: false, invoiceNote: null };
  }
  if (seller === "be_small_business_exempt") {
    return { treatment: "be_franchise_no_vat", automaticTax: false,
      invoiceNote: "Régime particulier de franchise des petites entreprises — TVA non applicable." };
  }
  const auto = automaticTaxRequested;
  if (country === "BE") return { treatment: "be_domestic_vat", automaticTax: auto, invoiceNote: null };
  if (EU_COUNTRIES.has(country)) {
    return customer.vatVerified === true
      ? { treatment: "eu_b2b_reverse_charge", automaticTax: auto,
          invoiceNote: "Autoliquidation — article 196 de la directive 2006/112/CE." }
      : { treatment: "eu_b2c_or_unverified", automaticTax: auto, invoiceNote: null };
  }
  return { treatment: "outside_eu", automaticTax: auto, invoiceNote: null };
}

export function sellerVatStatus(env: NodeJS.ProcessEnv = process.env): SellerVatStatus {
  const raw = String(env["FLOWPOINT_SELLER_VAT_STATUS"] ?? "").trim();
  return raw === "be_vat_registered" || raw === "be_small_business_exempt" ? raw : "unknown";
}

/**
 * Parametre a etaler dans subscriptions.create / checkout.sessions.create.
 * `{}` par defaut : aucun changement tant que le vendeur n'est pas immatricule
 * ET que STRIPE_AUTOMATIC_TAX=on. Les abonnements existants ne sont pas touches.
 */
export function stripeTaxParams(env: NodeJS.ProcessEnv = process.env): { automatic_tax?: { enabled: true } } {
  const on = String(env["STRIPE_AUTOMATIC_TAX"] ?? "").trim().toLowerCase() === "on";
  return on && sellerVatStatus(env) === "be_vat_registered" ? { automatic_tax: { enabled: true } } : {};
}
