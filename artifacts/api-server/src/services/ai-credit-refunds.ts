/**
 * ai-credit-refunds.ts
 *
 * Retrait des credits IA NON CONSOMMES lors d'un remboursement Stripe.
 *
 * Regle validee par le proprietaire : un remboursement retire uniquement les
 * credits non consommes qui lui correspondent, SANS JAMAIS creer de solde
 * negatif ni de dette. Ce service est volontairement separe du ledger vendeur
 * (`seller-financial-ledger`) : il ne l'importe pas, n'en lit aucune table et
 * n'ecrit que dans `ai_credit_purchases` (ligne d'ajustement) et
 * `ai_credit_refunds` (journal d'audit / suivi cumulatif).
 *
 * Modele de donnees (lu dans ai-engine.ts) :
 *   disponible  = limite du plan (mensuelle) + SUM(ai_credit_purchases.credits)
 *   consomme    = ai_monthly_usage.credits_used (mois courant, plan d'abord)
 * La consommation n'est pas attribuee a un lot : elle est globale a
 * l'organisation. Les credits achetes ne sont donc entames que lorsque
 * `credits_used` depasse la limite du plan. Attribution retenue (solde global,
 * plan consomme en premier) :
 *   non_consommes_achetes = max(0, SUM(achats) - max(0, credits_used - limite))
 * Un retrait n'excede jamais cette valeur : le solde disponible ne devient
 * jamais inferieur a ce qui a deja ete consomme.
 *
 * Arithmetique : entiers uniquement (BigInt pour le produit), arrondi par
 * defaut (floor) sur le CUMUL, jamais par remboursement : N remboursements
 * partiels donnent exactement le meme total qu'un remboursement unique.
 */
import { logger } from "../lib/logger.js";

type Row = Record<string, unknown>;
type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Row[] }> };
type TxClient = Queryable & { release: () => void };
export type PoolLike = Queryable & { connect: () => Promise<TxClient> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** floor(credits * refunded / paid), en entiers. */
export function creditsForRefundedAmount(credits: number, refundedCents: number, paidCents: number): number {
  if (!Number.isSafeInteger(credits) || credits <= 0) return 0;
  if (!Number.isSafeInteger(refundedCents) || refundedCents <= 0) return 0;
  if (!Number.isSafeInteger(paidCents) || paidCents <= 0) return 0;
  const capped = refundedCents > paidCents ? paidCents : refundedCents;
  return Number((BigInt(credits) * BigInt(capped)) / BigInt(paidCents));
}

export type RefundInput = {
  refundId: string;
  refundAmountCents: number;
  /** Statut Stripe du remboursement (pending, succeeded, failed, canceled, requires_action). */
  refundStatus: string;
  paymentIntentId: string;
  chargeId: string | null;
  /** Montant du paiement (charge) en centimes ; a defaut, montant de l'achat. */
  paidAmountCents: number | null;
  /** Organisation du customer Stripe de la charge, si resolue ; null si pas de customer. */
  customerOrgId: string | null;
  /** true si la charge porte un customer qui n'appartient a aucune organisation connue. */
  customerUnlinked?: boolean;
  livemode: boolean;
};

export type RefundOutcome =
  | { outcome: "no_purchase" }
  | { outcome: "rejected"; code: string }
  | { outcome: "duplicate" }
  | { outcome: "ignored"; reason: string }
  | { outcome: "reversed"; creditsRestored: number }
  | { outcome: "applied"; creditsRemoved: number; shortfall: number; orgId: string; purchaseId: string };

/** Achat de credits correspondant a un PaymentIntent (sans verrou). */
export async function findCreditPurchaseByPaymentIntent(
  db: Queryable, paymentIntentId: string,
): Promise<{ id: string; orgId: string; credits: number; amountCents: number } | null> {
  if (!paymentIntentId) return null;
  const r = await db.query(
    `SELECT id, org_id::text AS org_id, credits, amount_eur_cents
       FROM ai_credit_purchases
      WHERE stripe_payment_intent = $1 AND credits > 0
      ORDER BY created_at ASC LIMIT 1`, [paymentIntentId]);
  const row = r.rows[0];
  if (!row) return null;
  return { id: String(row["id"]), orgId: String(row["org_id"]), credits: Number(row["credits"]), amountCents: Number(row["amount_eur_cents"]) };
}

const ACTIVE = new Set(["succeeded", "pending"]);
const INACTIVE = new Set(["failed", "canceled"]);

/**
 * Applique (ou annule) l'effet d'UN remboursement. Idempotent par refund id et
 * serialise par PaymentIntent (meme verrou consultatif que l'inscription de
 * l'achat) : deux livraisons simultanees ne retirent qu'une fois.
 */
export async function applyAiCreditRefund(pool: PoolLike, p: RefundInput): Promise<RefundOutcome> {
  if (!p.refundId.startsWith("re_") || !Number.isSafeInteger(p.refundAmountCents) || p.refundAmountCents <= 0) {
    return { outcome: "rejected", code: "bad_refund" };
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`aicp:${p.paymentIntentId}`]);
      const purchase = await findCreditPurchaseByPaymentIntent(client, p.paymentIntentId);
      if (!purchase) { await client.query("COMMIT"); return { outcome: "no_purchase" }; }

      // (f) Coherence organisation : celle du customer de la charge, pas des metadata.
      if (p.customerUnlinked) { await client.query("COMMIT"); return { outcome: "rejected", code: "customer_not_linked" }; }
      if (p.customerOrgId && p.customerOrgId.toLowerCase() !== purchase.orgId.toLowerCase()) {
        await client.query("COMMIT"); return { outcome: "rejected", code: "org_mismatch" };
      }
      if (!UUID_RE.test(purchase.orgId)) { await client.query("COMMIT"); return { outcome: "rejected", code: "org_unknown" }; }

      const ex = await client.query(`SELECT status, credits_removed FROM ai_credit_refunds WHERE refund_id = $1`, [p.refundId]);
      const existing = ex.rows[0];
      const existingStatus = existing ? String(existing["status"]) : null;

      // ── Remboursement echoue / annule ────────────────────────────────────
      if (INACTIVE.has(p.refundStatus)) {
        if (existingStatus === "applied") {
          const restored = Number(existing!["credits_removed"]);
          if (restored > 0) {
            await client.query(
              `INSERT INTO ai_credit_purchases (id, org_id, pack, credits, amount_eur_cents)
               VALUES ($1, $2, 'refund_adjustment', $3, 0) ON CONFLICT (id) DO NOTHING`,
              [`acr_rev_${p.refundId}`, purchase.orgId, restored]);
          }
          await client.query(
            `UPDATE ai_credit_refunds SET status = 'reversed', refund_status = $2, updated_at = NOW() WHERE refund_id = $1`,
            [p.refundId, p.refundStatus]);
          await client.query("COMMIT");
          return { outcome: "reversed", creditsRestored: restored };
        }
        if (!existing) {
          await client.query(
            `INSERT INTO ai_credit_refunds
               (refund_id, purchase_id, org_id, payment_intent, charge_id, refund_amount_cents, status, refund_status, kind, livemode)
             VALUES ($1,$2,$3,$4,$5,$6,'ignored',$7,'refund_adjustment',$8) ON CONFLICT (refund_id) DO NOTHING`,
            [p.refundId, purchase.id, purchase.orgId, p.paymentIntentId, p.chargeId, p.refundAmountCents, p.refundStatus, p.livemode]);
        }
        await client.query("COMMIT");
        return { outcome: "ignored", reason: p.refundStatus };
      }

      // requires_action & co : l'argent n'a pas bouge, on attend refund.updated.
      if (!ACTIVE.has(p.refundStatus)) {
        await client.query("COMMIT");
        return { outcome: "ignored", reason: p.refundStatus };
      }
      if (existingStatus === "applied" || existingStatus === "reversed") {
        await client.query("COMMIT");
        return { outcome: "duplicate" };
      }

      // ── Calcul (cumulatif par achat) ─────────────────────────────────────
      const paid = p.paidAmountCents && p.paidAmountCents > 0 ? p.paidAmountCents : purchase.amountCents;
      if (!(paid > 0)) { await client.query("COMMIT"); return { outcome: "rejected", code: "paid_amount_unknown" }; }
      const cum = await client.query(
        `SELECT COALESCE(SUM(refund_amount_cents),0)::text AS refunded, COALESCE(SUM(credits_removed),0)::text AS removed
           FROM ai_credit_refunds WHERE purchase_id = $1 AND status = 'applied'`, [purchase.id]);
      const prevRefunded = Number(cum.rows[0]?.["refunded"] ?? 0);
      const prevRemoved = Number(cum.rows[0]?.["removed"] ?? 0);
      const newRefunded = Math.min(paid, prevRefunded + p.refundAmountCents);
      const targetTotal = Math.min(purchase.credits, creditsForRefundedAmount(purchase.credits, newRefunded, paid));
      const delta = Math.max(0, targetTotal - prevRemoved);

      // ── Plafond : credits achetes encore non consommes (jamais negatif) ──
      let unconsumed = 0;
      let used = 0, limit = 0, extra = 0;
      if (delta > 0) {
        const { getOrCreateMonthlyUsage } = await import("./ai-engine.js");
        const u = await getOrCreateMonthlyUsage(purchase.orgId);
        used = u.creditsUsed; limit = u.creditsLimit; extra = u.creditsExtra;
        unconsumed = Math.max(0, extra - Math.max(0, used - limit));
      }
      const removal = Math.min(delta, unconsumed);
      const shortfall = delta - removal;

      await client.query(
        `INSERT INTO ai_credit_refunds
           (refund_id, purchase_id, org_id, payment_intent, charge_id, refund_amount_cents, status, refund_status, kind,
            credits_target, credits_removed, credits_shortfall, cumulative_refunded_cents, cumulative_credits_removed, livemode)
         VALUES ($1,$2,$3,$4,$5,$6,'applied',$7,'refund_adjustment',$8,$9,$10,$11,$12,$13)
         ON CONFLICT (refund_id) DO UPDATE SET
           status = 'applied', refund_status = EXCLUDED.refund_status, credits_target = EXCLUDED.credits_target,
           credits_removed = EXCLUDED.credits_removed, credits_shortfall = EXCLUDED.credits_shortfall,
           cumulative_refunded_cents = EXCLUDED.cumulative_refunded_cents,
           cumulative_credits_removed = EXCLUDED.cumulative_credits_removed, updated_at = NOW()`,
        [p.refundId, purchase.id, purchase.orgId, p.paymentIntentId, p.chargeId, p.refundAmountCents, p.refundStatus,
         delta, removal, shortfall, newRefunded, prevRemoved + removal, p.livemode]);
      if (removal > 0) {
        await client.query(
          `INSERT INTO ai_credit_purchases (id, org_id, pack, credits, amount_eur_cents)
           VALUES ($1, $2, 'refund_adjustment', $3, 0) ON CONFLICT (id) DO NOTHING`,
          [`acr_${p.refundId}`, purchase.orgId, -removal]);
      }
      await client.query("COMMIT");

      logger.info({ type: "refund_adjustment", refundId: p.refundId, orgId: purchase.orgId, purchaseId: purchase.id,
        creditsRemoved: removal, creditsTarget: delta }, "[AI credits] refund_adjustment applied");
      if (shortfall > 0) {
        logger.error({ AI_CREDITS_REFUND_SHORTFALL: true, refundId: p.refundId, orgId: purchase.orgId, purchaseId: purchase.id,
          creditsToRemove: delta, creditsRemoved: removal, shortfall, creditsAlreadyConsumed: used, planLimit: limit, purchasedTotal: extra },
          "[AI credits] refund larger than the unconsumed balance — removed what was available, NO debt opened");
      }
      return { outcome: "applied", creditsRemoved: removal, shortfall, orgId: purchase.orgId, purchaseId: purchase.id };
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    }
  } finally {
    client.release();
  }
}

// ── Evenements Stripe ────────────────────────────────────────────────────────

export type StripeLike = {
  refunds: { list: (p: Record<string, unknown>) => Promise<{ data: Array<Record<string, unknown>> }> };
  charges: { retrieve: (id: string) => Promise<Record<string, unknown>> };
};

type RefundEventDeps = {
  pool: PoolLike;
  getStripe: () => Promise<StripeLike>;
  findOrgByCustomer: (customerId: string) => Promise<string | null>;
};

const str = (v: unknown): string => (typeof v === "string" ? v : (v && typeof v === "object" && typeof (v as Row)["id"] === "string" ? String((v as Row)["id"]) : ""));

/**
 * Point d'entree appele par le webhook pour charge.refunded, refund.created et
 * refund.updated. Ne fait RIEN si le paiement ne correspond a aucun achat de
 * credits (un remboursement d'abonnement n'est pas de ce perimetre).
 * Leve une erreur sur panne transitoire (Stripe/DB) pour que Stripe relivre.
 */
export async function processAiCreditRefundEvent(
  ev: { type: string; livemode: boolean; object: Row }, deps: RefundEventDeps,
): Promise<RefundOutcome[]> {
  const obj = ev.object;
  const isCharge = ev.type === "charge.refunded";
  const paymentIntentId = str(obj["payment_intent"]);
  if (!paymentIntentId) return [];

  // Pas d'achat de credits pour ce PaymentIntent : sortie sans appel Stripe.
  if (!(await findCreditPurchaseByPaymentIntent(deps.pool, paymentIntentId))) return [];

  if (typeof obj["livemode"] === "boolean" && obj["livemode"] !== ev.livemode) {
    logger.error({ AI_CREDITS_REFUND_REJECTED: true, code: "livemode_mismatch", paymentIntentId }, "[AI credits] refund ignored — livemode mismatch");
    return [{ outcome: "rejected", code: "livemode_mismatch" }];
  }

  let stripe: StripeLike | null = null;
  const getStripe = async () => (stripe ??= await deps.getStripe());

  // Charge : montant paye + customer (la charge est la source, pas les metadata).
  let charge: Row;
  let refunds: Row[];
  if (isCharge) {
    charge = obj;
    const embedded = ((obj["refunds"] as Row | undefined)?.["data"] as Row[] | undefined) ?? [];
    refunds = embedded.length > 0
      ? embedded
      : (await (await getStripe()).refunds.list({ charge: str(obj["id"]), limit: 100 })).data;
  } else {
    const chargeId = str(obj["charge"]);
    if (!chargeId) throw new Error("refund event without charge id — cannot resolve the paid amount");
    charge = await (await getStripe()).charges.retrieve(chargeId);
    refunds = [obj];
  }
  const chargeId = str(charge["id"]) || null;
  const paid = Number(charge["amount"]);
  const customerId = str(charge["customer"]);
  let customerOrgId: string | null = null;
  let customerUnlinked = false;
  if (customerId.startsWith("cus_")) {
    customerOrgId = await deps.findOrgByCustomer(customerId);
    if (!customerOrgId) customerUnlinked = true;
  }

  const out: RefundOutcome[] = [];
  for (const rf of refunds) {
    const refundId = str(rf["id"]);
    if (!refundId.startsWith("re_")) continue;
    const res = await applyAiCreditRefund(deps.pool, {
      refundId,
      refundAmountCents: Number(rf["amount"]),
      refundStatus: String(rf["status"] ?? "succeeded"),
      paymentIntentId, chargeId,
      paidAmountCents: Number.isSafeInteger(paid) && paid > 0 ? paid : null,
      customerOrgId, customerUnlinked, livemode: ev.livemode,
    });
    if (res.outcome === "rejected") {
      logger.error({ AI_CREDITS_REFUND_REJECTED: true, code: res.code, refundId, paymentIntentId },
        "[AI credits] refund NOT applied to credits — needs manual review");
    }
    out.push(res);
  }
  return out;
}
