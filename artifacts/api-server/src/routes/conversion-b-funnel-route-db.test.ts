/**
 * Conversion B — les etapes navigateur qui deviennent un jalon AI Lab, et le
 * consentement declare par le site vitrine (porte depuis Test-Replit #218).
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";

const SECRET = "conversion-test-secret-at-least-32-characters";
const FP_LID = "TestLeadFp_0000000002B";
let app: express.Express;
let dbOk = false;
let envoyes: Record<string, unknown>[] = [];

beforeAll(async () => {
  try { await pool.query("SELECT 1"); dbOk = true; } catch { dbOk = false; }
  const { default: routeur } = await import("./public-billing.js");
  app = express();
  app.use(express.json(), cookieParser());
  app.use("/api", routeur);
});

beforeEach(() => {
  envoyes = [];
  process.env["AI_LAB_CONVERSION_URL"] = "https://ai-lab.internal/events/conversion";
  process.env["CONVERSION_EVENT_SECRET"] = SECRET;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    envoyes.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ recorded: true, duplicate: false }), { status: 202 });
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  delete process.env["AI_LAB_CONVERSION_URL"];
  delete process.env["CONVERSION_EVENT_SECRET"];
  if (!dbOk) return;
  await pool.query(`DELETE FROM funnel_events WHERE visiteur_id LIKE 'fp-test-%'`).catch(() => undefined);
  await pool.query(`DELETE FROM conversion_event_outbox WHERE stage IN ('visit','signup_page','signup_started')
    AND created_at > now() - interval '1 hour'`).catch(() => undefined);
});

const visiteur = () => `fp-test-${randomUUID().replaceAll("-", "")}`;
const attendreEnvoi = async () => {
  for (let i = 0; i < 50 && envoyes.length === 0; i++) await new Promise((r) => setTimeout(r, 10));
};
async function compter(v: string): Promise<number> {
  const r = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM funnel_events WHERE visiteur_id = $1`, [v]);
  return r.rows[0]?.n ?? 0;
}

describe("Conversion B — jalons navigateur transmis a AI Lab", () => {
  for (const [etape, stage, source] of [
    ["landing_vue", "visit", "marketing"],
    ["signup_started", "signup_page", "saas"],
    ["signup_form_engaged", "signup_started", "saas"],
  ] as const) it(`${etape} devient le jalon ${stage} prouve par ${source}`, async (ctx) => {
    if (!dbOk) return ctx.skip();
    const r = await request(app).post("/api/public/funnel-event")
      .set("Cookie", "fp_analytics_consent=accepted")
      .send({ etape, visiteurId: visiteur(), source: "smartlead", fp_lid: FP_LID });
    expect(r.status).toBe(204);
    await attendreEnvoi();
    expect(envoyes).toHaveLength(1);
    expect(envoyes[0]).toMatchObject({ stage, source, fp_lid: FP_LID });
  });

  it("les autres etapes navigateur ne produisent aucun jalon", async (ctx) => {
    if (!dbOk) return ctx.skip();
    await request(app).post("/api/public/funnel-event")
      .set("Cookie", "fp_analytics_consent=accepted")
      .send({ etape: "tarifs_vus", visiteurId: visiteur(), fp_lid: FP_LID });
    await new Promise((r) => setTimeout(r, 50));
    expect(envoyes).toHaveLength(0);
  });

  it("le site vitrine, sans cookie, peut declarer un consentement accepte", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const v = visiteur();
    await request(app).post("/api/public/funnel-event")
      .send({ etape: "landing_vue", visiteurId: v, consentement: "accepted", fp_lid: FP_LID });
    expect(await compter(v)).toBe(1);
    await attendreEnvoi();
    expect(envoyes[0]).toMatchObject({ stage: "visit", source: "marketing" });
  });

  it("transmet a AI Lab l'horodatage persiste de l'etape", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const v = visiteur();
    await request(app).post("/api/public/funnel-event")
      .set("Cookie", "fp_analytics_consent=accepted")
      .send({ etape: "landing_vue", visiteurId: v, fp_lid: FP_LID });
    await attendreEnvoi();

    const result = await pool.query<{ created_at: Date }>(
      `SELECT created_at FROM funnel_events WHERE visiteur_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [v],
    );
    expect(result.rows[0]?.created_at).toBeInstanceOf(Date);
    expect(envoyes[0]?.["occurred_at"]).toBe(result.rows[0]?.created_at.toISOString());
  });

  it("un consentement declare autrement qu'accepte ne produit rien", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const v = visiteur();
    await request(app).post("/api/public/funnel-event")
      .send({ etape: "landing_vue", visiteurId: v, consentement: "refused", fp_lid: FP_LID });
    expect(await compter(v)).toBe(0);
    expect(envoyes).toHaveLength(0);
  });

  it("un refus porte par le cookie l'emporte sur le corps de la requete", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const v = visiteur();
    await request(app).post("/api/public/funnel-event")
      .set("Cookie", "fp_analytics_consent=refused")
      .send({ etape: "landing_vue", visiteurId: v, consentement: "accepted", fp_lid: FP_LID });
    expect(await compter(v)).toBe(0);
    expect(envoyes).toHaveLength(0);
  });
});
