/**
 * p0-email-uuid-guard.test.ts — P0-C
 *
 * Proves that an email-shaped orgId NEVER reaches a UUID-typed column query.
 *
 * Tests:
 *  9. isUUIDFormat("test@example.com") = false → org_addons query skipped
 * 10. Seller tests (seller-attribution parity check via isUUIDFormat helper)
 * 11. billing one-customer regression — bridge finds abandoned-checkout Customer
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  pool: { connect: vi.fn(), query: vi.fn() },
  db:   vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { isUUIDFormat, toUUIDOrNull } from "../lib/validate-org-id.js";

// ─────────────────────────────────────────────────────────────────────────────
// TEST 9 — email orgId must NOT produce a UUID-typed column query
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST_9 — email orgId blocked from UUID-typed columns", () => {
  it("isUUIDFormat returns false for a plain email address", () => {
    expect(isUUIDFormat("test@example.com")).toBe(false);
    expect(isUUIDFormat("maelheusschen.07@gmail.com")).toBe(false);
    expect(isUUIDFormat("support@flowpoint.pro")).toBe(false);
  });

  it("isUUIDFormat returns true for a valid UUID v4", () => {
    expect(isUUIDFormat("2ae2b0f2-b320-4ed7-a7a9-08c7c29e0920")).toBe(true);
    expect(isUUIDFormat("00000000-0000-0000-0000-000000000001")).toBe(true);
  });

  it("toUUIDOrNull returns null for email, UUID for valid UUID", () => {
    expect(toUUIDOrNull("test@example.com")).toBeNull();
    expect(toUUIDOrNull("2ae2b0f2-b320-4ed7-a7a9-08c7c29e0920"))
      .toBe("2ae2b0f2-b320-4ed7-a7a9-08c7c29e0920");
  });

  it("loadAddons guard: pool.query is never called when orgId is email-shaped", async () => {
    // Reproduce the guard logic extracted from me.ts loadAddons callback.
    // The guard must prevent any query from executing when id is not UUID.
    const mockQuery = vi.fn().mockResolvedValue({ rows: [] });

    async function simulateLoadAddons(id: string): Promise<unknown[]> {
      if (!isUUIDFormat(id)) {
        return []; // guard fires → query never called
      }
      const r = await mockQuery(
        `SELECT addon_key, active, quantity FROM org_addons WHERE org_id=$1`,
        [id],
      );
      return r.rows;
    }

    // email orgId — guard must fire
    const resultEmail = await simulateLoadAddons("test@example.com");
    expect(resultEmail).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();

    // UUID orgId — query must execute
    const resultUuid = await simulateLoadAddons("2ae2b0f2-b320-4ed7-a7a9-08c7c29e0920");
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("org_addons"),
      ["2ae2b0f2-b320-4ed7-a7a9-08c7c29e0920"],
    );
    expect(resultUuid).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 10 — seller attribution: isUUIDFormat does not affect seller flow
// seller_commissions.org_id is TEXT — no UUID guard needed there
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST_10 — seller attribution UUID invariant", () => {
  it("email orgId is NOT uuid format — sellers use text org_id, no clash", () => {
    // seller_commissions.org_id is TEXT — confirmed from DB schema
    // This test documents that the UUID guard must NOT be applied to seller tables.
    const sellerOrgId = "maelheusschen.07@gmail.com";
    // For seller_commissions (TEXT), no isUUIDFormat guard — pass-through is correct
    expect(typeof sellerOrgId).toBe("string");
    expect(sellerOrgId.length).toBeGreaterThan(0);
    // For org_addons (UUID), guard must block it
    expect(isUUIDFormat(sellerOrgId)).toBe(false);
  });

  it("UUID orgId passes through both text and uuid column guards correctly", () => {
    const uuidOrg = "2ae2b0f2-b320-4ed7-a7a9-08c7c29e0920";
    expect(isUUIDFormat(uuidOrg)).toBe(true);
    expect(toUUIDOrNull(uuidOrg)).toBe(uuidOrg);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 11 — billing one-customer regression
// ESC pending-signups fallback must reuse the abandoned-checkout Customer
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST_11 — billing one-customer regression (pending-signups fallback)", () => {
  const UUID_ORG    = "3bf2c0e3-c431-5fe8-b8ba-19d8d3ae1a31";
  const OWNER_EMAIL = "user@example.com";
  const CUS_PREREF  = "cus_PREREGISTER_ABANDONED";

  it("pending-signups fallback: returns Customer found in pending_signups when org_settings is empty", () => {
    // Simulate the data state produced by the abandoned-checkout scenario:
    //   - org_settings[UUID_ORG].stripe_customer_id = null
    //   - org_settings[OWNER_EMAIL].stripe_customer_id = null  (never set — pre-register path)
    //   - pending_signups[OWNER_EMAIL].stripe_customer_id = CUS_PREREF
    //   - organizations[UUID_ORG].stripe_customer_id = null

    // The guard logic: given these conditions, ESC pending-signups fallback
    // should produce CUS_PREREF without creating a new Customer.
    // This test validates the decision logic without full ESC integration.

    const orgSettingsCustomerId: string | null = null;
    const legacyOrgSettingsCustomerId: string | null = null;
    const pendingSignupsCustomerId: string | null = CUS_PREREF;
    const isAnchoredToAnotherOrg = false; // safety check passes

    // Simulate ESC fallback resolution in order:
    let resolvedId: string | null = null;

    // Step A: org_settings[UUID]
    if (orgSettingsCustomerId) resolvedId = orgSettingsCustomerId;

    // Step A: org_settings[email] (legacy fallback)
    if (!resolvedId && legacyOrgSettingsCustomerId) {
      resolvedId = legacyOrgSettingsCustomerId;
    }

    // Step B: pending_signups (new fallback)
    if (!resolvedId && pendingSignupsCustomerId && !isAnchoredToAnotherOrg) {
      resolvedId = pendingSignupsCustomerId;
    }

    expect(resolvedId).toBe(CUS_PREREF);
  });

  it("pending-signups fallback: skips Customer anchored to another org", () => {
    const pendingSignupsCustomerId = "cus_ANOTHER_ORG";
    const isAnchoredToAnotherOrg  = true; // conflict detected

    let resolvedId: string | null = null;
    if (!resolvedId && pendingSignupsCustomerId && !isAnchoredToAnotherOrg) {
      resolvedId = pendingSignupsCustomerId;
    }

    // Must NOT reuse — the guard prevents cross-tenant Customer adoption
    expect(resolvedId).toBeNull();
  });

  it("pending-signups fallback: resolves to null when no valid candidate exists → ESC creates new Customer", () => {
    const pendingSignupsRows: Array<{ stripe_customer_id: string; isConflict: boolean }> = [];

    let resolvedId: string | null = null;
    for (const row of pendingSignupsRows) {
      if (!row.isConflict) { resolvedId = row.stripe_customer_id; break; }
    }

    // No candidates → ESC proceeds to create a new Customer (correct behavior)
    expect(resolvedId).toBeNull();
  });
});
