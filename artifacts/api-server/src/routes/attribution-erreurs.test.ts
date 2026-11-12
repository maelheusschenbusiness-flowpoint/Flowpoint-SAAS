/**
 * GET /api/admin/acquisition/attribution : chaque famille d'echec a sa reponse, pour
 * qu'AI Lab distingue authentification, schema et erreur interne (HTTP 500 du 29/10).
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("@workspace/db", () => ({
  pool: { query: (...a: unknown[]) => query(...a), connect: vi.fn() },
  withOrgDb: vi.fn(),
}));
const logs = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: logs.error, debug: vi.fn(), fatal: vi.fn() },
}));

import express from "express";
import request from "supertest";

const CLE = "attribution-erreurs-cle-de-test-32-caracteres-min";
const URL = "/api/admin/acquisition/attribution?from=2026-10-01&to=2026-10-29";
let app: express.Express;

beforeAll(async () => {
  process.env["ADMIN_KEY"] = "attribution-erreurs-admin-differente-32-caracteres";
  process.env["ATTRIBUTION_EXPORT_KEY"] = CLE;
  const { default: adminRouter } = await import("./admin.js");
  app = express();
  app.use("/api", adminRouter);
});
beforeEach(() => { query.mockReset(); logs.error.mockReset(); });

describe("attribution : reponses d'echec distinctes", () => {
  it("colonnes UTM absentes (42703) : 503 schema_utm_absent, cause journalisee sans la cle", async () => {
    query.mockRejectedValue(Object.assign(new Error('column "utm_source" does not exist'), { code: "42703" }));
    const r = await request(app).get(URL).set("x-attribution-key", CLE);
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, code: "schema_utm_absent" });
    expect(logs.error).toHaveBeenCalledOnce();
    expect(JSON.stringify(logs.error.mock.calls)).toContain("42703");
    expect(JSON.stringify(logs.error.mock.calls)).not.toContain(CLE);
  });

  it("autre erreur SQL : 500 erreur_interne, message assaini", async () => {
    query.mockRejectedValue(Object.assign(new Error("connection terminated"), { code: "57P01" }));
    const r = await request(app).get(URL).set("x-attribution-key", CLE);
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ ok: false, code: "erreur_interne" });
  });

  it("mauvaise cle : 403 sans toucher a la base", async () => {
    const r = await request(app).get(URL).set("x-attribution-key", `${CLE}x`);
    expect(r.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("succes : contrat inchange", async () => {
    query.mockResolvedValue({ rows: [] });
    const r = await request(app).get(URL).set("x-attribution-key", CLE);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ du: "2026-10-01", au: "2026-10-29", lignes: [] });
  });
});
