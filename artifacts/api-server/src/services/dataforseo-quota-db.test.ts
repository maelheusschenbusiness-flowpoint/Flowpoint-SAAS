/**
 * dataforseo-quota-db.test.ts
 *
 * Le compteur de quota protege des appels PAYANTS. Il vivait en memoire de
 * processus, avec deux consequences mesurees le 17/10/2026 :
 *   - un redemarrage remettait le plafond a zero (la fonction ne lisait jamais
 *     la base), donc chaque deploiement Render rouvrait 1000 requetes ;
 *   - plusieurs instances auraient compte chacune pour elle.
 *
 * Ces tests tournent contre un vrai PostgreSQL : seule une base peut prouver
 * qu'un compteur survit a un redemarrage et resiste a la concurrence.
 */
import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) =>
  importOriginal<typeof import("@workspace/db")>()
);
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { pool } from "@workspace/db";
import { checkAndIncrementQuota, getQuotaUsageFromDB } from "./dataforseo-service.js";

const ORG = `quota-test-${Date.now()}`;
const AUJOURDHUI = new Date().toISOString().slice(0, 10);

async function lireBase(org: string): Promise<number> {
  const r = await pool.query<{ requests_used: number }>(
    `SELECT requests_used FROM dataforseo_quota WHERE org_id = $1 AND date = $2`,
    [org, AUJOURDHUI]
  );
  return Number(r.rows[0]?.requests_used ?? 0);
}

beforeEach(async () => {
  await pool.query(`DELETE FROM dataforseo_quota WHERE org_id LIKE 'quota-test-%'`);
});
afterAll(async () => {
  await pool.query(`DELETE FROM dataforseo_quota WHERE org_id LIKE 'quota-test-%'`);
});

describe("le compteur de quota est durable", () => {
  it("chaque consommation est ecrite en base, pas seulement en memoire", async () => {
    await checkAndIncrementQuota(ORG, "Pro", 3);
    expect(await lireBase(ORG)).toBe(3);
    await checkAndIncrementQuota(ORG, "Pro", 2);
    expect(await lireBase(ORG)).toBe(5);
  });

  it("le compte lu repart de la base, pas de zero — c'etait le defaut du redemarrage", async () => {
    await checkAndIncrementQuota(ORG, "Pro", 7);
    // getQuotaUsageFromDB rechauffe le cache comme le ferait un processus neuf.
    const vu = await getQuotaUsageFromDB(ORG);
    expect(vu.used).toBe(7);
  });
});

describe("le compteur resiste a la concurrence", () => {
  it("vingt consommations simultanees comptent vingt, pas moins", async () => {
    await Promise.all(Array.from({ length: 20 }, () => checkAndIncrementQuota(ORG, "Pro", 1)));
    // Si la lecture et l'ecriture n'etaient pas serialisees par PostgreSQL,
    // des increments se perdraient et le total serait inferieur a 20.
    expect(await lireBase(ORG)).toBe(20);
  });

  it("le plafond refuse au-dela de la limite, et le refus est partage", async () => {
    const LIMITE = 1000;
    await pool.query(
      `INSERT INTO dataforseo_quota (org_id, date, requests_used, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (org_id, date) DO UPDATE SET requests_used = EXCLUDED.requests_used`,
      [ORG, AUJOURDHUI, LIMITE - 1]
    );
    expect(await checkAndIncrementQuota(ORG, "Pro", 1)).toBe(true);   // atteint pile la limite
    expect(await checkAndIncrementQuota(ORG, "Pro", 1)).toBe(false);  // depasse
    expect(await checkAndIncrementQuota(ORG, "Pro", 1)).toBe(false);  // et reste refuse
  });

  it("deux organisations ne partagent pas leur quota", async () => {
    const autre = `${ORG}-bis`;
    await checkAndIncrementQuota(ORG, "Pro", 4);
    await checkAndIncrementQuota(autre, "Pro", 1);
    expect(await lireBase(ORG)).toBe(4);
    expect(await lireBase(autre)).toBe(1);
  });
});
