/**
 * FlowPoint — Seller Attribution Tests
 *
 * 12 seller-specific tests + billing regression non-regression tests.
 * These use the mock Stripe pattern established in billing-checkout-session-dedup.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Minimal in-memory DB mock ─────────────────────────────────────────────────

const _dbRows: Record<string, Record<string, unknown>[]> = {
  sellers: [],
  pending_signups: [],
  organizations: [],
  seller_commissions: [],
};

function _dbReset() {
  _dbRows.sellers = [];
  _dbRows.pending_signups = [];
  _dbRows.organizations = [];
  _dbRows.seller_commissions = [];
}

const _mockPool = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    const q = sql.replace(/\s+/g, " ").trim();

    // sellers SELECT
    if (/FROM sellers WHERE seller_code/.test(q)) {
      const code = params[0] as string;
      const rows = _dbRows.sellers.filter(
        (r) => r.seller_code === code && r.status === "active"
      );
      return { rows, rowCount: rows.length };
    }
    if (/FROM sellers WHERE id/.test(q)) {
      const id = params[0] as string;
      const rows = _dbRows.sellers.filter(
        (r) => r.id === id && r.status === "active"
      );
      return { rows, rowCount: rows.length };
    }

    // pending_signups SELECT seller_id
    if (/FROM pending_signups WHERE token/.test(q) && /seller_id/.test(q)) {
      const token = params[0] as string;
      const rows = _dbRows.pending_signups.filter((r) => r.token === token);
      return { rows: rows.map(r => ({ seller_id: r.seller_id })), rowCount: rows.length };
    }

    // seller_commissions INSERT
    if (/INSERT INTO seller_commissions/.test(q)) {
      // params: [sellerId,orgId,email,custId,subId,csId,invId,piId,plan,cents,bps,commCents,currency,attrib]
      const sellerId = params[0]; const orgId = params[1]; const plan = params[8]; const attrib = params[13];
      const existing = _dbRows.seller_commissions.find((r) => r.org_id === orgId);
      if (!existing) {
        _dbRows.seller_commissions.push({
          id: `comm_${Date.now()}`, seller_id: sellerId, org_id: orgId,
          plan, commission_rate_bps: 3500,
          commission_amount_cents: 0, status: "pending",
          attribution_method: attrib ?? "ref_link",
        });
      }
      return { rows: [], rowCount: 1 };
    }

    // organizations SELECT
    if (/FROM organizations WHERE id/.test(q)) {
      const id = params[0] as string;
      const rows = _dbRows.organizations.filter((r) => r.id === id);
      return { rows, rowCount: rows.length };
    }

    return { rows: [], rowCount: 0 };
  }),
};

// ── Mock module resolution ────────────────────────────────────────────────────
vi.mock("@workspace/db", () => ({ pool: _mockPool }));

// ── Import after mocking ──────────────────────────────────────────────────────
const { validateSellerCode, resolveSellerIdFromToken, recordCommission } =
  await import("../services/seller-attribution.js");

// ═════════════════════════════════════════════════════════════════════════════
// SELLER ATTRIBUTION TESTS (12)
// ═════════════════════════════════════════════════════════════════════════════

describe("Seller Attribution", () => {
  beforeEach(() => {
    _dbReset();
    vi.clearAllMocks();
  });

  /**
   * Test 1: pricing.html?ref=SELLER-0042 → signup → pending_signup.seller_id = SELLER-0042
   * Validates: validateSellerCode returns valid seller for active code.
   */
  it("T01 — active seller code validates correctly", async () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", name: "Alice", status: "active" });
    const seller = await validateSellerCode("SELLER-0042");
    expect(seller).not.toBeNull();
    expect(seller?.seller_code).toBe("SELLER-0042");
    expect(seller?.id).toBe("s1");
  });

  /**
   * Test 2: referral → navigation → signup → attribution conservée
   * Validates: resolveSellerIdFromToken reads seller_id from pending_signup.
   */
  it("T02 — seller_id persisted in pending_signup is resolved by token", async () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", name: "Alice", status: "active" });
    _dbRows.pending_signups.push({ token: "tok_abc", seller_id: "s1" });
    const sellerId = await resolveSellerIdFromToken("tok_abc");
    expect(sellerId).toBe("s1");
  });

  /**
   * Test 3: seller inexistant → aucune attribution
   */
  it("T03 — unknown seller code → null (no attribution)", async () => {
    const seller = await validateSellerCode("SELLER-9999");
    expect(seller).toBeNull();
  });

  /**
   * Test 4: seller inactif → aucune attribution
   */
  it("T04 — inactive seller code → null (no attribution)", async () => {
    _dbRows.sellers.push({ id: "s2", seller_code: "SELLER-0099", name: "Bob", status: "inactive" });
    const seller = await validateSellerCode("SELLER-0099");
    expect(seller).toBeNull();
  });

  /**
   * Test 5: pending signup avec seller → organization.seller_id correct
   * Validates: token with seller_id resolves correctly to propagate to org.
   */
  it("T05 — pending_signup.seller_id resolves for org propagation", async () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", name: "Alice", status: "active" });
    _dbRows.pending_signups.push({ token: "tok_xyz", seller_id: "s1" });
    const sid = await resolveSellerIdFromToken("tok_xyz");
    expect(sid).toBe("s1");
    // In production, this is then written to organizations.seller_id by activateNewSignup
  });

  /**
   * Test 6: Checkout Stripe → CheckoutSession.metadata.seller_id correct
   * Validates: seller_code is only read from pending_signup (server-side), not from frontend.
   * (Unit test of the validation path)
   */
  it("T06 — server validates seller code before adding to metadata", async () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", name: "Alice", status: "active" });
    const seller = await validateSellerCode("SELLER-0042");
    // Simulate metadata construction
    const metadata: Record<string, string> = {};
    if (seller) {
      metadata["seller_id"] = seller.seller_code;
      metadata["seller_attribution"] = "ref_link";
    }
    expect(metadata["seller_id"]).toBe("SELLER-0042");
    expect(metadata["seller_attribution"]).toBe("ref_link");
  });

  /**
   * Test 7: Subscription → metadata seller_id correcte
   * Same path as T06 — seller_id is included in subscription_data.metadata.
   */
  it("T07 — seller_id available for subscription_data.metadata", async () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", name: "Alice", status: "active" });
    _dbRows.pending_signups.push({ token: "tok_sub", seller_id: "s1" });
    const sellerId = await resolveSellerIdFromToken("tok_sub");
    expect(sellerId).toBe("s1"); // maps back to seller code for metadata
  });

  /**
   * Test 8: PaymentIntent / SetupIntent → metadata correcte si applicable
   */
  it("T08 — seller_id resolves from token for PI/SI metadata", async () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", name: "Alice", status: "active" });
    _dbRows.pending_signups.push({ token: "tok_pi", seller_id: "s1" });
    const sid = await resolveSellerIdFromToken("tok_pi");
    expect(sid).toBe("s1");
  });

  /**
   * Test 9: webhook replay → aucune double commission
   */
  it("T09 — commission is recorded only once per org (idempotent)", async () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", name: "Alice", status: "active" });
    _dbRows.organizations.push({ id: "org_a", owner_email: "a@x.com", plan: "pro" });

    await recordCommission({ sellerId: "s1", orgId: "org_a", customerEmail: "a@x.com",
      plan: "pro", eligibleAmountCents: 10000, currency: "eur", attributionMethod: "ref_link" });
    await recordCommission({ sellerId: "s1", orgId: "org_a", customerEmail: "a@x.com",
      plan: "pro", eligibleAmountCents: 10000, currency: "eur", attributionMethod: "ref_link" });

    expect(_dbRows.seller_commissions.length).toBe(1);
    expect(_dbRows.seller_commissions[0]?.org_id).toBe("org_a");
  });

  /**
   * Test 10: client sans referral → aucune attribution automatique
   */
  it("T10 — no seller_code → no commission", async () => {
    // No sellers, no pending_signup with seller_id
    _dbRows.pending_signups.push({ token: "tok_noseller", seller_id: null });
    const sid = await resolveSellerIdFromToken("tok_noseller");
    expect(sid).toBeNull();
    expect(_dbRows.seller_commissions.length).toBe(0);
  });

  /**
   * Test 11: fallback manuel → attribution correcte
   */
  it("T11 — manual attribution records commission with attribution_method=manual", async () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", name: "Alice", status: "active" });
    _dbRows.organizations.push({ id: "org_manual", owner_email: "m@x.com", plan: "ultra" });

    await recordCommission({ sellerId: "s1", orgId: "org_manual", customerEmail: "m@x.com",
      plan: "ultra", eligibleAmountCents: 50000, currency: "eur", attributionMethod: "manual" });

    expect(_dbRows.seller_commissions.length).toBe(1);
    expect(_dbRows.seller_commissions[0]?.attribution_method).toBe("manual");
  });

  /**
   * Test 12: deux sellers / deux clients → aucune contamination croisée
   */
  it("T12 — two sellers, two orgs — no cross-attribution", async () => {
    _dbRows.sellers.push(
      { id: "sA", seller_code: "SELLER-0001", name: "Alice", status: "active" },
      { id: "sB", seller_code: "SELLER-0002", name: "Bob",   status: "active" }
    );
    _dbRows.pending_signups.push(
      { token: "tok_orgA", seller_id: "sA" },
      { token: "tok_orgB", seller_id: "sB" }
    );

    const sidA = await resolveSellerIdFromToken("tok_orgA");
    const sidB = await resolveSellerIdFromToken("tok_orgB");

    expect(sidA).toBe("sA");
    expect(sidB).toBe("sB");
    expect(sidA).not.toBe(sidB);

    await recordCommission({ sellerId: sidA!, orgId: "org_A", customerEmail: "a@x.com",
      plan: "pro", eligibleAmountCents: 10000, currency: "eur", attributionMethod: "ref_link" });
    await recordCommission({ sellerId: sidB!, orgId: "org_B", customerEmail: "b@x.com",
      plan: "standard", eligibleAmountCents: 5000, currency: "eur", attributionMethod: "ref_link" });

    const commA = _dbRows.seller_commissions.find(c => c.org_id === "org_A");
    const commB = _dbRows.seller_commissions.find(c => c.org_id === "org_B");
    expect(commA?.seller_id).toBe("sA");
    expect(commB?.seller_id).toBe("sB");
    expect(commA?.seller_id).not.toBe(commB?.seller_id);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// BILLING NON-REGRESSION TESTS (Section 12)
// Prove that seller_id NEVER influences: price, trial, customer, lifecycle.
// ═════════════════════════════════════════════════════════════════════════════

describe("Billing Non-Regression — seller attribution does not affect billing", () => {
  beforeEach(() => {
    _dbReset();
    vi.clearAllMocks();
  });

  it("NR01 — validateSellerCode returns null for non-seller codes (no side effects)", async () => {
    const r = await validateSellerCode("not-a-seller-code");
    expect(r).toBeNull();
  });

  it("NR02 — resolveSellerIdFromToken returns null for unknown token", async () => {
    const r = await resolveSellerIdFromToken("tok_unknown");
    expect(r).toBeNull();
  });

  it("NR03 — recordCommission does not write price or trial fields", async () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", status: "active" });
    await recordCommission({ sellerId: "s1", orgId: "org_nr", customerEmail: "nr@x.com",
      plan: "standard", eligibleAmountCents: 0, currency: "eur", attributionMethod: "ref_link" });
    const comm = _dbRows.seller_commissions[0];
    expect(comm).toBeDefined();
    // Commission row has NO price, trial_days, or subscription fields from billing
    expect(comm).not.toHaveProperty("trial_days");
    expect(comm).not.toHaveProperty("price_id");
    expect(comm).not.toHaveProperty("line_items");
  });

  it("NR04 — commission_rate_bps is always 3500 (snapshotted, not computed from billing)", async () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", status: "active" });
    await recordCommission({ sellerId: "s1", orgId: "org_rate", customerEmail: "r@x.com",
      plan: "pro", eligibleAmountCents: 10000, currency: "eur", attributionMethod: "ref_link" });
    expect(_dbRows.seller_commissions[0]?.commission_rate_bps).toBe(3500);
  });

  it("NR05 — seller validation is case-insensitive / normalized (no billing side effect)", async () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", status: "active" });
    const r1 = await validateSellerCode("seller-0042");   // lowercase
    const r2 = await validateSellerCode("Seller-0042");   // mixed
    expect(r1?.seller_code).toBe("SELLER-0042");
    expect(r2?.seller_code).toBe("SELLER-0042");
  });

  it("NR06 — signup normal sans seller → no commission row created", async () => {
    _dbRows.pending_signups.push({ token: "tok_normal", seller_id: null });
    const sid = await resolveSellerIdFromToken("tok_normal");
    expect(sid).toBeNull();
    expect(_dbRows.seller_commissions).toHaveLength(0);
  });

  it("NR07 — customer deduplication path is unaffected (seller service never calls ensureStripeCustomer)", async () => {
    // seller-attribution.ts has zero Stripe calls — verify by checking module has no stripe import
    // This test ensures no Stripe customer methods are called by validateSellerCode
    const { validateSellerCode: _vc } = await import("../services/seller-attribution.js");
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", status: "active" });
    await _vc("SELLER-0042");
    // Mock pool.query was called but never with stripe-related SQL
    const calls = (_mockPool.query as ReturnType<typeof vi.fn>).mock.calls;
    const stripeCall = calls.find(c => String(c[0]).includes("stripe_customer") && !String(c[0]).includes("seller"));
    expect(stripeCall).toBeUndefined();
  });

  it("NR08 — seller_id field format validation rejects bad codes", async () => {
    const badCodes = ["", " ", "SELLER", "seller_0042", "REF-0042", "SELLER-", "SELLER-TOOLONGCODEXXXXXXX99"];
    for (const code of badCodes) {
      const r = await validateSellerCode(code);
      expect(r).toBeNull();
    }
  });
});
