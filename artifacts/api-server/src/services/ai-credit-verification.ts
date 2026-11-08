/**
 * ai-credit-verification.ts
 *
 * Verification serveur d'un achat de credits IA AVANT inscription par le
 * webhook Stripe. Le webhook ne doit jamais crediter une valeur lue dans les
 * metadata (`credits`, `amountEurCents`) : celles-ci decrivent l'intention au
 * moment de la creation du paiement, pas ce qui a ete reellement paye.
 *
 * Source de verite : le catalogue serveur (ADDON_DEFINITIONS pour le prix,
 * AI_CREDIT_CATALOG pour le nombre de credits). Les metadata ne servent qu'a
 * designer un pack (cle connue) ; credits et montant attendus sont recalcules.
 *
 * Aucune dependance Stripe ni DB dans resolveAiCreditPurchase (fonction pure).
 */
import { ADDON_DEFINITIONS } from "../lib/plans.js";

/** Credits accordes par pack (une unite). Prix : ADDON_DEFINITIONS[cle].priceEur. */
export const AI_CREDIT_CATALOG: Readonly<Record<string, number>> = Object.freeze({
  aiCreditsPack50k: 50_000,
  aiCreditsPack200k: 200_000,
  aiCreditsPack500k: 500_000,
});

/** Alias historiques poses par /billing/ai-credits-intent et /billing/checkout-ai-credits. */
const PACK_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  ai_credits_50k: "aiCreditsPack50k",
  ai_credits_200k: "aiCreditsPack200k",
  ai_credits_500k: "aiCreditsPack500k",
});

const MAX_PACK_QUANTITY = 20; // meme plafond que /billing/addon-checkout

export type AiCreditLine = { key: string; quantity: number; credits: number; amountCents: number };

export type AiCreditVerdict =
  | { ok: true; pack: string; credits: number; amountCents: number; lines: AiCreditLine[]; metadataCreditsMismatch: boolean }
  | { ok: false; code: string; detail: string };

export type AiCreditInput = {
  /**
   * PaymentIntent uniquement. Les sessions Checkout sont resolues a partir de
   * leurs lignes Stripe (services/ai-credit-cart.ts), jamais des metadata.
   */
  kind: "payment_intent";
  /** PaymentIntent.status. */
  status: unknown;
  metadata: Record<string, string>;
  /** amount_received (PI), en centimes. */
  paidAmountMinor: unknown;
  currency: unknown;
  /** Conserve pour compatibilite : le montant est toujours recoupe pour un PaymentIntent. */
  checkAmount: boolean;
};

export function catalogUnitAmountCents(key: string): number | null {
  const def = ADDON_DEFINITIONS[key];
  if (!def || typeof def.priceEur !== "number") return null;
  return Math.round(def.priceEur * 100);
}

function normalizeKey(raw: string): string {
  const k = raw.trim();
  return PACK_ALIASES[k.toLowerCase()] ?? k;
}

function line(key: string, quantity: number): AiCreditLine | null {
  const credits = AI_CREDIT_CATALOG[key];
  const unit = catalogUnitAmountCents(key);
  if (credits === undefined || unit === null) return null;
  return { key, quantity, credits: credits * quantity, amountCents: unit * quantity };
}

const fail = (code: string, detail: string): AiCreditVerdict => ({ ok: false, code, detail });

export function resolveAiCreditPurchase(input: AiCreditInput): AiCreditVerdict {
  const { metadata: meta } = input;

  // (6) Statut : uniquement un paiement abouti.
  const okStatus = "succeeded";
  if (input.status !== okStatus) {
    return fail("not_paid", `statut ${String(input.status)} (attendu ${okStatus})`);
  }

  // (1) Pack(s) : cles connues du catalogue serveur uniquement.
  let requested: Array<{ key: string; quantity: number }> = [];
  const addonsRaw = meta["addons"];
  if (addonsRaw && addonsRaw !== "{}" && addonsRaw !== "null") {
    // Panier du PaymentIntent public : quantites posees par le serveur (devis).
    let parsed: Record<string, unknown>;
    try { parsed = JSON.parse(addonsRaw) as Record<string, unknown>; }
    catch { return fail("cart_unreadable", "metadata.addons illisible"); }
    for (const [k, v] of Object.entries(parsed)) {
      if (v === false || v === 0 || v == null) continue;
      if (!(k in AI_CREDIT_CATALOG)) return fail("cart_not_ai_only", `cle hors catalogue credits: ${k}`);
      const quantity = v === true ? 1 : Number(v);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_PACK_QUANTITY) {
        return fail("bad_quantity", `quantite invalide pour ${k}`);
      }
      requested.push({ key: k, quantity });
    }
  }
  if (requested.length === 0) {
    const keys = String(meta["pack"] ?? "")
      .split(",").map(normalizeKey).filter(Boolean);
    const fromField = String(meta["ai_credits"] ?? "")
      .split(",").map(normalizeKey).filter((k) => k.startsWith("aiCreditsPack"));
    const list = keys.length > 0 ? keys : fromField;
    const effective = list;
    requested = effective.map((key) => ({ key, quantity: 1 }));
  }
  if (requested.length === 0) return fail("no_pack", "aucun pack dans les metadata");
  for (const r of requested) {
    if (!(r.key in AI_CREDIT_CATALOG)) return fail("unknown_pack", `pack hors catalogue: ${r.key}`);
  }

  const lines: AiCreditLine[] = [];
  for (const r of requested) {
    const l = line(r.key, r.quantity);
    if (!l) return fail("unknown_pack", `pack sans prix catalogue: ${r.key}`);
    lines.push(l);
  }
  const credits = lines.reduce((s, l) => s + l.credits, 0);
  const amountCents = lines.reduce((s, l) => s + l.amountCents, 0);

  // (3) Montant et devise payes = prix catalogue (pack x quantite).
  if (input.checkAmount) {
    if (String(input.currency ?? "").toLowerCase() !== "eur") {
      return fail("currency_mismatch", `devise ${String(input.currency)} (attendu eur)`);
    }
    if (typeof input.paidAmountMinor !== "number" || input.paidAmountMinor !== amountCents) {
      return fail("amount_mismatch", `montant paye ${String(input.paidAmountMinor)} (attendu ${amountCents})`);
    }
  }

  // (2) Les metadata `credits` ne sont jamais crues ; un ecart est seulement signale.
  const metaCredits = meta["credits"] !== undefined ? parseInt(meta["credits"], 10) : null;
  const metadataCreditsMismatch = metaCredits !== null && metaCredits !== credits;

  return { ok: true, pack: lines.map((l) => l.key).join(","), credits, amountCents, lines, metadataCreditsMismatch };
}

// ── Beneficiaire ─────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };

export type BeneficiaryVerdict = { ok: true; orgId: string } | { ok: false; code: string; detail: string };

/**
 * (4) L'organisation creditee est celle qui possede le customer Stripe.
 * - customer present : il doit avoir designe l'organisation (resolvedVia).
 * - metadata orgId : si presente, elle doit designer la MEME organisation.
 * - metadata absente : refusee quand `requireMetadataOrg` (achats de credits seuls).
 * - l'organisation doit exister en base.
 */
export async function verifyAiCreditBeneficiary(db: Queryable, p: {
  resolvedOrgId: string | null;
  resolvedVia: string;
  hasCustomer: boolean;
  metadata: Record<string, string>;
  requireMetadataOrg: boolean;
}): Promise<BeneficiaryVerdict> {
  const fail2 = (code: string, detail: string): BeneficiaryVerdict => ({ ok: false, code, detail });
  if (!p.resolvedOrgId) return fail2("org_unresolved", "organisation non resolue");
  if (p.hasCustomer && !p.resolvedVia.startsWith("stripe_customer_id")) {
    return fail2("customer_not_linked", "le customer Stripe n'appartient a aucune organisation connue");
  }
  const metaRaw = (p.metadata["orgId"] ?? p.metadata["org_id"] ?? "").trim();
  if (!metaRaw && p.requireMetadataOrg) return fail2("metadata_org_missing", "metadata.orgId absente");

  let target = p.resolvedOrgId;
  if (!UUID_RE.test(target)) {
    const r = await db.query(
      `SELECT id::text AS id FROM organizations WHERE lower(owner_email) = lower($1) ORDER BY created_at DESC LIMIT 1`, [target]);
    target = String(r.rows[0]?.["id"] ?? "");
  }
  if (!UUID_RE.test(target)) return fail2("org_unknown", "organisation inconnue en base");

  if (metaRaw) {
    let metaId = metaRaw;
    if (!UUID_RE.test(metaId)) {
      const r = await db.query(
        `SELECT id::text AS id FROM organizations WHERE lower(owner_email) = lower($1) ORDER BY created_at DESC LIMIT 1`, [metaId]);
      metaId = String(r.rows[0]?.["id"] ?? "");
    }
    if (metaId.toLowerCase() !== target.toLowerCase()) {
      return fail2("org_mismatch", "metadata.orgId differe de l'organisation du customer");
    }
  }
  const ex = await db.query(`SELECT 1 AS ok FROM organizations WHERE id = $1::uuid LIMIT 1`, [target]);
  if (ex.rows.length === 0) return fail2("org_unknown", "organisation inconnue en base");
  return { ok: true, orgId: target };
}

// ── Inscription idempotente ──────────────────────────────────────────────────

type TxClient = Queryable & { release: () => void };

/**
 * (6)(7) Inscrit l'achat une seule fois. Garde double :
 *  - id deterministe (acp_<session> / acp_pi_<pi>) -> rejeu du meme evenement ;
 *  - meme PaymentIntent deja inscrit sous un autre id -> checkout.session.completed
 *    et payment_intent.succeeded du meme achat (ou finalize-checkout).
 * Un verrou consultatif transactionnel sur le PaymentIntent serialise les deux
 * evenements concurrents. Retourne false si deja credite.
 */
export async function recordAiCreditPurchase(
  pool: { connect: () => Promise<TxClient> },
  p: { id: string; orgId: string; pack: string; credits: number; amountCents: number; sessionId: string; paymentIntent: string },
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const lockKey = p.paymentIntent ? `aicp:${p.paymentIntent}` : `aicp:${p.id}`;
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [lockKey]);
      const dup = await client.query(
        `SELECT 1 AS d FROM ai_credit_purchases
          WHERE id = $1 OR ($2 <> '' AND stripe_payment_intent = $2) LIMIT 1`,
        [p.id, p.paymentIntent]);
      if (dup.rows.length > 0) { await client.query("COMMIT"); return false; }
      await client.query(
        `INSERT INTO ai_credit_purchases
           (id, org_id, pack, credits, amount_eur_cents, stripe_session_id, stripe_payment_intent)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [p.id, p.orgId, p.pack, p.credits, p.amountCents, p.sessionId, p.paymentIntent]);
      await client.query("COMMIT");
      return true;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    }
  } finally {
    client.release();
  }
}
