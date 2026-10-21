/**
 * conversion-outbox-funnel-db.test.ts — le site vitrine, la route publique et la
 * file durable ensemble, sur une vraie base.
 *
 * Le parcours exact d'une visite Smartlead : `flowpoint.pro` envoie
 * `landing_vue` avec son `fp_lid` pendant qu'AI Lab dort. Ce qui est verrouille
 * ici : l'etape est enregistree, le jalon attend en base avec l'horodatage de
 * la ligne `funnel_events`, il part au reveil avec ce meme horodatage, et un
 * rechargement ne cree ni ligne ni envoi de plus.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterEach, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { processConversionOutboxOnce } from "./conversion-outbox.js";

const SECRET = "conversion-test-secret-at-least-32-characters";
const FP_LID = "TestLeadFp_0000000004D";
const VISITEUR = `fp-test${randomUUID().replaceAll("-", "").slice(0, 12)}-site`;
let dbOk = false;
let app: express.Express;
let reponse: number | "panne" = "panne";
let appels: Record<string, unknown>[] = [];

beforeAll(async () => {
  try { await pool.query("SELECT 1 FROM funnel_events LIMIT 1"); dbOk = true; } catch { dbOk = false; }
  const { default: routeur } = await import("../routes/public-billing.js");
  app = express();
  app.use(express.json(), cookieParser());
  app.use("/api", routeur);
});

beforeEach(() => {
  appels = [];
  process.env["AI_LAB_CONVERSION_URL"] = "https://ai-lab.internal/events/conversion";
  process.env["CONVERSION_EVENT_SECRET"] = SECRET;
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    appels.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    if (reponse === "panne") throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    return new Response(JSON.stringify({ recorded: true, duplicate: false }), { status: reponse });
  });
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  delete process.env["AI_LAB_CONVERSION_URL"];
  delete process.env["CONVERSION_EVENT_SECRET"];
  if (!dbOk) return;
  await pool.query(`DELETE FROM conversion_event_outbox WHERE event_id LIKE 'marketing:visit:%'
    AND occurred_at IN (SELECT date_trunc('milliseconds', created_at) FROM funnel_events WHERE visiteur_id = $1)`, [VISITEUR])
    .catch(() => undefined);
  await pool.query(`DELETE FROM funnel_events WHERE visiteur_id = $1`, [VISITEUR]).catch(() => undefined);
});

const visite = () => request(app).post("/api/public/funnel-event").set("Origin", "https://flowpoint.pro")
  .send({ etape: "landing_vue", visiteurId: VISITEUR, source: "smartlead", consentement: "accepted",
    fp_lid: FP_LID });

describe("une visite Smartlead pendant le sommeil d'AI Lab", () => {
  it("est enregistree, attend en base, puis part au reveil avec le meme horodatage", async (ctx) => {
    if (!dbOk) return ctx.skip();
    reponse = "panne";
    expect((await visite()).status).toBe(204);
    // L'emission est detachee de la reponse : on attend qu'elle ait laisse sa trace.
    let ligne: Record<string, unknown> | undefined;
    for (let i = 0; i < 50 && !ligne?.["attempts"]; i++) {
      await new Promise((r) => setTimeout(r, 20));
      // `occurredAt` est en ISO 8601, a la milliseconde ; `created_at` a la microseconde.
      const r = await pool.query(`SELECT o.*, f.created_at AS etape_at
          FROM conversion_event_outbox o JOIN funnel_events f ON f.visiteur_id = $1
         WHERE o.event_id LIKE 'marketing:visit:%'
           AND o.occurred_at = date_trunc('milliseconds', f.created_at)`, [VISITEUR]);
      ligne = r.rows[0];
    }
    expect(ligne).toMatchObject({ status: "pending", stage: "visit", source: "marketing", fp_lid: FP_LID,
      attempts: 1 });
    const enBase = (ligne!["etape_at"] as Date).toISOString();
    expect(appels[0]?.["occurred_at"]).toBe(enBase);

    // Le reveil : la ligne est due, le worker la livre avec le meme corps.
    reponse = 202;
    await pool.query(`UPDATE conversion_event_outbox SET next_attempt_at = now() WHERE event_id = $1`,
      [ligne!["event_id"]]);
    await processConversionOutboxOnce();
    const apres = await pool.query(`SELECT status, fp_lid, attempts FROM conversion_event_outbox
      WHERE event_id = $1`, [ligne!["event_id"]]);
    expect(apres.rows[0]).toMatchObject({ status: "delivered", fp_lid: null, attempts: 2 });
    expect(appels).toHaveLength(2);
    expect(appels[1]).toEqual(appels[0]);

    // Un rechargement le meme jour : ni ligne, ni envoi de plus.
    expect((await visite()).status).toBe(204);
    await new Promise((r) => setTimeout(r, 100));
    const n = await pool.query(`SELECT count(*)::int n FROM funnel_events WHERE visiteur_id = $1`, [VISITEUR]);
    expect(n.rows[0].n).toBe(1);
    expect(appels).toHaveLength(2);
  });
});
