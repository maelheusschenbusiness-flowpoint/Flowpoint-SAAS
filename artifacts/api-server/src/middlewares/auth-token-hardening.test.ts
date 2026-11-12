/**
 * auth-token-hardening.test.ts — constats C-09 et C-13 de l'audit du 08/11/2026.
 *
 * C-09 : les secrets de service (ADMIN_KEY, API_SECRET_KEY) etaient compares
 *        avec `===` : comparaison non constante.
 * C-13 : `orgContext` acceptait un jeton en query string sur TOUTE route,
 *        alors que `requireAuth` le limite aux flux SSE.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const session = vi.hoisted(() => ({ get: vi.fn(), del: vi.fn() }));
vi.mock("../services/sessions.js", () => ({
  getSession: (...a: unknown[]) => session.get(...(a as [])),
  deleteSession: (...a: unknown[]) => session.del(...(a as [])),
}));

import { keysEqual, isSseQueryTokenRequest } from "../lib/auth-token.js";
import { orgContext } from "./orgContext.js";
import { requireAuth } from "./requireAuth.js";

describe("keysEqual (C-09)", () => {
  it("accepte deux secrets identiques", () => {
    expect(keysEqual("a".repeat(40), "a".repeat(40))).toBe(true);
  });
  it("refuse un secret different, plus court, plus long ou vide", () => {
    const k = "secret-de-service-0123456789abcdef";
    expect(keysEqual(k + "x", k)).toBe(false);
    expect(keysEqual(k.slice(0, -1), k)).toBe(false);
    expect(keysEqual("", k)).toBe(false);
    expect(keysEqual("b" + k.slice(1), k)).toBe(false);
  });
  it("refuse tout ce qui n'est pas une chaine (en-tete tableau, undefined)", () => {
    expect(keysEqual(undefined, "x")).toBe(false);
    expect(keysEqual(["x"], "x")).toBe(false);
    expect(keysEqual("x", undefined)).toBe(false);
  });
});

describe("isSseQueryTokenRequest (C-13)", () => {
  const sse = { method: "GET", query: { token: "t" }, headers: { accept: "text/event-stream" } };
  it("accepte un GET SSE avec token", () => {
    expect(isSseQueryTokenRequest(sse as never)).toBe(true);
  });
  it("refuse une route ordinaire (Accept JSON), un POST, ou l'absence de token", () => {
    expect(isSseQueryTokenRequest({ ...sse, headers: { accept: "application/json" } } as never)).toBe(false);
    expect(isSseQueryTokenRequest({ ...sse, headers: {} } as never)).toBe(false);
    expect(isSseQueryTokenRequest({ ...sse, method: "POST" } as never)).toBe(false);
    expect(isSseQueryTokenRequest({ ...sse, query: {} } as never)).toBe(false);
  });
});

function fausseReponse() {
  return { status() { return this; }, json() { return this; }, clearCookie() { return this; }, redirect() { return this; } };
}

async function jouerOrgContext(req: Record<string, unknown>): Promise<Record<string, any>> {
  const r = { cookies: {}, url: "/api/x", ...req } as Record<string, any>;
  await new Promise<void>((fini) => {
    orgContext(r as never, fausseReponse() as never, () => fini());
    setTimeout(fini, 50);
  });
  return r;
}

const initial = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  session.get.mockImplementation(async (t: string) =>
    t === "jeton-valide"
      ? { orgId: "11111111-1111-4111-8111-111111111111", userId: "u", userUuid: "u", email: "a@b.co", role: "owner" }
      : null);
});
afterEach(() => { process.env = { ...initial }; });

describe("orgContext : jeton en query string (C-13)", () => {
  it("n'authentifie PAS un jeton de session passe en query sur une route ordinaire", async () => {
    const r = await jouerOrgContext({ method: "GET", headers: { accept: "application/json" }, query: { token: "jeton-valide" } });
    expect(r.orgContext.role).toBeUndefined();
    expect(r.orgId).toBe("default");
    expect(session.get).not.toHaveBeenCalled();
  });
  it("authentifie toujours ce jeton sur un flux SSE", async () => {
    const r = await jouerOrgContext({ method: "GET", headers: { accept: "text/event-stream" }, query: { token: "jeton-valide" } });
    expect(r.orgContext.role).toBe("owner");
  });
  it("le jeton en en-tete Authorization marche partout", async () => {
    const r = await jouerOrgContext({ method: "POST", headers: { authorization: "Bearer jeton-valide" }, query: {} });
    expect(r.orgContext.role).toBe("owner");
  });
  it("API_SECRET_KEY en query sur une route ordinaire ne donne pas le role service", async () => {
    process.env["API_SECRET_KEY"] = "cle-de-service-0123456789abcdef0123";
    const r = await jouerOrgContext({ method: "GET", headers: { accept: "application/json" }, query: { token: process.env["API_SECRET_KEY"] } });
    expect(r.orgContext.userId).toBeUndefined();
  });
});

describe("API_SECRET_KEY comparee en temps constant (C-09)", () => {
  it("orgContext : la bonne cle donne le contexte service, une cle proche non", async () => {
    process.env["API_SECRET_KEY"] = "cle-de-service-0123456789abcdef0123";
    const ok = await jouerOrgContext({ method: "GET", headers: { "x-api-key": "cle-de-service-0123456789abcdef0123" }, query: {} });
    expect(ok.orgContext.userId).toBe("service");
    const ko = await jouerOrgContext({ method: "GET", headers: { "x-api-key": "cle-de-service-0123456789abcdef0124" }, query: {} });
    expect(ko.orgContext.userId).toBeUndefined();
  });
  it("requireAuth : bonne cle acceptee, cle proche refusee", async () => {
    process.env["API_SECRET_KEY"] = "cle-de-service-0123456789abcdef0123";
    session.get.mockResolvedValue(null);
    const jouer = async (cle: string) => {
      let passe = false;
      let code = 0;
      const res = { status(c: number) { code = c; return this; }, json() { return this; } };
      const req = { headers: { "x-api-key": cle }, query: {}, method: "GET", url: "/api/x", cookies: {} };
      await new Promise<void>((fini) => {
        requireAuth(req as never, res as never, () => { passe = true; fini(); });
        setTimeout(fini, 50);
      });
      return { passe, code };
    };
    expect((await jouer("cle-de-service-0123456789abcdef0123")).passe).toBe(true);
    const ko = await jouer("cle-de-service-0123456789abcdef0124");
    expect(ko.passe).toBe(false);
    expect(ko.code).toBe(401);
  });
});
