/**
 * Attribution Smartlead — `GET /go` contre un vrai PostgreSQL (CI), apres la
 * migration 020 : une ligne par lead, par jour et par categorie ; aucune
 * donnee personnelle en base. Ignore sans base (poste local).
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import express from "express";
import request from "supertest";
import { pool } from "@workspace/db";
import { randomBytes } from "node:crypto";

let app: express.Express;
let dbOk = false;
const FP_LID = randomBytes(16).toString("base64url"); // 22 caracteres, comme l'acquisition engine
const CHROME = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
  "accept-language": "fr-FR,fr;q=0.9",
};

beforeAll(async () => {
  try { await pool.query("SELECT bot_suspect FROM funnel_events LIMIT 0"); dbOk = true; } catch { dbOk = false; }
  process.env["FP_EMAIL_CLICK_TRACKING"] = "on";
  const { default: routeur } = await import("./email-click.js");
  app = express();
  app.use(routeur);
});

afterAll(async () => {
  delete process.env["FP_EMAIL_CLICK_TRACKING"];
  if (dbOk) {
    const { empreinteLead } = await import("../lib/email-click.js");
    await pool.query(`DELETE FROM funnel_events WHERE visiteur_id = $1`, [`lid-${empreinteLead(FP_LID)}`]).catch(() => undefined);
  }
});

describe("GET /go — ecriture reelle", () => {
  it("un clic humain, rejoue, puis une verification HEAD : deux lignes, sans donnee personnelle", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const lien = `/go?fp_lid=${FP_LID}&utm_source=smartlead&utm_medium=email&utm_campaign=clients_fr_be&utm_content=v1`;
    for (let i = 0; i < 3; i++) expect((await request(app).get(lien).set(CHROME)).status).toBe(302);
    expect((await request(app).head(lien).set(CHROME)).status).toBe(302);

    const { empreinteLead } = await import("../lib/email-click.js");
    const r = await pool.query(
      `SELECT etape, source, campagne, variante, bot_suspect, visiteur_id, org_ref, plan, cle_idempotence
         FROM funnel_events WHERE visiteur_id = $1 ORDER BY bot_suspect`, [`lid-${empreinteLead(FP_LID)}`]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows.map((x) => x.bot_suspect)).toEqual([false, true]);
    for (const row of r.rows) {
      expect(row).toMatchObject({ etape: "email_clic", source: "smartlead", campagne: "clients_fr_be", variante: "v1", org_ref: null, plan: null });
      expect(JSON.stringify(row)).not.toContain(FP_LID);
    }
  });
});
