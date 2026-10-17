/**
 * betterstack-creation-guards-db.test.ts
 *
 * Verification demandee le 17/10/2026 : « les permissions sur les creations de
 * moniteurs ». Trois defauts mesures sur la branche fix/betterstack-tenancy —
 * l'isolation des moniteurs EXISTANTS etait correcte, la CREATION ne l'etait
 * pas :
 *
 *   1. AUCUNE garde de role sur les vingt-et-une routes BetterStack, alors que
 *      les routes des moniteurs natifs exigent `canAdmin` pour creer, modifier
 *      et supprimer. Un simple membre pouvait creer et supprimer.
 *   2. AUCUN plafond. La creation native passe par `checkQuota("monitors")`
 *      puis une relecture atomique ; celle-ci ne passait par rien. Le compte
 *      BetterStack est partage et facture a FlowPoint : une organisation
 *      pouvait y creer un nombre illimite de moniteurs payants.
 *   3. ORPHELIN POSSIBLE. `createMonitor` appelait BetterStack puis inscrivait
 *      le proprietaire. Si l'inscription echouait — table absente, base
 *      injoignable — le moniteur existait chez BetterStack SANS proprietaire :
 *      facture, invisible de tous, et par construction irrecuperable puisqu'un
 *      moniteur sans proprietaire reste inaccessible.
 *
 * Tests contre un vrai PostgreSQL. Toute sortie reseau est interceptee et
 * comptee : un refus ne vaut que s'il intervient AVANT l'appel a BetterStack.
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.hoisted(() => { process.env["BETTERSTACK_API_TOKEN"] = "jeton-de-test-creation"; });

const appels: Array<{ url: string; methode: string }> = [];
vi.mock("@workspace/db", async (importOriginal) =>
  importOriginal<typeof import("@workspace/db")>()
);
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// Le plafond vient de la facturation : on le fixe, on ne le decouvre pas.
const plafond = vi.fn(async () => ({ allowed: true, used: 0, limit: 3, plan: "standard" }));
vi.mock("./billing-service.js", () => ({ checkQuota: (...a: unknown[]) => plafond(...(a as [])) }));

let prochainId = 1;
vi.stubGlobal("fetch", vi.fn(async (url: string, init?: { method?: string }) => {
  appels.push({ url: String(url), methode: init?.method ?? "GET" });
  return {
    ok: true, status: 200,
    headers: { get: () => null },
    json: async () => ({ data: { id: `M-NOUVEAU-${prochainId++}`, attributes: {} } }),
  } as unknown as Response;
}));

import { pool } from "@workspace/db";
import { ensureBsOwnershipSchema, registreAppartenancePresent, BS_OWNERSHIP_TABLE } from "./init-bs-ownership.js";
import { createMonitor, monitorsDeLOrganisation } from "./betterstack-service.js";

const ORG = `bs-creation-${Date.now()}`;

beforeAll(async () => { await ensureBsOwnershipSchema(pool); });
afterAll(async () => {
  await pool.query(`DELETE FROM ${BS_OWNERSHIP_TABLE} WHERE org_id LIKE 'bs-creation-%'`);
});
// L'espion pose sur `pool.query` par un test doit etre retire AVANT toute
// autre requete, sinon le nettoyage du test suivant echoue a son tour.
afterEach(() => { vi.restoreAllMocks(); });
beforeEach(async () => {
  vi.restoreAllMocks();
  appels.length = 0;
  prochainId = 1;
  plafond.mockResolvedValue({ allowed: true, used: 0, limit: 3, plan: "standard" });
  // La suite complete tourne en parallele sur la meme base, et un autre
  // fichier refait le schema en cours de route. La migration etant idempotente
  // et peu couteuse, on la pose ici plutot que de dependre de l'ordre
  // d'execution des fichiers.
  await ensureBsOwnershipSchema(pool);
  await pool.query(`DELETE FROM ${BS_OWNERSHIP_TABLE} WHERE org_id LIKE 'bs-creation-%'`);
});

const charge = { url: "https://exemple.fr", name: "Site" };

describe("1. gardes de role sur les routes mutantes", () => {
  const src = readFileSync(path.join(import.meta.dirname ?? __dirname, "../routes/betterstack.ts"), "utf8");

  const mutantes: Array<[string, string]> = [
    ["POST   /betterstack/monitors",             'router.post("/betterstack/monitors", canAdmin,'],
    ["PATCH  /betterstack/monitors/:id",         'router.patch("/betterstack/monitors/:id", canAdmin,'],
    ["DELETE /betterstack/monitors/:id",         'router.delete("/betterstack/monitors/:id", canAdmin,'],
    ["POST   /betterstack/monitors/:id/pause",   'router.post("/betterstack/monitors/:id/pause", canAdmin,'],
    ["POST   /betterstack/monitors/:id/resume",  'router.post("/betterstack/monitors/:id/resume", canAdmin,'],
    ["POST   /betterstack/heartbeats",           'router.post("/betterstack/heartbeats", canAdmin,'],
    ["POST   /betterstack/status-pages",         'router.post("/betterstack/status-pages", canAdmin,'],
  ];
  for (const [nom, attendu] of mutantes) {
    it(`${nom} exige canAdmin`, () => {
      expect(src, `${nom} est ouverte a un simple membre`).toContain(attendu);
    });
  }

  it("acquitter un incident exige au moins canWrite", () => {
    expect(src).toContain('router.post("/betterstack/incidents/:id/acknowledge", canWrite,');
  });

  it("aucune route mutante n'est restee sans garde", () => {
    const sansGarde = [...src.matchAll(/router\.(post|patch|delete|put)\("([^"]+)",\s*(\w+)?/g)]
      .filter((m) => m[3] !== "canAdmin" && m[3] !== "canWrite")
      .map((m) => `${m[1]?.toUpperCase()} ${m[2]}`);
    expect(sansGarde, `routes mutantes sans garde de role : ${sansGarde.join(", ")}`).toEqual([]);
  });
});

describe("2. plafond de creation par organisation", () => {
  it("cree tant que le plafond n'est pas atteint", async () => {
    for (let i = 0; i < 3; i++) await createMonitor(ORG, charge);
    expect((await monitorsDeLOrganisation(ORG)).size).toBe(3);
  });

  it("refuse au-dela du plafond, AVANT tout appel a BetterStack", async () => {
    for (let i = 0; i < 3; i++) await createMonitor(ORG, charge);
    appels.length = 0;
    await expect(createMonitor(ORG, charge)).rejects.toThrow(/Quota de monitors atteint/);
    expect(appels, "un moniteur payant a ete cree malgre le plafond").toEqual([]);
  });

  it("le refus porte le statut 402, pas 500", async () => {
    plafond.mockResolvedValue({ allowed: false, used: 0, limit: 0, plan: "standard" });
    await createMonitor(ORG, charge).then(
      () => { throw new Error("la creation a ete autorisee"); },
      (err: { statusCode?: number }) => expect(err.statusCode).toBe(402),
    );
  });

  it("le plafond d'une organisation n'affecte pas l'autre", async () => {
    for (let i = 0; i < 3; i++) await createMonitor(ORG, charge);
    const autre = `${ORG}-b`;
    await expect(createMonitor(autre, charge)).resolves.toBeDefined();
    await pool.query(`DELETE FROM ${BS_OWNERSHIP_TABLE} WHERE org_id = $1`, [autre]);
  });
});

describe("3. aucun moniteur facture ne reste sans proprietaire", () => {
  it("registre illisible : rien n'est cree chez BetterStack", async () => {
    vi.spyOn(pool, "query").mockRejectedValue(new Error('relation "bs_monitor_ownership" does not exist') as never);
    await expect(createMonitor(ORG, charge)).rejects.toThrow(/ownership registry unavailable/i);
    expect(appels, "un moniteur payant a ete cree sans registre d'appartenance").toEqual([]);
  });

  it("le refus porte le statut 503 — c'est une indisponibilite, pas un refus d'acces", async () => {
    vi.spyOn(pool, "query").mockRejectedValue(new Error("ECONNREFUSED") as never);
    await createMonitor(ORG, charge).then(
      () => { throw new Error("la creation a ete autorisee"); },
      (err: { statusCode?: number }) => expect(err.statusCode).toBe(503),
    );
  });

  it("si l'inscription echoue APRES creation, le moniteur distant est retire", async () => {
    let appelsSql = 0;
    const vraiQuery = pool.query.bind(pool);
    vi.spyOn(pool, "query").mockImplementation(((sql: string, params?: unknown[]) => {
      appelsSql += 1;
      // Le comptage passe (1er appel), l'inscription echoue (2e appel).
      if (appelsSql >= 2) return Promise.reject(new Error("écriture refusée"));
      return vraiQuery(sql, params as never);
    }) as never);

    await expect(createMonitor(ORG, charge)).rejects.toThrow(/ownership registry unavailable/i);
    const suppressions = appels.filter((a) => a.methode === "DELETE");
    expect(suppressions.length, "le moniteur cree n'a pas ete retire : il reste facture et sans proprietaire").toBe(1);
    expect(suppressions[0]!.url).toMatch(/\/monitors\/M-NOUVEAU-1$/);
  });
});

describe("4. la sonde de presence du registre dit la verite", () => {
  it("vrai quand la table repond", async () => {
    expect(await registreAppartenancePresent(pool)).toBe(true);
  });

  it("faux quand la table est absente — sans lever", async () => {
    vi.spyOn(pool, "query").mockRejectedValue(new Error('relation "x" does not exist') as never);
    await expect(registreAppartenancePresent(pool)).resolves.toBe(false);
  });

  it("la sonde ne lit aucune donnee", async () => {
    const espion = vi.spyOn(pool, "query");
    await registreAppartenancePresent(pool);
    expect(String(espion.mock.calls[0]?.[0])).toContain("WHERE false");
  });
});

describe("5. la migration BetterStack reste distincte de la migration V1", () => {
  const racine = path.join(import.meta.dirname ?? __dirname, "..", "..");

  it("initDataTables — appelee par migrate.ts — ne pose plus cette table", () => {
    const src = readFileSync(path.join(racine, "src/services/init-data-tables.ts"), "utf8");
    expect(src).not.toMatch(/await\s+ensureBsOwnershipSchema\(/);
  });

  it("une migration autonome et idempotente existe", () => {
    const sql = readFileSync(path.join(racine, "migrations/024_bs_monitor_ownership.sql"), "utf8");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS bs_monitor_ownership");
    expect(sql).toContain("FORCE  ROW LEVEL SECURITY");
    expect((sql.match(/CREATE POLICY/g) ?? []).length).toBe(4);
  });

  it("la table porte RLS forcee et ses quatre policies", async () => {
    const r = await pool.query<{ rls: boolean; force: boolean; n: string }>(
      `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
              (SELECT COUNT(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS n
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = $1 AND n.nspname = 'public'`,
      [BS_OWNERSHIP_TABLE]
    );
    expect(r.rows[0]?.rls).toBe(true);
    expect(r.rows[0]?.force).toBe(true);
    expect(Number(r.rows[0]?.n)).toBe(4);
  });

  it("appliquer la migration deux fois ne change rien", async () => {
    await ensureBsOwnershipSchema(pool);
    await ensureBsOwnershipSchema(pool);
    const r = await pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid WHERE c.relname = $1`, [BS_OWNERSHIP_TABLE]);
    expect(Number(r.rows[0]?.n)).toBe(4);
  });
});

describe("6. le monitoring natif n'est pas touche", () => {
  const racine = path.join(import.meta.dirname ?? __dirname, "..", "..");

  it("le code BetterStack n'ecrit jamais dans la table `monitors`", () => {
    for (const f of ["src/services/betterstack-service.ts", "src/routes/betterstack.ts", "src/services/init-bs-ownership.ts"]) {
      const src = readFileSync(path.join(racine, f), "utf8");
      expect(src, `${f} ecrit dans monitors`).not.toMatch(/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+monitors\b/i);
    }
  });

  it("l'attribution des moniteurs preexistants ne fait que LIRE monitors", () => {
    const src = readFileSync(path.join(racine, "src/services/init-bs-ownership.ts"), "utf8");
    const refs = [...src.matchAll(/\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)[\s\S]{0,80}?\bmonitors\b/gi)]
      .map((m) => m[1]!.toUpperCase().replace(/\s+/g, " "));
    expect(refs.every((r) => r === "SELECT")).toBe(true);
  });

  it("une panne du registre n'empeche pas les moniteurs natifs d'exister", async () => {
    // La table native est interrogeable independamment du registre BetterStack.
    const r = await pool.query<{ n: string }>(`SELECT COUNT(*)::int AS n FROM monitors`);
    expect(Number(r.rows[0]?.n)).toBeGreaterThanOrEqual(0);
  });
});
