import { describe, it, expect, beforeEach, vi } from "vitest";

const query = vi.fn();
vi.mock("@workspace/db", () => ({ pool: { query } }));

const {
  recordPaymentReceived, recordRefund, recordCommissionGenerated,
  getSellerMetrics,
} = await import("../services/seller-financial-ledger.js");

describe("seller financial ledger", () => {
  beforeEach(() => query.mockReset());

  it("uses a durable source key so an economic fact is inserted once", async () => {
    query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: "l1" }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const opts = {
      sellerId: "seller-1", orgId: "org-1", sourceKey: "payment:in_1",
      amountCents: 2900, currency: "eur", stripeInvoiceId: "in_1",
    };
    expect(await recordPaymentReceived(opts)).toBe(true);
    expect(await recordPaymentReceived(opts)).toBe(false);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain("ON CONFLICT (source_key) DO NOTHING");
  });

  it("keeps refund and commission facts as separate append-only events", async () => {
    query.mockResolvedValue({ rowCount: 1, rows: [{ id: "l1" }] });
    await recordRefund({ sellerId: "seller-1", orgId: "org-1", sourceKey: "refund:re_1", amountCents: 2900 });
    await recordCommissionGenerated({
      sellerId: "seller-1", orgId: "org-1", sourceKey: "commission-generated:org-1", amountCents: 1015,
    });
    expect(query.mock.calls[0][1][2]).toBe("refund");
    expect(query.mock.calls[1][1][2]).toBe("commission_generated");
  });

  it("queries canonical metrics from ledger events", async () => {
    query.mockResolvedValue({ rows: [{ gross_revenue_cents: 5800, refunded_revenue_cents: 2900, net_revenue_cents: 2900 }] });
    await expect(getSellerMetrics("seller-1")).resolves.toMatchObject({ net_revenue_cents: 2900 });
    expect(query.mock.calls[0][0]).toContain("FROM seller_financial_ledger");
  });
});