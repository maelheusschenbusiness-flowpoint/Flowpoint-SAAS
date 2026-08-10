/**
 * monitor-addon-quota.test.ts — quantity add-on quota expansion tests
 *
 * Proves that every recurring quantity add-on (QTY_ADDON_GRANTS) expands its
 * resource limit by exactly perPack × packCount across the three billing
 * surfaces:
 *   1. getQuotaLimits   (used by /billing/usage-details and GET /addons)
 *   2. getUsageSummary  (used by /billing/usage — dashboard usage cards)
 *   3. checkQuota       (quota enforcement at resource creation)
 *
 * Regressions covered:
 *  - getUsageSummary previously multiplied the COMBINED monitor pack count
 *    by 50, so one +10 pack displayed +50 monitors while enforcement only
 *    granted +10.
 *  - audit/report/export packs were flat (+200 once regardless of quantity)
 *    or entirely missing from checkQuota.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { PLAN_LIMITS } from "../lib/plans.js";

// ─── Mock billing context (getUsageSummary source of truth) ──────────────────
type MockCtx = {
  plan: string;
  addons: Record<string, boolean | number>;
  subscriptionStatus: string;
  trialEndsAt: string | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  trialConsumedAt: string | null;
};
let mockCtx: MockCtx;

vi.mock("./billing-context.js", () => ({
  loadBillingContext: vi.fn().mockImplementation(async () => mockCtx),
}));

// ─── Mock org settings (checkQuota plan source) ───────────────────────────────
vi.mock("./org-settings.js", () => ({
  loadOrgSettings: vi.fn().mockImplementation(async () => ({ plan: mockCtx.plan })),
}));
vi.mock("./org-data.js", () => ({
  loadOrgData: vi.fn().mockImplementation(async () => null),
}));
vi.mock("./store.js", () => ({
  store: { broadcast: vi.fn(), logActivity: vi.fn().mockResolvedValue(undefined) },
}));

// ─── Mock DB: safeCount queries return 0 rows used; org_addons rows are set per test ──
// Mirrors production shape: ONE row per (org_id, addon_key) with a quantity column.
let mockOrgAddonRows: Array<{ addon_key: string; quantity?: number | null }> = [];
const mockQuery = vi.fn().mockImplementation(async (sql: string) => {
  if (typeof sql === "string" && sql.includes("org_addons")) {
    return { rows: mockOrgAddonRows };
  }
  return { rows: [{ count: "0", n: 0 }] };
});
vi.mock("@workspace/db", () => ({
  pool: {
    connect: vi.fn().mockImplementation(async () => ({ query: mockQuery, release: vi.fn() })),
    query: mockQuery,
  },
  db: {},
}));

beforeEach(() => {
  mockOrgAddonRows = [];
  mockCtx = {
    plan: "pro",
    addons: {},
    subscriptionStatus: "active",
    trialEndsAt: null,
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    trialConsumedAt: null,
  };
});

const PRO_BASE = PLAN_LIMITS["pro"]!.monitors; // 50

// ─── 1. getQuotaLimits (pure) ─────────────────────────────────────────────────
describe("getQuotaLimits — monitor pack expansion", () => {
  it("+10 pack grants exactly +10", async () => {
    const { getQuotaLimits } = await import("./addons-service.js");
    expect(getQuotaLimits("pro", { monitorsPack10: true }).monitors).toBe(PRO_BASE + 10);
  });

  it("+50 pack grants exactly +50", async () => {
    const { getQuotaLimits } = await import("./addons-service.js");
    expect(getQuotaLimits("pro", { monitorsPack50: true }).monitors).toBe(PRO_BASE + 50);
  });

  it("mixed packs stack per-pack (+10 and +50 → +60)", async () => {
    const { getQuotaLimits } = await import("./addons-service.js");
    expect(getQuotaLimits("pro", { monitorsPack10: true, monitorsPack50: true }).monitors).toBe(PRO_BASE + 60);
  });

  it("numeric quantities multiply per pack size (2×10 + 3×50 → +170)", async () => {
    const { getQuotaLimits } = await import("./addons-service.js");
    expect(getQuotaLimits("pro", { monitorsPack10: 2, monitorsPack50: 3 }).monitors).toBe(PRO_BASE + 170);
  });
});

// ─── 1b. getQuotaLimits — ALL quantity add-ons multiply per pack ─────────────
describe("getQuotaLimits — audits/reports/exports/seats packs multiply per pack", () => {
  const PRO = PLAN_LIMITS["pro"]!;

  it("auditsPack200 ×2 grants +400 audits", async () => {
    const { getQuotaLimits } = await import("./addons-service.js");
    expect(getQuotaLimits("pro", { auditsPack200: 2 }).audits).toBe(PRO.audits + 400);
  });

  it("auditsPack1000 ×3 grants +3000 audits", async () => {
    const { getQuotaLimits } = await import("./addons-service.js");
    expect(getQuotaLimits("pro", { auditsPack1000: 3 }).audits).toBe(PRO.audits + 3000);
  });

  it("mixed audit packs stack (2×200 + 1×1000 → +1400)", async () => {
    const { getQuotaLimits } = await import("./addons-service.js");
    expect(getQuotaLimits("pro", { auditsPack200: 2, auditsPack1000: 1 }).audits).toBe(PRO.audits + 1400);
  });

  it("pdfPack200 ×2 grants +400 reports", async () => {
    const { getQuotaLimits } = await import("./addons-service.js");
    expect(getQuotaLimits("pro", { pdfPack200: 2 }).reports).toBe(PRO.reports + 400);
  });

  it("exportsPack1000 ×2 grants +2000 exports", async () => {
    const { getQuotaLimits } = await import("./addons-service.js");
    expect(getQuotaLimits("pro", { exportsPack1000: 2 }).exports).toBe(PRO.exports + 2000);
  });

  it("extraSeats ×3 grants +15 seats", async () => {
    const { getQuotaLimits } = await import("./addons-service.js");
    expect(getQuotaLimits("pro", { extraSeats: 3 }).seats).toBe(PRO.teamMembers + 15);
  });

  it("boolean true counts as 1 pack for every quantity add-on", async () => {
    const { getQuotaLimits } = await import("./addons-service.js");
    const q = getQuotaLimits("pro", {
      auditsPack200: true, pdfPack200: true, exportsPack1000: true, extraSeats: true, monitorsPack10: true,
    });
    expect(q.audits).toBe(PRO.audits + 200);
    expect(q.reports).toBe(PRO.reports + 200);
    expect(q.exports).toBe(PRO.exports + 1000);
    expect(q.seats).toBe(PRO.teamMembers + 5);
    expect(q.monitors).toBe(PRO.monitors + 10);
  });
});

// ─── 2. getUsageSummary (dashboard usage cards) ───────────────────────────────
describe("getUsageSummary — monitor limit matches per-pack entitlement", () => {
  it("+10 pack only → limit is base+10 (NOT base+50)", async () => {
    mockCtx.addons = { monitorsPack10: 1 };
    const { getUsageSummary } = await import("./billing-service.js");
    const s = await getUsageSummary("org-t1");
    expect(s.usage.monitors.limit).toBe(PRO_BASE + 10);
  });

  it("+50 pack only → limit is base+50", async () => {
    mockCtx.addons = { monitorsPack50: 1 };
    const { getUsageSummary } = await import("./billing-service.js");
    const s = await getUsageSummary("org-t2");
    expect(s.usage.monitors.limit).toBe(PRO_BASE + 50);
  });

  it("mixed packs → limit is base+60 and pct uses the expanded limit", async () => {
    mockCtx.addons = { monitorsPack10: 1, monitorsPack50: 1 };
    const { getUsageSummary } = await import("./billing-service.js");
    const s = await getUsageSummary("org-t3");
    expect(s.usage.monitors.limit).toBe(PRO_BASE + 60);
    // 0 used → 0% against expanded limit
    expect(s.usage.monitors.pct).toBe(0);
  });

  it("no packs → base plan limit", async () => {
    const { getUsageSummary } = await import("./billing-service.js");
    const s = await getUsageSummary("org-t4");
    expect(s.usage.monitors.limit).toBe(PRO_BASE);
  });
});

// ─── 3. checkQuota (enforcement) ──────────────────────────────────────────────
// Production shape: one org_addons row per addon key, quantity column holds pack count.
describe("checkQuota — enforcement limit agrees with usage display", () => {
  it("+10 pack row grants +10 at enforcement", async () => {
    mockOrgAddonRows = [{ addon_key: "monitorsPack10", quantity: 1 }];
    const { checkQuota } = await import("./billing-service.js");
    const r = await checkQuota("monitors", "org-e1");
    expect(r.limit).toBe(PRO_BASE + 10);
  });

  it("+50 pack row grants +50 at enforcement", async () => {
    mockOrgAddonRows = [{ addon_key: "monitorsPack50", quantity: 1 }];
    const { checkQuota } = await import("./billing-service.js");
    const r = await checkQuota("monitors", "org-e2");
    expect(r.limit).toBe(PRO_BASE + 50);
  });

  it("mixed pack rows stack to +60 — same as getUsageSummary", async () => {
    mockOrgAddonRows = [
      { addon_key: "monitorsPack10", quantity: 1 },
      { addon_key: "monitorsPack50", quantity: 1 },
    ];
    mockCtx.addons = { monitorsPack10: 1, monitorsPack50: 1 };
    const { checkQuota, getUsageSummary } = await import("./billing-service.js");
    const r = await checkQuota("monitors", "org-e3");
    const s = await getUsageSummary("org-e3");
    expect(r.limit).toBe(PRO_BASE + 60);
    expect(s.usage.monitors.limit).toBe(r.limit); // surfaces must agree
  });

  it("quantity >1 on a single row multiplies per pack (3× +10 → +30)", async () => {
    mockOrgAddonRows = [{ addon_key: "monitorsPack10", quantity: 3 }];
    const { checkQuota } = await import("./billing-service.js");
    const r = await checkQuota("monitors", "org-e4");
    expect(r.limit).toBe(PRO_BASE + 30);
  });

  it("mixed multi-pack rows (2× +10, 2× +50) → +120 and surfaces agree", async () => {
    mockOrgAddonRows = [
      { addon_key: "monitorsPack10", quantity: 2 },
      { addon_key: "monitorsPack50", quantity: 2 },
    ];
    mockCtx.addons = { monitorsPack10: 2, monitorsPack50: 2 };
    const { checkQuota, getUsageSummary } = await import("./billing-service.js");
    const r = await checkQuota("monitors", "org-e5");
    const s = await getUsageSummary("org-e5");
    expect(r.limit).toBe(PRO_BASE + 120);
    expect(s.usage.monitors.limit).toBe(r.limit);
  });

  it("NULL quantity (legacy row) defaults to 1 pack", async () => {
    mockOrgAddonRows = [{ addon_key: "monitorsPack50", quantity: null }];
    const { checkQuota } = await import("./billing-service.js");
    const r = await checkQuota("monitors", "org-e6");
    expect(r.limit).toBe(PRO_BASE + 50);
  });

  it("auditsPack200 ×2 expands audit enforcement (+400)", async () => {
    mockOrgAddonRows = [{ addon_key: "auditsPack200", quantity: 2 }];
    const { checkQuota } = await import("./billing-service.js");
    const r = await checkQuota("audits", "org-e7");
    expect(r.limit).toBe(PLAN_LIMITS["pro"]!.audits + 400);
  });

  it("auditsPack1000 ×1 expands audit enforcement (+1000)", async () => {
    mockOrgAddonRows = [{ addon_key: "auditsPack1000", quantity: 1 }];
    const { checkQuota } = await import("./billing-service.js");
    const r = await checkQuota("audits", "org-e8");
    expect(r.limit).toBe(PLAN_LIMITS["pro"]!.audits + 1000);
  });

  it("pdfPack200 ×3 expands report enforcement (+600)", async () => {
    mockOrgAddonRows = [{ addon_key: "pdfPack200", quantity: 3 }];
    const { checkQuota } = await import("./billing-service.js");
    const r = await checkQuota("reports", "org-e9");
    expect(r.limit).toBe(PLAN_LIMITS["pro"]!.reports + 600);
  });

  it("exportsPack1000 ×2 expands export enforcement (+2000)", async () => {
    mockOrgAddonRows = [{ addon_key: "exportsPack1000", quantity: 2 }];
    const { checkQuota } = await import("./billing-service.js");
    const r = await checkQuota("exports", "org-e10");
    expect(r.limit).toBe(PLAN_LIMITS["pro"]!.exports + 2000);
  });

  it("extraSeats ×2 expands seat enforcement (+10)", async () => {
    mockOrgAddonRows = [{ addon_key: "extraSeats", quantity: 2 }];
    const { checkQuota } = await import("./billing-service.js");
    const r = await checkQuota("seats", "org-e11");
    expect(r.limit).toBe(PLAN_LIMITS["pro"]!.teamMembers + 10);
  });
});

// ─── 4. getUsageSummary — non-monitor packs expand display limits ────────────
describe("getUsageSummary — audit/report/export/seat packs expand display limits", () => {
  const PRO = PLAN_LIMITS["pro"]!;

  it("auditsPack200 ×2 → audits limit +400", async () => {
    mockCtx.addons = { auditsPack200: 2 };
    const { getUsageSummary } = await import("./billing-service.js");
    const s = await getUsageSummary("org-u1");
    expect(s.usage.audits.limit).toBe(PRO.audits + 400);
  });

  it("pdfPack200 ×2 → reports limit +400; exportsPack1000 ×1 → exports limit +1000", async () => {
    mockCtx.addons = { pdfPack200: 2, exportsPack1000: 1 };
    const { getUsageSummary } = await import("./billing-service.js");
    const s = await getUsageSummary("org-u2");
    expect(s.usage.reports.limit).toBe(PRO.reports + 400);
    expect(s.usage.exports.limit).toBe(PRO.exports + 1000);
  });

  it("extraSeats ×2 → seats limit +10", async () => {
    mockCtx.addons = { extraSeats: 2 };
    const { getUsageSummary } = await import("./billing-service.js");
    const s = await getUsageSummary("org-u3");
    expect(s.usage.seats.limit).toBe(PRO.teamMembers + 10);
  });
});
