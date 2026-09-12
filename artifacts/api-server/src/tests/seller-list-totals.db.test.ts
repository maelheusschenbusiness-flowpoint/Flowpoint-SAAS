/**
 * seller-list-totals.db.test.ts — non-regression for GET /api/admin/sellers totals.
 *
 * The list used to join organizations AND seller_commissions to sellers before
 * grouping, so each commission was counted once per organization of the seller:
 * a seller with 3 organizations saw 3× its commissions. This runs the real
 * SELLERS_LIST_SQL on a real PostgreSQL, inside a throw-away schema.
 *
 * Needs SELLER_TOTALS_DATABASE_URL (a disposable database); skipped otherwise.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { SELLERS_LIST_SQL } from "../routes/admin.js";

const URL = process.env["SELLER_TOTALS_DATABASE_URL"];

/** The pre-fix query, kept only to prove the fixture reproduces the bug. */
const LEGACY_SQL = `SELECT s.id, s.seller_code,
       COUNT(DISTINCT o.id)::int AS org_count,
       COUNT(sc.id)::int AS commission_count,
       COALESCE(SUM(sc.commission_amount_cents) FILTER (WHERE sc.status = 'paid'),   0)::int AS paid_cents,
       COALESCE(SUM(sc.commission_amount_cents) FILTER (WHERE sc.status = 'pending'),0)::int AS pending_cents
  FROM sellers s
  LEFT JOIN organizations o ON o.seller_id = s.id
  LEFT JOIN seller_commissions sc ON sc.seller_id = s.id
 GROUP BY s.id
 ORDER BY s.created_at DESC`;

describe.skipIf(!URL)("GET /admin/sellers totals on a real PostgreSQL", () => {
  const schema = `seller_totals_${randomBytes(4).toString("hex")}`;
  const client = new pg.Client({ connectionString: URL });

  beforeAll(async () => {
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`CREATE TABLE sellers (
      id TEXT PRIMARY KEY, seller_code TEXT UNIQUE NOT NULL, name TEXT, email TEXT,
      status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await client.query(`CREATE TABLE organizations (id TEXT PRIMARY KEY, seller_id TEXT)`);
    await client.query(`CREATE TABLE seller_commissions (
      id TEXT PRIMARY KEY, seller_id TEXT NOT NULL REFERENCES sellers(id), org_id TEXT NOT NULL UNIQUE,
      commission_amount_cents INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending')`);
    // A: 3 orgs, 2 commissions (paid 1110, pending 740) — the case the bug multiplied.
    // B: 1 org, 1 pending commission. C: 2 orgs, no commission. D: nothing.
    // E: 2 orgs, one 'earned' commission — counted, in neither sum.
    await client.query(`INSERT INTO sellers (id, seller_code, created_at) VALUES
      ('A','SELLER-A','2026-09-05'),('B','SELLER-B','2026-09-04'),('C','SELLER-C','2026-09-03'),
      ('D','SELLER-D','2026-09-02'),('E','SELLER-E','2026-09-01')`);
    await client.query(`INSERT INTO organizations (id, seller_id) VALUES
      ('a1','A'),('a2','A'),('a3','A'),('b1','B'),('c1','C'),('c2','C'),('e1','E'),('e2','E'),('x1',NULL)`);
    await client.query(`INSERT INTO seller_commissions (id, seller_id, org_id, commission_amount_cents, status) VALUES
      ('ca1','A','a1',1110,'paid'),('ca2','A','a2',740,'pending'),('cb1','B','b1',370,'pending'),('ce1','E','e1',500,'earned')`);
  });
  afterAll(async () => {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await client.end();
  });

  const byCode = async (sql: string) =>
    Object.fromEntries((await client.query(sql)).rows.map((r: any) => [r.seller_code,
      { org_count: r.org_count, commission_count: r.commission_count, paid_cents: r.paid_cents, pending_cents: r.pending_cents }]));

  it("the fixture reproduces the legacy multiplication", async () => {
    const legacy = await byCode(LEGACY_SQL);
    expect(legacy["SELLER-A"]).toEqual({ org_count: 3, commission_count: 6, paid_cents: 3330, pending_cents: 2220 });
  });

  it("totals are exact whatever the number of organizations", async () => {
    const t = await byCode(SELLERS_LIST_SQL);
    expect(t).toEqual({
      "SELLER-A": { org_count: 3, commission_count: 2, paid_cents: 1110, pending_cents: 740 },
      "SELLER-B": { org_count: 1, commission_count: 1, paid_cents: 0, pending_cents: 370 },
      "SELLER-C": { org_count: 2, commission_count: 0, paid_cents: 0, pending_cents: 0 },
      "SELLER-D": { org_count: 0, commission_count: 0, paid_cents: 0, pending_cents: 0 },
      "SELLER-E": { org_count: 2, commission_count: 1, paid_cents: 0, pending_cents: 0 },
    });
  });

  it("keeps the list shape and order", async () => {
    const r = await client.query(SELLERS_LIST_SQL);
    expect(r.rows.map((x: any) => x.seller_code)).toEqual(["SELLER-A", "SELLER-B", "SELLER-C", "SELLER-D", "SELLER-E"]);
    expect(Object.keys(r.rows[0]).sort()).toEqual(
      ["commission_count", "created_at", "email", "id", "name", "org_count", "paid_cents", "pending_cents", "seller_code", "status"]);
  });
});
