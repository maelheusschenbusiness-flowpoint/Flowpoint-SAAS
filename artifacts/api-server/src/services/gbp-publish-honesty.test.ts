/**
 * D-01 — Publication GBP honnete : « published » uniquement apres confirmation reelle de Google.
 * Google est TOUJOURS simule (fetch / publishGBPPost mockes) : aucun appel reseau reel,
 * aucune publication sur une fiche reelle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { query: mocks.query, connect: mocks.connect } }));
vi.mock("./google-service.js", async () => {
  const actual = await vi.importActual<typeof import("./google-service.js")>("./google-service.js");
  return { ...actual, publishGBPPost: vi.fn() };
});
vi.mock("../middlewares/planGate.js", () => ({
  requireFeature: () => (_q: unknown, _s: unknown, next: () => void) => next(),
  requireAddon: () => (_q: unknown, _s: unknown, next: () => void) => next(),
}));

import { publishGBPPost } from "./google-service.js";
import * as realGoogle from "./google-service.js";
import {
  publishPost, publishDueScheduledPosts, getPostsDashboard, GbpPublishError, type GBPPost,
} from "./gbp-posting-service.js";
import router from "../routes/gbp-posts.js";

const rows = (r: unknown[]) => ({ rows: r, rowCount: r.length }) as never;
const post = {
  id: "gp_1", org_id: "org-1", location_id: "loc-1", location_name: "Clinic", content: "Hello",
  cta_type: null, cta_url: null, status: "draft", post_type: "standard",
} as GBPPost;
const sqlOf = () => mocks.query.mock.calls.map(c => String(c[0]).replace(/\s+/g, " "));
const wroteStatus = (s: string) => sqlOf().some(q => q.includes(`status='${s}'`) && /^UPDATE gbp_posts\s+SET status=/.test(q.trim()) && !q.includes("status='publishing'"));

function primeClaim() {
  mocks.query
    .mockResolvedValueOnce(rows([post]))
    .mockResolvedValueOnce(rows([{ resource_name: "accounts/a/locations/l" }]));
  mocks.query.mockResolvedValue(rows([]));
}

describe("publishPost : jamais de faux succes", () => {
  beforeEach(() => { mocks.query.mockReset(); vi.mocked(publishGBPPost).mockReset(); });

  it.each([
    ["GOOGLE_NOT_CONNECTED"], ["GOOGLE_AUTH_FAILED"], ["GBP_API_UNAVAILABLE"], ["GBP_API_REJECTED"],
  ])("echec Google %s -> erreur typee, statut failed + code, jamais published", async code => {
    primeClaim();
    vi.mocked(publishGBPPost).mockResolvedValue({ ok: false, error: "x", code });
    const err = await publishPost("org-1", "gp_1").catch(e => e);
    expect(err).toBeInstanceOf(GbpPublishError);
    expect((err as GbpPublishError).code).toBe(code);
    expect(wroteStatus("published")).toBe(false);
    const failedCall = mocks.query.mock.calls.find(c => String(c[0]).includes("status='failed'"));
    expect(failedCall?.[1]).toEqual(["gp_1", "org-1", code, expect.stringContaining("")]);
    expect((failedCall?.[1] as string[])[3]!.length).toBeGreaterThan(10);
  });

  it("reponse Google ok mais sans identifiant de post -> echec (pas de published)", async () => {
    primeClaim();
    vi.mocked(publishGBPPost).mockResolvedValue({ ok: true });
    await expect(publishPost("org-1", "gp_1")).rejects.toBeInstanceOf(GbpPublishError);
    expect(wroteStatus("published")).toBe(false);
  });

  it("succes reel : published ecrit APRES l'appel Google, avec l'identifiant renvoye", async () => {
    primeClaim();
    vi.mocked(publishGBPPost).mockResolvedValue({ ok: true, postName: "accounts/a/locations/l/localPosts/9" });
    const r = await publishPost("org-1", "gp_1");
    expect(r.googlePostId).toContain("localPosts/9");
    const publishedCall = mocks.query.mock.calls.find(c => String(c[0]).includes("status='published'"));
    expect(publishedCall?.[1]).toEqual([expect.any(String), "accounts/a/locations/l/localPosts/9", "gp_1", "org-1"]);
  });

  it("Google a publie mais l'ecriture du statut echoue : pas de repassage en failed (pas de doublon)", async () => {
    mocks.query
      .mockResolvedValueOnce(rows([post]))
      .mockResolvedValueOnce(rows([{ resource_name: "accounts/a/locations/l" }]))
      .mockRejectedValue(new Error("db down"));
    vi.mocked(publishGBPPost).mockResolvedValue({ ok: true, postName: "accounts/a/locations/l/localPosts/9" });
    const r = await publishPost("org-1", "gp_1");
    expect(r.ok).toBe(true);
    expect(sqlOf().some(q => q.includes("status='failed'"))).toBe(false);
  });
});

describe("publishGBPPost (google-service, fetch simule)", () => {
  const connectClient = (rowsOut: unknown[]) => mocks.connect.mockResolvedValue({
    query: vi.fn().mockResolvedValue({ rows: rowsOut }), release: vi.fn(),
  });
  afterEach(() => vi.unstubAllGlobals());
  // On teste l'implementation reelle : on la recupere hors du mock.
  const real = async () => (await vi.importActual<typeof import("./google-service.js")>("./google-service.js")).publishGBPPost;

  it("Google non connecte -> GOOGLE_NOT_CONNECTED, aucun fetch", async () => {
    connectClient([]);
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const r = await (await real())("org-1", "accounts/a/locations/l", { summary: "x" });
    expect(r).toMatchObject({ ok: false, code: "GOOGLE_NOT_CONNECTED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([[503, "GBP_API_UNAVAILABLE"], [429, "GBP_API_RATE_LIMITED"], [403, "GBP_API_FORBIDDEN"], [400, "GBP_API_REJECTED"], [401, "GOOGLE_AUTH_FAILED"]])(
    "HTTP %i -> %s", async (status, code) => {
      connectClient([{ access_token: realGoogle.encryptToken("tok"), expires_at: new Date(Date.now() + 600_000).toISOString() }]);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
      expect(await (await real())("org-1", "accounts/a/locations/l", { summary: "x" })).toMatchObject({ ok: false, code });
    });

  it("panne reseau -> GBP_API_UNAVAILABLE", async () => {
    connectClient([{ access_token: realGoogle.encryptToken("tok"), expires_at: new Date(Date.now() + 600_000).toISOString() }]);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    expect(await (await real())("org-1", "accounts/a/locations/l", { summary: "x" })).toMatchObject({ ok: false, code: "GBP_API_UNAVAILABLE" });
  });
});

describe("route POST /gbp-posts/:id/publish : erreurs explicites", () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { Object.assign(req, { orgId: "org-1" }); next(); });
  app.use(router);
  beforeEach(() => { mocks.query.mockReset(); vi.mocked(publishGBPPost).mockReset(); });

  it.each([
    ["GOOGLE_NOT_CONNECTED", 409], ["GBP_API_UNAVAILABLE", 503], ["GBP_API_REJECTED", 502], ["GBP_API_RATE_LIMITED", 503],
  ])("%s -> HTTP %i avec code et message UI", async (code, status) => {
    primeClaim();
    vi.mocked(publishGBPPost).mockResolvedValue({ ok: false, code });
    const r = await request(app).post("/gbp-posts/gp_1/publish");
    expect(r.status).toBe(status);
    expect(r.body).toMatchObject({ ok: false, code });
    expect(String(r.body.error).length).toBeGreaterThan(20);
  });
});

describe("planification : traitement borne et sur", () => {
  beforeEach(() => { mocks.query.mockReset(); vi.mocked(publishGBPPost).mockReset(); });

  it("recupere les publishing orphelins, ferme les programmations manquees (>24h), lot borne", async () => {
    mocks.query.mockResolvedValue(rows([]));
    const out = await publishDueScheduledPosts();
    const q = sqlOf();
    expect(q[0]).toContain("status='publishing' AND updated_at < NOW() - INTERVAL '15 minutes'");
    expect(q[1]).toContain("GBP_SCHEDULE_MISSED");
    expect(q[2]).toMatch(/scheduled_at <= NOW\(\) AND scheduled_at >= NOW\(\) - INTERVAL '24 hours'[\s\S]*LIMIT 20/);
    expect(out).toEqual({ attempted: 0, published: 0 });
  });

  it("un post echu passe par le claim atomique de publishPost (jamais d'UPDATE published direct)", async () => {
    mocks.query
      .mockResolvedValueOnce(rows([])).mockResolvedValueOnce(rows([]))
      .mockResolvedValueOnce(rows([{ id: "gp_1", org_id: "org-1" }]))
      // claim vide : deja pris par une autre instance
      .mockResolvedValueOnce(rows([]));
    const out = await publishDueScheduledPosts();
    expect(out).toEqual({ attempted: 1, published: 0 });
    expect(publishGBPPost).not.toHaveBeenCalled();
  });
});

describe("statistiques : pas de faux publies", () => {
  it("un post 'published' sans identifiant Google n'est pas compte comme publie", async () => {
    const client = {
      query: vi.fn().mockResolvedValue(rows([
        { id: "a", status: "published", google_post_id: null, created_at: new Date().toISOString() },
        { id: "b", status: "published", google_post_id: "accounts/a/locations/l/localPosts/1", created_at: new Date().toISOString() },
      ])),
      release: vi.fn(),
    };
    mocks.connect.mockResolvedValue(client);
    const { stats } = await getPostsDashboard("org-1");
    expect(stats.published).toBe(1);
  });
});
