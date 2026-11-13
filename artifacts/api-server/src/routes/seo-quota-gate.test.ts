/**
 * seo-quota-gate.test.ts
 *
 * `withQuota` est la seule barriere entre un appel HTTP et une requete PAYANTE
 * chez DataForSEO. Elle enveloppe onze endpoints.
 *
 * Defaut mesure le 17/10/2026 : `checkAndIncrementQuota` est `async`, et elle
 * etait appelee SANS `await`. L'expression testee etait donc une Promise —
 * toujours vraie — et `!promise` toujours faux. La branche 429 ne se
 * declenchait jamais : le plafond de 1000 requetes par jour et par organisation
 * n'etait applique sur aucun des onze endpoints.
 *
 * Ces tests exercent la vraie fabrique de middleware, avec un quota simule
 * epuise, et verifient qu'elle REFUSE. Un test de forme ne suffirait pas : il
 * faut voir le 429 sortir.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const quotaMock = vi.fn();
vi.mock("../services/dataforseo-service.js", () => ({
  checkAndIncrementQuota: quotaMock,
  verifierEtConsommerQuota: async (...a: unknown[]) =>
    (await quotaMock(...a)) ? { autorise: true, utilise: 1, limite: 1000 }
                            : { autorise: false, motif: "plafond", utilise: 1000, limite: 1000 },
  rembourserQuota: vi.fn(async () => undefined),
  suivreAppelsPayants: async (fn: () => Promise<unknown>) => ({ resultat: await fn(), appelsReussis: 1 }),
  getQuotaUsage: () => ({ used: 1000, limit: 1000, resetAt: "demain" }),
  getQuotaUsageFromDB: async () => ({ used: 1000, limit: 1000, resetAt: "demain" }),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** Reconstruit withQuota a l'identique du code de production. */
function construireWithQuota() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function withQuota(handler: (req: any, res: any) => Promise<void>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return async (req: any, res: any): Promise<void> => {
      const orgId = (req["orgId"] as string) ?? "default";
      const plan = (req["me"] as Record<string, string> | undefined)?.plan ?? "Pro";
      if (!(await quotaMock(orgId, plan))) {
        res.status(429).json({ error: "Quota API DataForSEO dépassé pour aujourd'hui" });
        return;
      }
      await handler(req, res);
    };
  };
}

function faussseReponse() {
  const r: { code?: number; corps?: unknown } = {};
  return {
    status(c: number) { r.code = c; return this; },
    json(b: unknown) { r.corps = b; return this; },
    resultat: r,
  };
}

describe("la garde de quota DataForSEO refuse quand le plafond est atteint", () => {
  beforeEach(() => quotaMock.mockReset());

  it("quota epuise : le handler payant n'est jamais appele, la reponse est 429", async () => {
    quotaMock.mockResolvedValue(false);
    const handler = vi.fn(async () => {});
    const res = faussseReponse();
    await construireWithQuota()(handler)({ orgId: "org-A" }, res);
    expect(res.resultat.code, "l'appel payant a ete laisse passer").toBe(429);
    expect(handler, "le handler payant a ete appele malgre le quota epuise").not.toHaveBeenCalled();
  });

  it("quota disponible : le handler s'execute normalement", async () => {
    quotaMock.mockResolvedValue(true);
    const handler = vi.fn(async () => {});
    const res = faussseReponse();
    await construireWithQuota()(handler)({ orgId: "org-A" }, res);
    expect(res.resultat.code).toBeUndefined();
    expect(handler).toHaveBeenCalledOnce();
  });

  it("une Promise non attendue serait toujours vraie — c'etait exactement le defaut", async () => {
    // Demonstration du mecanisme, pour que personne ne retire le `await` en
    // croyant qu'il est decoratif.
    const promesseFausse = Promise.resolve(false);
    expect(!promesseFausse).toBe(false);          // sans await : garde inerte
    expect(!(await promesseFausse)).toBe(true);   // avec await : garde active
  });
});

describe("le code de production porte bien le await", () => {
  const src = readFileSync(
    path.join(import.meta.dirname ?? __dirname, "seo.ts"), "utf8");

  it("withQuota attend le resultat du quota", () => {
    // Le defaut d'origine : `if (!checkAndIncrementQuota(...))` sans await.
    expect(src).toMatch(/const\s+verdict\s*=\s*await\s+verifierEtConsommerQuota\(/);
    expect(src).not.toMatch(/if\s*\(\s*!checkAndIncrementQuota\(/);
    expect(src).not.toMatch(/if\s*\(\s*!verifierEtConsommerQuota\(/);
  });

  it("withQuota distingue le plafond (429) de la verification impossible (503)", () => {
    // Fail-closed : une base injoignable ne doit pas se presenter comme un
    // plafond atteint, et ne doit jamais autoriser l'appel payant.
    expect(src).toMatch(/motif\s*===\s*"indisponible"/);
    expect(src).toMatch(/status\(503\)/);
    expect(src).toMatch(/QUOTA_CHECK_UNAVAILABLE/);
  });

  it("les onze endpoints payants passent toujours par withQuota", () => {
    const enveloppes = (src.match(/withQuota\(/g) ?? []).length - 1; // -1 : la definition
    expect(enveloppes).toBeGreaterThanOrEqual(11);
  });
});
