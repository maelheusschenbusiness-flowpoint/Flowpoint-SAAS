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
const FP_LID_BOT = randomBytes(16).toString("base64url");
const FP_LID_H = randomBytes(16).toString("base64url");
const CAMPAGNE = `ci_${randomBytes(6).toString("hex")}`;
const CHROME = {
  "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
  "accept-language": "fr-FR,fr;q=0.9",
};

beforeAll(async () => {
  try { await pool.query("SELECT bot_suspect FROM funnel_events LIMIT 0"); dbOk = true; } catch { dbOk = false; }
  process.env["FP_EMAIL_CLICK_TRACKING"] = "on";
  process.env["FP_EMAIL_VISIT_BEACON"] = "on";
  process.env["FP_GO_CAMPAIGNS"] = `clients_fr_be,${CAMPAGNE}`;
  const { default: routeur } = await import("./email-click.js");
  app = express();
  app.use(express.json());
  app.use(routeur);
});

afterAll(async () => {
  delete process.env["FP_EMAIL_CLICK_TRACKING"];
  delete process.env["FP_EMAIL_VISIT_BEACON"];
  delete process.env["FP_GO_CAMPAIGNS"];
  if (dbOk) {
    const { empreinteLead } = await import("../lib/email-click.js");
    await pool.query(`DELETE FROM funnel_events WHERE visiteur_id = ANY($1) OR cle_idempotence LIKE 'ci-purge:%'`,
      [[FP_LID, FP_LID_BOT, FP_LID_H].map((l) => `lid-${empreinteLead(l)}`)]).catch(() => undefined);
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

  it("humain probable = clic non suspect suivi d'une visite navigateur ; un scanner seul n'en est pas un", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const lien = (lid: string) => `/go?fp_lid=${lid}&utm_source=smartlead&utm_medium=email&utm_campaign=${CAMPAGNE}`;
    const go = await request(app).get(lien(FP_LID_H)).set(CHROME);
    expect(String(go.headers["location"])).toContain("fp_v=1");
    expect((await request(app).post("/api/public/email-visit").send({ fp_lid: FP_LID_H })).status).toBe(204);
    expect((await request(app).post("/api/public/email-visit").send({ fp_lid: FP_LID_H })).status).toBe(204);
    // Un scanner : HEAD puis GET sans langue, et aucune visite navigateur.
    await request(app).head(lien(FP_LID_BOT)).set(CHROME);
    await request(app).get(lien(FP_LID_BOT)).set("user-agent", CHROME["user-agent"]);

    const { statistiquesClicsEmail } = await import("../services/funnel-events.js");
    const s = await statistiquesClicsEmail(new Date(Date.now() - 3600_000), new Date(Date.now() + 3600_000), CAMPAGNE);
    expect(s).toEqual({ clics: 2, clics_bot_suspect: 1, clics_non_suspects: 1, humains_probables: 1, visites: 1 });
  });

  it("la purge supprime l'attribution email de plus de 13 mois, et rien d'autre", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const id = randomBytes(6).toString("hex");
    await pool.query(`INSERT INTO funnel_events (etape, source, cle_idempotence, created_at) VALUES
      ('email_clic', 'smartlead', $1, now() - interval '14 months'),
      ('email_visite', 'smartlead', $2, now() - interval '14 months'),
      ('email_clic', 'smartlead', $3, now() - interval '12 months'),
      ('landing_vue', 'direct', $4, now() - interval '14 months')`,
      [`ci-purge:${id}:a`, `ci-purge:${id}:b`, `ci-purge:${id}:c`, `ci-purge:${id}:d`]);
    const { purgerAttributionEmail } = await import("../services/funnel-events.js");
    expect(await purgerAttributionEmail()).toBeGreaterThanOrEqual(2);
    const r = await pool.query<{ cle_idempotence: string }>(
      `SELECT cle_idempotence FROM funnel_events WHERE cle_idempotence LIKE $1 ORDER BY 1`, [`ci-purge:${id}:%`]);
    expect(r.rows.map((x) => x.cle_idempotence)).toEqual([`ci-purge:${id}:c`, `ci-purge:${id}:d`]);
  });
});
