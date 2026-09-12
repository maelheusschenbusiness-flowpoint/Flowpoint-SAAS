/**
 * seller-admin-routes.test.ts
 *
 * Pins the scoped seller-management key and the canonical seller link.
 *
 *  1. SELLER_ADMIN_KEY (header x-seller-admin-key) opens exactly the four seller
 *     routes: POST/GET /admin/sellers, PATCH /admin/sellers/:code,
 *     GET /admin/sellers/:code/report.
 *  2. It is refused on every other admin route — the route inventory is read from
 *     admin.ts itself, so a route added later is covered without editing this file —
 *     and the refusal happens before any database access.
 *  3. ADMIN_KEY (header x-admin-key) keeps working on the four seller routes.
 *  4. Misconfiguration fails closed: missing, short, or equal to ADMIN_KEY → 503.
 *  5. Every seller response carries the canonical signin.html?fp_ref= link, never
 *     the legacy pricing.html?ref= link.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";
import adminRouter, { SELLERS_LIST_SQL, sellerLink, SELLER_LINK_BASE } from "../routes/admin.js";

const ADMIN = "a".repeat(48);
const SELLER = "s".repeat(48);
const here = dirname(fileURLToPath(import.meta.url));
const SOURCE = readFileSync(join(here, "../routes/admin.ts"), "utf8");

/** Every route declared in admin.ts with the guard that opens its handler. */
const ROUTES = [...SOURCE.matchAll(/router\.(get|post|put|patch|delete)\("([^"]+)"/g)].map((m) => {
  const after = SOURCE.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 400);
  const guard = /require(?:Seller)?AdminKey/.exec(after)?.[0] ?? null;
  return { method: m[1] as "get" | "post" | "put" | "patch" | "delete", path: m[2], guard };
});
const SELLER_ROUTES = [
  "POST /admin/sellers", "GET /admin/sellers", "PATCH /admin/sellers/:code", "GET /admin/sellers/:code/report",
];
const key = (r: { method: string; path: string }) => `${r.method.toUpperCase()} ${r.path}`;
const concrete = (p: string) => p.replace(/:code/g, "SELLER-TEST1").replace(/:[a-zA-Z]+/g, "x1");

const app = express();
app.use(express.json());
app.use("/api", adminRouter);

const q = vi.mocked(pool.query) as unknown as ReturnType<typeof vi.fn>;
const c = vi.mocked(pool.connect) as unknown as ReturnType<typeof vi.fn>;

const SELLER_ROW = { id: "s-1", seller_code: "SELLER-TEST1", name: "Ana", email: "ana@x.co", status: "active", created_at: "2026-09-01T00:00:00Z" };
function fakeDb() {
  q.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.startsWith("INSERT INTO sellers")) return { rows: [{ ...SELLER_ROW, seller_code: String(params?.[0]) }] };
    if (sql === SELLERS_LIST_SQL) return { rows: [{ ...SELLER_ROW, org_count: 2, commission_count: 1, paid_cents: 0, pending_cents: 3700 }] };
    if (sql.trim().startsWith("UPDATE sellers")) return { rows: [{ ...SELLER_ROW, status: String(params?.[3] ?? "active") }] };
    if (sql.includes("FROM sellers WHERE seller_code")) return { rows: [SELLER_ROW] };
    if (sql.includes("FROM organizations o WHERE o.seller_id")) return { rows: [] };
    if (sql.includes("FROM seller_commissions sc WHERE sc.seller_id")) return { rows: [] };
    throw new Error(`unexpected query in seller test: ${sql.slice(0, 60)}`);
  });
}

beforeEach(() => {
  process.env["ADMIN_KEY"] = ADMIN;
  process.env["SELLER_ADMIN_KEY"] = SELLER;
  q.mockReset(); c.mockReset();
  fakeDb();
});
afterEach(() => {
  delete process.env["ADMIN_KEY"];
  delete process.env["SELLER_ADMIN_KEY"];
});

const call = (method: string, path: string) => (request(app) as any)[method](`/api${path}`);
const sellerBody = (m: string) => (m === "post" ? { name: "Ana", email: "ana@x.co" } : m === "patch" ? { status: "inactive" } : undefined);

describe("route inventory", () => {
  it("every admin route opens with an admin guard", () => {
    expect(ROUTES.length).toBeGreaterThan(40);
    expect(ROUTES.filter((r) => r.guard === null).map(key)).toEqual([]);
  });
  it("the scoped guard is used by exactly the four seller routes", () => {
    expect(ROUTES.filter((r) => r.guard === "requireSellerAdminKey").map(key).sort()).toEqual([...SELLER_ROUTES].sort());
    expect((SOURCE.match(/requireSellerAdminKey\(req, res\)/g) ?? []).length).toBe(4);
  });
});

describe("SELLER_ADMIN_KEY opens the four seller routes", () => {
  for (const route of SELLER_ROUTES) {
    it(`${route} → 2xx with x-seller-admin-key`, async () => {
      const [m, p] = route.split(" ");
      const r = await call(m.toLowerCase(), concrete(p)).set("x-seller-admin-key", SELLER).send(sellerBody(m.toLowerCase()));
      expect(r.status).toBeGreaterThanOrEqual(200);
      expect(r.status).toBeLessThan(300);
    });
  }
});

describe("ADMIN_KEY keeps working on the four seller routes", () => {
  for (const route of SELLER_ROUTES) {
    it(`${route} → 2xx with x-admin-key`, async () => {
      const [m, p] = route.split(" ");
      const r = await call(m.toLowerCase(), concrete(p)).set("x-admin-key", ADMIN).send(sellerBody(m.toLowerCase()));
      expect(r.status).toBeGreaterThanOrEqual(200);
      expect(r.status).toBeLessThan(300);
    });
  }
});

describe("SELLER_ADMIN_KEY is refused everywhere else, before any database access", () => {
  const others = ROUTES.filter((r) => !SELLER_ROUTES.includes(key(r)));
  it("covers every non-seller route", () => { expect(others.length).toBe(ROUTES.length - 4); });
  for (const r of others) {
    it(`${key(r)} → 403 with x-seller-admin-key`, async () => {
      const res = await call(r.method, concrete(r.path)).set("x-seller-admin-key", SELLER).send({});
      expect(res.status).toBe(403);
      expect(q).not.toHaveBeenCalled();
      expect(c).not.toHaveBeenCalled();
    });
    it(`${key(r)} → 403 with the seller key sent as x-admin-key`, async () => {
      const res = await call(r.method, concrete(r.path)).set("x-admin-key", SELLER).send({});
      expect(res.status).toBe(403);
      expect(q).not.toHaveBeenCalled();
    });
  }
});

describe("scoped key fails closed", () => {
  it("wrong key → 403", async () => {
    const r = await call("get", "/admin/sellers").set("x-seller-admin-key", "z".repeat(48));
    expect(r.status).toBe(403); expect(q).not.toHaveBeenCalled();
  });
  it("no header at all → 403 (unchanged admin behaviour)", async () => {
    const r = await call("get", "/admin/sellers");
    expect(r.status).toBe(403); expect(q).not.toHaveBeenCalled();
  });
  it("SELLER_ADMIN_KEY unset → 503", async () => {
    delete process.env["SELLER_ADMIN_KEY"];
    const r = await call("get", "/admin/sellers").set("x-seller-admin-key", SELLER);
    expect(r.status).toBe(503); expect(q).not.toHaveBeenCalled();
  });
  it("SELLER_ADMIN_KEY shorter than 32 chars → 503", async () => {
    process.env["SELLER_ADMIN_KEY"] = "short-key";
    const r = await call("get", "/admin/sellers").set("x-seller-admin-key", "short-key");
    expect(r.status).toBe(503); expect(q).not.toHaveBeenCalled();
  });
  it("SELLER_ADMIN_KEY equal to ADMIN_KEY → 503", async () => {
    process.env["SELLER_ADMIN_KEY"] = ADMIN;
    const r = await call("get", "/admin/sellers").set("x-seller-admin-key", ADMIN);
    expect(r.status).toBe(503); expect(q).not.toHaveBeenCalled();
  });
  it("both headers: x-admin-key decides, a valid seller key does not rescue a wrong admin key", async () => {
    const r = await call("get", "/admin/sellers").set("x-admin-key", "w".repeat(48)).set("x-seller-admin-key", SELLER);
    expect(r.status).toBe(403); expect(q).not.toHaveBeenCalled();
  });
  it("ADMIN_KEY unset: admin route answers 503 exactly as before", async () => {
    delete process.env["ADMIN_KEY"];
    const r = await call("get", "/admin/stats").set("x-admin-key", ADMIN);
    expect(r.status).toBe(503);
  });
});

describe("canonical seller link", () => {
  const CANON = /^https:\/\/app\.flowpoint\.pro\/signin\.html\?fp_ref=SELLER-[A-Z0-9]+$/;
  it("helper builds signin.html?fp_ref=", () => {
    expect(SELLER_LINK_BASE).toBe("https://app.flowpoint.pro/signin.html");
    expect(sellerLink("SELLER-0042")).toBe("https://app.flowpoint.pro/signin.html?fp_ref=SELLER-0042");
  });
  it("POST /admin/sellers (generated code) returns the canonical link", async () => {
    const r = await call("post", "/admin/sellers").set("x-seller-admin-key", SELLER).send({ name: "Ana" });
    expect(r.status).toBe(201);
    expect(r.body.link).toMatch(CANON);
    expect(r.body.link).toBe(sellerLink(r.body.seller.seller_code));
  });
  it("POST /admin/sellers (custom code) returns the canonical link for that code", async () => {
    const r = await call("post", "/admin/sellers").set("x-seller-admin-key", SELLER).send({ name: "Ana", code: "seller-ana01" });
    expect(r.status).toBe(201);
    expect(r.body.link).toBe("https://app.flowpoint.pro/signin.html?fp_ref=SELLER-ANA01");
  });
  it("custom code validation is unchanged", async () => {
    const r = await call("post", "/admin/sellers").set("x-seller-admin-key", SELLER).send({ code: "ANA" });
    expect(r.status).toBe(400); expect(q).not.toHaveBeenCalled();
  });
  it("GET /admin/sellers returns the canonical link and runs the fixed aggregate query", async () => {
    const r = await call("get", "/admin/sellers").set("x-seller-admin-key", SELLER);
    expect(r.status).toBe(200);
    expect(q).toHaveBeenCalledWith(SELLERS_LIST_SQL);
    expect(r.body.sellers[0].link).toBe("https://app.flowpoint.pro/signin.html?fp_ref=SELLER-TEST1");
  });
  it("PATCH /admin/sellers/:code returns the canonical link", async () => {
    const r = await call("patch", "/admin/sellers/SELLER-TEST1").set("x-seller-admin-key", SELLER).send({ status: "inactive" });
    expect(r.status).toBe(200);
    expect(r.body.link).toBe("https://app.flowpoint.pro/signin.html?fp_ref=SELLER-TEST1");
  });
  it("no seller endpoint builds a pricing.html?ref= link any more", () => {
    expect(SOURCE).not.toMatch(/pricing\.html\?ref=/);
  });
});
