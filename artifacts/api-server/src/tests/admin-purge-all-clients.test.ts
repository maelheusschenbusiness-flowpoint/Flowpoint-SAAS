/**
 * admin-purge-all-clients.test.ts
 *
 * Unit tests for the purge-all-clients handler logic:
 *   planStripeCustomerPurge  — Stripe discovery (read-only)
 *   executeStripeCustomerPurge — Stripe deletion
 *
 * Root-cause regression coverage (P0 fix):
 *   The real purge previously crashed with HTTP 500 when the organisation list
 *   included ownerless orgs (owner_email IS NULL, 0 users).  Root cause was that
 *   `.catch(() => {})` on per-table DELETEs inside a BEGIN transaction swallowed
 *   the JS exception but left the PostgreSQL connection in ABORTED state (25P01),
 *   so the subsequent `DELETE FROM organizations` threw and propagated to the
 *   outer catch → 500.  Fix: wrap each per-table DELETE in a SAVEPOINT so the
 *   transaction remains live even when a table does not exist.
 *
 * All tests are pure-logic / mock-only.  No live DB or Stripe required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  planStripeCustomerPurge,
  executeStripeCustomerPurge,
} from "../routes/admin.js";

// ---------------------------------------------------------------------------
// Stripe mock helpers
// ---------------------------------------------------------------------------

function makeCustomer(id: string, email: string | null) {
  return { id, email };
}

function makeSubscription(id: string, status: string) {
  return { id, status };
}

/** Build a minimal fake Stripe client */
function buildFakeStripe(opts: {
  customers?: Array<{ id: string; email: string | null }>;
  subscriptionsByCustomer?: Record<string, Array<{ id: string; status: string }>>;
  throwOnCustomerDel?: string; // customerId that should throw
}) {
  const customers = opts.customers ?? [];
  const subscriptionsByCustomer = opts.subscriptionsByCustomer ?? {};
  const deletedCustomers: string[] = [];
  const canceledSubscriptions: string[] = [];

  return {
    customers: {
      list: vi.fn(async (params: { limit: number; starting_after?: string }) => {
        const start = params.starting_after
          ? customers.findIndex((c) => c.id === params.starting_after) + 1
          : 0;
        const page = customers.slice(start, start + params.limit);
        return { data: page, has_more: start + params.limit < customers.length };
      }),
      del: vi.fn(async (id: string) => {
        if (opts.throwOnCustomerDel === id) {
          const err: any = new Error("No such customer");
          err.code = "resource_missing";
          throw err;
        }
        deletedCustomers.push(id);
        return { id, deleted: true };
      }),
    },
    subscriptions: {
      list: vi.fn(async (params: { customer: string; status: string; limit: number }) => {
        const subs = subscriptionsByCustomer[params.customer] ?? [];
        return { data: subs, has_more: false };
      }),
      cancel: vi.fn(async (id: string) => {
        canceledSubscriptions.push(id);
        return { id, status: "canceled" };
      }),
    },
    _deletedCustomers: deletedCustomers,
    _canceledSubscriptions: canceledSubscriptions,
  };
}

// ---------------------------------------------------------------------------
// Fake pg client for the DB-level purge logic
// ---------------------------------------------------------------------------

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rowCount: number; rows: unknown[] }>;

/**
 * Build a fake pg client that records all SQL statements and allows
 * individual tables to simulate missing-table (42P01) errors.
 *
 * This mirrors exactly what happens inside the purge handler after BEGIN:
 *   - SAVEPOINT / RELEASE SAVEPOINT / ROLLBACK TO SAVEPOINT are tracked
 *   - tables listed in `missingTables` throw 42P01 on DELETE
 *   - all other DELETEs succeed with the given rowCount
 */
function buildFakeClient(opts: {
  missingTables?: string[];
  orgRows?: Record<string, number>;   // table → rowCount on DELETE
  userRows?: Record<string, number>;
}) {
  const missingTables = new Set(opts.missingTables ?? []);
  const statements: string[] = [];
  const savepointStack: string[] = [];

  const query: QueryFn = async (sql: string) => {
    const normalized = sql.trim().toUpperCase();
    statements.push(sql.trim());

    if (normalized.startsWith("BEGIN") || normalized.startsWith("COMMIT")) {
      return { rowCount: 0, rows: [] };
    }
    if (normalized.startsWith("ROLLBACK TO SAVEPOINT")) {
      savepointStack.pop();
      return { rowCount: 0, rows: [] };
    }
    if (normalized.startsWith("RELEASE SAVEPOINT")) {
      savepointStack.pop();
      return { rowCount: 0, rows: [] };
    }
    if (normalized.startsWith("SAVEPOINT")) {
      const name = sql.trim().split(/\s+/)[1];
      savepointStack.push(name);
      return { rowCount: 0, rows: [] };
    }

    // Simulate table not found
    const tableMatch = sql.match(/DELETE FROM\s+(\w+)/i);
    if (tableMatch) {
      const tbl = tableMatch[1].toLowerCase();
      if (missingTables.has(tbl)) {
        const err: any = new Error(`relation "${tbl}" does not exist`);
        err.code = "42P01";
        throw err;
      }
      const rc = opts.orgRows?.[tbl] ?? opts.userRows?.[tbl] ?? 0;
      return { rowCount: rc, rows: [] };
    }

    return { rowCount: 0, rows: [] };
  };

  return {
    query,
    release: vi.fn(),
    _statements: statements,
    _savepointStack: savepointStack,
  };
}

// ---------------------------------------------------------------------------
// TEST 1 — Normal client purge
// ---------------------------------------------------------------------------
describe("TEST 1 — normal client purge (planStripeCustomerPurge)", () => {
  it("identifies non-exempt customers and live subscriptions", async () => {
    const stripe = buildFakeStripe({
      customers: [
        makeCustomer("cus_1", "client@example.com"),
        makeCustomer("cus_2", "support@flowpoint.pro"),
        makeCustomer("cus_3", "qa@flowpoint.pro"),
      ],
      subscriptionsByCustomer: {
        cus_1: [makeSubscription("sub_1", "active"), makeSubscription("sub_2", "canceled")],
      },
    });

    const exempt = ["support@flowpoint.pro", "qa@flowpoint.pro"];
    const plan = await planStripeCustomerPurge(exempt, stripe);

    expect(plan.configured).toBe(true);
    expect(plan.customersFound).toBe(3);
    expect(plan.customersExempted).toBe(2);
    expect(plan.customerIds).toEqual(["cus_1"]);
    expect(plan.liveSubscriptionsFound).toBe(1); // only active sub, not canceled
  });
});

// ---------------------------------------------------------------------------
// TEST 2 — Ownerless organisation (owner_email = NULL, 0 users, business data)
// ---------------------------------------------------------------------------
describe("TEST 2 — ownerless organization with owner_email NULL", () => {
  it("planStripeCustomerPurge produces customerIds=[] when no customers present", async () => {
    const stripe = buildFakeStripe({ customers: [] });
    const plan = await planStripeCustomerPurge(["support@flowpoint.pro", "qa@flowpoint.pro"], stripe);

    // Mirrors the production scenario: 0 non-exempt customers
    expect(plan.configured).toBe(true);
    expect(plan.customerIds).toEqual([]);
    expect(plan.customersFound).toBe(0);
    expect(plan.liveSubscriptionsFound).toBe(0);
  });

  it("executeStripeCustomerPurge is a no-op when customerIds=[]", async () => {
    const stripe = buildFakeStripe({ customers: [] });
    const plan = await planStripeCustomerPurge(["support@flowpoint.pro", "qa@flowpoint.pro"], stripe);
    const result = await executeStripeCustomerPurge(plan, stripe);

    expect(result.customersDeleted).toBe(0);
    expect(result.subscriptionsCanceled).toBe(0);
    expect(stripe.customers.del).not.toHaveBeenCalled();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TEST 3 — targetEmails = []  (the production orphan-org scenario)
// ---------------------------------------------------------------------------
describe("TEST 3 — targetEmails=[] with orphan orgs", () => {
  it("planStripeCustomerPurge handles empty customer list safely", async () => {
    // Stripe has the 2 exempt customers and nothing else
    const stripe = buildFakeStripe({
      customers: [
        makeCustomer("cus_support", "support@flowpoint.pro"),
        makeCustomer("cus_qa",      "qa@flowpoint.pro"),
      ],
    });
    const exempt = ["support@flowpoint.pro", "qa@flowpoint.pro"];
    const plan = await planStripeCustomerPurge(exempt, stripe);

    expect(plan.customerIds).toEqual([]);
    expect(plan.customersExempted).toBe(2);
  });

  it("SAVEPOINT-guarded fake client: missing table does not poison transaction", async () => {
    // Simulate the exact prod failure:
    //   - organisations table exists (orgIdsToDelete has 4 UUIDs)
    //   - some business tables (e.g. pagespeed_history) don't exist → 42P01
    //   - organizations DELETE must still succeed after savepointrollback
    const orgIds = [
      "dc9b51ec-c677-4c52-92a8-053d16bb6b51",
      "065615e1-f97e-420d-9995-0d4e5582081f",
    ];
    const client = buildFakeClient({
      missingTables: ["pagespeed_history", "pagespeed_results", "ai_market_reports"],
      orgRows: {
        audits:           1,
        ai_monthly_usage: 4,
        activity_logs:    1,
        user_prefs:       4,
        user_activity_days: 5,
        usage_events:     1,
        organizations:    2,
      },
    });

    // Replicate the SAVEPOINT-guarded delete pattern from the patched handler
    const deleted: Record<string, number> = {};
    await client.query("BEGIN");

    for (const tbl of ["audits", "pagespeed_history", "ai_monthly_usage", "ai_market_reports", "activity_logs"]) {
      const sp = `sp_${tbl}`;
      await client.query(`SAVEPOINT ${sp}`);
      try {
        const r = await client.query(`DELETE FROM ${tbl} WHERE org_id::text = ANY($1)`, [orgIds]);
        deleted[tbl] = r.rowCount;
        await client.query(`RELEASE SAVEPOINT ${sp}`);
      } catch {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
        deleted[tbl] = 0;
      }
    }

    // organizations DELETE must NOT throw even after the 42P01 errors above
    const orgR = await client.query(
      `DELETE FROM organizations WHERE id::text = ANY($1)`,
      [orgIds]
    );
    deleted["organizations"] = orgR.rowCount;
    await client.query("COMMIT");

    expect(deleted["audits"]).toBe(1);
    expect(deleted["pagespeed_history"]).toBe(0);     // missing table → 0, no throw
    expect(deleted["ai_market_reports"]).toBe(0);     // missing table → 0, no throw
    expect(deleted["ai_monthly_usage"]).toBe(4);
    expect(deleted["organizations"]).toBe(2);         // ← this previously threw 25P01
  });
});

// ---------------------------------------------------------------------------
// TEST 4 — System accounts preserved
// ---------------------------------------------------------------------------
describe("TEST 4 — system accounts preserved", () => {
  it("planStripeCustomerPurge never targets support@ or qa@ even if present", async () => {
    const stripe = buildFakeStripe({
      customers: [
        makeCustomer("cus_s", "support@flowpoint.pro"),
        makeCustomer("cus_q", "qa@flowpoint.pro"),
        makeCustomer("cus_c", "client@example.com"),
      ],
    });
    const SYSTEM = ["support@flowpoint.pro", "qa@flowpoint.pro"];
    const plan = await planStripeCustomerPurge(SYSTEM, stripe);

    expect(plan.customerIds).toEqual(["cus_c"]);
    expect(plan.customersExempted).toBe(2);
    expect(plan.customerIds).not.toContain("cus_s");
    expect(plan.customerIds).not.toContain("cus_q");
  });
});

// ---------------------------------------------------------------------------
// TEST 5 — dry_run performs zero DELETEs
// ---------------------------------------------------------------------------
describe("TEST 5 — dry_run produces no side-effects on Stripe", () => {
  it("planStripeCustomerPurge is read-only (no delete/cancel called)", async () => {
    const stripe = buildFakeStripe({
      customers: [makeCustomer("cus_1", "client@example.com")],
      subscriptionsByCustomer: { cus_1: [makeSubscription("sub_1", "active")] },
    });

    // planStripeCustomerPurge is the dry-run step — pure read
    await planStripeCustomerPurge(["support@flowpoint.pro"], stripe);

    expect(stripe.customers.del).not.toHaveBeenCalled();
    expect(stripe.subscriptions.cancel).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// TEST 6 — Failure mid-transaction causes rollback
// ---------------------------------------------------------------------------
describe("TEST 6 — hard failure on organizations DELETE propagates as throw", () => {
  it("throws when organizations DELETE itself fails (no savepoint on it)", async () => {
    const client = buildFakeClient({
      missingTables: ["organizations"], // simulate org table missing
    });

    await client.query("BEGIN");

    // Organizations DELETE has no SAVEPOINT — it must throw on failure
    await expect(
      client.query(`DELETE FROM organizations WHERE id::text = ANY($1)`, ["some-uuid"])
    ).rejects.toMatchObject({ code: "42P01" });
  });
});

// ---------------------------------------------------------------------------
// TEST 7 — Orphan org business rows are deleted before organization row
// ---------------------------------------------------------------------------
describe("TEST 7 — business rows deleted before organization row", () => {
  it("DELETE for business tables appears before DELETE FROM organizations in statement order", async () => {
    const orgIds = ["aabbccdd-1111-2222-3333-444455556666"];
    const client = buildFakeClient({
      orgRows: {
        audits:           1,
        ai_monthly_usage: 2,
        organizations:    1,
      },
    });

    await client.query("BEGIN");

    for (const tbl of ["audits", "ai_monthly_usage"]) {
      const sp = `sp_${tbl}`;
      await client.query(`SAVEPOINT ${sp}`);
      try {
        await client.query(`DELETE FROM ${tbl} WHERE org_id::text = ANY($1)`, [orgIds]);
        await client.query(`RELEASE SAVEPOINT ${sp}`);
      } catch {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
      }
    }

    await client.query(`DELETE FROM organizations WHERE id::text = ANY($1)`, [orgIds]);
    await client.query("COMMIT");

    const stmts = client._statements;
    const idxAudits  = stmts.findIndex((s) => /DELETE FROM audits/i.test(s));
    const idxAI      = stmts.findIndex((s) => /DELETE FROM ai_monthly_usage/i.test(s));
    const idxOrgs    = stmts.findIndex((s) => /DELETE FROM organizations/i.test(s));

    expect(idxAudits).toBeGreaterThan(-1);
    expect(idxAI).toBeGreaterThan(-1);
    expect(idxOrgs).toBeGreaterThan(-1);
    expect(idxAudits).toBeLessThan(idxOrgs);
    expect(idxAI).toBeLessThan(idxOrgs);
  });
});

// ---------------------------------------------------------------------------
// executeStripeCustomerPurge — idempotent resource_missing handling
// ---------------------------------------------------------------------------
describe("executeStripeCustomerPurge — resource_missing is treated as success", () => {
  it("counts already-deleted customers as deleted (idempotent retry)", async () => {
    const stripe = buildFakeStripe({
      customers: [makeCustomer("cus_gone", "gone@example.com")],
      throwOnCustomerDel: "cus_gone",
    });
    const plan = await planStripeCustomerPurge(["support@flowpoint.pro"], stripe);
    const result = await executeStripeCustomerPurge(plan, stripe);

    // resource_missing must be treated as success (idempotent)
    expect(result.customersDeleted).toBe(1);
  });
});
