/**
 * Adresse du client Stripe a partir de l'inscription en attente.
 *
 * Inscription courte (#466) : l'adresse est facultative, le pays reste requis.
 * Stripe accepte une adresse reduite au pays ; elle suffit a localiser le client
 * pour la facture. Les valeurs de remplissage de l'ancien parcours Google
 * ("—", "00000") ne sont jamais transmises comme une vraie adresse.
 */
export interface PendingAddressRow {
  address?: string | null;
  city?: string | null;
  postal_code?: string | null;
  country?: string | null;
}

export interface CustomerAddress {
  line1?: string;
  line2?: string;
  city?: string;
  postal_code?: string;
  country?: string;
}

const PLACEHOLDERS = new Set(["", "—", "-", "00000"]);

function clean(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  return PLACEHOLDERS.has(text) ? undefined : text;
}

export function customerAddressFrom(
  row: PendingAddressRow | null | undefined,
  submitted?: CustomerAddress | null,
): CustomerAddress | null {
  const source = submitted && clean(submitted.line1) ? submitted : row
    ? { line1: row.address ?? "", city: row.city ?? "", postal_code: row.postal_code ?? "", country: row.country ?? "" }
    : null;
  if (!source) return null;
  const out: CustomerAddress = {};
  for (const key of ["line1", "line2", "city", "postal_code"] as const) {
    const v = clean(source[key]);
    if (v) out[key] = v;
  }
  const country = clean(source.country)?.toUpperCase();
  if (country && /^[A-Z]{2}$/.test(country)) out.country = country;
  return Object.keys(out).length ? out : null;
}
