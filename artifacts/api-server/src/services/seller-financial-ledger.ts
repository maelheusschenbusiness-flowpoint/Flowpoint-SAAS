/**
 * Canonical seller financial facts.  This module deliberately appends facts
 * instead of updating/deleting totals; all admin metrics are derived from it.
 */
import { pool } from "@workspace/db";
import type { PoolClient } from "pg";

export type SellerLedgerEvent =
  | "payment_received" | "refund" | "commission_generated" | "commission_paid"
  | "commission_reversed" | "commission_clawback";

export interface LedgerEventOpts {
  sellerId: string;
  orgId?: string | null;
  eventType: SellerLedgerEvent;
  sourceKey: string;
  amountCents?: number;
  currency?: string;
  commissionId?: string | null;
  stripeInvoiceId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeChargeId?: string | null;
  stripeRefundId?: string | null;
  stripeSubscriptionId?: string | null;
  metadata?: Record<string, unknown>;
}

async function insertLedgerEvent(client: Pick<PoolClient, "query">, opts: LedgerEventOpts): Promise<boolean> {
  const r = await client.query(
    `INSERT INTO seller_financial_ledger
      (seller_id, org_id, event_type, source_key, amount_cents, currency, commission_id,
       stripe_invoice_id, stripe_payment_intent_id, stripe_charge_id, stripe_refund_id,
       stripe_subscription_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (source_key) DO NOTHING
     RETURNING id`,
    [opts.sellerId, opts.orgId ?? null, opts.eventType, opts.sourceKey,
     Math.max(0, Math.round(opts.amountCents ?? 0)), opts.currency ?? "eur",
     opts.commissionId ?? null, opts.stripeInvoiceId ?? null,
     opts.stripePaymentIntentId ?? null, opts.stripeChargeId ?? null,
     opts.stripeRefundId ?? null, opts.stripeSubscriptionId ?? null,
     opts.metadata ?? {}],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function recordSellerFinancialEvent(opts: LedgerEventOpts): Promise<boolean> {
  return insertLedgerEvent(pool, opts);
}

export async function recordPaymentReceived(opts: Omit<LedgerEventOpts, "eventType">): Promise<boolean> {
  return recordSellerFinancialEvent({ ...opts, eventType: "payment_received" });
}

export async function recordRefund(opts: Omit<LedgerEventOpts, "eventType">): Promise<boolean> {
  return recordSellerFinancialEvent({ ...opts, eventType: "refund" });
}

export async function recordCommissionGenerated(opts: Omit<LedgerEventOpts, "eventType">): Promise<boolean> {
  return recordSellerFinancialEvent({ ...opts, eventType: "commission_generated" });
}

export async function recordCommissionPaid(opts: Omit<LedgerEventOpts, "eventType">): Promise<boolean> {
  return recordSellerFinancialEvent({ ...opts, eventType: "commission_paid" });
}

export async function recordCommissionReversed(opts: Omit<LedgerEventOpts, "eventType">): Promise<boolean> {
  return recordSellerFinancialEvent({ ...opts, eventType: "commission_reversed" });
}

export async function recordCommissionClawback(opts: Omit<LedgerEventOpts, "eventType">): Promise<boolean> {
  return recordSellerFinancialEvent({ ...opts, eventType: "commission_clawback" });
}

export async function recordRefundAndCommissionReversal(opts: {
  payment: NonNullable<Awaited<ReturnType<typeof findAttributedPayment>>>;
  refundId: string;
  refundAmountCents: number;
  currency?: string;
  paymentIntentId?: string | null;
  chargeId?: string | null;
  sourceEventType: string;
}): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const refundInserted = await insertLedgerEvent(client, {
      sellerId: opts.payment.seller_id, orgId: opts.payment.org_id,
      eventType: "refund", sourceKey: `refund:${opts.refundId}`,
      amountCents: opts.refundAmountCents, currency: opts.currency ?? opts.payment.currency,
      stripeInvoiceId: opts.payment.stripe_invoice_id,
      stripePaymentIntentId: opts.paymentIntentId ?? null, stripeChargeId: opts.chargeId ?? null,
      stripeRefundId: opts.refundId, metadata: { source_event_type: opts.sourceEventType },
    });
    if (!refundInserted) {
      await client.query("COMMIT");
      return false;
    }
    if (!opts.payment.org_id) {
      await client.query("COMMIT");
      return true;
    }
    await client.query(
      `SELECT id FROM seller_financial_ledger WHERE id = $1 AND event_type = 'payment_received' FOR UPDATE`,
      [opts.payment.id],
    );
    const commissionR = await client.query<{ id: string; status: string; commission_amount_cents: number }>(
      `SELECT id, status, commission_amount_cents FROM seller_commissions
        WHERE ${opts.payment.commission_id ? "id = $1" : "org_id = $1"} LIMIT 1 FOR UPDATE`,
      [opts.payment.commission_id ?? opts.payment.org_id],
    );
    const commission = commissionR.rows[0];
    if (commission) {
      const refundTotalR = await client.query<{ total: number }>(
        `SELECT COALESCE(SUM(amount_cents),0)::int AS total
           FROM seller_financial_ledger
          WHERE event_type = 'refund' AND seller_id = $1 AND org_id = $2
            AND ($3::text IS NULL OR stripe_invoice_id = $3)`,
        [opts.payment.seller_id, opts.payment.org_id, opts.payment.stripe_invoice_id],
      );
      const reversalTotalR = await client.query<{ total: number }>(
        `SELECT COALESCE(SUM(amount_cents),0)::int AS total
           FROM seller_financial_ledger
          WHERE commission_id = $1 AND event_type IN ('commission_reversed','commission_clawback')`,
        [commission.id],
      );
      const refundTotal = Number(refundTotalR.rows[0]?.total ?? 0);
      const previousReversal = Number(reversalTotalR.rows[0]?.total ?? 0);
      const desiredReversal = Math.min(
        Number(commission.commission_amount_cents),
        Math.round(Number(commission.commission_amount_cents) * refundTotal / Math.max(1, opts.payment.amount_cents)),
      );
      const reversalAmount = Math.max(0, desiredReversal - previousReversal);
      const fullRefund = refundTotal >= opts.payment.amount_cents;
      const paid = commission.status === "paid" || commission.status === "clawback";
      if (reversalAmount > 0) {
        const eventType = paid ? "commission_clawback" : "commission_reversed";
        await insertLedgerEvent(client, {
          sellerId: opts.payment.seller_id, orgId: opts.payment.org_id, commissionId: commission.id,
          eventType, sourceKey: `${eventType}:${opts.refundId}`, amountCents: reversalAmount,
          currency: opts.currency ?? opts.payment.currency, stripeInvoiceId: opts.payment.stripe_invoice_id,
          stripeRefundId: opts.refundId, metadata: { paid_commission: paid, partial: !fullRefund },
        });
      }
      if (fullRefund && (commission.status === "pending" || commission.status === "paid")) {
        await client.query(
          `UPDATE seller_commissions SET status = $2 WHERE id = $1`,
          [commission.id, paid ? "clawback" : "reversed"],
        );
      }
    }
    await client.query("COMMIT");
    return true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function markCommissionPaid(opts: {
  commissionId: string; paidBy?: string | null; notes?: string | null;
}): Promise<{ found: boolean; transitioned: boolean; commission?: Record<string, unknown> }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<Record<string, unknown>>(
      `SELECT id, seller_id, org_id, status, commission_amount_cents, eligible_amount_cents,
              paid_at, paid_by, notes
         FROM seller_commissions WHERE id = $1 FOR UPDATE`, [opts.commissionId],
    );
    if (!current.rows[0]) {
      await client.query("ROLLBACK");
      return { found: false, transitioned: false };
    }
    if (current.rows[0].status !== "pending") {
      await client.query("COMMIT");
      return { found: true, transitioned: false, commission: current.rows[0] };
    }
    const updated = await client.query<Record<string, unknown>>(
      `UPDATE seller_commissions
          SET status = 'paid', paid_at = COALESCE(paid_at, NOW()),
              paid_by = COALESCE($2, paid_by), notes = COALESCE($3, notes)
        WHERE id = $1
        RETURNING id, seller_id, org_id, status, commission_amount_cents, eligible_amount_cents,
                  paid_at, paid_by, notes`,
      [opts.commissionId, opts.paidBy ?? null, opts.notes ?? null],
    );
    const row = updated.rows[0]!;
    await insertLedgerEvent(client, {
      sellerId: String(row.seller_id), orgId: String(row.org_id),
      commissionId: opts.commissionId, eventType: "commission_paid",
      sourceKey: `commission-paid:${opts.commissionId}`,
      amountCents: Number(row.commission_amount_cents ?? 0),
      metadata: { paid_by: opts.paidBy ?? null, notes: opts.notes ?? null },
    });
    await client.query("COMMIT");
    return { found: true, transitioned: true, commission: row };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Resolve the attributed payment from its Stripe identifiers.  The lookup is
 * intentionally read-only and returns no row when the payment was not a plan
 * payment, preventing add-on/AI credit refunds from entering seller history.
 */
export async function findAttributedPayment(ids: {
  invoiceId?: string | null; paymentIntentId?: string | null; chargeId?: string | null;
  orgId?: string | null; // fallback for Stripe API versions where charge no longer carries invoice/pi IDs
}): Promise<{ id: string; seller_id: string; org_id: string | null; amount_cents: number; currency: string; commission_id: string | null; stripe_invoice_id: string | null } | null> {
  // Try direct Stripe ID match first
  if (ids.invoiceId || ids.paymentIntentId || ids.chargeId) {
    const r = await pool.query(
      `SELECT id, seller_id, org_id, amount_cents, currency, commission_id, stripe_invoice_id
         FROM seller_financial_ledger
        WHERE event_type = 'payment_received'
          AND ($1::text IS NOT NULL AND stripe_invoice_id = $1
            OR $2::text IS NOT NULL AND stripe_payment_intent_id = $2
            OR $3::text IS NOT NULL AND stripe_charge_id = $3)
        ORDER BY occurred_at ASC LIMIT 1`,
      [ids.invoiceId ?? null, ids.paymentIntentId ?? null, ids.chargeId ?? null],
    );
    if (r.rows[0]) return r.rows[0] ?? null;
  }
  // Fallback: look up by org_id (used when Stripe dahlia removes invoice/charge refs from webhook payload)
  if (ids.orgId) {
    const r2 = await pool.query(
      `SELECT id, seller_id, org_id, amount_cents, currency, commission_id, stripe_invoice_id
         FROM seller_financial_ledger
        WHERE event_type = 'payment_received'
          AND org_id = $1
        ORDER BY occurred_at DESC LIMIT 1`,
      [ids.orgId],
    );
    return r2.rows[0] ?? null;
  }
  return null;
}

export async function listSellerLedger(sellerId: string): Promise<unknown[]> {
  const r = await pool.query(
    `SELECT id, org_id, event_type, source_key, amount_cents, currency, commission_id,
            stripe_invoice_id, stripe_payment_intent_id, stripe_charge_id,
            stripe_refund_id, stripe_subscription_id, metadata, occurred_at, created_at
       FROM seller_financial_ledger WHERE seller_id = $1
      ORDER BY occurred_at DESC, created_at DESC`,
    [sellerId],
  );
  return r.rows;
}

export async function getSellerMetrics(sellerId: string): Promise<Record<string, unknown>> {
  const r = await pool.query(
    `SELECT
       COUNT(DISTINCT org_id) FILTER (WHERE event_type = 'payment_received')::int AS paid_clients,
       COALESCE(SUM(amount_cents) FILTER (WHERE event_type = 'payment_received'),0)::int AS gross_revenue_cents,
       COALESCE(SUM(amount_cents) FILTER (WHERE event_type = 'refund'),0)::int AS refunded_revenue_cents,
       (COALESCE(SUM(amount_cents) FILTER (WHERE event_type = 'payment_received'),0)
        - COALESCE(SUM(amount_cents) FILTER (WHERE event_type = 'refund'),0))::int AS net_revenue_cents,
       COALESCE(SUM(amount_cents) FILTER (WHERE event_type = 'commission_generated'),0)::int AS commissions_generated_cents,
       COALESCE(SUM(amount_cents) FILTER (WHERE event_type = 'commission_paid'),0)::int AS commissions_paid_cents,
       COALESCE(SUM(amount_cents) FILTER (WHERE event_type IN ('commission_reversed','commission_clawback')),0)::int AS commissions_reversed_cents,
       (SELECT COALESCE(SUM(GREATEST(sc.commission_amount_cents - COALESCE(r.reversed_cents, 0), 0)),0)::int
          FROM seller_commissions sc
          LEFT JOIN (
                     SELECT commission_id, SUM(amount_cents) AS reversed_cents
                       FROM seller_financial_ledger
                      WHERE event_type IN ('commission_reversed','commission_clawback')
                      GROUP BY commission_id
                    ) r ON r.commission_id = sc.id
         WHERE sc.seller_id = $1 AND sc.status = 'pending') AS commissions_pending_cents,
       (SELECT COUNT(*) FILTER (WHERE consumed_at IS NOT NULL)::int FROM pending_signups WHERE seller_id = $1) AS attributed_signups,
       (SELECT COUNT(*)::int FROM pending_signups WHERE seller_id = $1) AS signup_started,
       (SELECT COUNT(*) FILTER (WHERE consumed_at IS NULL)::int FROM pending_signups WHERE seller_id = $1) AS signup_abandoned,
       (SELECT COUNT(*)::int FROM organizations WHERE seller_id = $1) AS attributed_organizations,
       (SELECT COUNT(*) FILTER (WHERE o.trial_started_at IS NOT NULL)::int FROM organizations o
         WHERE o.seller_id = $1) AS trials_started,
       (SELECT COUNT(*) FILTER (WHERE o.subscription_status = 'trialing'
                                   AND (o.trial_ends_at IS NULL OR o.trial_ends_at > NOW()))::int
         FROM organizations o WHERE o.seller_id = $1) AS active_trials
       FROM seller_financial_ledger WHERE seller_id = $1`,
    [sellerId],
  );
  return r.rows[0] ?? {};
}