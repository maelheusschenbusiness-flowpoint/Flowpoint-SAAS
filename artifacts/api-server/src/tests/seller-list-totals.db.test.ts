/**
 * seller-list-totals.db.test.ts — non-regression for GET /api/admin/sellers totals.
 *
 * The list used to join organizations AND seller_commissions to sellers before
 * grouping, so each commission was counted once per organization of the seller:
 * a seller with 3 organizations saw 3× its commissions. This runs the real
 * SELLERS_LIST_SQL on a real PostgreSQL, inside a throw-away schema.
 *
 * Needs SELLER_TOTALS_DATABASE_URL: a DISPOSABLE database already migrated (node dist/migrate.mjs); skipped otherwise.
 * The fixture is inserted into the real schema (the list query now joins the ledger, funnel and trial
 * tables, so a hand-built mini schema no longer works) and removed afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { randomBytes, randomUUID } from "node:crypto";
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
  const tag = randomBytes(4).toString("hex").toUpperCase();
  const ids = ["A", "B", "C", "D", "E"].map((k) => `${k}-${tag}`);
  const code = (k: string) => `SELLER-${k}-${tag}`;
  const orgIds: Record<string, string> = {};
  const client = new pg.Client({ connectionString: URL });

  beforeAll(async () => {
    await client.connect();
    const dates: Record<string, string> = { A: "2026-09-05", B: "2026-09-04", C: "2026-09-03", D: "2026-09-02", E: "2026-09-01" };
    for (const k of ["A", "B", "C", "D", "E"]) {
      await client.query(`INSERT INTO sellers (id, seller_code, created_at) VALUES ($1,$2,$3)`, [`${k}-${tag}`, code(k), dates[k]]);
    }
    // A: 3 orgs, 2 commissions (paid 1110, pending 740) — the case the bug multiplied.
    // B: 1 org, 1 pending commission. C: 2 orgs, none. D: nothing. E: 2 orgs, one 'earned' commission.
    const orgs: [string, string][] = [["a1", "A"], ["a2", "A"], ["a3", "A"], ["b1", "B"], ["c1", "C"], ["c2", "C"], ["e1", "E"], ["e2", "E"]];
    for (const [name, k] of orgs) {
      const id = randomUUID(); orgIds[name] = id;
      await client.query(`INSERT INTO organizations (id, name, slug, seller_id) VALUES ($1,$2,$3,$4)`, [id, name, `${name}-${tag}`, `${k}-${tag}`]);
    }
    const commissions: [string, string, string, number, string][] = [
      ["A", "a1", "paid", 1110, "ca1"], ["A", "a2", "pending", 740, "ca2"], ["B", "b1", "pending", 370, "cb1"], ["E", "e1", "earned", 500, "ce1"]];
    for (const [k, org, status, cents, id] of commissions) {
      await client.query(
        `INSERT INTO seller_commissions (id, seller_id, org_id, customer_email, plan, commission_amount_cents, status) VALUES ($1,$2,$3,$4,'pro',$5,$6)`,
        [`${id}-${tag}`, `${k}-${tag}`, orgIds[org], `${id}@example.test`, cents, status]);
    }
    // Les commissions versees viennent du registre financier (et non du statut de la commission).
    await client.query(
      `INSERT INTO seller_financial_ledger (seller_id, org_id, event_type, source_key, amount_cents, commission_id)
       VALUES ($1,$2,'commission_paid',$3,1110,$4)`,
      [`A-${tag}`, orgIds["a1"], `ledger-${tag}`, `ca1-${tag}`]);
  });
  afterAll(async () => {
    await client.query(`DELETE FROM seller_financial_ledger WHERE seller_id = ANY($1)`, [ids]).catch(() => {});
    await client.query(`DELETE FROM seller_commissions WHERE seller_id = ANY($1)`, [ids]).catch(() => {});
    await client.query(`DELETE FROM organizations WHERE seller_id = ANY($1)`, [ids]).catch(() => {});
    await client.query(`DELETE FROM sellers WHERE id = ANY($1)`, [ids]).catch(() => {});
    await client.end();
  });

  const mine = (rows: any[]) => rows.filter((r) => ids.includes(r.id));
  const byCode = async (sql: string) =>
    Object.fromEntries(mine((await client.query(sql)).rows).map((r: any) => [r.seller_code.replace(`-${tag}`, ""),
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
    const rows = mine((await client.query(SELLERS_LIST_SQL)).rows);
    expect(rows.map((x: any) => x.seller_code.replace(`-${tag}`, ""))).toEqual(["SELLER-A", "SELLER-B", "SELLER-C", "SELLER-D", "SELLER-E"]);
    for (const key of ["commission_count", "created_at", "email", "id", "name", "org_count", "paid_cents", "pending_cents", "seller_code", "status"]) {
      expect(Object.keys(rows[0])).toContain(key);
    }
  });
});
