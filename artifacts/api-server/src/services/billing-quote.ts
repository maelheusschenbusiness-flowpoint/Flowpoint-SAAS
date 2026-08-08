import {
  ADDON_DEFINITIONS,
  ADDON_PRICE_IDS,
  PLAN_DEFINITIONS,
  PLAN_INCLUDED_ADDONS,
  PLAN_PRICE_IDS,
} from "../lib/plans.js";

export type BillingSelection = {
  plan: string;
  addons: Record<string, boolean | number>;
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
};

export type BillingQuote = {
  catalogVersion: 1;
  currency: "EUR";
  plan: string | null;
  includedAddonKeys: string[];
  lines: QuoteLine[];
  amountDueTodayMinor: number;
  recurringAmountMinor: number;
  checkoutType: "subscription" | "ai_credits_only" | "addon_only";
};

/**
 * Builds the one canonical selection/price view used by every checkout path.
 * Amounts are expressed in minor EUR units; browser code must only render this
 * response and never recompute a cart total from a local catalogue.
 */
export function createBillingQuote(selection: BillingSelection): BillingQuote {
  const plan = selection.plan.trim().toLowerCase();
  const planDefinition = plan ? PLAN_DEFINITIONS[plan] : undefined;
  if (plan && !planDefinition) throw new Error("UNKNOWN_PLAN");

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
    lines.push({
      key,
      kind: "addon",
      name: definition.name,
      priceId,
      quantity,
      unitAmountMinor,
      amountMinor: includedInPlan ? 0 : unitAmountMinor * quantity,
      interval: definition.oneTime ? "one_time" : "month",
      includedInPlan,
    });
  }

  const recurringLines = lines.filter(line => line.interval === "month" && !line.includedInPlan);
  const oneTimeLines = lines.filter(line => line.interval === "one_time" && !line.includedInPlan);
  const recurringAmountMinor = recurringLines.reduce((total, line) => total + line.amountMinor, 0);
  const amountDueTodayMinor = oneTimeLines.reduce((total, line) => total + line.amountMinor, 0);
  const hasPlan = !!planDefinition;
  const checkoutType = hasPlan
    ? "subscription"
    : oneTimeLines.length > 0 && recurringLines.length === 0
      ? "ai_credits_only"
      : "addon_only";

  return {
    catalogVersion: 1,
    currency: "EUR",
    plan: plan || null,
    includedAddonKeys: [...included],
    lines,
    amountDueTodayMinor,
    recurringAmountMinor,
    checkoutType,
  };
}
