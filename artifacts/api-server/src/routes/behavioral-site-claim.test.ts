/**
 * GET /behavioral/snippet : un site deja enregistre par une autre organisation doit repondre 403
 * (et non 500). La verification de propriete ne peut pas passer par orgDb (RLS : la ligne de
 * l'autre organisation est invisible), elle utilise donc la connexion superuser.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ orgDb: vi.fn(), existing: [] as Array<{ orgId: string }> }));
vi.mock("@workspace/db", () => {
  const chain = { from: () => chain, where: () => chain, limit: async () => mocks.existing };
  return {
    db: { select: () => chain },
    behaviorSiteTokensTable: { siteUrl: "site_url", orgId: "org_id", tokenHash: "token_hash" },
    behaviorEventsTable: {}, croExperimentsTable: {},
  };
});
vi.mock("drizzle-orm", () => ({ eq: () => ({}), and: () => ({}), sql: () => ({}) }));
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_r: unknown, _s: unknown, next: () => void) => next(),
  resolveOrgAddonEntitlement: async () => "granted",
}));
vi.mock("../middlewares/requireRole.js", () => ({ canWrite: (_r: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../services/behavioral-session-auth.js", () => ({
  MAX_TS_SKEW_MS: 300000, issueSessionToken: vi.fn(), verifySessionToken: vi.fn(), consumeNonce: vi.fn(),
}));
vi.mock("../middlewares/rateLimiter.js", () => ({ behavioralRateLimit: () => (_r: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../services/behavioral-service.js", () => ({
  trackBehaviorEvent: vi.fn(), upsertSession: vi.fn(), generateBehaviorInsights: vi.fn(), getBehaviorInsights: vi.fn(),
  analyzeBehaviorFunnel: vi.fn(), ALLOWED_BEHAVIOR_FUNNEL_EVENTS: [],
}));
import router from "./behavioral.js";

const app = express();
app.use((req, _res, next) => { Object.assign(req, { orgId: "org-b", orgDb: mocks.orgDb }); next(); });
app.use("/api", router);
const URL_ = "/api/behavioral/snippet?siteUrl=https://claimed.example";

beforeEach(() => { mocks.orgDb.mockReset(); mocks.orgDb.mockResolvedValue({ rows: [] }); mocks.existing = []; });

describe("GET /behavioral/snippet — site deja revendique", () => {
  it("403 quand le site appartient a une autre organisation, sans toucher a la base tenant", async () => {
    mocks.existing = [{ orgId: "org-a" }];
    const r = await request(app).get(URL_);
    expect(r.status).toBe(403);
    expect(mocks.orgDb).not.toHaveBeenCalled();
  });
  it("403 si l'upsert est refuse par la RLS (revendication concurrente)", async () => {
    mocks.orgDb.mockRejectedValueOnce(Object.assign(new Error("rls"), { code: "42501" }));
    expect((await request(app).get(URL_)).status).toBe(403);
  });
  it("200 pour le proprietaire ou un site libre", async () => {
    expect((await request(app).get(URL_)).status).toBe(200);
    mocks.existing = [{ orgId: "org-b" }];
    expect((await request(app).get(URL_)).status).toBe(200);
  });
});
