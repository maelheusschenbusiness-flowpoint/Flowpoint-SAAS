/**
 * monitor-ssrf-pinned.test.ts — constat C-16 de l'audit du 08/11/2026.
 *
 * Les monitors validaient le DNS (checkDnsResolution) puis appelaient fetch(),
 * qui re-resolvait le nom : un DNS a TTL court pouvait donc repondre une IP
 * publique a la validation, puis une IP interne a la connexion (rebinding).
 * Desormais, la sonde passe par le garde DNS epingle de url-fetcher : la
 * connexion TCP vise l'adresse VALIDEE, jamais une seconde resolution.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";

const dnsMock = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock("node:dns", () => ({ promises: { lookup: (...a: unknown[]) => dnsMock.lookup(...a) } }));

const httpMock = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
function fabrique(statusCode: number, headers: Record<string, string> = {}) {
  return (opts: Record<string, unknown>, cb: (res: unknown) => void) => {
    httpMock.calls.push(opts);
    const req = {
      on() { return req; },
      once() { return req; },
      destroy() {},
      end() { cb({ statusCode, headers, destroy() {} }); },
    };
    return req;
  };
}
const reponses = vi.hoisted(() => ({ file: [] as Array<{ status: number; headers?: Record<string, string> }> }));
vi.mock("node:https", () => ({
  request: (opts: Record<string, unknown>, cb: (res: unknown) => void) => {
    const r = reponses.file.shift() ?? { status: 200 };
    return fabrique(r.status, r.headers ?? {})(opts, cb);
  },
}));
vi.mock("node:http", () => ({
  request: (opts: Record<string, unknown>, cb: (res: unknown) => void) => {
    const r = reponses.file.shift() ?? { status: 200 };
    return fabrique(r.status, r.headers ?? {})(opts, cb);
  },
}));

import { probeUrlPinned } from "./url-fetcher.js";

const PUBLIQUE = "93.184.216.34";

beforeEach(() => {
  vi.clearAllMocks();
  httpMock.calls.length = 0;
  reponses.file.length = 0;
});

describe("probeUrlPinned : DNS epingle (C-16)", () => {
  it("se connecte a l'IP VALIDEE et ne re-resout jamais le nom (anti-rebinding)", async () => {
    // Une seconde resolution repondrait une IP interne : elle ne doit pas avoir lieu.
    dnsMock.lookup
      .mockResolvedValueOnce([{ address: PUBLIQUE, family: 4 }])
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    const r = await probeUrlPinned("https://exemple.test/sante");
    expect(r).toMatchObject({ reached: true, statusCode: 200, blocked: false });
    expect(dnsMock.lookup).toHaveBeenCalledTimes(1);
    expect(httpMock.calls).toHaveLength(1);
    expect(httpMock.calls[0]!["hostname"]).toBe(PUBLIQUE);
    expect((httpMock.calls[0]!["headers"] as Record<string, string>)["Host"]).toBe("exemple.test");
    expect(httpMock.calls[0]!["method"]).toBe("HEAD");
  });

  it("bloque un nom qui resout vers une adresse interne, sans aucune connexion", async () => {
    dnsMock.lookup.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
    const r = await probeUrlPinned("https://interne.test/");
    expect(r.blocked).toBe(true);
    expect(r.reached).toBe(false);
    expect(httpMock.calls).toHaveLength(0);
  });

  it("bloque aussi si UNE des adresses resolues est interne", async () => {
    dnsMock.lookup.mockResolvedValue([
      { address: PUBLIQUE, family: 4 },
      { address: "169.254.169.254", family: 4 },
    ]);
    expect((await probeUrlPinned("https://mixte.test/")).blocked).toBe(true);
    expect(httpMock.calls).toHaveLength(0);
  });

  it("revalide chaque redirection : un saut vers un nom interne est bloque", async () => {
    dnsMock.lookup
      .mockResolvedValueOnce([{ address: PUBLIQUE, family: 4 }])
      .mockResolvedValueOnce([{ address: "192.168.1.10", family: 4 }]);
    reponses.file.push({ status: 302, headers: { location: "https://rebond.test/admin" } });
    const r = await probeUrlPinned("https://exemple.test/");
    expect(r.blocked).toBe(true);
    expect(httpMock.calls).toHaveLength(1);
  });

  it("refuse un protocole non http(s) en redirection", async () => {
    dnsMock.lookup.mockResolvedValue([{ address: PUBLIQUE, family: 4 }]);
    reponses.file.push({ status: 301, headers: { location: "file:///etc/passwd" } });
    const r = await probeUrlPinned("https://exemple.test/");
    expect(r.blocked).toBe(true);
  });

  it("suit une redirection sure et renvoie le statut final", async () => {
    dnsMock.lookup.mockResolvedValue([{ address: PUBLIQUE, family: 4 }]);
    reponses.file.push({ status: 301, headers: { location: "https://exemple.test/final" } }, { status: 204 });
    const r = await probeUrlPinned("https://exemple.test/");
    expect(r).toMatchObject({ reached: true, statusCode: 204, blocked: false });
    expect(httpMock.calls).toHaveLength(2);
  });
});
