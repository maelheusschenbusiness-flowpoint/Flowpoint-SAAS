/**
 * funnel-endpoint-db.test.ts
 *
 * Le point d'entree que le site vitrine utilisera. Il existe parce que
 * `flowpoint.pro` n'est PAS dans ce depot : verifie le 18/10/2026, aucune de
 * ses pages n'y figure, il est servi depuis Google Cloud. Sans ce point
 * d'entree, les etapes vues par le navigateur resteraient non mesurables.
 *
 * Ce qui est verrouille ici : une etape qui engage de l'argent ne peut jamais
 * etre declaree depuis un navigateur, et un rechargement de page ne gonfle pas
 * les chiffres.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) =>
  importOriginal<typeof import("@workspace/db")>()
);
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";

const VISITEUR = `fp-test-${randomUUID().replaceAll("-", "")}`;
let app: express.Express;
let dbOk = false;

beforeAll(async () => {
  try { await pool.query("SELECT 1"); dbOk = true; } catch { dbOk = false; }
  const { default: routeur } = await import("./public-billing.js");
  app = express();
  app.use(express.json(), cookieParser());
  app.use("/api", routeur);
});

beforeEach(async () => {
  if (!dbOk) return;
  await pool.query(`DELETE FROM funnel_events WHERE visiteur_id LIKE 'fp-test-%'`).catch(() => undefined);
});

afterAll(async () => {
  if (!dbOk) return;
  await pool.query(`DELETE FROM funnel_events WHERE visiteur_id LIKE 'fp-test-%'`).catch(() => undefined);
});

async function compter(visiteur: string): Promise<number> {
  const r = await pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM funnel_events WHERE visiteur_id = $1`, [visiteur]);
  return r.rows[0]?.n ?? 0;
}

describe("POST /api/public/funnel-event", () => {
  it("accepte une etape navigateur et ne renvoie aucune information", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const r = await request(app).post("/api/public/funnel-event")
      .set("Cookie", "fp_analytics_consent=accepted")
      .send({ etape: "landing_vue", visiteurId: VISITEUR, source: "smartlead" });
    expect(r.status).toBe(204);
    expect(r.text).toBe("");          // rien ne fuit, pas meme un compteur
    expect(await compter(VISITEUR)).toBe(1);
  });

  it("accepte le fp_lid opaque sur une visite marketing sans le stocker", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const fpLid = "TestLeadFp_0000000001A";
    const visiteur = `fp-test-${randomUUID().replaceAll("-", "")}`;
    const r = await request(app).post("/api/public/funnel-event")
      .set("Cookie", "fp_analytics_consent=accepted")
      .send({ etape: "landing_vue", visiteurId: visiteur, source: "smartlead", fp_lid: fpLid });
    expect(r.status).toBe(204);
    const stored = await pool.query(
      `SELECT * FROM funnel_events WHERE visiteur_id = $1`, [visiteur]);
    expect(JSON.stringify(stored.rows)).not.toContain(fpLid);
  });

  it("n'enregistre aucun visiteur sans consentement accepté", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const r = await request(app).post("/api/public/funnel-event")
      .send({ etape: "landing_vue", visiteurId: VISITEUR, source: "smartlead" });
    expect(r.status).toBe(204);
    expect(await compter(VISITEUR)).toBe(0);
  });

  it("UNE ETAPE QUI ENGAGE DE L'ARGENT EST REFUSEE depuis le navigateur", async (ctx) => {
    if (!dbOk) return ctx.skip();
    for (const etape of ["subscription_activated", "trial_activated", "checkout_completed"]) {
      const r = await request(app).post("/api/public/funnel-event")
        .send({ etape, visiteurId: VISITEUR });
      expect(r.status, `${etape} a ete accepte`).toBe(400);
    }
    expect(await compter(VISITEUR)).toBe(0);
  });

  it("une etape inventee est refusee", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const r = await request(app).post("/api/public/funnel-event")
      .send({ etape: "etape_inventee", visiteurId: VISITEUR });
    expect(r.status).toBe(400);
  });

  it("l'identifiant de visiteur est exige", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const r = await request(app).post("/api/public/funnel-event").send({ etape: "landing_vue" });
    expect(r.status).toBe(400);
  });

  it("UN RECHARGEMENT DE PAGE NE GONFLE PAS LES CHIFFRES", async (ctx) => {
    if (!dbOk) return ctx.skip();
    for (let i = 0; i < 4; i++) {
      await request(app).post("/api/public/funnel-event")
        .set("Cookie", "fp_analytics_consent=accepted")
        .send({ etape: "tarifs_vus", visiteurId: VISITEUR });
    }
    expect(await compter(VISITEUR)).toBe(1);   // idempotence par visiteur/etape/jour
  });
});

describe("Conversion B — jalons navigateur transmis a AI Lab", () => {
  const SECRET = "conversion-test-secret-at-least-32-characters";
  const FP_LID = "TestLeadFp_0000000002B";
  let envoyes: Record<string, unknown>[] = [];

  beforeEach(() => {
    envoyes = [];
    process.env["AI_LAB_CONVERSION_URL"] = "https://ai-lab.internal/events/conversion";
    process.env["CONVERSION_EVENT_SECRET"] = SECRET;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      envoyes.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ recorded: true, duplicate: false }), { status: 202 });
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    delete process.env["AI_LAB_CONVERSION_URL"];
    delete process.env["CONVERSION_EVENT_SECRET"];
  });

  const attendreEnvoi = async () => {
    for (let i = 0; i < 50 && envoyes.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  };

  for (const [etape, stage, source] of [
    ["landing_vue", "visit", "marketing"],
    ["signup_started", "signup_page", "saas"],
    ["signup_form_engaged", "signup_started", "saas"],
  ] as const) it(`${etape} devient le jalon ${stage} prouve par ${source}`, async (ctx) => {
    if (!dbOk) return ctx.skip();
    const visiteur = `fp-test-${randomUUID().replaceAll("-", "")}`;
    const r = await request(app).post("/api/public/funnel-event")
      .set("Cookie", "fp_analytics_consent=accepted")
      .send({ etape, visiteurId: visiteur, source: "smartlead", fp_lid: FP_LID });
    expect(r.status).toBe(204);
    await attendreEnvoi();
    expect(envoyes).toHaveLength(1);
    expect(envoyes[0]).toMatchObject({ stage, source, fp_lid: FP_LID });
  });

  it("les autres etapes navigateur ne produisent aucun jalon", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const visiteur = `fp-test-${randomUUID().replaceAll("-", "")}`;
    await request(app).post("/api/public/funnel-event")
      .set("Cookie", "fp_analytics_consent=accepted")
      .send({ etape: "tarifs_vus", visiteurId: visiteur, fp_lid: FP_LID });
    await new Promise((r) => setTimeout(r, 50));
    expect(envoyes).toHaveLength(0);
  });

  it("le site vitrine, sans cookie, peut declarer un consentement accepte", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const visiteur = `fp-test-${randomUUID().replaceAll("-", "")}`;
    await request(app).post("/api/public/funnel-event")
      .send({ etape: "landing_vue", visiteurId: visiteur, consentement: "accepted", fp_lid: FP_LID });
    expect(await compter(visiteur)).toBe(1);
    await attendreEnvoi();
    expect(envoyes[0]).toMatchObject({ stage: "visit", source: "marketing" });
  });

  it("un consentement declare autrement qu'accepte ne produit rien", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const visiteur = `fp-test-${randomUUID().replaceAll("-", "")}`;
    await request(app).post("/api/public/funnel-event")
      .send({ etape: "landing_vue", visiteurId: visiteur, consentement: "refused", fp_lid: FP_LID });
    expect(await compter(visiteur)).toBe(0);
    expect(envoyes).toHaveLength(0);
  });

  it("un refus porte par le cookie l'emporte sur le corps de la requete", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const visiteur = `fp-test-${randomUUID().replaceAll("-", "")}`;
    await request(app).post("/api/public/funnel-event")
      .set("Cookie", "fp_analytics_consent=refused")
      .send({ etape: "landing_vue", visiteurId: visiteur, consentement: "accepted", fp_lid: FP_LID });
    expect(await compter(visiteur)).toBe(0);
    expect(envoyes).toHaveLength(0);
  });
});
