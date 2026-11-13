/**
 * requireAuth-dev-bypass.test.ts
 *
 * MESURE DU 17/10/2026, pendant la mise en place des tests E2E navigateur :
 * `requireAuth` laissait passer TOUTE requete sans credential des lors que
 * `API_SECRET_KEY` etait absente et que `NODE_ENV` ne valait pas exactement
 * "production". Constate sur un serveur local : `/api/missions` et
 * `/api/reports` repondaient 200 a un appelant anonyme.
 *
 * Les deux instances deployees repondent bien 401 — elles posent
 * NODE_ENV=production — ce n'etait donc pas une faille en production. Mais
 * l'ouverture dependait de l'ABSENCE d'une variable : un oubli sur un futur
 * environnement d'apercu aurait tout ouvert, en silence.
 *
 * Le contournement demande maintenant une intention declaree. Ces tests
 * exercent le vrai middleware.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
const session = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../services/sessions.js", () => ({
  getSession: (...a: unknown[]) => session.get(...(a as [])),
}));

import { requireAuth } from "./requireAuth.js";

type Reponse = { code?: number; corps?: unknown };

function fausseReponse(): { res: unknown; vu: Reponse } {
  const vu: Reponse = {};
  const res = {
    status(c: number) { vu.code = c; return this; },
    json(b: unknown) { vu.corps = b; return this; },
  };
  return { res, vu };
}

/** Joue le middleware sur une requete SANS aucune credential. */
async function sansCredential(): Promise<{ passe: boolean; vu: Reponse }> {
  const { res, vu } = fausseReponse();
  let passe = false;
  const req = { headers: {}, query: {}, method: "GET", url: "/api/missions", cookies: {} };
  await new Promise<void>((fini) => {
    requireAuth(req as never, res as never, () => { passe = true; fini(); });
    setTimeout(fini, 50);
  });
  return { passe, vu };
}

const environnementInitial = { ...process.env };
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env["API_SECRET_KEY"];
  delete process.env["ALLOW_UNAUTHENTICATED_DEV"];
  process.env["NODE_ENV"] = "development";
});
afterEach(() => { process.env = { ...environnementInitial }; });

describe("une requete sans credential est refusee par defaut", () => {
  it("sans API_SECRET_KEY et hors production, l'API privee reste FERMEE", async () => {
    const { passe, vu } = await sansCredential();
    expect(passe, "la requete anonyme a traverse le middleware").toBe(false);
    expect(vu.code).toBe(401);
  });

  it("avec une API_SECRET_KEY posee, elle reste fermee aussi", async () => {
    process.env["API_SECRET_KEY"] = "secret-de-service";
    const { passe, vu } = await sansCredential();
    expect(passe).toBe(false);
    expect(vu.code).toBe(401);
  });

  it("en production, elle reste fermee", async () => {
    process.env["NODE_ENV"] = "production";
    const { passe, vu } = await sansCredential();
    expect(passe).toBe(false);
    expect(vu.code).toBe(401);
  });
});

describe("le contournement de developpement exige une intention declaree", () => {
  it("ALLOW_UNAUTHENTICATED_DEV=true ouvre l'acces hors production", async () => {
    process.env["ALLOW_UNAUTHENTICATED_DEV"] = "true";
    const { passe } = await sansCredential();
    expect(passe, "le drapeau explicite n'ouvre pas l'acces en developpement").toBe(true);
  });

  it("le drapeau n'ouvre RIEN en production", async () => {
    process.env["ALLOW_UNAUTHENTICATED_DEV"] = "true";
    process.env["NODE_ENV"] = "production";
    const { passe, vu } = await sansCredential();
    expect(passe, "le drapeau a ouvert l'acces EN PRODUCTION").toBe(false);
    expect(vu.code).toBe(401);
  });

  it("une valeur autre que la chaine « true » n'ouvre rien", async () => {
    for (const valeur of ["1", "yes", "True", "oui", ""]) {
      process.env["ALLOW_UNAUTHENTICATED_DEV"] = valeur;
      const { passe } = await sansCredential();
      expect(passe, `la valeur « ${valeur} » a ouvert l'acces`).toBe(false);
    }
  });

  it("l'ouverture ne depend plus de l'ABSENCE d'une variable", async () => {
    // C'etait le defaut : oublier API_SECRET_KEY suffisait a tout ouvrir.
    delete process.env["API_SECRET_KEY"];
    const { passe } = await sansCredential();
    expect(passe).toBe(false);
  });
});
