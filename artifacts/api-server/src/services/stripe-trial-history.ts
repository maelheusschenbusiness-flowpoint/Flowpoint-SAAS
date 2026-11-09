type StripeTrialHistoryClient = {
  customers: {
    list(params: { email: string; limit: number; starting_after?: string }): Promise<{
      data: Array<{ id: string }>;
      has_more: boolean;
    }>;
  };
  subscriptions: {
    list(params: { customer: string; status: "all"; limit: number }): Promise<{
      data: Array<{ id: string }>;
    }>;
  };
};

/**
 * A trial belongs to a person, not to a pending-signup token or a particular
 * organization. Search every customer we already know and every Stripe customer
 * matching the account email; canceled subscriptions count as prior history.
 *
 * Any provider lookup error is thrown so callers can fail closed.
 */
export async function hasStripeSubscriptionHistory(
  stripe: StripeTrialHistoryClient,
  input: { email?: string | null; customerIds?: readonly string[] },
): Promise<boolean> {
  const customerIds = new Set((input.customerIds ?? []).filter(Boolean));
  const email = input.email?.trim();

  if (email) {
    let startingAfter: string | undefined;
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      const page = await stripe.customers.list({
        email,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
      for (const customer of page.data) customerIds.add(customer.id);
      if (!page.has_more) break;

      const lastId = page.data.at(-1)?.id;
      if (!lastId || lastId === startingAfter || pageNumber === 9) {
        throw new Error("TRIAL_CUSTOMER_HISTORY_INCOMPLETE");
      }
      startingAfter = lastId;
    }
  }

  if (customerIds.size === 0) {
    if (!email) throw new Error("TRIAL_IDENTITY_UNAVAILABLE");
    return false;
  }

  for (const customerId of customerIds) {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 1,
    });
    if (subscriptions.data.length > 0) return true;
  }

  return false;
}
