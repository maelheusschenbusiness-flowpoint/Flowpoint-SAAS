/**
 * Coordonnees de facturation collectees au paiement (Address Element Stripe).
 *
 * L'inscription ne demande plus l'adresse ni la TVA : elles arrivent avec le
 * moyen de paiement. Ce module les recopie, sans jamais ecraser une valeur deja
 * presente, dans pending_signups ET dans les lignes org_settings du compte si
 * l'activation a deja eu lieu (webhook arrive avant finalize-checkout, ou
 * reprise apres interruption). Chaque etape est idempotente : relancer
 * finalize-checkout ou rejouer le webhook ne cree ni doublon ni ecrasement.
 */
import { normalizeVat } from "./vat.js";

export interface BillingDetails {
  country: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  phone: string | null;
  vat: string | null;
}

type PmBillingDetails = {
  phone?: string | null;
  address?: {
    line1?: string | null; line2?: string | null; city?: string | null;
    postal_code?: string | null; country?: string | null;
  } | null;
} | null | undefined;

const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
};

/** Extrait l'adresse et le telephone du moyen de paiement (null si rien d'utile). */
export function billingFromPaymentMethod(bd: PmBillingDetails, vat?: unknown): BillingDetails | null {
  const a = bd?.address ?? null;
  const hasAddr = !!(clean(a?.line1) && clean(a?.country));
  const out: BillingDetails = {
    country:    hasAddr ? clean(a?.country)?.toUpperCase() ?? null : null,
    address:    hasAddr ? [clean(a?.line1), clean(a?.line2)].filter(Boolean).join(", ") : null,
    city:       hasAddr ? clean(a?.city) : null,
    postalCode: hasAddr ? clean(a?.postal_code) : null,
    phone:      clean(bd?.phone),
    vat:        normalizeVat(vat),
  };
  return Object.values(out).some(Boolean) ? out : null;
}

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }> };

const FILL_SQL = (table: string, key: string) => `UPDATE ${table} SET
     country     = COALESCE(NULLIF(country, ''),     $2),
     address     = COALESCE(NULLIF(address, ''),     $3),
     city        = COALESCE(NULLIF(city, ''),        $4),
     postal_code = COALESCE(NULLIF(postal_code, ''), $5),
     phone       = COALESCE(NULLIF(phone, ''),       $6),
     vat         = COALESCE(NULLIF(vat, ''),         $7)
   WHERE ${key} = $1`;

const params = (k: string, b: BillingDetails) =>
  [k, b.country, b.address, b.city, b.postalCode, b.phone, b.vat];

/** Complete la ligne pending_signups (champs vides seulement). */
export async function fillPendingSignup(db: Queryable, token: string, b: BillingDetails): Promise<void> {
  if (!token) return;
  await db.query(FILL_SQL("pending_signups", "token"), params(token, b));
}

/**
 * Complete les lignes org_settings deja creees pour ce compte (cle email et cle
 * UUID de l'organisation). Ne cree aucune ligne : l'activation s'en charge.
 * Retourne le nombre de lignes touchees.
 */
export async function fillOrgSettings(db: Queryable, email: string, b: BillingDetails): Promise<number> {
  if (!email) return 0;
  const keys = new Set<string>([email]);
  const r = await db.query(`SELECT id::text AS id FROM organizations WHERE owner_email = $1`, [email]);
  for (const row of r.rows) if (row["id"]) keys.add(String(row["id"]));
  let n = 0;
  for (const k of keys) {
    const u = await db.query(FILL_SQL("org_settings", "org_id"), params(k, b));
    n += u.rowCount ?? 0;
  }
  return n;
}

/** Prefixes TVA des pays de l'UE (la Grece utilise EL). */
const EU_VAT_PREFIXES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "EL", "ES", "FI", "FR", "HR", "HU",
  "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
]);

export function isEuVat(vat: string | null): vat is string {
  return !!vat && EU_VAT_PREFIXES.has(vat.slice(0, 2));
}

type StripeTaxIds = {
  customers: {
    listTaxIds: (id: string, p?: { limit?: number }) => Promise<{ data: Array<{ type: string; value: string }> }>;
    createTaxId: (id: string, p: { type: "eu_vat"; value: string }) => Promise<unknown>;
  };
};

export type TaxIdOutcome = "created" | "already_present" | "not_eu" | "invalid" | "failed";

/**
 * Ajoute le numero de TVA au client Stripe, une seule fois. Relancer (double
 * clic, reprise, webhook rejoue) ne cree pas de doublon : la liste existante est
 * lue d'abord. Une erreur Stripe ne bloque jamais l'activation.
 */
export async function ensureEuVatTaxId(stripe: StripeTaxIds, customerId: string, rawVat: unknown): Promise<TaxIdOutcome> {
  const vat = normalizeVat(rawVat);
  if (!vat) return "invalid";
  if (!isEuVat(vat)) return "not_eu";
  try {
    const existing = await stripe.customers.listTaxIds(customerId, { limit: 100 });
    if (existing.data.some(t => t.type === "eu_vat" && t.value.replace(/[\s.-]/g, "").toUpperCase() === vat)) {
      return "already_present";
    }
    await stripe.customers.createTaxId(customerId, { type: "eu_vat", value: vat });
    return "created";
  } catch {
    return "failed";
  }
}
