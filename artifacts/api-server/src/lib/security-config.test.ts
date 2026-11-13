/**
 * security-config.test.ts — constat C-15 de l'audit du 08/11/2026.
 *
 * - un jeton INVALIDE ne traverse plus requireAuth quand API_SECRET_KEY est
 *   absente hors production (le defaut NODE_ENV=development ouvrait l'API) ;
 * - JWT_SECRET n'a plus de repli public hors tests ;
 * - les anomalies de configuration sont detectees au demarrage.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

const session = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../services/sessions.js", () => ({
  getSession: (...a: unknown[]) => session.get(...(a as [])),
}));

import {
  devAuthBypassAllowed,
  resolveJwtSecret,
  evaluateSecurityConfig,
  enforceSecurityConfig,
} from "./security-config.js";
import { requireAuth } from "../middlewares/requireAuth.js";

async function avecJeton(jeton: string): Promise<{ passe: boolean; code?: number }> {
  let passe = false;
  let code: number | undefined;
  const res = { status(c: number) { code = c; return this; }, json() { return this; } };
  const req = { headers: { authorization: `Bearer ${jeton}` }, query: {}, method: "GET", url: "/api/missions", cookies: {} };
  await new Promise<void>((fini) => {
    requireAuth(req as never, res as never, () => { passe = true; fini(); });
    setTimeout(fini, 50);
  });
  return { passe, code };
}

const initial = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  session.get.mockResolvedValue(null);
  delete process.env["API_SECRET_KEY"];
  delete process.env["ALLOW_UNAUTHENTICATED_DEV"];
  delete process.env["RENDER"];
  delete process.env["RENDER_SERVICE_NAME"];
});
afterEach(() => { process.env = { ...initial }; });

describe("requireAuth : jeton invalide sans API_SECRET_KEY (C-15)", () => {
  it.each(["development", "test"])("NODE_ENV=%s : un jeton bidon est refuse en 401", async (env) => {
    process.env["NODE_ENV"] = env;
    const r = await avecJeton("jeton-bidon");
    expect(r.passe, "un jeton invalide a traverse le middleware").toBe(false);
    expect(r.code).toBe(401);
  });

  it("l'ouverture reste possible uniquement avec l'intention declaree, hors production", async () => {
    process.env["NODE_ENV"] = "development";
    process.env["ALLOW_UNAUTHENTICATED_DEV"] = "true";
    expect((await avecJeton("jeton-bidon")).passe).toBe(true);
  });

  it("le drapeau n'est jamais honore sur Render, meme avec NODE_ENV=test", async () => {
    process.env["NODE_ENV"] = "test";
    process.env["ALLOW_UNAUTHENTICATED_DEV"] = "true";
    process.env["RENDER"] = "true";
    expect(devAuthBypassAllowed()).toBe(false);
    expect((await avecJeton("jeton-bidon")).passe).toBe(false);
  });

  it("en production sans API_SECRET_KEY : 503 (inchange)", async () => {
    process.env["NODE_ENV"] = "production";
    expect((await avecJeton("jeton-bidon")).code).toBe(503);
  });

  it("une session valide passe toujours", async () => {
    process.env["NODE_ENV"] = "test";
    session.get.mockResolvedValue({ orgId: "o", userId: "u", role: "owner" });
    expect((await avecJeton("session-ok")).passe).toBe(true);
  });
});

describe("resolveJwtSecret : plus de repli public (C-15)", () => {
  it("renvoie le secret configure", () => {
    expect(resolveJwtSecret({ JWT_SECRET: "x".repeat(40), NODE_ENV: "production" })).toBe("x".repeat(40));
  });
  it("leve hors tests quand le secret manque", () => {
    expect(() => resolveJwtSecret({ NODE_ENV: "production" })).toThrow(/JWT_SECRET/);
    expect(() => resolveJwtSecret({ NODE_ENV: "development" })).toThrow(/JWT_SECRET/);
    expect(() => resolveJwtSecret({})).toThrow(/JWT_SECRET/);
    expect(() => resolveJwtSecret({ JWT_SECRET: "   ", NODE_ENV: "production" })).toThrow();
  });
  it("garde un repli propre aux tests, different des anciens secrets publics", () => {
    const s = resolveJwtSecret({ NODE_ENV: "test" });
    expect(s).not.toBe("dev-secret-change-me-in-prod-min32chars");
    expect(s).not.toBe("dev-key-please-change");
  });
});

describe("evaluateSecurityConfig / enforceSecurityConfig", () => {
  const bon = { NODE_ENV: "production", JWT_SECRET: "j".repeat(40), API_SECRET_KEY: "a".repeat(40) };

  it("une configuration saine ne produit rien", () => {
    expect(evaluateSecurityConfig(bon)).toEqual({ fatal: [], warnings: [] });
  });
  it("JWT_SECRET absent hors test est fatal", () => {
    expect(evaluateSecurityConfig({ NODE_ENV: "production" }).fatal.join(" ")).toMatch(/JWT_SECRET/);
    expect(evaluateSecurityConfig({ NODE_ENV: "test" }).fatal).toEqual([]);
  });
  it("NODE_ENV absent sur Render et drapeaux de contournement sont signales", () => {
    const r = evaluateSecurityConfig({ RENDER: "true", JWT_SECRET: "j".repeat(40), API_SECRET_KEY: "a", ALLOW_UNAUTHENTICATED_DEV: "true", ENABLE_DEV_AUTH: "true" });
    expect(r.warnings.join("\n")).toMatch(/NODE_ENV absent/);
    expect(r.warnings.join("\n")).toMatch(/ALLOW_UNAUTHENTICATED_DEV/);
    expect(r.warnings.join("\n")).toMatch(/ENABLE_DEV_AUTH/);
    expect(r.fatal).toEqual([]);
  });
  it("SECURITY_STRICT_STARTUP=true rend ces anomalies fatales", () => {
    const r = evaluateSecurityConfig({ RENDER: "true", JWT_SECRET: "j".repeat(40), SECURITY_STRICT_STARTUP: "true" });
    expect(r.fatal.length).toBeGreaterThan(0);
  });
  it("enforceSecurityConfig sort avec le code 1 sur anomalie fatale, sans rien casser sinon", () => {
    const log = { warn: vi.fn(), fatal: vi.fn() };
    const exit = vi.fn();
    enforceSecurityConfig(log, exit as never, { NODE_ENV: "production" });
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockClear();
    enforceSecurityConfig(log, exit as never, bon);
    expect(exit).not.toHaveBeenCalled();
  });
});
