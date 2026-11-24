/**
 * Le snippet Behavioral AI n'envoie RIEN avant un consentement explicite, ne demarre
 * jamais sous Global Privacy Control, et ne demarre qu'une fois. Le snippet genere est
 * execute pour de vrai dans un contexte isole.
 */
import express from "express";
import request from "supertest";
import { runInNewContext } from "node:vm";
import { beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ orgDb: vi.fn() }));
vi.mock("@workspace/db", () => ({
  db: {}, behaviorSiteTokensTable: {}, behaviorEventsTable: {}, croExperimentsTable: {},
}));
vi.mock("../middlewares/planGate.js", () => ({ requireAddon: () => (_r: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../middlewares/rateLimiter.js", () => ({ behavioralRateLimit: () => (_r: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../services/behavioral-service.js", () => ({
  trackBehaviorEvent: vi.fn(), upsertSession: vi.fn(), generateBehaviorInsights: vi.fn(), getBehaviorInsights: vi.fn(),
  analyzeBehaviorFunnel: vi.fn(), ALLOWED_BEHAVIOR_FUNNEL_EVENTS: [],
}));
import router from "./behavioral.js";

let snippetCode = "";
let instructions: string[] = [];

beforeAll(async () => {
  mocks.orgDb.mockResolvedValue({ rows: [] });
  const app = express();
  app.use((req, _res, next) => { Object.assign(req, { orgId: "org-a", orgDb: mocks.orgDb }); next(); });
  app.use("/api", router);
  const r = await request(app).get("/api/behavioral/snippet?siteUrl=https://test-site.example");
  expect(r.status).toBe(200);
  snippetCode = String(r.body.snippet).match(/<script>([\s\S]*)<\/script>/)![1]!;
  instructions = r.body.instructions;
});

function run(opts: { gpc?: boolean; consentFlag?: boolean } = {}) {
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  const docListeners: string[] = [];
  const fetchCalls: string[] = [];
  const win: Record<string, unknown> = {
    navigator: { userAgent: "test", globalPrivacyControl: opts.gpc },
    location: { origin: "https://test-site.example", pathname: "/" },
    addEventListener: (n: string, f: (e: unknown) => void) => { (listeners[n] ??= []).push(f); },
    scrollY: 0, innerHeight: 800,
    crypto: { subtle: { importKey: async () => ({}), sign: async () => new ArrayBuffer(4) } },
    ...(opts.consentFlag ? { fpBehavioralConsent: true } : {}),
  };
  const doc = {
    readyState: "complete", referrer: "", title: "t",
    addEventListener: (n: string) => { docListeners.push(n); },
    querySelectorAll: () => [], body: { scrollHeight: 2000 },
  };
  const ctx: Record<string, unknown> = {
    window: win, document: doc, navigator: win["navigator"], location: win["location"],
    fetch: (u: string) => { fetchCalls.push(u); return Promise.resolve({ ok: false, json: async () => ({}) }); },
    crypto: win["crypto"], TextEncoder, Uint8Array, Array, Object, JSON, Date, Math, Number, Promise, String,
    getComputedStyle: () => ({ cursor: "auto" }), setTimeout, console,
  };
  win["crypto"] = ctx["crypto"];
  runInNewContext(snippetCode, ctx);
  return {
    docListeners, fetchCalls,
    consent: (granted: boolean) => (listeners["fp:behavioral-consent"] ?? []).forEach(f => f({ detail: { granted } })),
    hasConsentListener: () => !!listeners["fp:behavioral-consent"],
  };
}
const settle = () => new Promise(r => setTimeout(r, 20));

describe("snippet Behavioral AI — consentement", () => {
  it("n'envoie rien et n'écoute aucun clic avant l'accord", async () => {
    const s = run();
    await settle();
    expect(s.fetchCalls).toEqual([]);
    expect(s.docListeners).toEqual([]); // ni clic, ni scroll
    expect(s.hasConsentListener()).toBe(true);
  });
  it("démarre après l'événement d'accord, une seule fois", async () => {
    const s = run();
    s.consent(false); await settle();
    expect(s.fetchCalls).toEqual([]);          // refus : rien
    s.consent(true); s.consent(true); await settle();
    expect(s.docListeners).toContain("click");
    expect(s.docListeners.filter(n => n === "click")).toHaveLength(1); // un seul démarrage
    expect(s.fetchCalls.length).toBeGreaterThan(0);
  });
  it("démarre immédiatement si le site a déjà déclaré l'accord", async () => {
    const s = run({ consentFlag: true });
    await settle();
    expect(s.docListeners).toContain("click");
  });
  it("ne démarre jamais sous Global Privacy Control, même avec accord", async () => {
    const s = run({ gpc: true, consentFlag: true });
    s.consent(true); await settle();
    expect(s.fetchCalls).toEqual([]);
    expect(s.docListeners).toEqual([]);
    expect(s.hasConsentListener()).toBe(false);
  });
  it("documente le consentement et n'utilise plus le domaine de repli .io", () => {
    expect(instructions.some(i => i.includes("fp:behavioral-consent"))).toBe(true);
    expect(snippetCode).not.toContain("flowpoint.io");
  });
});
