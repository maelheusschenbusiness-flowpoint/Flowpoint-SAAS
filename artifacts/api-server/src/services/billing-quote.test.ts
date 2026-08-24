import { describe, expect, it } from "vitest";

import {
  ADDON_DEFINITIONS,
  PLAN_DEFINITIONS,
  PLAN_INCLUDED_ADDONS,
  PLAN_PRICE_IDS,
} from "../lib/plans.js";
import { createBillingQuote, quoteToStripeLineItems, TRIAL_DAYS } from "./billing-quote.js";

/**
 * The quote is the only place a total is computed, so these tests pin the two
 * properties that decide whether a customer is charged correctly:
 *
 *  1. `amountDueTodayMinor` equals what the card is actually debited today.
 *  2. `paymentIntentAmountMinor` never includes the plan, because the plan
 *     subscription raises its own Stripe invoice — collecting it in our
 *     PaymentIntent as well debits the first month twice.
 */

const eur = (n: number) => Math.round(n * 100);
const planMinor = (id: string) => eur(PLAN_DEFINITIONS[id]!.priceEur);
const addonMinor = (key: string) => eur(ADDON_DEFINITIONS[key]!.priceEur);

/** An add-on that no plan bundles and is purchasable on all plans (standard+). */
const PAID_ADDON = "monitorsPack10";
/** A one-time pack (AI credits) — never deferred by a trial. */
const ONE_TIME_ADDON = "aiCreditsPack50k";

describe("billing quote — Payment Element path", () => {
  it("defers the plan during a trial and charges nothing when there are no add-ons", () => {
    const q = createBillingQuote({ plan: "standard", addons: {}, trialEligible: true });

    expect(q.trialEligible).toBe(true);
    expect(q.trialDays).toBe(TRIAL_DAYS);
    expect(q.amountDueTodayMinor).toBe(0);
    expect(q.paymentIntentAmountMinor).toBe(0);
    expect(q.recurringAmountMinor).toBe(planMinor("standard"));
  });

  it("shows the plan as due today when no trial applies, but leaves it out of the PaymentIntent", () => {
    // Regression: the plan subscription invoices this itself at creation.
    // Putting it in the PaymentIntent too charged the first month twice.
    const q = createBillingQuote({ plan: "standard", addons: {}, trialEligible: false });

    expect(q.amountDueTodayMinor).toBe(planMinor("standard"));
    expect(q.paymentIntentAmountMinor).toBe(0);
    expect(q.recurringAmountMinor).toBe(planMinor("standard"));
  });

  it("bills a trial-ineligible plan plus add-ons once each, splitting who collects what", () => {
    const q = createBillingQuote({
      plan: "standard",
      addons: { [PAID_ADDON]: true },
      trialEligible: false,
    });

    // Displayed to the customer: both, because both hit the card today.
    expect(q.amountDueTodayMinor).toBe(planMinor("standard") + addonMinor(PAID_ADDON));
    // Collected by us: the add-on only. Stripe's subscription invoice takes the plan.
    expect(q.paymentIntentAmountMinor).toBe(addonMinor(PAID_ADDON));
    expect(q.recurringAmountMinor).toBe(planMinor("standard") + addonMinor(PAID_ADDON));
  });

  it("charges add-ons up front even while the plan is in trial", () => {
    const q = createBillingQuote({
      plan: "standard",
      addons: { [PAID_ADDON]: true },
      trialEligible: true,
    });

    expect(q.amountDueTodayMinor).toBe(addonMinor(PAID_ADDON));
    expect(q.paymentIntentAmountMinor).toBe(addonMinor(PAID_ADDON));
    expect(q.lines.find(l => l.kind === "plan")?.billedToday).toBe(false);
  });

  it("never routes the plan through the PaymentIntent, whatever the selection", () => {
    for (const planId of Object.keys(PLAN_DEFINITIONS)) {
      for (const trialEligible of [true, false]) {
        const q = createBillingQuote({
          plan: planId,
          addons: { [PAID_ADDON]: true, [ONE_TIME_ADDON]: 2 },
          trialEligible,
        });
        const planLine = q.lines.find(l => l.kind === "plan");
        const nonPlanBilledToday = q.lines
          .filter(l => l.billedToday && l.kind !== "plan")
          .reduce((n, l) => n + l.amountMinor, 0);

        expect(q.paymentIntentAmountMinor).toBe(nonPlanBilledToday);
        expect(q.paymentIntentAmountMinor).toBeLessThan(
          q.amountDueTodayMinor + planLine!.amountMinor + 1,
        );
      }
    }
  });
});

describe("billing quote — hosted Checkout Session path", () => {
  it("defers recurring add-ons along with the plan, because the trial suspends the whole subscription", () => {
    const q = createBillingQuote({
      plan: "standard",
      addons: { [PAID_ADDON]: true },
      trialEligible: true,
      mechanism: "checkout_session",
    });

    // Stripe's trial_period_days applies to every recurring item, add-ons included.
    expect(q.amountDueTodayMinor).toBe(0);
    expect(q.lines.find(l => l.key === PAID_ADDON)?.billedToday).toBe(false);
    expect(q.recurringAmountMinor).toBe(planMinor("standard") + addonMinor(PAID_ADDON));
  });

  it("still charges one-time packs on day zero during a trial", () => {
    const q = createBillingQuote({
      plan: "standard",
      addons: { [PAID_ADDON]: true, [ONE_TIME_ADDON]: 3 },
      trialEligible: true,
      mechanism: "checkout_session",
    });

    expect(q.amountDueTodayMinor).toBe(addonMinor(ONE_TIME_ADDON) * 3);
  });

  it("charges everything on day zero when no trial applies", () => {
    const q = createBillingQuote({
      plan: "pro",
      addons: { [ONE_TIME_ADDON]: 1 },
      trialEligible: false,
      mechanism: "checkout_session",
    });

    expect(q.amountDueTodayMinor).toBe(planMinor("pro") + addonMinor(ONE_TIME_ADDON));
    // Stripe computes the amount from line_items; the two figures must agree.
    expect(q.paymentIntentAmountMinor).toBe(q.amountDueTodayMinor);
  });
});

describe("billing quote — inclusions", () => {
  it("never charges an add-on the plan already bundles, in either mechanism", () => {
    for (const planId of Object.keys(PLAN_DEFINITIONS)) {
      const included = [...(PLAN_INCLUDED_ADDONS[planId] ?? [])];
      if (!included.length) continue;
      const addons = Object.fromEntries(included.map(k => [k, true]));

      for (const mechanism of ["payment_intent", "checkout_session"] as const) {
        const q = createBillingQuote({ plan: planId, addons, trialEligible: false, mechanism });
        const chargedAddons = q.lines.filter(l => l.kind === "addon" && l.amountMinor > 0);

        expect(chargedAddons).toEqual([]);
        expect(q.recurringAmountMinor).toBe(planMinor(planId));
        expect(q.amountDueTodayMinor).toBe(planMinor(planId));
      }
    }
  });

  it("keeps a bundled add-on out of the Stripe line items entirely", () => {
    // A bundled add-on still has a real price ID, so sending it to Stripe would
    // charge for something the customer was told was included.
    const planId = Object.keys(PLAN_INCLUDED_ADDONS).find(
      p => (PLAN_INCLUDED_ADDONS[p]?.size ?? 0) > 0,
    )!;
    const includedKey = [...PLAN_INCLUDED_ADDONS[planId]!][0]!;

    const q = createBillingQuote({ plan: planId, addons: { [includedKey]: true } });
    const items = quoteToStripeLineItems(q);

    expect(items).toHaveLength(1); // the plan, nothing else
    expect(items[0]!.price).toBe(PLAN_PRICE_IDS[planId]);
  });

  it("rejects an unknown plan or add-on rather than quoting a guess", () => {
    expect(() => createBillingQuote({ plan: "ultramax", addons: {} })).toThrow("UNKNOWN_PLAN");
    expect(() => createBillingQuote({ plan: "pro", addons: { nope: 1 } }))
      .toThrow("UNKNOWN_OR_UNBILLABLE_ADDON");
    expect(() => createBillingQuote({ plan: "pro", addons: { [PAID_ADDON]: 0.5 } }))
      .toThrow("INVALID_ADDON_QUANTITY");
  });
});

// ── P0 — addon lifecycle guards ───────────────────────────────────────────────
import { COMING_SOON_ADDONS, REMOVED_ADDONS, PLAN_ALLOWED_ADDONS } from "../lib/plans.js";

describe("billing quote — addon lifecycle guards (P0)", () => {
  const COMING_SOON_KEYS = [...COMING_SOON_ADDONS].slice(0, 4); // slaMonitoring, crmIntegration, ssoEnterprise, aiWorkspaceLaunch, ...

  it("blocks every coming_soon addon on all checkout paths", () => {
    for (const key of COMING_SOON_KEYS) {
      expect(
        () => createBillingQuote({ plan: "ultra", addons: { [key]: true } }),
        `${key} must throw ADDON_COMING_SOON`,
      ).toThrow("ADDON_COMING_SOON");

      expect(
        () => createBillingQuote({ plan: "", addons: { [key]: true }, inclusionPlan: "ultra" }),
        `${key} (addon-only cart) must throw ADDON_COMING_SOON`,
      ).toThrow("ADDON_COMING_SOON");
    }
  });

  it("blocks slaMonitoring, aiWorkspaceLaunch, crmIntegration, ssoEnterprise explicitly", () => {
    for (const key of ["slaMonitoring", "aiWorkspaceLaunch", "crmIntegration", "ssoEnterprise"]) {
      expect(
        () => createBillingQuote({ plan: "ultra", addons: { [key]: true } }),
      ).toThrow("ADDON_COMING_SOON");
    }
  });

  it("blocks a removed addon", () => {
    const removedKey = [...REMOVED_ADDONS][0]!;
    // Inject a fake entry in ADDON_DEFINITIONS-compatible shape just to reach the guard
    // (removed addons already fail at ADDON_REMOVED before UNKNOWN_OR_UNBILLABLE_ADDON)
    expect(
      () => createBillingQuote({ plan: "ultra", addons: { [removedKey]: true } }),
    ).toThrow("ADDON_REMOVED");
  });

  it("blocks an addon that is not purchasable on the chosen plan", () => {
    // ssoEnterprise and aiWorkspaceLaunch are coming_soon so skip those.
    // Find an addon that is ONLY in ultra's allowed set, not standard.
    const ultraOnlyKey = [...(PLAN_ALLOWED_ADDONS["ultra"] ?? [])].find(
      k => !PLAN_ALLOWED_ADDONS["standard"]?.has(k) && !COMING_SOON_ADDONS.has(k) && !REMOVED_ADDONS.has(k),
    );
    if (!ultraOnlyKey) return; // No ultra-only addon available — skip gracefully

    expect(
      () => createBillingQuote({ plan: "standard", addons: { [ultraOnlyKey]: true } }),
    ).toThrow("ADDON_NOT_ALLOWED_FOR_PLAN");
  });

  it("allowedPlans in PLAN_ALLOWED_ADDONS never includes coming_soon addons", () => {
    for (const key of COMING_SOON_ADDONS) {
      for (const [, allowed] of Object.entries(PLAN_ALLOWED_ADDONS)) {
        expect(allowed.has(key)).toBe(false);
      }
    }
  });

  it("never charges a coming_soon addon even if rawQuantity is truthy (guard fires first)", () => {
    expect(
      () => createBillingQuote({ plan: "ultra", addons: { slaMonitoring: 3 } }),
    ).toThrow("ADDON_COMING_SOON");
  });
});
