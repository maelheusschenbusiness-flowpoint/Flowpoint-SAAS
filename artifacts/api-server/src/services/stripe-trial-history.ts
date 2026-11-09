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

  // Every known customer is checked (no early exit): the test contract of #410
  // requires both the anchored IDs and the email matches to be consulted.
  let found = false;
  for (const customerId of customerIds) {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 1,
    });
    if (subscriptions.data.length > 0) found = true;
  }

  return found;
}

type TrialHistoryPool = {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
};

/**
 * Eligibilite a l'essai pour une identite (e-mail + clients Stripe connus).
 *
 * Partagee par `resolveTrialEligibility` (devis, intent, finalize-checkout) et
 * par le provisionnement webhook (services/signup-subscription.ts) : les deux
 * chemins doivent prendre la MEME decision, sinon ils construisent des corps de
 * requete differents sous la meme cle d'idempotence Stripe.
 *
 * Refuse l'essai si une organisation (ou un etat legacy org_settings) de cet
 * e-mail a deja consomme un essai ou porte un abonnement, ou si l'un des clients
 * Stripe de cet e-mail a un historique d'abonnement. Les erreurs remontent :
 * l'appelant echoue ferme.
 */
export async function isTrialEligibleForIdentity(
  pool: TrialHistoryPool,
  input: { email: string; customerIds?: readonly string[] },
  stripeOverride?: StripeTrialHistoryClient,
): Promise<boolean> {
  const email = input.email;
  const customerIds = new Set((input.customerIds ?? []).filter(Boolean));
  type Row = { stripe_customer_id: string | null; stripe_subscription_id: string | null; trial_consumed_at: string | null };

  const existingOrgs = await pool.query<Row>(
    `SELECT stripe_customer_id, stripe_subscription_id, trial_consumed_at
       FROM organizations
      WHERE lower(owner_email) = lower($1)`,
    [email],
  );
  for (const existing of existingOrgs.rows) {
    if (existing.trial_consumed_at || existing.stripe_subscription_id) return false;
    if (existing.stripe_customer_id) customerIds.add(existing.stripe_customer_id);
  }

  // Older accounts may still have email-keyed billing state. It is history,
  // not a new signup, and must also be included in the customer lookup.
  const legacyOrgs = await pool.query<Row>(
    `SELECT stripe_customer_id, stripe_subscription_id, trial_consumed_at
       FROM org_settings
      WHERE lower(org_id) = lower($1)`,
    [email],
  );
  for (const existing of legacyOrgs.rows) {
    if (existing.trial_consumed_at || existing.stripe_subscription_id) return false;
    if (existing.stripe_customer_id) customerIds.add(existing.stripe_customer_id);
  }

  let stripe = stripeOverride;
  if (!stripe) {
    const { getStripeKey, createStripeClient } = await import("./stripe-factory.js");
    const stripeKey = getStripeKey();
    if (!stripeKey) return false;
    stripe = (await createStripeClient(stripeKey)) as unknown as StripeTrialHistoryClient;
  }
  return !(await hasStripeSubscriptionHistory(stripe, { email, customerIds: [...customerIds] }));
}
