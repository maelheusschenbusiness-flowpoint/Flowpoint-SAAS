/**
 * Attribution Smartlead — de bout en bout cote SaaS : le fp_lid porte par
 * `GET /go` jusqu'a `signin.html` arrive dans le corps de pre-register, est
 * stocke sur `pending_signups`, puis devient le jalon `signup` de la file AI Lab.
 *
 * Verification (pas de changement de comportement) : `routes/auth.ts` n'est pas
 * modifie par cette branche.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FP_LID = "AbCdEfGhIjKlMnOpQr_-12";
const CREE = new Date("2026-10-27T09:15:00.000Z");
let inserts: unknown[][];

function answer(sql: string, v: unknown[] = []) {
  const s = sql.replace(/\s+/g, " ").trim();
  if (/^INSERT INTO pending_signups/i.test(s)) {
    inserts.push(v);
    return { rows: [{ created_at: CREE, fp_lid: (v[12] as string) ?? null }], rowCount: 1 };
  }
  return { rows: [], rowCount: 0 };
}

vi.mock("@workspace/db", () => {
  const client = { query: vi.fn(async (s: string, v?: unknown[]) => answer(s, v)), release: vi.fn() };
  return { pool: { connect: vi.fn(async () => client), query: vi.fn(async (s: string, v?: unknown[]) => answer(s, v)) },
           db: {}, eq: vi.fn(), desc: vi.fn(), and: vi.fn() };
});
const queueConversionEvent = vi.fn(async () => "queued");
vi.mock("../lib/conversion-outbox.js", () => ({ queueConversionEvent }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }));
vi.mock("../middlewares/rateLimiter.js", () => ({
  createRateLimit: () => (_q: unknown, _r: unknown, n: () => void) => n(),
  authRateLimit: (_q: unknown, _r: unknown, n: () => void) => n(),
  publicCheckoutRateLimit: (_q: unknown, _r: unknown, n: () => void) => n(),
  globalRateLimit: (_q: unknown, _r: unknown, n: () => void) => n(),
}));
vi.mock("../services/org-settings.js", () => ({ loadOrgSettings: vi.fn(async () => null), upsertOrgSettings: vi.fn(async () => {}) }));
vi.mock("../services/seller-attribution.js", () => ({
  validateSellerCode: vi.fn(async () => null), resolveSellerIdFromToken: vi.fn(async () => null), recordCommission: vi.fn(async () => {}),
}));
vi.mock("../services/stripe-factory.js", () => ({ getStripeKey: vi.fn(() => undefined), createStripeClient: vi.fn(async () => null) }));
vi.mock("../services/mailer.js", () => ({ mailer: new Proxy({}, { get: () => vi.fn(async () => ({ ok: true })) }) }));
vi.mock("../services/store.js", () => ({ store: { broadcast: vi.fn(), broadcastPlanUpdate: vi.fn() } }));
vi.mock("../services/addons-service.js", () => ({ activateAddon: vi.fn(async () => true), deactivateAddon: vi.fn(async () => true), provisionPlanAddons: vi.fn(async () => {}) }));
vi.mock("../services/org-data.js", () => ({ findOrgByStripeCustomer: vi.fn(async () => null), persistOrgData: vi.fn(async () => {}), loadOrgData: vi.fn(async () => ({})) }));

const { default: authRouter } = await import("../routes/auth.js");
const { stableEventId } = await import("../lib/conversion-events.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => { req.cookies = {}; next(); });
  a.use("/api", authRouter);
  return a;
}
const corps = (extra: Record<string, unknown> = {}) => ({
  firstName: "Lead", lastName: "Test", email: "lead@exemple.fr", companyName: "Agence", country: "BE",
  address: "1 rue", city: "Bruxelles", postalCode: "1000", ...extra,
});
const attendre = async () => { for (let i = 0; i < 20 && queueConversionEvent.mock.calls.length === 0; i++) await new Promise(r => setTimeout(r, 5)); };

beforeEach(() => { inserts = []; queueConversionEvent.mockClear(); });

describe("pre-register : fp_lid -> pending_signups -> jalon signup", () => {
  it("un fp_lid valide est stocke et emis comme jalon signup, horodate par created_at", async () => {
    const r = await request(app()).post("/api/auth/pre-register").send(corps({ fp_lid: FP_LID }));
    expect(r.status).toBe(200);
    expect(inserts[0]?.[12]).toBe(FP_LID);
    await attendre();
    expect(queueConversionEvent).toHaveBeenCalledTimes(1);
    const evt = (queueConversionEvent.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(evt).toMatchObject({ stage: "signup", source: "saas", fpLid: FP_LID, occurredAt: CREE.toISOString() });
    expect(String(evt["eventId"])).toMatch(/^signup:[0-9a-f]{32}$/);
    expect(evt["eventId"]).toBe(stableEventId("signup", String(r.body.preRegisterToken)));
  });

  it("sans fp_lid, ou mal forme : inscription acceptee, aucun jalon", async () => {
    for (const extra of [{}, { fp_lid: "lead@exemple.fr" }]) {
      const r = await request(app()).post("/api/auth/pre-register").send(corps(extra));
      expect(r.status).toBe(200);
    }
    await new Promise(r => setTimeout(r, 30));
    expect(inserts.map(v => v[12])).toEqual([null, null]);
    expect(queueConversionEvent).not.toHaveBeenCalled();
  });
});

describe("pages : le fp_lid de l'URL de redirection /go est garde", () => {
  const lire = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
  it("signin.html lit fp_lid de l'URL, le range, et le joint a pre-register", () => {
    const html = lire("../../../flowpoint-export/signin.html");
    expect(html).toMatch(/urlParams\.get\('fp_lid'\)/);
    expect(html).toMatch(/sessionStorage\.setItem\('fp_lid', fpLidValue\)/);
    expect(html).toMatch(/fp_lid: \(function\(\)\{try\{var _l=sessionStorage\.getItem\('fp_lid'\)/);
  });
  it("pricing.html le garde aussi", () => {
    expect(lire("../../../flowpoint-export/pricing.html")).toMatch(/get\('fp_lid'\)[\s\S]*sessionStorage\.setItem\('fp_lid',_l\)/);
  });
});
