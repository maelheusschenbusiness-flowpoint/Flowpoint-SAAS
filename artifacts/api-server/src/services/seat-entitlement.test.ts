/**
 * seat-entitlement.test.ts — targeted tests for the P0 Ultra seat resolver.
 *
 * Proves the ONE authoritative resolver (resolveSeatEntitlement) derives seat
 * capacity from the canonical billing record (loadBillingContext) + extraSeats
 * pack expansion, and NEVER silently degrades to Standard/1 on failure.
 *
 * Coverage:
 *   - Ultra → limit 10 (plan.teamMembers)
 *   - Ultra + 1 extraSeats pack → limit 15
 *   - Standard → limit 1
 *   - unknown plan → SeatEntitlementUnavailableError (retryable), NOT Standard/1
 *   - loadBillingContext throws → SeatEntitlementUnavailableError (retryable)
 *   - null context → SeatEntitlementUnavailableError (retryable)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Logger mock ──────────────────────────────────────────────────────────────
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

// ─── billing-context mock — the canonical org/billing record ──────────────────
type MockResult = { value?: Record<string, unknown>; throwErr?: boolean };
let mockCtx: MockResult = {};
vi.mock("./billing-context.js", () => ({
  loadBillingContext: vi.fn(async () => {
    if (mockCtx.throwErr) throw new Error("db down");
    return mockCtx.value;
  }),
}));

import { resolveSeatEntitlement, SeatEntitlementUnavailableError } from "./seat-entitlement.js";

const ORG = "org-uuid-1234";

describe("resolveSeatEntitlement — authoritative seat capacity", () => {
  beforeEach(() => {
    mockCtx = {};
    vi.clearAllMocks();
  });

  it("Ultra → limit 10", async () => {
    mockCtx = { value: { plan: "ultra", addons: {} } };
    const r = await resolveSeatEntitlement(ORG);
    expect(r.plan).toBe("ultra");
    expect(r.limit).toBe(10);
  });

  it("Ultra + 1 extraSeats pack → limit 15", async () => {
    mockCtx = { value: { plan: "ultra", addons: { extraSeats: 1 } } };
    const r = await resolveSeatEntitlement(ORG);
    expect(r.limit).toBe(15); // 10 + 1×5
  });

  it("Standard → limit 1", async () => {
    mockCtx = { value: { plan: "standard", addons: {} } };
    const r = await resolveSeatEntitlement(ORG);
    expect(r.plan).toBe("standard");
    expect(r.limit).toBe(1);
  });

  it("unknown plan → retryable error, NEVER Standard/1", async () => {
    mockCtx = { value: { plan: "mystery", addons: {} } };
    await expect(resolveSeatEntitlement(ORG)).rejects.toBeInstanceOf(SeatEntitlementUnavailableError);
    await expect(resolveSeatEntitlement(ORG)).rejects.toMatchObject({ retryable: true });
  });

  it("billing context throws → retryable error, NEVER Standard/1", async () => {
    mockCtx = { throwErr: true };
    const err = await resolveSeatEntitlement(ORG).catch(e => e);
    expect(err).toBeInstanceOf(SeatEntitlementUnavailableError);
    expect(err.retryable).toBe(true);
  });

  it("null context → retryable error, NEVER Standard/1", async () => {
    mockCtx = { value: undefined };
    await expect(resolveSeatEntitlement(ORG)).rejects.toBeInstanceOf(SeatEntitlementUnavailableError);
  });
});
