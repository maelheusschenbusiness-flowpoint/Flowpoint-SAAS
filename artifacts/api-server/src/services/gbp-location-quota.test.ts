import { describe, expect, it } from "vitest";
import { selectGbpLocations } from "./gbp-location-quota.js";

const batches = [
  { accountId: "account-1", locations: Array.from({ length: 18 }, (_, i) => `a-${i + 1}`) },
  { accountId: "account-2", locations: Array.from({ length: 18 }, (_, i) => `b-${i + 1}`) },
  { accountId: "account-3", locations: Array.from({ length: 18 }, (_, i) => `c-${i + 1}`) },
  { accountId: "account-4", locations: ["d-1"] },
];

describe("GBP location pack capacity", () => {
  it("preserves the existing baseline of ten locations per first three accounts", () => {
    const selected = selectGbpLocations(batches, {});

    expect(selected).toHaveLength(30);
    expect(selected.filter(item => item.accountId === "account-1")).toHaveLength(10);
    expect(selected.filter(item => item.accountId === "account-2")).toHaveLength(10);
    expect(selected.filter(item => item.accountId === "account-3")).toHaveLength(10);
    expect(selected.some(item => item.accountId === "account-4")).toBe(false);
  });

  it("adds ten locations per active GBP pack and shares extras across accounts", () => {
    const selected = selectGbpLocations(batches, { gbpSlots10: 2 });

    expect(selected).toHaveLength(50);
    expect(selected.filter(item => item.accountId === "account-1")).toHaveLength(17);
    expect(selected.filter(item => item.accountId === "account-2")).toHaveLength(17);
    expect(selected.filter(item => item.accountId === "account-3")).toHaveLength(16);
  });

  it("ignores inactive and unrelated quantity add-ons", () => {
    const selected = selectGbpLocations(batches, { gbpSlots10: false, auditsPack200: 5 });
    expect(selected).toHaveLength(30);
  });
});
