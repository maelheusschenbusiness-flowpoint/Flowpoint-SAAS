/**
 * Les evenements refuses ou perdus par POST /api/public/funnel-event sont
 * COMPTES par motif (liste fermee), sans aucune donnee de l'appelant. Se saute sans base.
 *
 * Les appels au compteur sont observes par un enrobage (les autres fichiers de
 * test ecrivent dans la meme table en parallele : un total global n'est pas stable).
 */
import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";
vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }));
const espion = vi.hoisted(() => ({ appels: [] as string[] }));
vi.mock("../services/funnel-rejections.js", async (importOriginal) => {
  const reel = await importOriginal<typeof import("../services/funnel-rejections.js")>();
  return { ...reel, compterRejetFunnel: async (m: never) => { espion.appels.push(String(m)); return reel.compterRejetFunnel(m); } };
});
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { pool } from "@workspace/db";
import { compterRejetFunnel } from "../services/funnel-rejections.js";

let app: express.Express;
let dbOk = false;

beforeAll(async () => {
  try { await pool.query("SELECT 1"); dbOk = true; } catch { dbOk = false; }
  const { default: routeur } = await import("./public-billing.js");
  app = express();
  app.use(express.json(), cookieParser());
  app.use("/api", routeur);
  if (dbOk) await compterRejetFunnel("unknown_stage"); // cree la table
});
beforeEach(() => { espion.appels.length = 0; });

describe("compteur des rejets de POST /api/public/funnel-event", () => {
  it("compte une etape inconnue (400), un visiteur absent (400) et l'absence de consentement (204)", async () => {
    expect((await request(app).post("/api/public/funnel-event").send({ etape: "etape_inventee", visiteurId: "x" })).status).toBe(400);
    expect((await request(app).post("/api/public/funnel-event").send({ etape: "landing_vue" })).status).toBe(400);
    expect((await request(app).post("/api/public/funnel-event").send({ etape: "landing_vue", visiteurId: "fp-test-aaaa-bbbb" })).status).toBe(204);
    expect(espion.appels).toEqual(["unknown_stage", "missing_visitor_id", "consent_missing"]);
  });

  it("un evenement valide et consenti ne compte aucun rejet", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const v = `fp-test-${Date.now().toString(36)}ok`;
    const r = await request(app).post("/api/public/funnel-event")
      .set("Cookie", "fp_analytics_consent=accepted").send({ etape: "landing_vue", visiteurId: v, source: "direct" });
    expect(r.status).toBe(204);
    expect(espion.appels).toEqual([]);
    await pool.query(`DELETE FROM funnel_events WHERE visiteur_id = $1`, [v]);
  });

  it("ecrit le compteur : une ligne (jour, motif) dont le total augmente", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const lire = async () => Number((await pool.query<{ t: string }>(
      `SELECT coalesce(sum(total),0)::text AS t FROM funnel_event_rejections WHERE motif = 'storage_error'`)).rows[0]!.t);
    const avant = await lire();
    await compterRejetFunnel("storage_error");
    expect(await lire()).toBeGreaterThan(avant);
  });

  it("ne stocke que (jour, motif, total) : ni valeur d'appelant ni motif libre", async (ctx) => {
    if (!dbOk) return ctx.skip();
    await request(app).post("/api/public/funnel-event").send({ etape: "<script>mon-etape</script>", visiteurId: "personne@example.com" });
    // @ts-expect-error motif hors liste : ignore, sans erreur ni ligne
    await compterRejetFunnel("personne@example.com");
    const cols = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'funnel_event_rejections' ORDER BY 1`);
    expect(cols.rows.map(c => c.column_name)).toEqual(["jour", "motif", "total"]);
    const motifs = await pool.query(`SELECT DISTINCT motif FROM funnel_event_rejections`);
    for (const m of motifs.rows) expect(["unknown_stage", "missing_visitor_id", "consent_missing", "storage_error"]).toContain(m.motif);
  });
});
