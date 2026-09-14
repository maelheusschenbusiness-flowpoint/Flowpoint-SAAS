/**
 * seller-delete.db.test.ts — DELETE /api/admin/sellers/:code on a real PostgreSQL.
 *
 * Runs SELLER_DELETE_UNUSED_SQL and SELLER_REFERENCES_SQL inside a throw-away schema:
 * a seller without history is deleted, a seller referenced by an organization, a
 * pending signup or a commission (pending or paid) is kept, and no other row moves.
 *
 * Needs SELLER_TOTALS_DATABASE_URL (a disposable database); skipped otherwise.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { randomBytes } from "node:crypto";
import { SELLER_DELETE_UNUSED_SQL, SELLER_REFERENCES_SQL } from "../routes/admin.js";

const URL = process.env["SELLER_TOTALS_DATABASE_URL"];

describe.skipIf(!URL)("seller hard delete on a real PostgreSQL", () => {
  const schema = `seller_delete_${randomBytes(4).toString("hex")}`;
  const client = new pg.Client({ connectionString: URL });
  const snapshot = async () => {
    const all = await Promise.all(["sellers", "organizations", "pending_signups", "seller_commissions", "seller_financial_ledger"].map((t) =>
      client.query(`SELECT * FROM ${t} ORDER BY id`).then((r) => [t, r.rows] as const)));
    return Object.fromEntries(all);
  };

  beforeAll(async () => {
    await client.connect();
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}`);
    await client.query(`CREATE TABLE sellers (
      id TEXT PRIMARY KEY, seller_code TEXT UNIQUE NOT NULL, name TEXT, email TEXT,
      status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    await client.query(`CREATE TABLE organizations (id TEXT PRIMARY KEY, seller_id TEXT)`);
    await client.query(`CREATE TABLE pending_signups (token TEXT PRIMARY KEY, id TEXT, seller_id TEXT)`);
    await client.query(`CREATE TABLE seller_commissions (
      id TEXT PRIMARY KEY, seller_id TEXT NOT NULL REFERENCES sellers(id), org_id TEXT NOT NULL UNIQUE,
      commission_amount_cents INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending')`);
    // E: nothing. O: one organization. P: one pending signup. C: pending commission. K: paid commission, org gone. L: financial ledger only.
    await client.query(`CREATE TABLE seller_financial_ledger (id TEXT PRIMARY KEY, seller_id TEXT NOT NULL, event_type TEXT NOT NULL, amount_cents INTEGER NOT NULL DEFAULT 0)`);
    await client.query(`INSERT INTO sellers (id, seller_code) VALUES
      ('E','SELLER-E'),('O','SELLER-O'),('P','SELLER-P'),('C','SELLER-C'),('K','SELLER-K'),('L','SELLER-L'),('X','SELLER-X')`);
    await client.query(`INSERT INTO organizations (id, seller_id) VALUES ('o1','O'),('c1','C'),('x1','X'),('n1',NULL)`);
    await client.query(`INSERT INTO pending_signups (token, id, seller_id) VALUES ('t1','t1','P'),('t2','t2',NULL)`);
    await client.query(`INSERT INTO seller_commissions (id, seller_id, org_id, commission_amount_cents, status) VALUES
      ('kc','C','c1',1015,'pending'),('kk','K','k-gone',1015,'paid')`);
  });
  afterAll(async () => {
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
    await client.end();
  });

  it("SELLER_DELETE_EMPTY: a seller without history is deleted, and only that row", async () => {
    const before = await snapshot();
    const d = await client.query(SELLER_DELETE_UNUSED_SQL, ["SELLER-E"]);
    expect(d.rows).toEqual([{ id: "E", seller_code: "SELLER-E" }]);
    const after = await snapshot();
    expect(after.sellers).toEqual(before.sellers.filter((s: any) => s.id !== "E"));
    expect(after.organizations).toEqual(before.organizations);
    expect(after.pending_signups).toEqual(before.pending_signups);
    expect(after.seller_commissions).toEqual(before.seller_commissions);
    expect((await client.query(SELLER_REFERENCES_SQL, ["SELLER-E"])).rows).toEqual([]);
  });

  for (const [code, refs] of [
    ["SELLER-O", { organizations: 1, pending_signups: 0, commissions: 0, financial_ledger: 0 }],
    ["SELLER-P", { organizations: 0, pending_signups: 1, commissions: 0, financial_ledger: 0 }],
    ["SELLER-C", { organizations: 1, pending_signups: 0, commissions: 1, financial_ledger: 0 }],
    ["SELLER-K", { organizations: 0, pending_signups: 0, commissions: 1, financial_ledger: 0 }],
    ["SELLER-L", { organizations: 0, pending_signups: 0, commissions: 0, financial_ledger: 1 }],
  ] as const) {
    it(`${code} has history: nothing deleted, references reported`, async () => {
      const before = await snapshot();
      expect((await client.query(SELLER_DELETE_UNUSED_SQL, [code])).rows).toEqual([]);
      expect(await snapshot()).toEqual(before);
      expect((await client.query(SELLER_REFERENCES_SQL, [code])).rows).toEqual([refs]);
    });
  }

  it("unknown code: nothing deleted, no reference row (→ 404)", async () => {
    const before = await snapshot();
    expect((await client.query(SELLER_DELETE_UNUSED_SQL, ["SELLER-NOPE"])).rows).toEqual([]);
    expect((await client.query(SELLER_REFERENCES_SQL, ["SELLER-NOPE"])).rows).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it("the foreign key still refuses an unguarded delete of a seller with a commission", async () => {
    await expect(client.query(`DELETE FROM sellers WHERE id = 'K'`)).rejects.toThrow(/foreign key/);
  });
});
