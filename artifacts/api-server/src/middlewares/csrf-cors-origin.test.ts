import { describe, expect, it, vi } from "vitest";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import request from "supertest";
import { buildAllowedOrigins, isOriginAllowed } from "../lib/cors-policy.js";
import { sessionCookieSameSite } from "../lib/session-cookie.js";
import { csrfOrigin } from "./csrfOrigin.js";

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const PROD = { NODE_ENV: "production" } as NodeJS.ProcessEnv;
const TEST_ENV = { NODE_ENV: "test" } as NodeJS.ProcessEnv;

function buildApp(env: NodeJS.ProcessEnv) {
  const allowed = buildAllowedOrigins(env);
  const app = express();
  app.set("trust proxy", 1);
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || isOriginAllowed(origin, allowed)),
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());
  app.use(csrfOrigin(allowed));
  app.post("/api/thing", (_req, res) => res.json({ ok: true }));
  app.get("/api/thing", (_req, res) => res.json({ ok: true }));
  app.post("/api/webhooks/stripe", (_req, res) => res.json({ received: true }));
  app.post("/api/billing/webhook", (_req, res) => res.json({ received: true }));
  return app;
}

describe("politique CORS par environnement (C-01)", () => {
  it("production : origines FlowPoint exactes uniquement", () => {
    const a = buildAllowedOrigins(PROD);
    expect(isOriginAllowed("https://app.flowpoint.pro", a)).toBe(true);
    expect(isOriginAllowed("https://evil.replit.dev", a)).toBe(false);
    expect(isOriginAllowed("https://evil.replit.app", a)).toBe(false);
    expect(isOriginAllowed("http://localhost:3000", a)).toBe(false);
    expect(isOriginAllowed("https://app.flowpoint.pro.evil.com", a)).toBe(false);
    expect(isOriginAllowed("https://evil.com", a)).toBe(false);
  });

  it("hors production : Replit et localhost restent acceptes, suffixes libres refuses", () => {
    const a = buildAllowedOrigins(TEST_ENV);
    expect(isOriginAllowed("https://x.y.replit.dev", a)).toBe(true);
    expect(isOriginAllowed("https://x.replit.app", a)).toBe(true);
    expect(isOriginAllowed("http://localhost:5173", a)).toBe(true);
    expect(isOriginAllowed("https://evilreplit.dev", a)).toBe(false);
    expect(isOriginAllowed("https://replit.dev.evil.com", a)).toBe(false);
  });

  it("les origines declarees en variables d'environnement sont normalisees et exactes", () => {
    const a = buildAllowedOrigins({
      NODE_ENV: "production",
      FRONTEND_URL: "https://front.example.com/path/, javascript:alert(1)",
    } as NodeJS.ProcessEnv);
    expect(isOriginAllowed("https://front.example.com", a)).toBe(true);
    expect(isOriginAllowed("https://front.example.com.evil.com", a)).toBe(false);
  });

  it("le cookie de session n'est plus SameSite=None", () => {
    expect(sessionCookieSameSite()).toBe("lax");
  });

  it("CORS reel : origine tierce sans Access-Control-Allow-Origin, origine legitime avec credentials", async () => {
    const app = buildApp(PROD);
    const bad = await request(app).get("/api/thing").set("Origin", "https://evil.replit.dev");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
    const good = await request(app).get("/api/thing").set("Origin", "https://app.flowpoint.pro");
    expect(good.headers["access-control-allow-origin"]).toBe("https://app.flowpoint.pro");
    expect(good.headers["access-control-allow-credentials"]).toBe("true");
  });
});

describe("controle Origin/Referer sur requetes non sures par cookie (C-01)", () => {
  const cookie = "fp_token=abc123";

  it("POST cookie + origine tierce : 403 CSRF_ORIGIN_REJECTED", async () => {
    const res = await request(buildApp(PROD)).post("/api/thing").set("Cookie", cookie).set("Origin", "https://evil.com").send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("CSRF_ORIGIN_REJECTED");
  });

  it("POST cookie + origine Replit en production : 403", async () => {
    const res = await request(buildApp(PROD)).post("/api/thing").set("Cookie", cookie).set("Origin", "https://x.replit.dev").send({});
    expect(res.status).toBe(403);
  });

  it("POST cookie + origine legitime : accepte", async () => {
    const res = await request(buildApp(PROD)).post("/api/thing").set("Cookie", cookie).set("Origin", "https://app.flowpoint.pro").send({});
    expect(res.status).toBe(200);
  });

  it("POST cookie same-origin (Origin == Host) : accepte", async () => {
    const res = await request(buildApp(PROD))
      .post("/api/thing").set("Cookie", cookie).set("Host", "mon-service.onrender.com")
      .set("X-Forwarded-Proto", "https").set("Origin", "https://mon-service.onrender.com").send({});
    expect(res.status).toBe(200);
  });

  it("POST cookie sans Origin ni Referer : 403", async () => {
    const res = await request(buildApp(PROD)).post("/api/thing").set("Cookie", cookie).send({});
    expect(res.status).toBe(403);
  });

  it("POST cookie sans Origin mais Referer legitime : accepte ; Referer tiers : 403", async () => {
    const app = buildApp(PROD);
    const ok = await request(app).post("/api/thing").set("Cookie", cookie).set("Referer", "https://app.flowpoint.pro/dashboard").send({});
    expect(ok.status).toBe(200);
    const ko = await request(app).post("/api/thing").set("Cookie", cookie).set("Referer", "https://evil.com/x").send({});
    expect(ko.status).toBe(403);
  });

  it("Origin: null (iframe sandbox) : 403", async () => {
    const res = await request(buildApp(PROD)).post("/api/thing").set("Cookie", cookie).set("Origin", "null").send({});
    expect(res.status).toBe(403);
  });

  it("GET avec cookie et origine tierce : non concerne par le controle", async () => {
    const res = await request(buildApp(PROD)).get("/api/thing").set("Cookie", cookie).set("Origin", "https://evil.com");
    expect(res.status).toBe(200);
  });

  it("POST sans cookie (endpoint public) : non concerne", async () => {
    const res = await request(buildApp(PROD)).post("/api/thing").set("Origin", "https://evil.com").send({});
    expect(res.status).toBe(200);
  });

  it("POST avec cle API (Bearer fp_sec_ / X-API-Key) : exempte", async () => {
    const app = buildApp(PROD);
    const a = await request(app).post("/api/thing").set("Cookie", cookie).set("Authorization", "Bearer fp_sec_x").send({});
    expect(a.status).toBe(200);
    const b = await request(app).post("/api/thing").set("X-API-Key", "fp_pub_x").set("Cookie", cookie).send({});
    expect(b.status).toBe(200);
  });

  it("webhooks Stripe intacts (les deux chemins), meme avec Origin tiers", async () => {
    const app = buildApp(PROD);
    for (const path of ["/api/webhooks/stripe", "/api/billing/webhook"]) {
      const res = await request(app).post(path).set("Cookie", cookie).set("Origin", "https://evil.com").send({});
      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
    }
  });
});
