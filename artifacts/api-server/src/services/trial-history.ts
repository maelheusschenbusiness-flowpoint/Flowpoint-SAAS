import type Stripe from "stripe";

export type TrialHistoryStripeClient = Pick<Stripe, "customers" | "subscriptions">;

export interface TrialHistoryCandidate {
  accountHasHistory: boolean;
  customerIds?: Array<string | null | undefined>;
  email?: string | null;
}

export class TrialHistoryLookupError extends Error {
  readonly code = "TRIAL_HISTORY_UNAVAILABLE";

  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "TrialHistoryLookupError";
  }
}

/**
 * A trial is available only when neither the account nor any Stripe customer
 * tied to its identity has a subscription. Lookup failures are not treated as
 * "no history": callers must stop checkout and allow a retry.
 */
export async function isFirstTimeTrialEligible(
  stripe: TrialHistoryStripeClient,
  candidate: TrialHistoryCandidate,
): Promise<boolean> {
  if (candidate.accountHasHistory) return false;

  const customerIds = new Set(
    (candidate.customerIds ?? [])
      .map((id) => id?.trim())
      .filter((id): id is string => Boolean(id)),
  );
  const email = candidate.email?.trim();

  if (email) {
    let startingAfter: string | undefined;
    let pageCount = 0;

    try {
      while (true) {
        const page = await stripe.customers.list({
          email,
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        for (const customer of page.data) customerIds.add(customer.id);

        if (!page.has_more) break;
        const lastCustomer = page.data.at(-1);
        if (!lastCustomer || pageCount >= 9) {
          throw new Error("Stripe customer history pagination was incomplete");
        }
        startingAfter = lastCustomer.id;
        pageCount += 1;
      }
    } catch (cause) {
      throw new TrialHistoryLookupError("Could not verify Stripe customer history", cause);
    }
  }

  // An unidentifiable account is never granted a trial.
  if (!email && customerIds.size === 0) return false;

  try {
    for (const customerId of customerIds) {
      const subscriptions = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 1,
      });
      if (subscriptions.data.length > 0) return false;
    }
  } catch (cause) {
    throw new TrialHistoryLookupError("Could not verify Stripe subscription history", cause);
  }

  return true;
}
