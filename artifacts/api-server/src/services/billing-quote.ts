import {
  ADDON_DEFINITIONS,
  ADDON_PRICE_IDS,
  PLAN_DEFINITIONS,
  PLAN_INCLUDED_ADDONS,
  PLAN_PRICE_IDS,
} from "../lib/plans.js";

/** Free-trial length granted to first-time subscribers. Single source of truth. */
export const TRIAL_DAYS = 14;

/**
 * How the money is actually collected. The two paths defer different things, so
 * a quote is only truthful with respect to one of them:
 *
 * - `payment_intent` — our own Payment Element. One card charge covers the plan
 *   (unless a trial defers it) plus every non-included add-on. Finalisation then
 *   creates each subscription with `trial_end` set past the period just paid.
 * - `checkout_session` — Stripe-hosted `mode: "subscription"`. Stripe's own
 *   invoice decides, and `trial_period_days` suspends the *entire* subscription,
 *   recurring add-ons included. Only one-time items are taken on day zero.
 */
export type BillingMechanism = "payment_intent" | "checkout_session";

export type BillingSelection = {
  plan: string;
  addons: Record<string, boolean | number>;
  /**
   * Server-derived trial eligibility. MUST come from billing context or signup
   * state — never from the browser. When false the plan and every recurring
   * add-on are billed immediately, so the quote says so.
   */
  trialEligible?: boolean;
  /** Defaults to the Payment Element path. */
  mechanism?: BillingMechanism;
};

export type QuoteLine = {
  key: string;
  kind: "plan" | "addon";
  name: string;
  priceId: string;
  quantity: number;
  unitAmountMinor: number;
  amountMinor: number;
  interval: "month" | "one_time";
  includedInPlan: boolean;
  /** True when this exact line is part of the charge taken today. */
  billedToday: boolean;
};

export type BillingQuote = {
  catalogVersion: 1;
  currency: "EUR";
  /** Billing interval of the recurring part of this quote. */
  interval: "month";
  plan: string | null;
  planName: string | null;
  trialEligible: boolean;
  trialDays: number;
  /** Which collection path this quote is valid for. */
  mechanism: BillingMechanism;
  includedAddonKeys: string[];
  lines: QuoteLine[];
  /**
   * Everything the customer is actually debited today, across every charge.
   * This is the figure to display. Trial-aware.
   */
  amountDueTodayMinor: number;
  /**
   * `payment_intent` path only: what OUR PaymentIntent must collect. It excludes
   * the plan, because the plan subscription raises its own Stripe invoice at
   * creation. Charging the plan here as well would debit the first month twice.
   * Zero means the card only needs to be saved (SetupIntent).
   */
  paymentIntentAmountMinor: number;
  /** Charged every `interval` once any trial ends. */
  recurringAmountMinor: number;
  /**
   * The server-validated figure the frontend must display as the amount taken
   * today, and the exact amount handed to Stripe. Kept as an explicit field so
   * no surface has to decide which of the two totals above to render.
   */
  totalMinor: number;
  checkoutType: "subscription" | "ai_credits_only" | "addon_only";
};

/**
 * Builds the one canonical selection/price view used by every checkout path.
 * Amounts are expressed in minor EUR units; browser code must only render this
 * response and never recompute a cart total from a local catalogue.
 */
/**
 * The one way to turn a quote into Stripe line items. Every payment entry point
 * must build its items from here, so what Stripe is asked to charge can never
 * diverge from what the quote displayed.
 *
 * Add-ons bundled with the plan are omitted entirely — they carry a real price
 * ID, so sending them would charge for something advertised as included.
 */
export function quoteToStripeLineItems(
  quote: BillingQuote,
): Array<{ price: string; quantity: number }> {
  return quote.lines
    .filter(line => !line.includedInPlan)
    .map(line => ({ price: line.priceId, quantity: line.quantity }));
}

export function createBillingQuote(selection: BillingSelection): BillingQuote {
  const plan = selection.plan.trim().toLowerCase();
  const planDefinition = plan ? PLAN_DEFINITIONS[plan] : undefined;
  if (plan && !planDefinition) throw new Error("UNKNOWN_PLAN");

  const hasPlan = !!planDefinition;
  // A trial only has meaning when a subscription is being started.
  const trialEligible = hasPlan && selection.trialEligible === true;
  const mechanism: BillingMechanism = selection.mechanism ?? "payment_intent";

  const included = PLAN_INCLUDED_ADDONS[plan] ?? new Set<string>();
  const lines: QuoteLine[] = [];

  if (planDefinition) {
    const priceId = PLAN_PRICE_IDS[plan];
    if (!priceId) throw new Error("MISSING_PRICE_ID");
    const unitAmountMinor = Math.round(planDefinition.priceEur * 100);
    lines.push({
      key: plan,
      kind: "plan",
      name: planDefinition.name,
      priceId,
      quantity: 1,
      unitAmountMinor,
      amountMinor: unitAmountMinor,
      interval: "month",
      includedInPlan: false,
      // Deferred to the end of the trial when one applies.
      billedToday: !trialEligible,
    });
  }

  for (const [key, rawQuantity] of Object.entries(selection.addons)) {
    if (!rawQuantity) continue;
    const definition = ADDON_DEFINITIONS[key];
    const priceId = ADDON_PRICE_IDS[key];
    if (!definition || !priceId) throw new Error("UNKNOWN_OR_UNBILLABLE_ADDON");
    const quantity = typeof rawQuantity === "number" ? rawQuantity : 1;
    if (!Number.isInteger(quantity) || quantity < 1) throw new Error("INVALID_ADDON_QUANTITY");
    const includedInPlan = included.has(key);
    const unitAmountMinor = Math.round(definition.priceEur * 100);
    const interval: "month" | "one_time" = definition.oneTime ? "one_time" : "month";
    /* One-time packs are always taken now. For recurring add-ons the answer
       depends on who collects the money:
        - Payment Element: we charge month 1 up front and start the add-on
          subscription at month 2, so a plan trial never defers the add-on.
        - Hosted Checkout: Stripe's `trial_period_days` suspends the whole
          subscription, add-ons included, so nothing recurring is taken today. */
    const deferredByHostedTrial =
      mechanism === "checkout_session" && trialEligible && interval === "month";
    const billedToday = !includedInPlan && !deferredByHostedTrial;
    lines.push({
      key,
      kind: "addon",
      name: definition.name,
      priceId,
      quantity,
      unitAmountMinor,
      amountMinor: includedInPlan ? 0 : unitAmountMinor * quantity,
      interval,
      includedInPlan,
      billedToday,
    });
  }

  const billable = lines.filter(line => !line.includedInPlan);
  const recurringAmountMinor = billable
    .filter(line => line.interval === "month")
    .reduce((total, line) => total + line.amountMinor, 0);
  const amountDueTodayMinor = billable
    .filter(line => line.billedToday)
    .reduce((total, line) => total + line.amountMinor, 0);
  /* The plan is always collected by its own subscription invoice — immediately
     when there is no trial, at trial end otherwise. So it is due today, but it
     is never part of our PaymentIntent. */
  const paymentIntentAmountMinor = mechanism === "checkout_session"
    ? amountDueTodayMinor
    : billable
        .filter(line => line.billedToday && line.kind !== "plan")
        .reduce((total, line) => total + line.amountMinor, 0);

  const hasOneTime = billable.some(line => line.interval === "one_time");
  const hasRecurring = billable.some(line => line.interval === "month");
  const checkoutType = hasPlan
    ? "subscription"
    : hasOneTime && !hasRecurring
      ? "ai_credits_only"
      : "addon_only";

  return {
    catalogVersion: 1,
    currency: "EUR",
    interval: "month",
    plan: plan || null,
    planName: planDefinition?.name ?? null,
    trialEligible,
    trialDays: trialEligible ? TRIAL_DAYS : 0,
    mechanism,
    includedAddonKeys: [...included],
    lines,
    amountDueTodayMinor,
    paymentIntentAmountMinor,
    recurringAmountMinor,
    totalMinor: amountDueTodayMinor,
    checkoutType,
  };
}
