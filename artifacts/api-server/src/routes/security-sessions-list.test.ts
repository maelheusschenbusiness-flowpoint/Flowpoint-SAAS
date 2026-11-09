/**
 * GET /api/sessions (constat 3) : avant, TOUTE l'organisation (IP + navigateur complets des autres
 * membres) etait listee quel que soit le role. Maintenant : member/viewer = leurs seules sessions ;
 * owner/admin = organisation, avec IP tronquee et user-agent resume pour les sessions des autres ;
 * jamais de jeton ; isolation inter-organisations.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { orgDbMock } = vi.hoisted(() => ({ orgDbMock: vi.fn() }));

vi.mock("@workspace/db", () => ({ pool: { query: vi.fn() } }));
vi.mock("../services/org-settings.js", () => ({ loadOrgSettings: vi.fn() }));
vi.mock("../middlewares/requireRole.js", () => ({ canAdmin: (_q: any, _s: any, n: any) => n() }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import securityRouter, { sessionPublicId, maskIp, summarizeUserAgent } from "./security.js";

const FUTURE = new Date(Date.now() + 1e6);
const UA_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const UA_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const T_A = "tokA-secret-aaaaaaaaaaaaaaaaaaaa";
const T_A2 = "tokA2-secret-aaaaaaaaaaaaaaaaaaa";
const T_B = "tokB-secret-bbbbbbbbbbbbbbbbbbbb";
const T_C_ORG2 = "tokC-secret-cccccccccccccccccccc"; // autre organisation
const rows = [
  { org_id: "org-a", token: T_A, user_id: "user-a", user_id_v2: null, email: "a@example.test", ip_address: "81.2.69.142", user_agent: UA_MAC, created_at: new Date(), expires_at: FUTURE },
  { org_id: "org-a", token: T_A2, user_id: "user-a", user_id_v2: null, email: "a@example.test", ip_address: "81.2.69.143", user_agent: UA_IPHONE, created_at: new Date(), expires_at: FUTURE },
  { org_id: "org-a", token: T_B, user_id: "user-b", user_id_v2: null, email: "b@example.test", ip_address: "203.0.113.77", user_agent: UA_MAC, created_at: new Date(), expires_at: FUTURE },
  { org_id: "org-b", token: T_C_ORG2, user_id: "user-c", user_id_v2: null, email: "c@other.test", ip_address: "198.51.100.9", user_agent: UA_MAC, created_at: new Date(), expires_at: FUTURE },
];

/** Simule le SQL : filtre org_id = $1 ; si le SQL contient un filtre d'identite, applique-le. */
orgDbMock.mockImplementation(async (sql: string, params: unknown[]) => {
  const org = params[0];
  let out = rows.filter(r => r.org_id === org);
  if (/lower\(email\)/.test(sql)) {
    const emails = params.slice(1).map(String);
    out = out.filter(r => emails.includes(r.email.toLowerCase()) || emails.includes(r.user_id));
  }
  return { rows: out };
});

function makeApp(ctx: Record<string, unknown>, orgId = "org-a", cookie = T_A) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { orgId, orgContext: { orgId, ...ctx }, orgDb: orgDbMock, cookies: { fp_token: cookie } });
    next();
  });
  app.use("/api", securityRouter);
  return app;
}
const viewerA = { userId: "user-a", email: "a@example.test", role: "viewer" };
const memberA = { userId: "user-a", email: "a@example.test", role: "member" };
const adminB = { userId: "user-b", email: "b@example.test", role: "admin" };

beforeEach(() => { orgDbMock.mockClear(); });

describe("GET /sessions — visibilite par role", () => {
  it.each([["member", memberA], ["viewer", viewerA]])("%s : uniquement SES sessions, jamais celles des autres membres", async (_n, ctx) => {
    const res = await request(makeApp(ctx)).get("/api/sessions");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    const ids = res.body.sessions.map((s: any) => s.id).sort();
    expect(ids).toEqual([sessionPublicId(T_A), sessionPublicId(T_A2)].sort());
    expect(ids).not.toContain(sessionPublicId(T_B));
    expect(res.body.sessions.every((s: any) => s.own === true)).toBe(true);
    // la requete SQL est bornee par organisation ET par identite
    expect(orgDbMock.mock.calls[0]![0]).toMatch(/org_id = \$1/);
    expect(orgDbMock.mock.calls[0]![0]).toMatch(/lower\(email\)/);
  });

  it("member : ses propres sessions gardent l'IP complete (c'est son compte)", async () => {
    const res = await request(makeApp(memberA)).get("/api/sessions");
    expect(res.body.sessions.find((s: any) => s.isCurrent).ip).toBe("81.2.69.142");
  });

  it("defense en profondeur : meme si le SQL renvoyait tout, un member ne recoit que le sien", async () => {
    orgDbMock.mockImplementationOnce(async () => ({ rows: rows.filter(r => r.org_id === "org-a") }));
    const res = await request(makeApp(memberA)).get("/api/sessions");
    expect(res.body.count).toBe(2);
    expect(JSON.stringify(res.body)).not.toContain("203.0.113");
  });

  it("admin : toute l'organisation, IP tronquee et navigateur resume pour les AUTRES membres", async () => {
    const res = await request(makeApp(adminB, "org-a", T_B)).get("/api/sessions");
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    const mine = res.body.sessions.find((s: any) => s.id === sessionPublicId(T_B));
    expect(mine).toMatchObject({ own: true, ip: "203.0.113.77", isCurrent: true, canRevoke: false });
    const other = res.body.sessions.find((s: any) => s.id === sessionPublicId(T_A));
    expect(other).toMatchObject({ own: false, ip: "81.2.x.x", device: "Chrome · macOS", canRevoke: true });
    const phone = res.body.sessions.find((s: any) => s.id === sessionPublicId(T_A2));
    expect(phone.device).toBe("Safari · iOS");
    // aucun user-agent brut ni IP complete pour les sessions des AUTRES membres
    for (const s of res.body.sessions.filter((x: any) => !x.own)) {
      expect(s.device).not.toContain("Mozilla");
      expect(s.ip).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
    }
  });

  it("isolation inter-organisations : aucune session de org-b, meme pour un admin de org-a", async () => {
    const res = await request(makeApp(adminB, "org-a", T_B)).get("/api/sessions");
    const ids = res.body.sessions.map((s: any) => s.id);
    expect(ids).not.toContain(sessionPublicId(T_C_ORG2));
    expect(orgDbMock.mock.calls[0]![1][0]).toBe("org-a");
    expect(JSON.stringify(res.body)).not.toContain("198.51.100");
  });

  it("jamais le jeton ni un fragment du jeton dans la reponse, et champs limites", async () => {
    const res = await request(makeApp(adminB, "org-a", T_B)).get("/api/sessions");
    const raw = JSON.stringify(res.body);
    for (const t of [T_A, T_A2, T_B]) { expect(raw).not.toContain(t); expect(raw).not.toContain(t.slice(0, 10)); }
    for (const s of res.body.sessions) {
      expect(Object.keys(s).sort()).toEqual(["canRevoke", "date", "device", "event", "id", "ip", "isCurrent", "own", "success"]);
    }
  });

  it("cle API / service : liste vide, aucune requete", async () => {
    for (const userId of ["apikey:org-a", "service"]) {
      const res = await request(makeApp({ userId, role: "admin" })).get("/api/sessions");
      expect(res.body).toEqual({ sessions: [], count: 0 });
    }
    expect(orgDbMock).not.toHaveBeenCalled();
  });

  it("compatibilite dashboard : id + canRevoke + isCurrent presents pour le bouton « Terminer la session »", async () => {
    const res = await request(makeApp(memberA)).get("/api/sessions");
    const other = res.body.sessions.find((s: any) => !s.isCurrent);
    expect(other.id).toMatch(/^[a-f0-9]{24}$/);
    expect(other.canRevoke).toBe(true);
    expect(res.body.sessions.find((s: any) => s.isCurrent).canRevoke).toBe(false);
  });
});

describe("minimisation", () => {
  it("maskIp", () => {
    expect(maskIp("81.2.69.142")).toBe("81.2.x.x");
    expect(maskIp("::ffff:10.1.2.3")).toBe("10.1.x.x");
    expect(maskIp("2001:db8:85a3::8a2e:370:7334")).toBe("2001:db8::x");
    expect(maskIp("")).toBe("IP inconnue");
    expect(maskIp("pas-une-ip")).toBe("IP inconnue");
  });
  it("summarizeUserAgent", () => {
    expect(summarizeUserAgent(UA_MAC)).toBe("Chrome · macOS");
    expect(summarizeUserAgent("Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/127.0")).toBe("Firefox · Windows");
    expect(summarizeUserAgent("")).toBe("Appareil inconnu");
  });
});
