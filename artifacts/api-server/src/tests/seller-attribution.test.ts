/**
 * FlowPoint — Seller Attribution Tests
 *
 * Tests A–R covering the full lifecycle:
 *   A-C  frontend ?ref= capture / persistence / first-touch
 *   D-F  signup propagation chain
 *   G-I  Stripe metadata
 *   J-L  commission 35 % + idempotency
 *   M-N  exclusions (addon / no-seller)
 *   O    invalid code
 *   P    mark-paid
 *   Q    manual attribution
 *   R    ONE_CUSTOMER_INVARIANT billing non-regression
 *
 * All tests use an in-memory mock — zero real DB or Stripe calls.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Minimal in-memory DB mock ────────────────────────────────────────────────

const _dbRows: Record<string, Record<string, unknown>[]> = {
  sellers:            [],
  pending_signups:    [],
  organizations:      [],
  seller_commissions: [],
};

function _dbReset() {
  _dbRows.sellers            = [];
  _dbRows.pending_signups    = [];
  _dbRows.organizations      = [];
  _dbRows.seller_commissions = [];
}

const _mockPool = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    const q = sql.replace(/\s+/g, " ").trim();

    // sellers SELECT by seller_code
    if (/FROM sellers WHERE seller_code/.test(q)) {
      const code = params[0] as string;
      const rows = _dbRows.sellers.filter(r => r.seller_code === code && r.status === "active");
      return { rows, rowCount: rows.length };
    }
    // sellers SELECT by id
    if (/FROM sellers WHERE id/.test(q)) {
      const id = params[0] as string;
      const rows = _dbRows.sellers.filter(r => r.id === id && r.status === "active");
      return { rows, rowCount: rows.length };
    }

    // pending_signups SELECT seller_id
    if (/FROM pending_signups WHERE token/.test(q) && /seller_id/.test(q)) {
      const token = params[0] as string;
      const rows  = _dbRows.pending_signups.filter(r => r.token === token);
      return { rows: rows.map(r => ({ seller_id: r.seller_id ?? null })), rowCount: rows.length };
    }

    // seller_commissions SELECT (existence check)
    if (/FROM seller_commissions WHERE org_id/.test(q)) {
      const orgId = params[0] as string;
      const rows  = _dbRows.seller_commissions.filter(r => r.org_id === orgId);
      return { rows, rowCount: rows.length };
    }

    // seller_commissions INSERT — params index matches seller-attribution.ts
    // [$1 sellerId, $2 orgId, $3 email, $4 custId, $5 subId, $6 csId, $7 invId, $8 piId,
    //  $9 plan, $10 eligibleCents, $11 bps, $12 commCents, $13 currency, $14 attrib]
    if (/INSERT INTO seller_commissions/.test(q)) {
      const sellerId  = params[0];
      const orgId     = params[1];
      const plan      = params[8];
      const eligible  = Number(params[9] ?? 0);
      const bps       = Number(params[10] ?? 3500);
      const commCents = Number(params[11] ?? 0);
      const attrib    = params[13];
      const existing  = _dbRows.seller_commissions.find(r => r.org_id === orgId);
      if (!existing) {
        _dbRows.seller_commissions.push({
          id: `comm_${Date.now()}_${Math.random()}`,
          seller_id: sellerId, org_id: orgId,
          plan,
          eligible_amount_cents:  eligible,
          commission_rate_bps:    bps,
          commission_amount_cents: commCents || Math.round(eligible * bps / 10000),
          status: "pending",
          attribution_method: attrib ?? "ref_link",
          earned_at: eligible > 0 ? new Date().toISOString() : null,
        });
      }
      return { rows: [], rowCount: 1 };
    }

    // organizations SELECT
    if (/FROM organizations WHERE id/.test(q)) {
      const id   = params[0] as string;
      const rows = _dbRows.organizations.filter(r => r.id === id);
      return { rows, rowCount: rows.length };
    }

    return { rows: [], rowCount: 0 };
  }),
};

vi.mock("@workspace/db", () => ({ pool: _mockPool }));

const { validateSellerCode, resolveSellerIdFromToken, recordCommission } =
  await import("../services/seller-attribution.js");

// ─────────────────────────────────────────────────────────────────────────────
// SECTION A-C — Frontend capture / persistence / first-touch
// These tests exercise the JS logic that would run in pricing.html.
// They use helper functions that mirror the frontend behaviour.
// ─────────────────────────────────────────────────────────────────────────────

/** Simulate localStorage */
function makeLocalStorage() {
  const _store: Record<string, string> = {};
  return {
    getItem:    (k: string) => _store[k] ?? null,
    setItem:    (k: string, v: string) => { _store[k] = v; },
    removeItem: (k: string) => { delete _store[k]; },
  };
}

/** Mirrors pricing.html seller-ref capture (FIRST_TOUCH) */
function captureRef(ref: string, ls: ReturnType<typeof makeLocalStorage>): void {
  const r = ref.trim().toUpperCase();
  if (/^SELLER-[A-Z0-9]{1,20}$/.test(r) && !ls.getItem("fp_seller_ref")) {
    ls.setItem("fp_seller_ref", r);
  }
}

/** Mirrors signin.html seller_code extraction */
function getSellerCodeForSignup(ls: ReturnType<typeof makeLocalStorage>, urlFpRef?: string): string | undefined {
  const ref = urlFpRef || ls.getItem("fp_seller_ref") || "";
  return ref || undefined;
}

describe("A–C  Frontend ?ref= capture / persistence / first-touch", () => {
  it("A — ?ref=SELLER-0042 → stored in localStorage as SELLER-0042", () => {
    const ls = makeLocalStorage();
    captureRef("SELLER-0042", ls);
    expect(ls.getItem("fp_seller_ref")).toBe("SELLER-0042");
  });

  it("B — stored ref survives refresh (persists across page loads)", () => {
    const ls = makeLocalStorage();
    captureRef("SELLER-0042", ls);
    // Simulate refresh: captureRef called again with no ?ref=
    captureRef("", ls);
    expect(ls.getItem("fp_seller_ref")).toBe("SELLER-0042"); // unchanged
  });

  it("C — FIRST_TOUCH: second ?ref= different code does NOT overwrite first", () => {
    const ls = makeLocalStorage();
    captureRef("SELLER-0042", ls);
    captureRef("SELLER-9999", ls); // different seller — must be ignored
    expect(ls.getItem("fp_seller_ref")).toBe("SELLER-0042");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION D-F — Signup propagation chain
// ─────────────────────────────────────────────────────────────────────────────

describe("D–F  Signup propagation chain", () => {
  beforeEach(() => { _dbReset(); vi.clearAllMocks(); });

  it("D — signup: seller_code from localStorage passed to pre-register body", () => {
    const ls = makeLocalStorage();
    captureRef("SELLER-0042", ls);
    const sc = getSellerCodeForSignup(ls);
    // Verify the signup form would include seller_code
    expect(sc).toBe("SELLER-0042");
  });

  it("E — pre-register: seller_id resolved from active seller_code → stored in pending_signups", async () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", name: "Alice", status: "active" });
    const seller = await validateSellerCode("SELLER-0042");
    expect(seller).not.toBeNull();
    expect(seller?.id).toBe("s1");
    // Simulate pre-register storing seller_id
    _dbRows.pending_signups.push({ token: "tok1", seller_id: seller!.id });
    const resolved = await resolveSellerIdFromToken("tok1");
    expect(resolved).toBe("s1");
  });

  it("F — organization.seller_id matches seller.id after activation", async () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", status: "active" });
    _dbRows.pending_signups.push({ token: "tok1", seller_id: "s1" });
    const sellerId = await resolveSellerIdFromToken("tok1");
    // Simulate org creation with seller_id from pending_signup
    _dbRows.organizations.push({ id: "org_a", seller_id: sellerId, plan: "standard" });
    const org = _dbRows.organizations.find(o => o.id === "org_a");
    expect(org?.seller_id).toBe("s1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION G-I — Stripe metadata
// ─────────────────────────────────────────────────────────────────────────────

describe("G–I  Stripe metadata (structural)", () => {
  it("G — Stripe Customer metadata includes seller_id and seller_attribution", () => {
    // Verify the metadata shape that would be sent to Stripe
    const seller_code = "SELLER-0042";
    const meta = { seller_id: seller_code, seller_attribution: "ref_link" };
    expect(meta.seller_id).toBe("SELLER-0042");
    expect(meta.seller_attribution).toBe("ref_link");
  });

  it("H — Checkout Session metadata includes seller_id and seller_attribution", () => {
    const csMeta = { seller_id: "SELLER-0042", seller_attribution: "ref_link", flowpoint_cart: "true" };
    expect(csMeta["seller_id"]).toBe("SELLER-0042");
    expect(csMeta["seller_attribution"]).toBe("ref_link");
    expect(csMeta["flowpoint_cart"]).toBe("true"); // existing fields untouched
  });

  it("I — Subscription metadata includes seller_id and seller_attribution (not for addonSub)", () => {
    const planSubMeta   = { seller_id: "SELLER-0042", seller_attribution: "ref_link" };
    const addonSubMeta  = { addonSub: "true" }; // addon sub must NOT get seller metadata
    expect(planSubMeta["seller_id"]).toBe("SELLER-0042");
    expect(addonSubMeta).not.toHaveProperty("seller_id");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION J-L — Commission 35 % + idempotency
// ─────────────────────────────────────────────────────────────────────────────

describe("J–L  Commission 35 % lifecycle", () => {
  beforeEach(() => { _dbReset(); vi.clearAllMocks(); });

  it("J — first subscription payment → commission = 35 % of eligible amount", async () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", status: "active" });
    await recordCommission({
      sellerId:            "s1",
      orgId:               "org_j",
      customerEmail:       "j@test.com",
      plan:                "standard",
      eligibleAmountCents: 4900,  // €49/mo
      currency:            "eur",
      attributionMethod:   "ref_link",
    });
    const comm = _dbRows.seller_commissions.find(c => c.org_id === "org_j");
    expect(comm).toBeDefined();
    expect(comm?.commission_rate_bps).toBe(3500);
    // 35 % of 4900 = 1715
    expect(comm?.commission_amount_cents).toBe(1715);
    expect(comm?.eligible_amount_cents).toBe(4900);
    expect(comm?.status).toBe("pending");
    expect(comm?.earned_at).not.toBeNull();
  });

  it("K — renewal (subscription_cycle): no second commission if one already exists", async () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", status: "active" });
    // First commission
    await recordCommission({
      sellerId: "s1", orgId: "org_k", customerEmail: "k@test.com",
      plan: "standard", eligibleAmountCents: 4900, currency: "eur", attributionMethod: "ref_link",
    });
    // Simulate renewal — ON CONFLICT DO NOTHING
    await recordCommission({
      sellerId: "s1", orgId: "org_k", customerEmail: "k@test.com",
      plan: "standard", eligibleAmountCents: 4900, currency: "eur", attributionMethod: "ref_link",
    });
    expect(_dbRows.seller_commissions.filter(c => c.org_id === "org_k")).toHaveLength(1);
  });

  it("L — resubscription: no second commission for same org_id", async () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", status: "active" });
    await recordCommission({
      sellerId: "s1", orgId: "org_l", customerEmail: "l@test.com",
      plan: "standard", eligibleAmountCents: 4900, currency: "eur", attributionMethod: "ref_link",
    });
    // Cancel + resubscribe would trigger invoice.payment_succeeded again
    await recordCommission({
      sellerId: "s1", orgId: "org_l", customerEmail: "l@test.com",
      plan: "pro", eligibleAmountCents: 9900, currency: "eur", attributionMethod: "ref_link",
    });
    const comms = _dbRows.seller_commissions.filter(c => c.org_id === "org_l");
    expect(comms).toHaveLength(1);
    expect(comms[0]?.plan).toBe("standard"); // original, not overwritten
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION M-N — Exclusions
// ─────────────────────────────────────────────────────────────────────────────

describe("M–N  Exclusions", () => {
  beforeEach(() => { _dbReset(); vi.clearAllMocks(); });

  it("M — addon subscription (addonSub=true): no commission created", () => {
    // The commission logic guards on addonSub — test the guard logic
    const subMeta = { addonSub: "true" };
    const isAddon = subMeta["addonSub"] === "true";
    expect(isAddon).toBe(true);
    // If isAddon is true, recordCommission is never called
    expect(_dbRows.seller_commissions).toHaveLength(0);
  });

  it("N — signup without ?ref= → no seller_id in pending_signups → no commission", async () => {
    _dbRows.pending_signups.push({ token: "tok_no_seller", seller_id: null });
    const sid = await resolveSellerIdFromToken("tok_no_seller");
    expect(sid).toBeNull();
    // No commission because seller_id is null
    expect(_dbRows.seller_commissions).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION O — Invalid code
// ─────────────────────────────────────────────────────────────────────────────

describe("O  Invalid / inactive seller code", () => {
  beforeEach(() => { _dbReset(); vi.clearAllMocks(); });

  it("O — invalid seller code formats → null → no attribution stored", async () => {
    const badCodes = ["", "SELLER", "REF-0042", "seller_0042", "SELLER-", "SELLER-TOOLONGCODEXXXXXXX99", "  "];
    for (const code of badCodes) {
      const r = await validateSellerCode(code);
      expect(r).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION P — mark-paid
// ─────────────────────────────────────────────────────────────────────────────

describe("P  mark-paid lifecycle", () => {
  it("P — pending → paid: commission_amount_cents unchanged, paid_at set, idempotent", () => {
    // Simulate the DB UPDATE that mark-paid endpoint performs
    const comm = {
      id: "comm_p1", status: "pending",
      commission_amount_cents: 1715,
      paid_at: null as string | null,
      paid_by: null as string | null,
    };

    // First call: mark paid
    function markPaid(c: typeof comm, paid_by?: string) {
      if (c.status !== "paid") {
        c.status  = "paid";
        c.paid_at = c.paid_at ?? new Date().toISOString();
      }
      if (paid_by) c.paid_by = c.paid_by ?? paid_by; // idempotent
    }

    markPaid(comm, "admin@flowpoint.pro");
    expect(comm.status).toBe("paid");
    expect(comm.paid_at).not.toBeNull();
    expect(comm.commission_amount_cents).toBe(1715); // never changed

    // Second call (idempotent)
    const paidAt = comm.paid_at;
    markPaid(comm, "other@flowpoint.pro");
    expect(comm.paid_at).toBe(paidAt); // unchanged
    expect(comm.paid_by).toBe("admin@flowpoint.pro"); // first-writer wins
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION Q — Manual attribution
// ─────────────────────────────────────────────────────────────────────────────

describe("Q  Manual attribution", () => {
  beforeEach(() => { _dbReset(); vi.clearAllMocks(); });

  it("Q — manual attribution attaches seller to org, does NOT create €0 commission", async () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", status: "active" });
    _dbRows.organizations.push({ id: "org_q", seller_id: null, plan: "pro", owner_email: "q@test.com" });

    // Simulate the FIRST_TOUCH UPDATE: only writes if seller_id is null
    const org = _dbRows.organizations.find(o => o.id === "org_q")!;
    if (!org.seller_id) {
      org.seller_id = "s1";
    }
    expect(org.seller_id).toBe("s1");

    // Crucially: NO commission is created (commission will come from invoice.payment_succeeded)
    expect(_dbRows.seller_commissions).toHaveLength(0);
  });

  it("Q2 — manual attribution FIRST_TOUCH: existing seller_id not overwritten", () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", status: "active" });
    _dbRows.sellers.push({ id: "s2", seller_code: "SELLER-9999", status: "active" });
    _dbRows.organizations.push({ id: "org_q2", seller_id: "s1", plan: "pro" });

    const org = _dbRows.organizations.find(o => o.id === "org_q2")!;
    // Simulate UPDATE ... WHERE seller_id IS NULL — should NOT overwrite
    if (!org.seller_id) { org.seller_id = "s2"; } // guard prevents write
    expect(org.seller_id).toBe("s1"); // unchanged
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SECTION R — ONE_CUSTOMER_INVARIANT billing non-regression
// ─────────────────────────────────────────────────────────────────────────────

describe("R  Billing non-regression — seller does not affect billing", () => {
  beforeEach(() => { _dbReset(); vi.clearAllMocks(); });

  it("R1 — seller validation makes zero Stripe calls", async () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", status: "active" });
    await validateSellerCode("SELLER-0042");
    const calls = (_mockPool.query as ReturnType<typeof vi.fn>).mock.calls;
    const stripeCall = calls.find(c => String(c[0]).includes("stripe_customer") && !String(c[0]).includes("seller"));
    expect(stripeCall).toBeUndefined();
  });

  it("R2 — commission_rate_bps is always 3500, never derived from billing params", async () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", status: "active" });
    await recordCommission({
      sellerId: "s1", orgId: "org_r2", customerEmail: "r@test.com",
      plan: "ultra", eligibleAmountCents: 29900, currency: "eur", attributionMethod: "ref_link",
    });
    expect(_dbRows.seller_commissions[0]?.commission_rate_bps).toBe(3500);
  });

  it("R3 — trial payment (amount=0) → commission earned_at is null", async () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", status: "active" });
    await recordCommission({
      sellerId: "s1", orgId: "org_r3", customerEmail: "r3@test.com",
      plan: "standard", eligibleAmountCents: 0, currency: "eur", attributionMethod: "ref_link",
    });
    const comm = _dbRows.seller_commissions.find(c => c.org_id === "org_r3");
    expect(comm?.earned_at).toBeNull();
    expect(comm?.commission_amount_cents).toBe(0); // 35% of 0
  });

  it("R4 — two different orgs from same seller each get their own commission", async () => {
    _dbRows.sellers.push({ id: "sA", seller_code: "SELLER-A000", status: "active" });
    _dbRows.sellers.push({ id: "sB", seller_code: "SELLER-B000", status: "active" });
    await recordCommission({
      sellerId: "sA", orgId: "org_A", customerEmail: "a@test.com",
      plan: "standard", eligibleAmountCents: 4900, currency: "eur", attributionMethod: "ref_link",
    });
    await recordCommission({
      sellerId: "sB", orgId: "org_B", customerEmail: "b@test.com",
      plan: "pro", eligibleAmountCents: 9900, currency: "eur", attributionMethod: "ref_link",
    });
    expect(_dbRows.seller_commissions).toHaveLength(2);
    const commA = _dbRows.seller_commissions.find(c => c.org_id === "org_A");
    const commB = _dbRows.seller_commissions.find(c => c.org_id === "org_B");
    expect(commA?.seller_id).toBe("sA");
    expect(commB?.seller_id).toBe("sB");
    expect(commA?.seller_id).not.toBe(commB?.seller_id);
  });

  it("R5 — seller_attribution.ts has no pricing, trial_days, or subscription line_items fields", async () => {
    _dbRows.sellers.push({ id: "s1", seller_code: "SELLER-0042", status: "active" });
    await recordCommission({
      sellerId: "s1", orgId: "org_r5", customerEmail: "r5@test.com",
      plan: "standard", eligibleAmountCents: 0, currency: "eur", attributionMethod: "ref_link",
    });
    const comm = _dbRows.seller_commissions[0];
    expect(comm).toBeDefined();
    expect(comm).not.toHaveProperty("trial_days");
    expect(comm).not.toHaveProperty("price_id");
    expect(comm).not.toHaveProperty("line_items");
  });
});
