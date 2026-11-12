import express from "express";
import request from "supertest";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ poolQuery: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { query: mocks.poolQuery } }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
import router from "./admin-conversion.js";

const KEY = "k".repeat(40);
const app = () => { const a = express(); a.use("/api", router); return a; };
const Q = "?from=2026-03-01&to=2026-03-31";

describe("routes /admin/conversion/*", () => {
  beforeEach(() => { vi.clearAllMocks(); process.env["ADMIN_KEY"] = KEY; mocks.poolQuery.mockResolvedValue({ rows: [] }); });
  afterEach(() => { delete process.env["ADMIN_KEY"]; });

  for (const view of ["global", "outbound"]) {
    it(`${view} : 403 sans clé, 403 avec une mauvaise clé, aucune requête SQL`, async () => {
      expect((await request(app()).get(`/api/admin/conversion/${view}${Q}`)).status).toBe(403);
      expect((await request(app()).get(`/api/admin/conversion/${view}${Q}`).set("x-admin-key", "x".repeat(40))).status).toBe(403);
      expect(mocks.poolQuery).not.toHaveBeenCalled();
    });
    it(`${view} : 503 si ADMIN_KEY est absente ou trop courte`, async () => {
      process.env["ADMIN_KEY"] = "short";
      expect((await request(app()).get(`/api/admin/conversion/${view}${Q}`).set("x-admin-key", "short")).status).toBe(503);
    });
    it(`${view} : 400 sur fenêtre invalide`, async () => {
      for (const q of ["", "?from=2026-03-01", "?from=2026-03-31&to=2026-03-01", "?from=2020-01-01&to=2026-12-31"]) {
        expect((await request(app()).get(`/api/admin/conversion/${view}${q}`).set("x-admin-key", KEY)).status).toBe(400);
      }
    });
    it(`${view} : 200, non mis en cache, définitions présentes`, async () => {
      const r = await request(app()).get(`/api/admin/conversion/${view}${Q}`).set("x-admin-key", KEY);
      expect(r.status).toBe(200);
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.body.stages.length).toBe(8);
      expect(r.body.stages.every((s: { definition: string }) => s.definition.length > 10)).toBe(true);
      expect(r.body.stages.find((s: { key: string }) => s.key === "cta_clique").definition).toContain("n'est pas une conversion");
    });
  }
  it("503 explicite (jamais des zéros) quand la base échoue", async () => {
    mocks.poolQuery.mockRejectedValue(new Error("db down"));
    const r = await request(app()).get(`/api/admin/conversion/global${Q}`).set("x-admin-key", KEY);
    expect(r.status).toBe(503);
    expect(r.body.stages).toBeUndefined();
  });
  it("outbound : file absente = not_initialized, autre erreur = unavailable, le reste reste servi", async () => {
    mocks.poolQuery.mockImplementation(async (sql: string) => {
      if (String(sql).includes("conversion_event_outbox")) throw Object.assign(new Error("x"), { code: "42P01" });
      return { rows: [] };
    });
    const r = await request(app()).get(`/api/admin/conversion/outbound${Q}`).set("x-admin-key", KEY);
    expect(r.status).toBe(200);
    expect(r.body.delivery).toEqual({ status: "not_initialized" });
  });
});
