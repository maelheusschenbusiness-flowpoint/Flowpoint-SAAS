/**
 * ai-credit-cart.ts
 *
 * Composition REELLE d'une session Stripe Checkout, determinee cote serveur a
 * partir des LIGNES Stripe (price id + quantite), jamais a partir des metadata
 * ni de `credits`. Un panier qui combine abonnement et packs de credits ne peut
 * ainsi ni sous-crediter (quantite ignoree) ni sur-crediter (metadata forgee).
 *
 * Fonctions pures, hors `fetchSessionLineItems` (seul acces Stripe, injecte).
 *
 * Regle : si la composition ne peut pas etre PROUVEE (ligne inconnue, quantite
 * invalide, prix different du catalogue, mode live/test incoherent...), AUCUN
 * credit n'est inscrit et le verdict porte un code de rejet (AI_CREDITS_REJECTED
 * cote webhook) : jamais de sous-credit silencieux.
 */
import {
  ADDON_PRICE_IDS, ADDON_PRICE_IDS_TEST, PLAN_PRICE_IDS, PLAN_PRICE_IDS_TEST,
} from "../lib/plans.js";
import { ADDON_DEFINITIONS } from "../lib/plans.js";
import { AI_CREDIT_CATALOG, catalogUnitAmountCents, type AiCreditLine, type AiCreditVerdict } from "./ai-credit-verification.js";

export const MAX_LINE_QUANTITY = 20; // meme plafond que /billing/addon-checkout

export type StripeLineItemLike = {
  price?: { id?: string | null } | string | null;
  quantity?: number | null;
  amount_subtotal?: number | null;
  amount_discount?: number | null;
  amount_total?: number | null;
};

export type StripeSessionClient = {
  checkout: {
    sessions: {
      listLineItems: (
        id: string, params: Record<string, unknown>,
      ) => Promise<{ data: StripeLineItemLike[]; has_more?: boolean }>;
    };
  };
};

/** Toutes les lignes de la session (pagination Stripe), bornees a 5 pages de 100. */
export async function fetchSessionLineItems(stripe: StripeSessionClient, sessionId: string): Promise<StripeLineItemLike[]> {
  const out: StripeLineItemLike[] = [];
  let after: string | undefined;
  for (let page = 0; page < 5; page++) {
    const res = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100, ...(after ? { starting_after: after } : {}) });
    out.push(...res.data);
    if (!res.has_more || res.data.length === 0) return out;
    const last = res.data[res.data.length - 1] as { id?: string };
    if (!last.id) return out;
    after = last.id;
  }
  throw new Error("line items: more than 500 lines — composition cannot be proven");
}

const priceIdOf = (l: StripeLineItemLike): string =>
  typeof l.price === "string" ? l.price : String(l.price?.id ?? "");

function invert(map: Record<string, string>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [key, id] of Object.entries(map)) if (id) m.set(id, key);
  return m;
}

export type CartInput = {
  /** Session.payment_status. */
  paymentStatus: unknown;
  /** Mode de l'EVENEMENT Stripe (decide du jeu de price ids, pas l'environnement). */
  livemode: boolean;
  lineItems: StripeLineItemLike[];
  /** Session.amount_total (centimes), pour le recoupement des lignes de credits. */
  amountTotal: unknown;
  currency: unknown;
  /** true : session de credits seuls (aucune ligne hors credits n'est admise). */
  creditsOnly: boolean;
  metadata: Record<string, string>;
};

export type CartVerdict =
  | (Extract<AiCreditVerdict, { ok: true }> & { discounted: boolean; nonCreditLines: number })
  | Extract<AiCreditVerdict, { ok: false }>;

const fail = (code: string, detail: string): CartVerdict => ({ ok: false, code, detail });

export function resolveAiCreditsFromLineItems(input: CartInput): CartVerdict {
  if (input.paymentStatus !== "paid") {
    return fail("not_paid", `payment_status ${String(input.paymentStatus)} (attendu paid)`);
  }
  if (String(input.currency ?? "").toLowerCase() !== "eur") {
    return fail("currency_mismatch", `devise ${String(input.currency)} (attendu eur)`);
  }
  if (!Array.isArray(input.lineItems) || input.lineItems.length === 0) {
    return fail("no_line_items", "aucune ligne Stripe : composition impossible a prouver");
  }

  const addonIds = invert(input.livemode ? ADDON_PRICE_IDS : ADDON_PRICE_IDS_TEST);
  const planIds = invert(input.livemode ? PLAN_PRICE_IDS : PLAN_PRICE_IDS_TEST);
  const creditKeys = new Set(Object.keys(AI_CREDIT_CATALOG));

  const perPack = new Map<string, { quantity: number; paidCents: number }>();
  let discounted = false;
  let nonCredit = 0;

  for (const l of input.lineItems) {
    const priceId = priceIdOf(l);
    if (!priceId) return fail("unknown_line", "ligne sans price id");
    const addonKey = addonIds.get(priceId);
    if (addonKey && creditKeys.has(addonKey)) {
      const q = l.quantity;
      if (typeof q !== "number" || !Number.isInteger(q) || q < 1 || q > MAX_LINE_QUANTITY) {
        return fail("bad_quantity", `quantite invalide (${String(q)}) pour ${addonKey}`);
      }
      const unit = catalogUnitAmountCents(addonKey);
      if (unit === null) return fail("unknown_pack", `pack sans prix catalogue: ${addonKey}`);
      if (typeof l.amount_subtotal !== "number" || l.amount_subtotal !== unit * q) {
        return fail("amount_mismatch", `${addonKey} x${q}: sous-total ${String(l.amount_subtotal)} (attendu ${unit * q})`);
      }
      const discount = typeof l.amount_discount === "number" ? l.amount_discount : 0;
      if (discount < 0 || discount >= l.amount_subtotal) {
        // 100 % de remise : credits gratuits, jamais attribues sans revue manuelle.
        return fail("credit_line_free", `${addonKey}: remise ${discount} sur ${l.amount_subtotal}`);
      }
      if (discount > 0) discounted = true;
      const cur = perPack.get(addonKey) ?? { quantity: 0, paidCents: 0 };
      perPack.set(addonKey, { quantity: cur.quantity + q, paidCents: cur.paidCents + l.amount_subtotal - discount });
      continue;
    }
    if (addonKey || planIds.has(priceId)) { nonCredit++; continue; }   // ligne connue, hors credits
    return fail("unknown_line", `price id hors catalogue (${priceId})`);
  }

  if (perPack.size === 0) return fail("no_credit_lines", "aucune ligne de pack de credits");
  if (input.creditsOnly && nonCredit > 0) return fail("cart_not_ai_only", "ligne hors credits dans une session de credits seuls");

  const lines: AiCreditLine[] = [];
  let paidCredits = 0;
  for (const [key, v] of perPack) {
    if (v.quantity > MAX_LINE_QUANTITY) return fail("bad_quantity", `quantite cumulee ${v.quantity} pour ${key}`);
    const unit = catalogUnitAmountCents(key)!;
    lines.push({ key, quantity: v.quantity, credits: AI_CREDIT_CATALOG[key]! * v.quantity, amountCents: unit * v.quantity });
    paidCredits += v.paidCents;
  }
  const credits = lines.reduce((s, l) => s + l.credits, 0);
  const amountCents = lines.reduce((s, l) => s + l.amountCents, 0);

  // Montant paye aujourd'hui : doit couvrir au moins les lignes de credits (un essai a 0 EUR
  // ne concerne que la partie abonnement). Credits seuls : montant exactement egal.
  const total = input.amountTotal;
  if (typeof total !== "number" || !Number.isInteger(total) || total < paidCredits) {
    return fail("amount_mismatch", `amount_total ${String(total)} < credits payes ${paidCredits}`);
  }
  if (input.creditsOnly && total !== paidCredits) {
    return fail("amount_mismatch", `amount_total ${total} (attendu ${paidCredits})`);
  }

  // Les metadata ne sont jamais crues ; un ecart est seulement signale.
  const metaCredits = input.metadata["credits"] !== undefined ? parseInt(input.metadata["credits"], 10) : null;
  return {
    ok: true, pack: lines.map((l) => l.key).join(","), credits, amountCents, lines,
    metadataCreditsMismatch: metaCredits !== null && metaCredits !== credits,
    discounted, nonCreditLines: nonCredit,
  };
}

// ── PaymentIntent du panier public (finalize-checkout) ───────────────────────

/**
 * Panier public paye par PaymentIntent qui peut MELANGER packs de credits et
 * add-ons recurrents (premier mois preleve dans le meme paiement). Le panier est lu
 * dans `metadata.addons` du PaymentIntent (ecrit par le serveur a partir du devis,
 * jamais dans le corps de la requete du navigateur), quantites incluses. Le montant
 * recu doit couvrir au moins les packs ; une cle inconnue ou une quantite invalide
 * => aucun credit (rejet).
 */
export function resolveAiCreditsFromPaymentIntentCart(input: {
  status: unknown; metadata: Record<string, string>; amountReceived: unknown; currency: unknown;
}): AiCreditVerdict {
  if (input.status !== "succeeded") return { ok: false, code: "not_paid", detail: `statut ${String(input.status)}` };
  if (String(input.currency ?? "").toLowerCase() !== "eur") return { ok: false, code: "currency_mismatch", detail: "devise" };
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(input.metadata["addons"] || "{}") as Record<string, unknown>; }
  catch { return { ok: false, code: "cart_unreadable", detail: "metadata.addons illisible" }; }
  const lines: AiCreditLine[] = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (v === false || v === 0 || v == null) continue;
    if (!ADDON_DEFINITIONS[k]) return { ok: false, code: "unknown_line", detail: `cle hors catalogue: ${k}` };
    if (!(k in AI_CREDIT_CATALOG)) continue;
    const q = v === true ? 1 : Number(v);
    if (!Number.isInteger(q) || q < 1 || q > MAX_LINE_QUANTITY) return { ok: false, code: "bad_quantity", detail: `quantite invalide pour ${k}` };
    const unit = catalogUnitAmountCents(k);
    if (unit === null) return { ok: false, code: "unknown_pack", detail: k };
    lines.push({ key: k, quantity: q, credits: AI_CREDIT_CATALOG[k]! * q, amountCents: unit * q });
  }
  if (lines.length === 0) return { ok: false, code: "no_pack", detail: "aucun pack de credits dans le panier" };
  const amountCents = lines.reduce((s, l) => s + l.amountCents, 0);
  const got = input.amountReceived;
  if (typeof got !== "number" || !Number.isInteger(got) || got < amountCents) {
    return { ok: false, code: "amount_mismatch", detail: `montant recu ${String(got)} < packs ${amountCents}` };
  }
  return { ok: true, pack: lines.map((l) => l.key).join(","), credits: lines.reduce((s, l) => s + l.credits, 0), amountCents, lines, metadataCreditsMismatch: false };
}
