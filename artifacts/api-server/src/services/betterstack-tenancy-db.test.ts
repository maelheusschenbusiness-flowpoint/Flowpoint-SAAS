/**
 * betterstack-tenancy-db.test.ts
 *
 * Le compte BetterStack est partage par FlowPoint. Avant correction, rien ne
 * separait les organisations (mesure du 17/10/2026) :
 *
 *   - `updateMonitor(bsId, orgId, …)` n'utilisait `orgId` que pour vider un
 *     cache ; l'appel partait en `PATCH /monitors/${bsId}` sans controle.
 *     Idem pour delete, pause, resume.
 *   - `listMonitors(orgId)` appelait `/monitors?per_page=250` sans filtre et
 *     renvoyait TOUT le parc a n'importe quelle organisation authentifiee.
 *
 * Ces tests posent deux organisations, un moniteur appartenant a chacune, et un
 * moniteur SANS proprietaire. Toute sortie reseau est interceptee et comptee :
 * un refus ne vaut que s'il intervient AVANT l'appel a BetterStack.
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

// Le jeton est lu au CHARGEMENT du module : il doit exister avant l'import.
// Sa valeur n'a aucune importance — toute sortie reseau est interceptee.
vi.hoisted(() => { process.env["BETTERSTACK_API_TOKEN"] = "jeton-de-test-isolation"; });

const appels: string[] = [];
vi.mock("@workspace/db", async (importOriginal) =>
  importOriginal<typeof import("@workspace/db")>()
);
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.stubGlobal("fetch", vi.fn(async (url: string) => {
  appels.push(String(url));
  return {
    ok: true, status: 200,
    headers: { get: () => null },
    json: async () => ({ data: [{ id: M_A, attributes: {} }, { id: M_B, attributes: {} }, { id: M_ORPHELIN, attributes: {} }] }),
  } as unknown as Response;
}));

import { pool } from "@workspace/db";
import { ensureBsOwnershipSchema, proposerAttributions } from "./init-bs-ownership.js";
import {
  listMonitors, getMonitor, updateMonitor, deleteMonitor,
  pauseMonitor, resumeMonitor, monitorsDeLOrganisation,
} from "./betterstack-service.js";

// Les identifiants sont propres a CE fichier.
//
// Mesure du 17/10/2026 : le nettoyage effacait `org_id LIKE 'bs-%'`, motif qui
// englobe les organisations `bs-creation-%` d'un AUTRE fichier de test. La
// suite tournant en parallele, chaque fichier vidait les lignes de l'autre en
// pleine execution : neuf tests tombaient un passage sur deux, pour une raison
// etrangere au produit. Les prefixes sont desormais disjoints, et chaque
// fichier ne nettoie que ce qu'il a pose.
const JEU = `bsiso-${Date.now()}`;
const A = `${JEU}-A`;
const B = `${JEU}-B`;
/** Les identifiants BetterStack simules, propres a ce fichier. */
const M_A = `${JEU}-M-A`;
const M_B = `${JEU}-M-B`;
const M_ORPHELIN = `${JEU}-M-ORPHELIN`;

beforeAll(async () => {
  await ensureBsOwnershipSchema(pool);
  await pool.query(`DELETE FROM bs_monitor_ownership WHERE org_id = ANY($1) OR bs_id = ANY($2)`,
    [[A, B], [M_A, M_B, M_ORPHELIN]]);
  await pool.query(
    `INSERT INTO bs_monitor_ownership (bs_id, org_id, claimed_via) VALUES ($3,$1,'created'), ($4,$2,'created')
     ON CONFLICT (bs_id) DO UPDATE SET org_id = EXCLUDED.org_id`, [A, B, M_A, M_B]);
  // M-ORPHELIN n'est volontairement attribue a personne.
});
afterAll(async () => {
  await pool.query(`DELETE FROM bs_monitor_ownership WHERE org_id = ANY($1) OR bs_id = ANY($2)`,
    [[A, B], [M_A, M_B, M_ORPHELIN]]);
});
beforeEach(async () => {
  appels.length = 0;
  // Idempotent : un autre fichier de la suite refait le schema en parallele.
  await ensureBsOwnershipSchema(pool);
  await pool.query(
    `INSERT INTO bs_monitor_ownership (bs_id, org_id, claimed_via) VALUES ($3,$1,'created'), ($4,$2,'created')
     ON CONFLICT (bs_id) DO UPDATE SET org_id = EXCLUDED.org_id`, [A, B, M_A, M_B]);
});

describe("A ne peut rien faire sur les moniteurs de B", () => {
  const interdits: Array<[string, () => Promise<unknown>]> = [
    ["voir",       () => getMonitor(M_B, A)],
    ["modifier",   () => updateMonitor(M_B, A, { pronunciation_name: "detourne" } as never)],
    ["supprimer",  () => deleteMonitor(M_B, A)],
    ["suspendre",  () => pauseMonitor(M_B, A)],
    ["reactiver",  () => resumeMonitor(M_B, A)],
  ];
  for (const [action, lancer] of interdits) {
    it(`A ne peut pas ${action} le moniteur de B`, async () => {
      await expect(lancer()).rejects.toThrow(/not found/i);
      expect(appels, `un appel est parti vers BetterStack malgre le refus : ${appels.join(", ")}`).toEqual([]);
    });
  }

  it("la liste de A ne contient jamais le moniteur de B", async () => {
    const vus = await listMonitors(A);
    const ids = vus.map((m) => String(m.id));
    expect(ids).toContain(M_A);
    expect(ids, "le moniteur de B a fuite dans la liste de A").not.toContain(M_B);
  });
});

describe("un moniteur sans proprietaire n'appartient a personne", () => {
  it("il n'apparait dans la liste d'aucune organisation", async () => {
    expect((await listMonitors(A)).map((m) => String(m.id))).not.toContain(M_ORPHELIN);
    expect((await listMonitors(B)).map((m) => String(m.id))).not.toContain(M_ORPHELIN);
  });

  it("aucune organisation ne peut le modifier, donc aucune ne peut se l'approprier", async () => {
    await expect(updateMonitor(M_ORPHELIN, A, {} as never)).rejects.toThrow(/not found/i);
    await expect(updateMonitor(M_ORPHELIN, B, {} as never)).rejects.toThrow(/not found/i);
    expect(appels).toEqual([]);
  });
});

describe("l'organisation proprietaire garde son acces", () => {
  it("A agit sur son propre moniteur, et l'appel part", async () => {
    await expect(updateMonitor(M_A, A, { pronunciation_name: "renomme" } as never)).resolves.toBeDefined();
    expect(appels.length, "aucun appel n'est parti alors que l'acces est legitime").toBeGreaterThan(0);
  });
});

describe("comportements degrades : le doute ne profite jamais a l'appelant", () => {
  it("table absente : tout est refuse, rien ne fuite", async () => {
    // La premiere version RENOMMAIT la table pour simuler son absence. Deux
    // consequences mesurees le 17/10/2026 : un passage interrompu laissait
    // `bs_monitor_ownership_tmp` derriere lui et bloquait tous les passages
    // suivants ; et surtout, la suite tournant en parallele, un autre fichier
    // lisait la table pendant qu'elle etait renommee — sept tests tombaient
    // pour une raison qui n'avait rien a voir avec le produit.
    //
    // On simule donc l'absence a la SOURCE, sans toucher au schema partage :
    // la requete echoue, exactement comme avec une table absente.
    const espion = vi.spyOn(pool, "query").mockRejectedValue(
      new Error('relation "bs_monitor_ownership" does not exist') as never);
    try {
      expect(await monitorsDeLOrganisation(A)).toEqual(new Set());
      await expect(updateMonitor(M_A, A, {} as never)).rejects.toThrow(/not found/i);
      expect(await listMonitors(A)).toEqual([]);
      expect(appels.filter((u) => u.includes("PATCH")), "une mutation est partie sans appartenance lisible").toEqual([]);
    } finally {
      espion.mockRestore();
    }
  });

  it("BetterStack indisponible : l'erreur remonte, aucune donnee d'autrui n'est renvoyee", async () => {
    // Organisation distincte : `listMonitors` garde 30 s de cache par
    // organisation, et une cle deja chaude court-circuiterait l'appel — ce
    // serait alors le cache qu'on testerait, pas la panne.
    const orgFraiche = `bs-panne-${Date.now()}`;
    (globalThis.fetch as unknown as { mockImplementation: (f: unknown) => void })
      .mockImplementation(async () => { throw new Error("BetterStack injoignable"); });
    await expect(listMonitors(orgFraiche)).rejects.toThrow(/injoignable/i);
  });
});

describe("attribution des moniteurs preexistants : seulement ce qui se demontre", () => {
  const ORG_SITE = `bs-site-${Date.now()}`;

  beforeAll(async () => {
    await pool.query(
      `INSERT INTO monitors (id, org_id, url, name, created_at)
       VALUES ($1, $2, 'https://unique.exemple.fr/', 'site unique', NOW())
       ON CONFLICT (id) DO NOTHING`,
      [`mon-${ORG_SITE}`, ORG_SITE]
    );
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM monitors WHERE org_id = $1`, [ORG_SITE]);
    await pool.query(`DELETE FROM bs_monitor_ownership WHERE bs_id LIKE 'BF-%'`);
  });

  it("une URL appartenant a UNE seule organisation est attribuee", async () => {
    const p = await proposerAttributions(pool, [{ id: "BF-1", url: "http://unique.exemple.fr" }]);
    expect(p[0]!.raison).toBe("url unique");
    expect(p[0]!.orgId).toBe(ORG_SITE);
  });

  it("par defaut rien n'est ecrit — une attribution se regarde avant de s'appliquer", async () => {
    await proposerAttributions(pool, [{ id: "BF-2", url: "http://unique.exemple.fr" }]);
    const r = await pool.query(`SELECT 1 FROM bs_monitor_ownership WHERE bs_id = 'BF-2'`);
    expect(r.rowCount).toBe(0);
  });

  it("une URL sans correspondance reste SANS proprietaire, donc inaccessible", async () => {
    const p = await proposerAttributions(pool, [{ id: "BF-3", url: "https://inconnu.exemple.fr" }], { appliquer: true });
    expect(p[0]!.orgId).toBeNull();
    expect(p[0]!.raison).toBe("aucune correspondance");
    const r = await pool.query(`SELECT 1 FROM bs_monitor_ownership WHERE bs_id = 'BF-3'`);
    expect(r.rowCount, "un moniteur non demontre a ete attribue").toBe(0);
  });

  it("avec appliquer, l'attribution demontree est ecrite", async () => {
    await proposerAttributions(pool, [{ id: "BF-4", url: "https://unique.exemple.fr" }], { appliquer: true });
    const r = await pool.query<{ org_id: string; claimed_via: string }>(
      `SELECT org_id, claimed_via FROM bs_monitor_ownership WHERE bs_id = 'BF-4'`);
    expect(r.rows[0]?.org_id).toBe(ORG_SITE);
    expect(r.rows[0]?.claimed_via).toBe("backfill_url");
  });
});
