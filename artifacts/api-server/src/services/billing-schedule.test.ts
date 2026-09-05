import { describe, expect, it, vi } from "vitest";
import {
  ensureStripeScheduleTarget,
  type BillingScheduleItem,
} from "./billing-schedule.js";

function fakeStripe(schedule: unknown) {
  return {
    subscriptionSchedules: {
      retrieve: vi.fn(async () => schedule),
      update: vi.fn(async (_id: string, params: Record<string, unknown>) => ({ id: "sched_1", ...params })),
    },
  };
}

const currentItems: BillingScheduleItem[] = [
  { price: "price_ultra", quantity: 1 },
  { price: "price_addon", quantity: 2 },
];

describe("ensureStripeScheduleTarget", () => {
  it("is idempotent only when the future plan and add-ons exactly match", async () => {
    const stripe = fakeStripe({
      id: "sched_1",
      phases: [
        { start_date: 1_700_000_000, items: currentItems },
        { items: [{ price: { id: "price_pro" }, quantity: 1 }, { price: "price_addon", quantity: 2 }] },
      ],
    });

    const result = await ensureStripeScheduleTarget({
      stripe,
      scheduleId: "sched_1",
      periodEnd: 1_800_000_000,
      currentItems,
      futureItems: [{ price: "price_pro", quantity: 1 }, { price: "price_addon", quantity: 2 }],
      targetPlan: "pro",
    });

    expect(result).toEqual({ alreadyTarget: true });
    expect(stripe.subscriptionSchedules.update).not.toHaveBeenCalled();
  });

  it("rewrites a Pro downgrade schedule when the owner selects Standard", async () => {
    const stripe = fakeStripe({
      id: "sched_1",
      phases: [
        { start_date: 1_700_000_000, items: currentItems },
        { items: [{ price: "price_pro", quantity: 1 }] },
      ],
    });

    const result = await ensureStripeScheduleTarget({
      stripe,
      scheduleId: "sched_1",
      periodEnd: 1_800_000_000,
      currentItems,
      futureItems: [{ price: "price_standard", quantity: 1 }],
      targetPlan: "standard",
    });

    expect(result).toEqual({ alreadyTarget: false });
    expect(stripe.subscriptionSchedules.update).toHaveBeenCalledTimes(1);
    const [, params] = stripe.subscriptionSchedules.update.mock.calls[0]!;
    const phases = params["phases"] as Array<{ items: BillingScheduleItem[]; metadata?: { plan?: string } }>;
    expect(phases[1]?.items).toEqual([{ price: "price_standard", quantity: 1 }]);
    expect(phases[1]?.metadata?.plan).toBe("standard");
  });

  it("rewrites the schedule when the target add-on set changed", async () => {
    const stripe = fakeStripe({
      id: "sched_1",
      phases: [
        { start_date: 1_700_000_000, items: currentItems },
        { items: [{ price: "price_pro", quantity: 1 }, { price: "price_old_addon", quantity: 1 }] },
      ],
    });

    await ensureStripeScheduleTarget({
      stripe,
      scheduleId: "sched_1",
      periodEnd: 1_800_000_000,
      currentItems,
      futureItems: [{ price: "price_pro", quantity: 1 }],
      targetPlan: "pro",
    });

    expect(stripe.subscriptionSchedules.update).toHaveBeenCalledTimes(1);
  });

  it("fails explicitly instead of writing an invalid schedule without a start date", async () => {
    const stripe = fakeStripe({ id: "sched_1", phases: [{ items: currentItems }] });

    await expect(ensureStripeScheduleTarget({
      stripe,
      scheduleId: "sched_1",
      periodEnd: 1_800_000_000,
      currentItems,
      futureItems: [{ price: "price_standard", quantity: 1 }],
      targetPlan: "standard",
    })).rejects.toThrow("downgrade_schedule_start_unresolved:sched_1");
    expect(stripe.subscriptionSchedules.update).not.toHaveBeenCalled();
  });
});