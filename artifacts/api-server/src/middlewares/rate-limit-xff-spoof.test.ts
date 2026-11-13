import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { authRateLimit, createIpRateLimit } from "./rateLimiter.js";

/**
 * Audit C-06 : X-Forwarded-For est controle par le client. Avec `trust proxy 1`
 * (comme app.ts), seule l'entree ajoutee par le proxy de confiance (la plus a
 * droite) compte. Ces tests simulent le proxy en ajoutant l'adresse reelle en
 * fin de chaine, apres un prefixe forge par l'appelant.
 */
function buildApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.post("/auth", authRateLimit, (_req, res) => res.json({ ok: true }));
  app.post("/ip", createIpRateLimit("xff_spoof_test", 3, 60_000), (_req, res) => res.json({ ok: true }));
  return app;
}

describe("limiteurs de debit : X-Forwarded-For forge ne contourne plus la limite (C-06)", () => {
  it("authRateLimit : 10 tentatives puis 429, meme en changeant le prefixe forge", async () => {
    const app = buildApp();
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await request(app).post("/auth").set("X-Forwarded-For", `10.9.8.${i}, 203.0.113.7`);
      codes.push(r.status);
    }
    expect(codes.slice(0, 10).every((c) => c === 200)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });

  it("createIpRateLimit : meme comportement", async () => {
    const app = buildApp();
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await request(app).post("/ip").set("X-Forwarded-For", `172.16.0.${i}, 198.51.100.4`);
      codes.push(r.status);
    }
    expect(codes).toEqual([200, 200, 200, 429, 429]);
  });

  it("deux vrais clients distincts (entree du proxy differente) ont chacun leur compteur", async () => {
    const app = buildApp();
    for (let i = 0; i < 3; i++) await request(app).post("/ip").set("X-Forwarded-For", "198.51.100.50");
    const other = await request(app).post("/ip").set("X-Forwarded-For", "198.51.100.51");
    expect(other.status).toBe(200);
  });
});
