/**
 * FlowPoint — Seller Attribution Service (beta)
 *
 * Pure read/write functions — zero billing logic.
 * Never modifies Stripe Customer resolution, pricing, trial eligibility,
 * subscription lifecycle, or any financial parameter.
 */

import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SellerRow {
  id: string;
  seller_code: string;
  name: string | null;
  email: string | null;
  status: string;
}

export interface CommissionOpts {
  sellerId:               string;
  orgId:                  string;
  customerEmail:          string;
  stripeCustomerId?:      string | null;
  stripeSubscriptionId?:  string | null;
  stripeCheckoutSessionId?: string | null;
  stripeInvoiceId?:       string | null;
  stripePaymentIntentId?: string | null;
  plan:                   string;
  eligibleAmountCents:    number;
  currency:               string;
  attributionMethod:      "ref_link" | "manual";
}

const COMMISSION_RATE_BPS = 3500; // 35 % — snapshotted per commission row

// ── Seller validation ─────────────────────────────────────────────────────────

/**
 * Validate a seller code.
 * Returns the seller row if the code exists and is active, null otherwise.
 * Always queries the DB — never trusts caller input.
 */
export async function validateSellerCode(code: string): Promise<SellerRow | null> {
  if (!code || typeof code !== "string") return null;
  const normalized = code.trim().toUpperCase();
  // Reject codes that don't match SELLER-XXXX format
  if (!/^SELLER-[A-Z0-9]{1,20}$/.test(normalized)) return null;
  try {
    const r = await pool.query<SellerRow>(
      `SELECT id, seller_code, name, email, status
       FROM sellers WHERE seller_code = $1 AND status = 'active' LIMIT 1`,
      [normalized]
    );
    return r.rows[0] ?? null;
  } catch (err) {
    logger.warn({ err, code }, "[SellerAttrib] validateSellerCode DB error (non-fatal)");
    return null;
  }
}

/**
 * Resolve seller_id stored in a pending_signup token.
 * This is the authoritative path — webhook and checkout must use this,
 * never a raw frontend-supplied seller_code.
 */
export async function resolveSellerIdFromToken(token: string): Promise<string | null> {
  if (!token) return null;
  try {
    const r = await pool.query<{ seller_id: string | null }>(
      `SELECT seller_id FROM pending_signups WHERE token = $1 LIMIT 1`,
      [token]
    );
    return r.rows[0]?.seller_id ?? null;
  } catch (err) {
    logger.warn({ err, token }, "[SellerAttrib] resolveSellerIdFromToken DB error (non-fatal)");
    return null;
  }
}

// ── Commission recording ──────────────────────────────────────────────────────

/**
 * Record one commission for an acquisition event.
 *
 * Idempotent: org_id has a UNIQUE constraint on seller_commissions —
 * a second call for the same org silently does nothing (ON CONFLICT DO NOTHING).
 *
 * Commission rate is SNAPSHOTTED into the row at recording time.
 * Retrospective rate changes never affect past records.
 *
 * Non-recurring: only the first successful call creates a commission.
 */
export async function recordCommission(opts: CommissionOpts): Promise<void> {
  const commissionAmountCents = Math.round(opts.eligibleAmountCents * COMMISSION_RATE_BPS / 10000);
  try {
    await pool.query(
      `INSERT INTO seller_commissions
         (seller_id, org_id, customer_email, stripe_customer_id,
          stripe_subscription_id, stripe_checkout_session_id,
          stripe_invoice_id, stripe_payment_intent_id,
          plan, eligible_amount_cents, commission_rate_bps, commission_amount_cents,
          currency, status, attribution_method, attributed_at, earned_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'pending',$14,NOW(),
               CASE WHEN $10 > 0 THEN NOW() ELSE NULL END,NOW())
       ON CONFLICT (org_id) DO NOTHING`,
      [
        opts.sellerId,
        opts.orgId,
        opts.customerEmail,
        opts.stripeCustomerId       ?? null,
        opts.stripeSubscriptionId   ?? null,
        opts.stripeCheckoutSessionId ?? null,
        opts.stripeInvoiceId        ?? null,
        opts.stripePaymentIntentId  ?? null,
        opts.plan,
        opts.eligibleAmountCents,
        COMMISSION_RATE_BPS,
        commissionAmountCents,
        opts.currency,
        opts.attributionMethod,
      ]
    );
    logger.info(
      { orgId: opts.orgId, sellerId: opts.sellerId, commissionAmountCents },
      "[SellerAttrib] Commission recorded (or already existed — idempotent)"
    );
  } catch (err) {
    // Fire-and-forget callers must not propagate — log and move on
    logger.error({ err, opts }, "[SellerAttrib] recordCommission failed (non-fatal)");
    throw err; // rethrow so callers using fire-and-forget can catch if needed
  }
}
