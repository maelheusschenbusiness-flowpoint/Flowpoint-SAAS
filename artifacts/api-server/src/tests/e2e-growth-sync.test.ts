/**
 * E2E Croissance — la VRAIE route admin contre un VRAI PostgreSQL.
 *
 * `@workspace/db` est remplace par un vrai pool `pg` pointant sur une base
 * jetable : le handler, son SQL `jsonb_each` et le registre vendeurs sont donc
 * reellement executes. Aucune cle Stripe, aucun appel Stripe, aucune production.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import request from "supertest";
import pg from "pg";

const URL = process.env["SAAS_URL"]!;
const KEY = "g".repeat(48);
const real = new pg.Pool({ connectionString: URL });

vi.mock("@workspace/db", () => ({
  pool: real, db: {}, eq: vi.fn(), desc: vi.fn(), and: vi.fn(),
}));

const { default: adminRouter } = await import("../routes/admin.js");
const app = express();
app.use(express.json());
app.use("/api", adminRouter);

beforeAll(() => {
  process.env["ADMIN_KEY"] = "a".repeat(48);
  process.env["SELLER_ADMIN_KEY"] = "s".repeat(48);
  process.env["GROWTH_ADMIN_KEY"] = KEY;
});
afterAll(async () => { await real.end(); });

const get = (from: string, to: string) =>
  request(app).get(`/api/admin/growth/daily?from=${from}&to=${to}`).set("x-growth-admin-key", KEY);

describe("la route lit vraiment les faits en base", () => {
  it("rend les faits du mois, journee par journee", async () => {
    const r = await get("2026-10-01", "2026-10-31");
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    const d = r.body.days;
    // Client payant d'emblee, 49 EUR.
    expect(d["2026-10-02"]).toMatchObject({ clients_new: 1, mrr_gained_cents: 4900, sellers_new: 1 });
    // Un essai demarre, sans client ni MRR.
    expect(d["2026-10-03"]).toMatchObject({ trials_started: 1, sellers_new: 1 });
    expect(d["2026-10-03"].clients_new).toBeUndefined();
    // La conversion : essai -> payant.
    expect(d["2026-10-06"]).toMatchObject({ trials_converted: 1, clients_new: 1, mrr_gained_cents: 9900 });
    // Montee en gamme : un ECART seul, et le vendeur desactive.
    expect(d["2026-10-07"]).toMatchObject({ mrr_gained_cents: 5000, sellers_lost: 1 });
    expect(d["2026-10-07"].clients_new).toBeUndefined();
    expect(d["2026-10-07"].clients_churned).toBeUndefined();
    // Resiliation effective.
    expect(d["2026-10-08"]).toMatchObject({ clients_churned: 1, mrr_lost_cents: 4900 });
  });

  it("l evenement de 23h30 UTC le 31 tombe le 1er novembre a Bruxelles", async () => {
    expect((await get("2026-10-01", "2026-10-31")).body.days["2026-11-01"]).toBeUndefined();
    expect((await get("2026-11-01", "2026-11-30")).body.days["2026-11-01"])
      .toMatchObject({ clients_new: 1, mrr_gained_cents: 4900 });
  });

  it("la facture a 0 EUR, l add-on seul et le paiement echoue n apparaissent nulle part", async () => {
    const total = Object.values((await get("2026-10-01", "2026-10-31")).body.days as Record<string, Record<string, number>>)
      .reduce((n, m) => n + (m.clients_new ?? 0) + (m.trials_started ?? 0), 0);
    // 1 client d emblee + 1 conversion + 1 essai = 3. L add-on n a rien ajoute.
    expect(total).toBe(3);
  });

  it("deux lectures identiques donnent exactement le meme resultat", async () => {
    const a = await get("2026-10-01", "2026-10-31");
    const b = await get("2026-10-01", "2026-10-31");
    expect(JSON.stringify(a.body.days)).toBe(JSON.stringify(b.body.days));
  });

  it("la couverture est declaree, sellers_lost en partiel", async () => {
    const c = (await get("2026-10-01", "2026-10-31")).body.coverage;
    expect(c.partial).toContain("sellers_lost");
    expect(c.complete).toContain("mrr_gained_cents");
  });

  it("sans la bonne cle, rien n est lu", async () => {
    const r = await request(app).get("/api/admin/growth/daily?from=2026-10-01&to=2026-10-31")
      .set("x-growth-admin-key", "z".repeat(48));
    expect(r.status).toBe(403);
  });

  it("une fenetre mal formee est refusee avant la base", async () => {
    for (const q of ["from=hier&to=2026-10-31", "from=2026-10-01&to=x", "from=2026-11-01&to=2026-10-01"]) {
      expect((await request(app).get(`/api/admin/growth/daily?${q}`)
        .set("x-growth-admin-key", KEY)).status).toBe(400);
    }
  });
});
