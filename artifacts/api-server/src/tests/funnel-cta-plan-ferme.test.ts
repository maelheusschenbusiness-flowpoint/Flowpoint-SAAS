/**
 * D9 : le plan de `cta_clique` est une liste fermee, et la cle d'idempotence
 * du jour inclut le plan (deux plans cliques le meme jour = deux clics).
 */
import { vi, describe, it, expect, beforeAll, beforeEach } from "vitest";

const etapes = vi.hoisted(() => [] as Array<Record<string, unknown>>);
vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));
vi.mock("../services/funnel-events.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../services/funnel-events.js")>();
  return { ...mod, enregistrerEtape: vi.fn(async (e: Record<string, unknown>) => { etapes.push(e); return true; }) };
});

import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { normaliserPlanFunnel } from "../services/funnel-events.js";

let app: express.Express;
beforeAll(async () => {
  const { default: routeur } = await import("../routes/public-billing.js");
  app = express();
  app.use(express.json(), cookieParser());
  app.use("/api", routeur);
});
beforeEach(() => { etapes.length = 0; });

const envoyer = (corps: Record<string, unknown>) =>
  request(app).post("/api/public/funnel-event").set("Cookie", "fp_analytics_consent=accepted")
    .send({ etape: "cta_clique", visiteurId: "fp-test-d9", source: "direct", ...corps });

describe("normaliserPlanFunnel", () => {
  it("ne garde que standard|pro|ultra", () => {
    expect(normaliserPlanFunnel("pro")).toBe("pro");
    expect(normaliserPlanFunnel(" ULTRA ")).toBe("ultra");
    for (const v of ["enterprise", "pro; DROP", "x".repeat(120), "", 5, null, undefined, {}, ["pro"]]) {
      expect(normaliserPlanFunnel(v)).toBeNull();
    }
  });
});

describe("POST /api/public/funnel-event cta_clique", () => {
  it("un plan libre est ecarte, la reponse reste 204", async () => {
    const r = await envoyer({ plan: "n'importe quoi de tres long".repeat(5) });
    expect(r.status).toBe(204);
    expect(etapes).toHaveLength(1);
    expect(etapes[0]!["plan"]).toBeNull();
  });

  it("un plan valide est conserve", async () => {
    expect((await envoyer({ plan: "Pro" })).status).toBe(204);
    expect(etapes[0]!["plan"]).toBe("pro");
  });

  it("deux plans differents le meme jour ont deux cles distinctes", async () => {
    await envoyer({ plan: "standard" });
    await envoyer({ plan: "ultra" });
    const cles = etapes.map((e) => e["cleIdempotence"]);
    expect(new Set(cles).size).toBe(2);
    expect(cles[0]).toContain("standard");
    expect(cles[1]).toContain("ultra");
  });

  it("le meme plan repete le meme jour garde la meme cle (dedoublonnage)", async () => {
    await envoyer({ plan: "pro" });
    await envoyer({ plan: "pro" });
    expect(etapes[0]!["cleIdempotence"]).toBe(etapes[1]!["cleIdempotence"]);
  });

  it("les autres etapes gardent leur cle sans plan", async () => {
    await envoyer({ etape: "tarifs_vus", plan: "pro" });
    expect(String(etapes[0]!["cleIdempotence"])).toMatch(/^tarifs_vus:fp-test-d9:\d{4}-\d{2}-\d{2}$/);
  });
});
