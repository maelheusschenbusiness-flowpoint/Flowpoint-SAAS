/**
 * Attribution fine (UTM) — PostgreSQL reel :
 *  - la route publique /public/funnel-event ecrit la campagne normalisee, et
 *    rien sans consentement ; un ancien appel sans utm reste identique ;
 *  - l'endpoint admin /admin/acquisition/attribution rend des agregats sans
 *    aucun identifiant, au contrat exact attendu par AI Lab.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";

const ADMIN = "attribution-test-admin-key-at-least-32-characters";
const CAMPAGNE_TEST = `test_${randomUUID().slice(0, 8)}`;
let app: express.Express;
let dbOk = false;
const ancienneCle = process.env["ADMIN_KEY"];

beforeAll(async () => {
  try { await pool.query("SELECT utm_campaign FROM funnel_events LIMIT 0"); dbOk = true; } catch { dbOk = false; }
  process.env["ADMIN_KEY"] = ADMIN;
  const { default: publicRouter } = await import("./public-billing.js");
  const { default: adminRouter } = await import("./admin.js");
  app = express();
  app.use(express.json(), cookieParser());
  app.use("/api", publicRouter);
  app.use("/api", adminRouter);
});

afterAll(async () => {
  if (ancienneCle === undefined) delete process.env["ADMIN_KEY"]; else process.env["ADMIN_KEY"] = ancienneCle;
  if (!dbOk) return;
  await pool.query(`DELETE FROM funnel_events WHERE visiteur_id LIKE 'fp-utmtest-%'`).catch(() => undefined);
});

const visiteur = () => `fp-utmtest-${randomUUID().replaceAll("-", "")}`;
async function ligne(v: string) {
  const r = await pool.query(
    `SELECT source, utm_source, utm_medium, utm_campaign FROM funnel_events WHERE visiteur_id = $1`, [v]);
  return r.rows;
}

describe("route publique : la campagne entre en base normalisee", () => {
  it("landing_vue Instagram : utm en minuscules, valeur invalide ignoree", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const v = visiteur();
    const r = await request(app).post("/api/public/funnel-event").send({
      etape: "landing_vue", visiteurId: v, consentement: "accepted", source: "social",
      utm_source: "Instagram", utm_medium: "social", utm_campaign: "jean@example.com",
    });
    expect(r.status).toBe(204);
    expect(await ligne(v)).toEqual([
      { source: "social", utm_source: "instagram", utm_medium: "social", utm_campaign: null },
    ]);
  });

  it("sans consentement : rien n'est ecrit, campagne comprise", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const v = visiteur();
    await request(app).post("/api/public/funnel-event").send({
      etape: "landing_vue", visiteurId: v, consentement: "refused", utm_source: "instagram",
    });
    expect(await ligne(v)).toEqual([]);
  });

  it("compatibilite : un ancien appel sans utm ecrit la meme ligne qu'avant (utm NULL)", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const v = visiteur();
    const r = await request(app).post("/api/public/funnel-event")
      .set("Cookie", "fp_analytics_consent=accepted")
      .send({ etape: "tarifs_vus", visiteurId: v, source: "google" });
    expect(r.status).toBe(204);
    expect(await ligne(v)).toEqual([
      { source: "google", utm_source: null, utm_medium: null, utm_campaign: null },
    ]);
  });
});

describe("migration 020 au demarrage (assurerColonnesUtm)", () => {
  it("base deja migree : rien a ajouter, appel idempotent", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const { assurerColonnesUtm } = await import("../services/funnel-events.js");
    expect(await assurerColonnesUtm()).toEqual({ etat: "deja_presentes" });
    expect(await assurerColonnesUtm()).toEqual({ etat: "deja_presentes" });
  });
});

describe("GET /api/admin/acquisition/attribution", () => {
  it("refuse sans x-admin-key, comme les autres routes admin", async () => {
    const r = await request(app).get("/api/admin/acquisition/attribution?from=2001-03-01&to=2001-03-02");
    expect(r.status).toBe(403);
  });

  it("cle restreinte x-attribution-key : lit les agregats, rien d'autre ; absente ou egale a ADMIN_KEY refusee", async () => {
    const CLE = "attribution-export-key-for-tests-at-least-32-chars";
    const avant = process.env["ATTRIBUTION_EXPORT_KEY"];
    try {
      delete process.env["ATTRIBUTION_EXPORT_KEY"];
      const sans = await request(app).get("/api/admin/acquisition/attribution?from=2001-03-01&to=2001-03-02").set("x-attribution-key", CLE);
      expect(sans.status).toBe(503);
      process.env["ATTRIBUTION_EXPORT_KEY"] = ADMIN;
      const egale = await request(app).get("/api/admin/acquisition/attribution?from=2001-03-01&to=2001-03-02").set("x-attribution-key", ADMIN);
      expect(egale.status).toBe(503);
      process.env["ATTRIBUTION_EXPORT_KEY"] = CLE;
      const fausse = await request(app).get("/api/admin/acquisition/attribution?from=2001-03-01&to=2001-03-02").set("x-attribution-key", `${CLE}x`);
      expect(fausse.status).toBe(403);
      const bonne = await request(app).get("/api/admin/acquisition/attribution?from=2001-03-01&to=2001-03-02").set("x-attribution-key", CLE);
      expect([200, 500]).toContain(bonne.status); // 500 seulement sans base de test ; jamais 401/403
      // La cle restreinte n'ouvre aucune autre route admin.
      const autre = await request(app).get("/api/admin/stats").set("x-attribution-key", CLE);
      expect([403, 404]).toContain(autre.status);
    } finally {
      if (avant === undefined) delete process.env["ATTRIBUTION_EXPORT_KEY"]; else process.env["ATTRIBUTION_EXPORT_KEY"] = avant;
    }
  });

  it("valide from/to (obligatoires, dates reelles, ordre, 400 jours max)", async () => {
    for (const q of ["", "?from=2001-03-01", "?from=2001-02-30&to=2001-03-01", "?from=2001-03-02&to=2001-03-01",
                     "?from=2001-01-01&to=2002-02-05"]) {
      const r = await request(app).get(`/api/admin/acquisition/attribution${q}`).set("x-admin-key", ADMIN);
      expect(r.status, q).toBe(400);
    }
  });

  it("agrege par jour UTC x etape x source x campagne, sans identifiant", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const [a, b, c] = [visiteur(), visiteur(), visiteur()];
    const ins = (etape: string, v: string | null, at: string, campagne: string | null, org: string | null = null) =>
      pool.query(
        `INSERT INTO funnel_events (etape, visiteur_id, org_ref, source, utm_source, utm_medium, utm_campaign, created_at)
         VALUES ($1, $2, $3, 'social', 'instagram', 'social', $4, $5)`,
        [etape, v, org, campagne, at]);
    await ins("landing_vue", a, "2001-03-01T23:30:00Z", CAMPAGNE_TEST);
    await ins("landing_vue", a, "2001-03-01T10:00:00Z", CAMPAGNE_TEST);   // meme visiteur
    await ins("landing_vue", b, "2001-03-01T09:00:00Z", CAMPAGNE_TEST);
    await ins("landing_vue", c, "2001-03-02T00:30:00Z", CAMPAGNE_TEST);   // jour UTC suivant
    await ins("signup_form_completed", a, "2001-03-01T23:40:00Z", CAMPAGNE_TEST);
    await ins("trial_activated", a, "2001-03-02T08:00:00Z", CAMPAGNE_TEST, "org-secret-ref");
    await ins("subscription_activated", null, "2001-03-02T09:00:00Z", CAMPAGNE_TEST, "org-secret-ref");
    await ins("landing_vue", c, "2001-03-03T00:30:00Z", CAMPAGNE_TEST);   // hors plage
    // Visiteur de test (convention fp-test-, exclue comme dans la surveillance Conversion B) : jamais compte.
    const testeur = `fp-test-${Date.now().toString(36)}-utmagg`;
    await ins("landing_vue", testeur, "2001-03-01T12:00:00Z", CAMPAGNE_TEST);

    const r = await request(app)
      .get("/api/admin/acquisition/attribution?from=2001-03-01&to=2001-03-02")
      .set("x-admin-key", ADMIN);
    expect(r.status).toBe(200);
    expect(Object.keys(r.body).sort()).toEqual(["au", "du", "genereLe", "lignes"]);
    expect(r.body.du).toBe("2001-03-01");
    expect(r.body.au).toBe("2001-03-02");
    expect(new Date(r.body.genereLe).toISOString()).toBe(r.body.genereLe);

    const lignes = (r.body.lignes as Array<Record<string, unknown>>).filter((l) => l["utm_campaign"] === CAMPAGNE_TEST);
    const cle = { source: "social", utm_source: "instagram", utm_medium: "social", utm_campaign: CAMPAGNE_TEST };
    expect(lignes).toEqual([
      { jour: "2001-03-01", etape: "landing_vue", ...cle, evenements: 3, visiteurs: 2 },
      { jour: "2001-03-01", etape: "signup_form_completed", ...cle, evenements: 1, visiteurs: 1 },
      { jour: "2001-03-02", etape: "landing_vue", ...cle, evenements: 1, visiteurs: 1 },
      { jour: "2001-03-02", etape: "trial_activated", ...cle, evenements: 1, visiteurs: 1 },
      { jour: "2001-03-02", etape: "subscription_activated", ...cle, evenements: 1, visiteurs: 0 },
    ]);
    for (const l of r.body.lignes as Array<Record<string, unknown>>) {
      expect(Object.keys(l).sort()).toEqual(
        ["etape", "evenements", "jour", "source", "utm_campaign", "utm_medium", "utm_source", "visiteurs"]);
    }
    const brut = JSON.stringify(r.body);
    for (const id of [a, b, c, "org-secret-ref", "fp-utmtest-"]) expect(brut).not.toContain(id);
    expect(brut).not.toMatch(/@/);
    await pool.query(`DELETE FROM funnel_events WHERE visiteur_id = $1`, [testeur]);
  });
});
