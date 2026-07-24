/**
 * ensure-stripe-customer.test.ts — v4 unit + concurrency tests
 *
 * Tests three concerns:
 *  A) Flow logic  — Step 1-5 happy/unhappy paths with mocked Stripe + DB
 *  B) Concurrency — 20 concurrent in-process calls produce exactly 1 Stripe customer
 *  C) Error paths — resource_missing, deleted customer, DB write failure
 *
 * The DB-level lock (pg_advisory_xact_lock) cannot be exercised in a unit test
 * because it requires a real PostgreSQL connection.  Cross-process serialisation
 * is validated by the integration test suite (billing-portal.test.cjs / .ts)
 * which spins up a real DB and fires concurrent HTTP requests.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";

// ── Mock @workspace/db before importing the module under test ─────────────────
//
// We replace `pool.connect()` with a factory that returns a fake PoolClient.
// The fake client tracks query calls and implements a trivial in-process mutex
// so that pg_advisory_xact_lock serialises concurrent calls inside one process.

const _lockHolder = new Map<number, { resolve: () => void }>();
const _lockQueue  = new Map<number, Array<() => void>>();

function _releaseLock(key: number) {
  const queue = _lockQueue.get(key);
  if (queue && queue.length > 0) {
    const next = queue.shift()!;
    next();
  } else {
    _lockHolder.delete(key);
  }
}

function makeFakeClient(queryLog: string[]) {
  let _lockKey: number | null = null;
  let _inTx = false;

  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queryLog.push(sql.replace(/\s+/g, " ").trim());

      if (/^BEGIN/i.test(sql)) {
        _inTx = true;
        return { rows: [], rowCount: 0 };
      }

      if (/^COMMIT/i.test(sql)) {
        _inTx = false;
        if (_lockKey !== null) { _releaseLock(_lockKey); _lockKey = null; }
        return { rows: [], rowCount: 0 };
      }

      if (/^ROLLBACK/i.test(sql)) {
        _inTx = false;
        if (_lockKey !== null) { _releaseLock(_lockKey); _lockKey = null; }
        return { rows: [], rowCount: 0 };
      }

      if (/pg_advisory_xact_lock/i.test(sql)) {
        const key = (params as number[])[0];
        _lockKey = key;
        if (_lockHolder.has(key)) {
          // Block until the current holder commits/rolls back
          await new Promise<void>((resolve) => {
            const q = _lockQueue.get(key) ?? [];
            q.push(resolve);
            _lockQueue.set(key, q);
          });
        }
        _lockHolder.set(key, {
          resolve: () => { /* managed by _releaseLock */ },
        });
        return { rows: [], rowCount: 0 };
      }

      if (/INSERT INTO org_settings/i.test(sql)) {
        return { rows: [], rowCount: 0 };
      }

      if (/UPDATE org_settings/i.test(sql)) {
        return { rows: [], rowCount: 1 };
      }

      if (/SELECT \* FROM org_settings/i.test(sql)) {
        const orgId = (params as string[])[0];
        return {
          rows: [{
            org_id: orgId, plan: "pro", email: null,
            first_name: null, last_name: null, org_name: null,
            website: null, subscription_status: "active",
            stripe_customer_id: _dbState.get(orgId) ?? null,
            stripe_subscription_id: null, trial_ends_at: null,
            addons: {}, usage: {}, created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            address: null, city: null, postal_code: null, country: null,
            region: null, phone: null, latitude: null, longitude: null,
            service_area: null, location_configured: false,
            location_source: null, timezone: null, language: null,
            currency: null, date_format: null, time_format: null,
          }],
          rowCount: 1,
        };
      }

      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return client;
}

// Shared DB state (simulates org_settings table)
const _dbState = new Map<string, string | null>();

// Mock the pool
vi.mock("@workspace/db", () => {
  const queryLog: string[] = [];
  return {
    pool: {
      connect: vi.fn(() => {
        const client = makeFakeClient(queryLog);
        // Intercept UPDATE to persist to _dbState
        const originalQuery = client.query;
        client.query = vi.fn(async (sql: string, params?: unknown[]) => {
          const result = await originalQuery(sql, params);
          // The UPDATE SQL is multi-line so `.` won't cross newlines.
          // Check the two keywords separately instead of using dotAll.
          if (
            /UPDATE org_settings/i.test(sql) &&
            /stripe_customer_id/i.test(sql) &&
            params
          ) {
            const customerId = (params as string[])[0];
            const orgId = (params as string[])[1];
            _dbState.set(orgId, customerId);
          }
          return result;
        }) as typeof client.query;
        return Promise.resolve(client);
      }),
    },
  };
});

// Mock store
vi.mock("./store.js", () => ({
  store: { me: { stripeCustomerId: null } },
}));

// ── Stripe mock ───────────────────────────────────────────────────────────────

let _mockRetrieve: MockInstance;
let _mockSearch: MockInstance;
let _mockCreate: MockInstance;
let _createCallCount = 0;
let _createdCustomerId = "cus_TEST_NEW";

// Build a single Stripe-shaped stub object whose methods are always read
// through getters — so reassigning _mock* in a test is reflected immediately.
// This stub is injected via _setStripeForTest() instead of vi.mock("stripe")
// because vitest's dynamic import() mocking is unreliable under high concurrency.
const _mockStripeClient = {
  get customers() {
    return {
      get retrieve() { return _mockRetrieve; },
      get search()   { return _mockSearch; },
      get create()   { return _mockCreate; },
    };
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetMocks() {
  _dbState.clear();
  _lockHolder.clear();
  _lockQueue.clear();
  _createCallCount = 0;

  _mockRetrieve = vi.fn().mockRejectedValue(
    Object.assign(new Error("resource_missing"), { code: "resource_missing" }),
  );
  _mockSearch = vi.fn().mockResolvedValue({ data: [] });
  _mockCreate = vi.fn().mockImplementation(async () => {
    _createCallCount++;
    return { id: _createdCustomerId, deleted: false };
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ensureStripeCustomer — v4", async () => {
  // Lazy-import so @workspace/db mock is in place before module code runs
  const { ensureStripeCustomer, _setStripeForTest } = await import("./ensure-stripe-customer.js");

  beforeEach(() => {
    resetMocks();
    _setStripeForTest(_mockStripeClient);
  });
  afterEach(() => {
    _setStripeForTest(undefined);
    vi.clearAllMocks();
  });

  // ── A: Flow logic ──────────────────────────────────────────────────────────

  describe("A: flow logic", () => {
    it("A1 — reuses existing valid customer (no creation)", async () => {
      const orgId = "a1@test.com";
      const existingId = "cus_EXISTING";

      _dbState.set(orgId, existingId);
      _mockRetrieve = vi.fn().mockResolvedValue({ id: existingId, deleted: false });

      const result = await ensureStripeCustomer(orgId, null, "sk_test_key");

      expect(result).toBe(existingId);
      expect(_mockCreate).not.toHaveBeenCalled();
    });

    it("A2 — creates customer when DB has null stripe_customer_id", async () => {
      const orgId = "a2@test.com";

      const result = await ensureStripeCustomer(orgId, null, "sk_test_key");

      expect(result).toBe(_createdCustomerId);
      expect(_mockCreate).toHaveBeenCalledTimes(1);
      expect(_dbState.get(orgId)).toBe(_createdCustomerId);
    });

    it("A3 — recreates customer when Stripe returns resource_missing", async () => {
      const orgId = "a3@test.com";
      const staleId = "cus_STALE";
      _dbState.set(orgId, staleId);

      // retrieve throws resource_missing
      _mockRetrieve = vi.fn().mockRejectedValue(
        Object.assign(new Error("resource_missing"), { code: "resource_missing" }),
      );

      const result = await ensureStripeCustomer(orgId, null, "sk_test_key");

      expect(result).toBe(_createdCustomerId);
      expect(_mockCreate).toHaveBeenCalledTimes(1);
      // idempotency key uses last 12 chars of stale ID
      expect(_mockCreate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ idempotencyKey: `fp-cust-${orgId}-rpl-${staleId.slice(-12)}` }),
      );
    });

    it("A4 — recreates customer when Stripe returns deleted:true", async () => {
      const orgId = "a4@test.com";
      const deletedId = "cus_DELETED";
      _dbState.set(orgId, deletedId);

      _mockRetrieve = vi.fn().mockResolvedValue({ id: deletedId, deleted: true });

      const result = await ensureStripeCustomer(orgId, null, "sk_test_key");

      expect(result).toBe(_createdCustomerId);
      expect(_mockCreate).toHaveBeenCalledTimes(1);
    });

    it("A5 — recovers orphan via metadata search when DB is null", async () => {
      const orgId = "a5@test.com";
      const orphanId = "cus_ORPHAN";

      _mockSearch = vi.fn().mockResolvedValue({
        data: [{ id: orphanId, deleted: false }],
      });

      const result = await ensureStripeCustomer(orgId, null, "sk_test_key");

      expect(result).toBe(orphanId);
      expect(_mockCreate).not.toHaveBeenCalled();
      expect(_dbState.get(orgId)).toBe(orphanId);
    });

    it("A6 — uses idempotency key 'fp-cust-<orgId>' on first creation", async () => {
      const orgId = "a6@test.com";

      await ensureStripeCustomer(orgId, null, "sk_test_key");

      expect(_mockCreate).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ idempotencyKey: `fp-cust-${orgId}` }),
      );
    });

    it("A7 — hint email/name used when org_settings row has no email", async () => {
      const orgId = "a7@test.com";

      await ensureStripeCustomer(
        orgId,
        { stripeCustomerId: null, email: "hint@example.com", firstName: "Jane", orgName: "ACME" },
        "sk_test_key",
      );

      expect(_mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ email: "hint@example.com", name: "Jane ACME" }),
        expect.any(Object),
      );
    });

    it("A8 — propagates non-resource_missing Stripe errors", async () => {
      const orgId = "a8@test.com";
      const staleId = "cus_ERR";
      _dbState.set(orgId, staleId);

      _mockRetrieve = vi.fn().mockRejectedValue(
        Object.assign(new Error("rate_limit"), { code: "rate_limit" }),
      );

      await expect(ensureStripeCustomer(orgId, null, "sk_test_key")).rejects.toMatchObject({
        code: "rate_limit",
      });
      expect(_mockCreate).not.toHaveBeenCalled();
    });

    it("A9 — throws when no Stripe key is configured", async () => {
      const orgId = "a9@test.com";
      const savedLive = process.env["STRIPE_LIVE_API_KEY"];
      const savedTest = process.env["STRIPE_SECRET_KEY"];
      delete process.env["STRIPE_LIVE_API_KEY"];
      delete process.env["STRIPE_SECRET_KEY"];

      try {
        await expect(ensureStripeCustomer(orgId, null, undefined)).rejects.toThrow(
          "No Stripe key configured",
        );
      } finally {
        if (savedLive) process.env["STRIPE_LIVE_API_KEY"] = savedLive;
        if (savedTest) process.env["STRIPE_SECRET_KEY"] = savedTest;
      }
    });

    it("A10 — search errors do not propagate (index lag tolerance)", async () => {
      const orgId = "a10@test.com";

      _mockSearch = vi.fn().mockRejectedValue(new Error("Stripe search unavailable"));

      const result = await ensureStripeCustomer(orgId, null, "sk_test_key");

      // Should fall through to create
      expect(result).toBe(_createdCustomerId);
      expect(_mockCreate).toHaveBeenCalledTimes(1);
    });
  });

  // ── B: Concurrency ─────────────────────────────────────────────────────────

  describe("B: concurrency", () => {
    it("B1 — 20 concurrent in-process calls → exactly 1 Stripe customer created", async () => {
      const orgId = "concurrent@test.com";

      // Each call is ~10ms (simulate Stripe latency)
      _mockCreate = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 10));
        _createCallCount++;
        return { id: _createdCustomerId, deleted: false };
      });

      const calls = Array.from({ length: 20 }, () =>
        ensureStripeCustomer(orgId, null, "sk_test_key"),
      );

      const results = await Promise.all(calls);

      expect(_mockCreate).toHaveBeenCalledTimes(1);
      const unique = new Set(results);
      expect(unique.size).toBe(1);
      expect([...unique][0]).toBe(_createdCustomerId);
    });

    it("B2 — 20 concurrent calls for DIFFERENT orgs each create 1 customer (total: 20)", async () => {
      _mockCreate = vi.fn().mockImplementation(async () => {
        _createCallCount++;
        const id = `cus_ORG_${_createCallCount}`;
        return { id, deleted: false };
      });

      const calls = Array.from({ length: 20 }, (_, i) =>
        ensureStripeCustomer(`org${i}@test.com`, null, "sk_test_key"),
      );

      const results = await Promise.all(calls);

      expect(_mockCreate).toHaveBeenCalledTimes(20);
      const unique = new Set(results);
      expect(unique.size).toBe(20);
    });

    it("B3 — second call immediately after first reuses existing customer (no creation)", async () => {
      const orgId = "sequential@test.com";

      const first = await ensureStripeCustomer(orgId, null, "sk_test_key");
      expect(first).toBe(_createdCustomerId);
      expect(_mockCreate).toHaveBeenCalledTimes(1);

      // second call: _inflight is gone, but DB now has the customer
      _mockRetrieve = vi.fn().mockResolvedValue({ id: _createdCustomerId, deleted: false });

      const second = await ensureStripeCustomer(orgId, null, "sk_test_key");
      expect(second).toBe(_createdCustomerId);
      expect(_mockCreate).toHaveBeenCalledTimes(1);
    });
  });

  // ── C: Error / edge cases ──────────────────────────────────────────────────

  describe("C: error paths", () => {
    it("C1 — missing Stripe key throws before touching DB", async () => {
      const orgId = "c1@test.com";
      await expect(ensureStripeCustomer(orgId, null, "")).rejects.toThrow(
        "No Stripe key configured",
      );
    });

    it("C2 — empty-string stripe_customer_id treated as null → creates new customer", async () => {
      const orgId = "c2@test.com";
      // Pre-seed with empty string (some legacy rows have this)
      _dbState.set(orgId, "");

      const result = await ensureStripeCustomer(orgId, null, "sk_test_key");

      expect(result).toBe(_createdCustomerId);
      expect(_mockCreate).toHaveBeenCalledTimes(1);
    });

    it("C3 — _persistStrict errors are NOT swallowed by orphan search catch", async () => {
      const orgId = "c3@test.com";
      const orphanId = "cus_ORPHAN_C3";

      _mockSearch = vi.fn().mockResolvedValue({
        data: [{ id: orphanId, deleted: false }],
      });

      // Simulate UPDATE failure — make client.query throw on UPDATE
      const { pool } = await import("@workspace/db");
      const originalConnect = (pool.connect as MockInstance).getMockImplementation();
      (pool.connect as MockInstance).mockImplementationOnce(async () => {
        const client = await (originalConnect ? originalConnect() : Promise.resolve(makeFakeClient([])));
        const originalQuery = client.query;
        let updateCallCount = 0;
        client.query = vi.fn(async (sql: string, params?: unknown[]) => {
          // Multi-line SQL: check UPDATE and stripe_customer_id separately
          if (
            /UPDATE org_settings/i.test(sql) &&
            /stripe_customer_id/i.test(sql)
          ) {
            updateCallCount++;
            if (updateCallCount <= 2) throw new Error("DB write failed");
          }
          return originalQuery(sql, params);
        }) as typeof client.query;
        return client;
      });

      await expect(ensureStripeCustomer(orgId, null, "sk_test_key")).rejects.toThrow();
    });
  });
});
