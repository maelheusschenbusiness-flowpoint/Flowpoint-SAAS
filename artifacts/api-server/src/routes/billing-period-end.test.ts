/**
 * billing-period-end.test.ts — subPeriodEnd() resolution tests
 *
 * Stripe API version 2026-04-22.dahlia removed `current_period_end` from the
 * subscription object and moved it onto each subscription item. Every code
 * path that schedules a downgrade or reports a next-billing date must resolve
 * the period end through subPeriodEnd(), which tolerates both shapes.
 *
 * Root cause this guards against: `end_date: sub.current_period_end` was
 * `undefined` under dahlia, so Stripe rejected the downgrade schedule with
 * "Phase 0 is invalid" and every Ultra→Standard downgrade returned a generic
 * 500 ("Erreur lors du changement de plan").
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  pool: { connect: vi.fn(), query: vi.fn(async () => ({ rows: [] })) },
}));

const { subPeriodEnd } = await import("./billing.js");

describe("subPeriodEnd", () => {
  it("uses sub.current_period_end when present (older API versions)", () => {
    expect(subPeriodEnd({ current_period_end: 1789000000 })).toBe(1789000000);
  });

  it("falls back to item-level current_period_end (2026-04-22.dahlia)", () => {
    const sub = {
      // dahlia: no top-level current_period_end
      items: { data: [{ current_period_end: 1789244865 }] },
    };
    expect(subPeriodEnd(sub)).toBe(1789244865);
  });

  it("takes the max across multiple items (plan + add-ons)", () => {
    const sub = {
      items: { data: [
        { current_period_end: 1789000000 },
        { current_period_end: 1789999999 },
        { current_period_end: 1788000000 },
      ] },
    };
    expect(subPeriodEnd(sub)).toBe(1789999999);
  });

  it("falls back to trial_end when neither sub nor items carry a period end", () => {
    const sub = { trial_end: 1787776048, items: { data: [{}] } };
    expect(subPeriodEnd(sub)).toBe(1787776048);
  });

  it("prefers top-level current_period_end over items and trial_end", () => {
    const sub = {
      current_period_end: 1786000000,
      trial_end: 1787000000,
      items: { data: [{ current_period_end: 1788000000 }] },
    };
    expect(subPeriodEnd(sub)).toBe(1786000000);
  });

  it("returns null for null/undefined/empty subscriptions", () => {
    expect(subPeriodEnd(null)).toBeNull();
    expect(subPeriodEnd(undefined)).toBeNull();
    expect(subPeriodEnd({})).toBeNull();
    expect(subPeriodEnd({ items: { data: [] } })).toBeNull();
    expect(subPeriodEnd("not-an-object")).toBeNull();
  });
});
