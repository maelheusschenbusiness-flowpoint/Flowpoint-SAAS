/** Les erreurs 4xx de body-parser (corps trop gros, JSON invalide) ne doivent pas devenir des 500. */
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/logger.js", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
import { errorHandler } from "./errorHandler.js";

const app = express();
app.use(express.json({ limit: "1kb" }));
app.post("/x", (_req, res) => { res.json({ ok: true }); });
app.get("/boom", () => { throw new Error("boom"); });
app.use(errorHandler);

describe("errorHandler — erreurs client body-parser", () => {
  it("corps trop volumineux -> 413 PAYLOAD_TOO_LARGE", async () => {
    const r = await request(app).post("/x").send({ a: "x".repeat(5000) });
    expect(r.status).toBe(413);
    expect(r.body.code).toBe("PAYLOAD_TOO_LARGE");
  });
  it("JSON invalide -> 400 BAD_REQUEST", async () => {
    const r = await request(app).post("/x").set("content-type", "application/json").send("{oops");
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("BAD_REQUEST");
  });
  it("une vraie erreur serveur reste 500", async () => {
    expect((await request(app).get("/boom")).status).toBe(500);
  });
});
