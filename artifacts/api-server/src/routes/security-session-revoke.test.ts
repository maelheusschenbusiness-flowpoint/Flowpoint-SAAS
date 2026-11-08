/**
 * D-08 — POST /api/auth/sessions/:id/revoke : une session de l'utilisateur courant (ou, pour un
 * owner/admin, de SA organisation), jamais celle d'une autre organisation, jamais la session courante
 * sans le dire.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { poolQueryMock, orgDbMock } = vi.hoisted(() => ({ poolQueryMock: vi.fn(), orgDbMock: vi.fn() }));

vi.mock("@workspace/db", () => ({ pool: { query: poolQueryMock } }));
vi.mock("../services/org-settings.js", () => ({ loadOrgSettings: vi.fn() }));
vi.mock("../middlewares/requireRole.js", () => ({ canAdmin: (_q: any, _s: any, n: any) => n() }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import securityRouter, { sessionPublicId } from "./security.js";

const SAME_PREFIX = "dXNlci1hQG9yZy1hOjEyMzQ1Njc4"; // tous les jetons d'un meme utilisateur partagent ce debut
const tok = (suffix: string) => `${SAME_PREFIX}.${suffix}`;
const CURRENT = tok("current");
const OTHER_DEVICE = tok("phone");
const MEMBER_B = "Ym9iQG9yZy1hOmJvYg.session";

const rows = [
  { token: CURRENT, user_id: "user-a", user_id_v2: null, email: "a@example.test", ip_address: "1.1.1.1", user_agent: "Chrome", created_at: new Date(), expires_at: new Date(Date.now() + 1e6) },
  { token: OTHER_DEVICE, user_id: "user-a", user_id_v2: null, email: "a@example.test", ip_address: "2.2.2.2", user_agent: "iPhone", created_at: new Date(), expires_at: new Date(Date.now() + 1e6) },
  { token: MEMBER_B, user_id: "user-b", user_id_v2: null, email: "b@example.test", ip_address: "3.3.3.3", user_agent: "Firefox", created_at: new Date(), expires_at: new Date(Date.now() + 1e6) },
];

function makeApp(ctx: Record<string, unknown>, cookieToken: string | null = CURRENT) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { orgId: "org-a", orgContext: { orgId: "org-a", ...ctx }, orgDb: orgDbMock, cookies: cookieToken ? { fp_token: cookieToken } : {} });
    next();
  });
  app.use("/api", securityRouter);
  return app;
}
const member = { userId: "user-a", email: "a@example.test", role: "member" };
const admin = { userId: "user-admin", email: "admin@example.test", role: "admin" };

function mockDb(opts: { deleteCount?: number } = {}) {
  poolQueryMock.mockImplementation(async (sql: string) => {
    if (/^\s*SELECT/i.test(sql)) return { rows };
    if (/^\s*DELETE/i.test(sql)) return { rows: [], rowCount: opts.deleteCount ?? 1 };
    return { rows: [] };
  });
}
const deleteCalls = () => poolQueryMock.mock.calls.filter(c => /DELETE FROM user_sessions/.test(c[0]));

describe("POST /auth/sessions/:id/revoke", () => {
  beforeEach(() => { vi.clearAllMocks(); mockDb(); });

  it("les identifiants publics sont distincts meme si les jetons partagent le meme prefixe, et ne contiennent pas le jeton", () => {
    expect(CURRENT.slice(0, 16)).toBe(OTHER_DEVICE.slice(0, 16)); // l'ancien identifiant etait ambigu
    expect(sessionPublicId(CURRENT)).not.toBe(sessionPublicId(OTHER_DEVICE));
    expect(sessionPublicId(CURRENT)).toMatch(/^[a-f0-9]{24}$/);
  });

  it("revoque UNE seule session propre (l'autre appareil) et pas ses voisines au meme prefixe", async () => {
    const res = await request(makeApp(member)).post(`/api/auth/sessions/${sessionPublicId(OTHER_DEVICE)}/revoke`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, revoked: 1, current: false });
    expect(deleteCalls()).toHaveLength(1);
    expect(deleteCalls()[0][1]).toEqual([OTHER_DEVICE, "org-a"]);
  });

  it("recherche uniquement dans l'organisation de l'appelant (requete bornee par org_id)", async () => {
    await request(makeApp(member)).post(`/api/auth/sessions/${sessionPublicId(OTHER_DEVICE)}/revoke`).send({});
    const select = poolQueryMock.mock.calls.find(c => /^\s*SELECT/i.test(c[0]))!;
    expect(select[0]).toMatch(/org_id = \$1/);
    expect(select[1]).toEqual(["org-a"]);
  });

  it("404 pour une session d'une autre organisation (absente de la liste de l'organisation) — aucune suppression", async () => {
    const foreign = sessionPublicId("token-of-org-b");
    const res = await request(makeApp(admin)).post(`/api/auth/sessions/${foreign}/revoke`).send({});
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SESSION_NOT_FOUND");
    expect(deleteCalls()).toHaveLength(0);
  });

  it("403 : un membre ne peut pas revoquer la session d'un autre membre", async () => {
    const res = await request(makeApp(member)).post(`/api/auth/sessions/${sessionPublicId(MEMBER_B)}/revoke`).send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SESSION_REVOKE_FORBIDDEN");
    expect(deleteCalls()).toHaveLength(0);
  });

  it("un admin de l'organisation peut revoquer la session d'un membre", async () => {
    const res = await request(makeApp(admin)).post(`/api/auth/sessions/${sessionPublicId(MEMBER_B)}/revoke`).send({});
    expect(res.status).toBe(200);
    expect(deleteCalls()[0][1]).toEqual([MEMBER_B, "org-a"]);
  });

  it("409 CURRENT_SESSION : la session courante n'est jamais revoquee silencieusement", async () => {
    const res = await request(makeApp(member)).post(`/api/auth/sessions/${sessionPublicId(CURRENT)}/revoke`).send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("CURRENT_SESSION");
    expect(deleteCalls()).toHaveLength(0);
    // meme pour un admin dont le jeton courant est cette session
    const res2 = await request(makeApp(admin, CURRENT)).post(`/api/auth/sessions/${sessionPublicId(CURRENT)}/revoke`).send({});
    expect(res2.status).toBe(409);
    expect(deleteCalls()).toHaveLength(0);
  });

  it("400 pour un identifiant mal forme (dont un fragment de jeton)", async () => {
    for (const bad of ["abc", CURRENT.slice(0, 16), "../etc", "G".repeat(24)]) {
      const res = await request(makeApp(member)).post(`/api/auth/sessions/${encodeURIComponent(bad)}/revoke`).send({});
      expect(res.status, bad).toBe(400);
    }
    expect(poolQueryMock).not.toHaveBeenCalled();
  });

  it("403 pour une cle API / le service (ce ne sont pas des personnes)", async () => {
    const res = await request(makeApp({ userId: "apikey:org-a", role: "admin" }))
      .post(`/api/auth/sessions/${sessionPublicId(OTHER_DEVICE)}/revoke`).send({});
    expect(res.status).toBe(403);
    expect(deleteCalls()).toHaveLength(0);
  });

  it("401 sans contexte d'organisation", async () => {
    const res = await request(makeApp({ orgId: "default", role: "member" }))
      .post(`/api/auth/sessions/${sessionPublicId(OTHER_DEVICE)}/revoke`).send({});
    expect(res.status).toBe(401);
  });

  it("503 explicite si la base echoue (pas de faux succes)", async () => {
    poolQueryMock.mockRejectedValue(new Error("db down"));
    const res = await request(makeApp(member)).post(`/api/auth/sessions/${sessionPublicId(OTHER_DEVICE)}/revoke`).send({});
    expect(res.status).toBe(503);
    expect(res.body.ok).toBeUndefined();
  });

  it("404 si la suppression n'a touche aucune ligne (course)", async () => {
    mockDb({ deleteCount: 0 });
    const res = await request(makeApp(member)).post(`/api/auth/sessions/${sessionPublicId(OTHER_DEVICE)}/revoke`).send({});
    expect(res.status).toBe(404);
  });
});

describe("GET /sessions — identifiants et droit de revocation", () => {
  beforeEach(() => { vi.clearAllMocks(); orgDbMock.mockResolvedValue({ rows }); });

  it("expose un identifiant opaque (jamais le jeton ni son debut) et canRevoke selon le role", async () => {
    const res = await request(makeApp(member)).get("/api/sessions");
    expect(res.status).toBe(200);
    const byDevice = Object.fromEntries(res.body.sessions.map((s: any) => [s.device, s]));
    expect(JSON.stringify(res.body)).not.toContain(SAME_PREFIX);
    expect(byDevice["Chrome"]).toMatchObject({ isCurrent: true, canRevoke: false });
    expect(byDevice["iPhone"]).toMatchObject({ isCurrent: false, canRevoke: true });
    expect(byDevice["Firefox"]).toMatchObject({ isCurrent: false, canRevoke: false });
    expect(new Set(res.body.sessions.map((s: any) => s.id)).size).toBe(3);
  });

  it("un admin peut revoquer les sessions des autres, mais pas la courante", async () => {
    const res = await request(makeApp(admin, "some-admin-token")).get("/api/sessions");
    expect(res.body.sessions.every((s: any) => s.canRevoke === true)).toBe(true);
    const res2 = await request(makeApp(admin, MEMBER_B)).get("/api/sessions");
    const current = res2.body.sessions.find((s: any) => s.isCurrent);
    expect(current.canRevoke).toBe(false);
  });
});
