/**
 * dataforseo-quota-failclosed-db.test.ts
 *
 * Trois proprietes que seule une vraie base peut etablir :
 *
 *   1. FAIL-CLOSED — si PostgreSQL est injoignable, le verdict est
 *      `indisponible` et AUCUNE unite n'est consommee. L'ancien repli comptait
 *      en memoire de processus : il laissait passer des appels factures sur un
 *      compteur reparti de zero a chaque redemarrage.
 *   2. CONCURRENCE — vingt consommations simultanees pres du plafond donnent le
 *      compte exact, et le nombre d'autorisations accordees est exactement le
 *      nombre d'unites restantes. Pas une de plus.
 *   3. REMBOURSEMENT — une unite reservee puis non utilisee est rendue, et le
 *      compteur ne descend jamais sous zero.
 */
import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) =>
  importOriginal<typeof import("@workspace/db")>()
);
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { pool } from "@workspace/db";
import {
  verifierEtConsommerQuota,
  rembourserQuota,
  suivreAppelsPayants,
} from "./dataforseo-service.js";

const ORG = `quota-fc-${Date.now()}`;
const AUJOURDHUI = new Date().toISOString().slice(0, 10);

async function lireBase(org = ORG): Promise<number | null> {
  const r = await pool.query<{ requests_used: number }>(
    `SELECT requests_used FROM dataforseo_quota WHERE org_id = $1 AND date = $2`,
    [org, AUJOURDHUI]
  );
  return r.rows[0] === undefined ? null : Number(r.rows[0].requests_used);
}

async function poser(utilise: number, org = ORG): Promise<void> {
  await pool.query(
    `INSERT INTO dataforseo_quota (org_id, date, requests_used, created_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (org_id, date) DO UPDATE SET requests_used = EXCLUDED.requests_used`,
    [org, AUJOURDHUI, utilise]
  );
}

beforeEach(async () => {
  vi.restoreAllMocks();
  await pool.query(`DELETE FROM dataforseo_quota WHERE org_id LIKE 'quota-fc-%'`);
});
afterAll(async () => {
  await pool.query(`DELETE FROM dataforseo_quota WHERE org_id LIKE 'quota-fc-%'`);
});

describe("1. fail-closed quand PostgreSQL est injoignable", () => {
  it("le verdict est `indisponible`, jamais `plafond`", async () => {
    vi.spyOn(pool, "connect").mockRejectedValue(new Error("ECONNREFUSED") as never);
    const v = await verifierEtConsommerQuota(ORG, "Pro", 1);
    expect(v.autorise).toBe(false);
    expect(v.autorise === false ? v.motif : null).toBe("indisponible");
  });

  it("aucune unite n'est consommee : la ligne reste absente en base", async () => {
    vi.spyOn(pool, "connect").mockRejectedValue(new Error("ECONNREFUSED") as never);
    await verifierEtConsommerQuota(ORG, "Pro", 5);
    vi.restoreAllMocks();
    expect(await lireBase()).toBeNull();
  });

  it("un compteur deja a zero ne devient pas une autorisation", async () => {
    await poser(0);
    vi.spyOn(pool, "connect").mockRejectedValue(new Error("ECONNREFUSED") as never);
    for (let i = 0; i < 5; i++) {
      const v = await verifierEtConsommerQuota(ORG, "Pro", 1);
      expect(v.autorise).toBe(false);
    }
    vi.restoreAllMocks();
    expect(await lireBase()).toBe(0);
  });

  it("le service redevient autorisant des que la base repond", async () => {
    const spy = vi.spyOn(pool, "connect").mockRejectedValue(new Error("ECONNREFUSED") as never);
    expect((await verifierEtConsommerQuota(ORG, "Pro", 1)).autorise).toBe(false);
    spy.mockRestore();
    expect((await verifierEtConsommerQuota(ORG, "Pro", 1)).autorise).toBe(true);
    expect(await lireBase()).toBe(1);
  });
});

describe("2. concurrence au bord du plafond", () => {
  it("vingt consommations simultanees comptent exactement vingt unites", async () => {
    await poser(0);
    await Promise.all(Array.from({ length: 20 }, () => verifierEtConsommerQuota(ORG, "Pro", 1)));
    expect(await lireBase()).toBe(20);
  });

  it("a cinq unites du plafond, exactement cinq appels sur vingt sont autorises", async () => {
    await poser(995);
    const verdicts = await Promise.all(
      Array.from({ length: 20 }, () => verifierEtConsommerQuota(ORG, "Pro", 1))
    );
    expect(verdicts.filter((v) => v.autorise).length).toBe(5);
    expect(verdicts.filter((v) => !v.autorise).length).toBe(15);
    expect(verdicts.every((v) => v.autorise || v.motif === "plafond")).toBe(true);
    expect(await lireBase()).toBe(1015);
  });

  it("deux organisations ne partagent pas leur compteur", async () => {
    const autre = `${ORG}-b`;
    await Promise.all([
      ...Array.from({ length: 6 }, () => verifierEtConsommerQuota(ORG, "Pro", 1)),
      ...Array.from({ length: 4 }, () => verifierEtConsommerQuota(autre, "Pro", 1)),
    ]);
    expect(await lireBase(ORG)).toBe(6);
    expect(await lireBase(autre)).toBe(4);
  });
});

describe("3. remboursement d'une unite non consommee", () => {
  it("rend l'unite reservee", async () => {
    await poser(10);
    await rembourserQuota(ORG, 1);
    expect(await lireBase()).toBe(9);
  });

  it("ne descend jamais sous zero", async () => {
    await poser(1);
    await rembourserQuota(ORG, 50);
    expect(await lireBase()).toBe(0);
  });

  it("un remboursement sur une ligne absente ne cree rien", async () => {
    await rembourserQuota(ORG, 1);
    expect(await lireBase()).toBeNull();
  });

  it("reservation puis remboursement laissent le compteur intact", async () => {
    await poser(100);
    const v = await verifierEtConsommerQuota(ORG, "Pro", 1);
    expect(v.autorise).toBe(true);
    expect(await lireBase()).toBe(101);
    await rembourserQuota(ORG, 1);
    expect(await lireBase()).toBe(100);
  });

  it("une base injoignable pendant le remboursement ne fait pas echouer l'appelant", async () => {
    await poser(10);
    vi.spyOn(pool, "connect").mockRejectedValue(new Error("ECONNREFUSED") as never);
    await expect(rembourserQuota(ORG, 1)).resolves.toBeUndefined();
  });
});

describe("le compteur d'appels payants ne compte que les appels aboutis", () => {
  it("un traitement sans sortie reseau rapporte zero appel paye", async () => {
    const { appelsReussis } = await suivreAppelsPayants(async () => "rien");
    expect(appelsReussis).toBe(0);
  });

  it("le resultat du traitement est transmis tel quel", async () => {
    const { resultat } = await suivreAppelsPayants(async () => ({ a: 1 }));
    expect(resultat).toEqual({ a: 1 });
  });
});
