/**
 * addon-activate-quantity.test.ts — quantity flow integration tests
 *
 * Proves that a UI/API request `POST /addons/:key/activate { quantity: N }`
 * carries N end-to-end:
 *   1. syncAddonWithStripe receives quantity N (Stripe subscription item qty).
 *   2. activateAddon receives quantity N (persisted to org_addons.quantity).
 *   3. quantity is clamped server-side (1..20) and defaults to 1 when absent.
 *   4. flag add-ons ignore quantity (always 1 pack semantics).
 *
 * Strategy: mount only the addons router with a minimal Express app; all
 * heavy deps (Stripe sync, DB persistence, org data) are mocked so no real
 * DB/Stripe connection is needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── Recorded calls ───────────────────────────────────────────────────────────
let stripeSyncCalls: Array<{ key: string; action: string; quantity?: number }>;
let activateCalls: Array<{ key: string; orgId: string; quantity?: number }>;
// Configurable sync result — lets tests simulate every unsynced Stripe outcome.
let mockSyncResult: { synced: boolean; reason: string };

// ─── Mocks (must precede dynamic import of the router) ────────────────────────
vi.mock("../services/addon-stripe-sync.js", () => ({
  syncAddonWithStripe: vi.fn(async (_orgId: string, key: string, action: string, quantity?: number) => {
    stripeSyncCalls.push({ key, action, quantity });
    return mockSyncResult;
  }),
}));

vi.mock("../services/addons-service.js", () => ({
  activateAddon: vi.fn(async (key: string, orgId: string, quantity?: number) => {
    activateCalls.push({ key, orgId, quantity });
    return true;
  }),
  deactivateAddon: vi.fn(async () => true),
  getOrgAddons: vi.fn(async () => ({})),
  addExtraAICredits: vi.fn(async () => true),
  getQuotaLimits: vi.fn(() => ({ audits: 0, monitors: 0, reports: 0, exports: 0, seats: 0, retention: 30 })),
  ADDON_DEFINITIONS: {
    monitorsPack10:  { name: "+10 Monitors" },
    monitorsPack50:  { name: "+50 Monitors" },
    auditsPack200:   { name: "+200 Audits" },
    extraSeats:      { name: "+5 Seats" },
    whiteLabel:      { name: "White Label" },
  },
}));

vi.mock("../services/org-data.js", () => ({
  loadOrgData: vi.fn(async () => ({ plan: "standard", addons: {} })),
}));

vi.mock("../services/store.js", () => ({
  store: {
    logActivity: vi.fn(async () => {}),
    broadcast: vi.fn(),
  },
}));

vi.mock("../middlewares/requireRole.js", () => ({
  ownerOnly: (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock("@workspace/db", () => ({
  db: {},
  pool: { connect: vi.fn(), query: vi.fn(async () => ({ rows: [] })) },
  orgAddonsTable: {},
}));

// ─── App builder ──────────────────────────────────────────────────────────────
async function buildApp() {
  const { default: addonsRouter } = await import("./addons.js");
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { orgId: string }).orgId = "org-qty-test";
    next();
  });
  app.use(addonsRouter);
  return app;
}

beforeEach(() => {
  stripeSyncCalls = [];
  activateCalls = [];
  mockSyncResult = { synced: true, reason: "item_added" };
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /addons/:key/activate — quantity carried end-to-end", () => {
  it("quantity 3 reaches BOTH Stripe sync and DB activation", async () => {
    const app = await buildApp();
    const res = await request(app).post("/addons/monitorsPack10/activate").send({ quantity: 3 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(stripeSyncCalls).toEqual([{ key: "monitorsPack10", action: "activate", quantity: 3 }]);
    expect(activateCalls).toEqual([{ key: "monitorsPack10", orgId: "org-qty-test", quantity: 3 }]);
  });

  it("quantity 5 for auditsPack200 flows through identically", async () => {
    const app = await buildApp();
    const res = await request(app).post("/addons/auditsPack200/activate").send({ quantity: 5 });
    expect(res.status).toBe(200);
    expect(stripeSyncCalls[0]?.quantity).toBe(5);
    expect(activateCalls[0]?.quantity).toBe(5);
  });

  it("missing quantity defaults to 1", async () => {
    const app = await buildApp();
    const res = await request(app).post("/addons/monitorsPack50/activate").send({});
    expect(res.status).toBe(200);
    expect(stripeSyncCalls[0]?.quantity).toBe(1);
    expect(activateCalls[0]?.quantity).toBe(1);
  });

  it("no body at all defaults to 1 (legacy dashboard callers)", async () => {
    const app = await buildApp();
    const res = await request(app).post("/addons/extraSeats/activate");
    expect(res.status).toBe(200);
    expect(activateCalls[0]?.quantity).toBe(1);
  });

  it("quantity is clamped to 20 max", async () => {
    const app = await buildApp();
    await request(app).post("/addons/monitorsPack10/activate").send({ quantity: 999 });
    expect(stripeSyncCalls[0]?.quantity).toBe(20);
    expect(activateCalls[0]?.quantity).toBe(20);
  });

  it("quantity is clamped to 1 min (zero/negative/garbage)", async () => {
    const app = await buildApp();
    await request(app).post("/addons/monitorsPack10/activate").send({ quantity: -4 });
    expect(activateCalls[0]?.quantity).toBe(1);
    activateCalls = [];
    await request(app).post("/addons/monitorsPack10/activate").send({ quantity: "garbage" });
    expect(activateCalls[0]?.quantity).toBe(1);
  });

  it("fractional quantity is floored (2.9 → 2)", async () => {
    const app = await buildApp();
    await request(app).post("/addons/monitorsPack10/activate").send({ quantity: 2.9 });
    expect(activateCalls[0]?.quantity).toBe(2);
  });

  it("unknown addon key is rejected before any Stripe/DB call", async () => {
    const app = await buildApp();
    const res = await request(app).post("/addons/notARealAddon/activate").send({ quantity: 3 });
    expect(res.status).toBe(400);
    expect(stripeSyncCalls).toHaveLength(0);
    expect(activateCalls).toHaveLength(0);
  });
});

// ─── Billing fail-closed: any unsynced Stripe result must NOT grant the addon ─
describe("POST /addons/:key/activate — unsynced Stripe results are rejected (no free entitlement)", () => {
  it("no_stripe_key → 503, no DB grant", async () => {
    mockSyncResult = { synced: false, reason: "no_stripe_key" };
    const app = await buildApp();
    const res = await request(app).post("/addons/monitorsPack10/activate").send({ quantity: 2 });
    expect(res.status).toBe(503);
    expect(activateCalls).toHaveLength(0);
  });

  it("no_live_subscription → 402, no DB grant", async () => {
    mockSyncResult = { synced: false, reason: "no_live_subscription" };
    const app = await buildApp();
    const res = await request(app).post("/addons/monitorsPack10/activate").send({ quantity: 2 });
    expect(res.status).toBe(402);
    expect(activateCalls).toHaveLength(0);
  });

  it("no_subscription_id → 402, no DB grant", async () => {
    mockSyncResult = { synced: false, reason: "no_subscription_id" };
    const app = await buildApp();
    const res = await request(app).post("/addons/extraSeats/activate").send({ quantity: 3 });
    expect(res.status).toBe(402);
    expect(activateCalls).toHaveLength(0);
  });

  it("stripe_error → 502, no DB grant", async () => {
    mockSyncResult = { synced: false, reason: "stripe_error" };
    const app = await buildApp();
    const res = await request(app).post("/addons/monitorsPack50/activate").send({ quantity: 1 });
    expect(res.status).toBe(502);
    expect(activateCalls).toHaveLength(0);
  });

  it("no_price_id → 422, no DB grant", async () => {
    mockSyncResult = { synced: false, reason: "no_price_id" };
    const app = await buildApp();
    const res = await request(app).post("/addons/monitorsPack10/activate").send({});
    expect(res.status).toBe(422);
    expect(activateCalls).toHaveLength(0);
  });

  it("one_time_addon → 422, no DB grant (one-time packs use the dedicated checkout)", async () => {
    mockSyncResult = { synced: false, reason: "one_time_addon" };
    const app = await buildApp();
    const res = await request(app).post("/addons/monitorsPack10/activate").send({});
    expect(res.status).toBe(422);
    expect(activateCalls).toHaveLength(0);
  });

  it("unknown unsynced reason → 402 fail-closed, no DB grant", async () => {
    mockSyncResult = { synced: false, reason: "some_future_reason" };
    const app = await buildApp();
    const res = await request(app).post("/addons/monitorsPack10/activate").send({});
    expect(res.status).toBe(402);
    expect(activateCalls).toHaveLength(0);
  });

  it("included_in_plan (synced:false) → grant allowed, nothing to bill", async () => {
    mockSyncResult = { synced: false, reason: "included_in_plan" };
    const app = await buildApp();
    const res = await request(app).post("/addons/monitorsPack10/activate").send({ quantity: 2 });
    expect(res.status).toBe(200);
    expect(activateCalls).toHaveLength(1);
  });

  it("already_on_subscription (synced:true) → grant allowed", async () => {
    mockSyncResult = { synced: true, reason: "already_on_subscription" };
    const app = await buildApp();
    const res = await request(app).post("/addons/monitorsPack10/activate").send({ quantity: 2 });
    expect(res.status).toBe(200);
    expect(activateCalls).toHaveLength(1);
  });

  it("quantity_updated (synced:true) → grant allowed", async () => {
    mockSyncResult = { synced: true, reason: "quantity_updated" };
    const app = await buildApp();
    const res = await request(app).post("/addons/monitorsPack10/activate").send({ quantity: 4 });
    expect(res.status).toBe(200);
    expect(activateCalls[0]?.quantity).toBe(4);
  });
});
