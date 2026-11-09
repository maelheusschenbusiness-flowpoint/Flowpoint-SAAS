import type Stripe from "stripe";
import { logger } from "../lib/logger.js";
import {
  subscriptionAttemptKey,
  claimSubscriptionCreation,
  settleSubscriptionClaim,
  waitForClaimedSubscription,
  createWithIdempotency,
  ensureClaimTable,
  type ClaimOutcome,
} from "./checkout-subscription-claim.js";

/**
 * Create or reuse the one Stripe subscription associated with a checkout intent.
 * Both finalize-checkout and Stripe webhook recovery must call this function so
 * concurrent paths share the same database claim and Stripe idempotency key.
 */
export async function createSubscriptionForAttempt(args: {
  stripe: Stripe;
  intentId: string;
  scope: string;
  plan: string;
  priceId: string;
  orgRef: string | null;
  params: Stripe.SubscriptionCreateParams;
}): Promise<Stripe.Subscription> {
  const attemptKey = subscriptionAttemptKey({
    scope: args.scope,
    intentId: args.intentId,
    plan: args.plan,
    priceId: args.priceId,
  });
  const claimArgs = {
    attemptKey,
    intentId: args.intentId,
    plan: args.plan,
    priceId: args.priceId,
    orgRef: args.orgRef,
  };
  const { pool } = await import("@workspace/db");

  const tryClaim = async (): Promise<ClaimOutcome | null> => {
    try {
      return await claimSubscriptionCreation(pool, claimArgs);
    } catch (err) {
      if ((err as { code?: string } | null)?.code === "42P01") {
        try {
          await ensureClaimTable(pool);
          return await claimSubscriptionCreation(pool, claimArgs);
        } catch (healErr) {
          logger.error({ healErr, scope: args.scope },
            "[CheckoutSubscription][P0] claim table unavailable — using Stripe idempotency only");
          return null;
        }
      }
      logger.error({ err, scope: args.scope },
        "[CheckoutSubscription][P0] claim unavailable — using Stripe idempotency only");
      return null;
    }
  };

  let claim: ClaimOutcome = (await tryClaim()) ?? { role: "owner", subscriptionId: null };
  if (claim.role === "pending") {
    const waited = await waitForClaimedSubscription(pool, attemptKey).catch(() => null);
    if (waited) {
      claim = { role: "settled", subscriptionId: waited };
    } else {
      const retried = await tryClaim();
      claim = retried && retried.role !== "pending"
        ? retried
        : { role: "takeover", subscriptionId: null };
      logger.warn({ scope: args.scope, attemptKey, role: claim.role },
        "[CheckoutSubscription][P0] claim lease expired — retrying with Stripe idempotency");
    }
  }

  if (claim.role === "settled" && claim.subscriptionId) {
    logger.info({ scope: args.scope, subscriptionId: claim.subscriptionId, attemptKey },
      "[CheckoutSubscription][P0] reusing subscription already created for this attempt");
    return args.stripe.subscriptions.retrieve(claim.subscriptionId);
  }

  const created = await createWithIdempotency<Stripe.Subscription>(
    (idempotencyKey) => args.stripe.subscriptions.create(args.params, { idempotencyKey }),
    attemptKey,
  );
  const winner = await settleSubscriptionClaim(pool, attemptKey, created.id).catch(() => null);
  if (winner && winner !== created.id) {
    logger.error({ scope: args.scope, duplicate: created.id, kept: winner, attemptKey },
      "[CheckoutSubscription][P0] duplicate subscription detected — cancelling duplicate");
    try {
      await args.stripe.subscriptions.cancel(created.id);
    } catch (cancelErr) {
      logger.error({ cancelErr, duplicate: created.id },
        "[CheckoutSubscription][P0] duplicate cancellation failed");
    }
    return args.stripe.subscriptions.retrieve(winner);
  }

  logger.info({ scope: args.scope, subscriptionId: created.id, attemptKey, role: claim.role },
    "[CheckoutSubscription][P0] subscription created once for checkout attempt");
  return created;
}
