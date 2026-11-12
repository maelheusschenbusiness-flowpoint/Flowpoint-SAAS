/**
 * readiness-db.test.ts
 *
 * La sonde que Render doit interroger. Les deux sondes existantes sont
 * inutilisables : `/healthz` ne touche pas la base — un serveur dont
 * l'initialisation de schema a echoue y repond « ok » —, et `/healthz/deep`
 * renvoie 503 des qu'un seul de ses six controles tiers tombe, ce qui ferait
 * redemarrer une instance saine parce que DataForSEO est en panne.
 *
 * Ce qui est fixe ici :
 *   - une coupure PASSAGERE de PostgreSQL ne doit pas declarer l'instance
 *     indisponible, et le compteur doit retomber au premier succes ;
 *   - une coupure PERSISTANTE doit la declarer indisponible ;
 *   - un schema invalide doit la declarer indisponible IMMEDIATEMENT, sans
 *     tolerance : il ne se repare pas en attendant ;
 *   - aucun appel reseau sortant ;
 *   - la sonde ne leve jamais.
 */

import { vi, describe, it, expect, beforeEach, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) =>
  importOriginal<typeof import("@workspace/db")>()
);
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { pool } from "@workspace/db";
import {
  evaluateReadiness,
  probeDatabase,
  inspectSchema,
  resetReadinessState,
  DB_FAILURE_THRESHOLD,
  type Queryable,
} from "./readiness.js";

/** Base muette : chaque requete echoue, comme un pool sature ou une bascule. */
const downDb: Queryable = {
  query: () => Promise.reject(Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" })),
};

/** Base qui pend : la sonde doit rendre la main malgre tout. */
const hangingDb: Queryable = {
  query: () => new Promise(() => { /* jamais resolue */ }),
};

beforeEach(() => { resetReadinessState(); });
afterAll(() => { resetReadinessState(); });

describe("ping PostgreSQL borne", () => {
  it("repond sur une base saine", async () => {
    const probe = await probeDatabase(pool);
    expect(probe.ok).toBe(true);
    expect(probe.latencyMs).toBeLessThan(2_000);
  });

  it("rend la main sur une base qui pend, sans attendre indefiniment", async () => {
    const start = Date.now();
    const probe = await probeDatabase(hangingDb, 150);
    expect(probe.ok).toBe(false);
    expect(Date.now() - start).toBeLessThan(1_000);
  });

  it("ne reflete jamais le message brut de la base — il peut porter la connexion", async () => {
    const leaky: Queryable = {
      query: () => Promise.reject(Object.assign(
        new Error("password authentication failed for user \"postgres\" host=db.example"),
        { code: "28P01" }
      )),
    };
    const probe = await probeDatabase(leaky);
    expect(probe.ok).toBe(false);
    expect(probe.detail).toBe("echec (28P01)");
    expect(probe.detail).not.toContain("password");
    expect(probe.detail).not.toContain("host=");
  });
});

describe("tolerance d'une coupure passagere", () => {
  it(`reste disponible pendant ${DB_FAILURE_THRESHOLD - 1} echec(s) consecutif(s)`, async () => {
    for (let i = 1; i < DB_FAILURE_THRESHOLD; i++) {
      const verdict = await evaluateReadiness(downDb);
      expect(verdict.httpStatus).toBe(200);
      expect(verdict.body.status).toBe("ready");
      expect(verdict.body.database.consecutiveFailures).toBe(i);
    }
  });

  it("devient indisponible au seuil atteint", async () => {
    let verdict = await evaluateReadiness(downDb);
    for (let i = 1; i < DB_FAILURE_THRESHOLD; i++) verdict = await evaluateReadiness(downDb);
    expect(verdict.httpStatus).toBe(503);
    expect(verdict.body.status).toBe("not_ready");
  });

  it("le compteur retombe a zero au premier succes", async () => {
    await evaluateReadiness(downDb);
    await evaluateReadiness(downDb);
    const recovered = await evaluateReadiness(pool);
    expect(recovered.httpStatus).toBe(200);
    expect(recovered.body.database.consecutiveFailures).toBe(0);
  });

  it("sans base, le schema est declare inconnu — il n'est pas invente", async () => {
    const verdict = await evaluateReadiness(downDb);
    expect(verdict.body.schema).toEqual({ status: "unknown" });
  });
});

describe("validite du schema", () => {
  it("la base certifiee est valide", async () => {
    const verdict = await inspectSchema(pool);
    expect(verdict.missingTables).toEqual([]);
    expect(verdict.missingColumns).toEqual([]);
    expect(verdict.isolationGaps).toEqual([]);
    expect(verdict.valid).toBe(true);
  });

  it("une table requise absente rend l'instance indisponible SANS tolerance", async () => {
    // Base saine pour le ping, mais catalogues vides : le schema n'a rien de
    // ce que le code attend. Aucun echec consecutif n'est requis.
    const emptySchemaDb: Queryable = {
      query: (sql: string) =>
        /SELECT 1/.test(sql)
          ? Promise.resolve({ rows: [{ "?column?": 1 }], rowCount: 1 })
          : Promise.resolve({ rows: [], rowCount: 0 }),
    };
    const verdict = await evaluateReadiness(emptySchemaDb);
    expect(verdict.httpStatus).toBe(503);
    expect(verdict.body.status).toBe("not_ready");
    expect(verdict.body.schema).toMatchObject({ valid: false });
  });

  it("une table portant org_id sans RLS est signalee — transaction annulee, base intacte", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE TABLE readiness_probe_leak (id serial PRIMARY KEY, org_id text NOT NULL)`);
      const verdict = await inspectSchema({
        query: (sql: string, params?: unknown[]) => client.query(sql, params as never[]) as never,
      });
      expect(verdict.isolationGaps).toContain("readiness_probe_leak");
      expect(verdict.valid).toBe(false);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
    const after = await pool.query<{ present: boolean }>(
      `SELECT to_regclass('public.readiness_probe_leak') IS NOT NULL AS present`
    );
    expect(after.rows[0]?.present).toBe(false);
  });

  it("le verdict de schema est mis en cache — la sonde est interrogee en boucle", async () => {
    let catalogQueries = 0;
    const counting: Queryable = {
      query: (sql: string, params?: unknown[]) => {
        if (!/SELECT 1/.test(sql)) catalogQueries++;
        return pool.query(sql, params as never[]) as never;
      },
    };
    await evaluateReadiness(counting);
    const afterFirst = catalogQueries;
    await evaluateReadiness(counting);
    await evaluateReadiness(counting);
    expect(afterFirst).toBeGreaterThan(0);
    expect(catalogQueries).toBe(afterFirst); // aucune requete de catalogue en plus
  });

  it("le cache expire, et la base est reinspectee", async () => {
    let catalogQueries = 0;
    const counting: Queryable = {
      query: (sql: string, params?: unknown[]) => {
        if (!/SELECT 1/.test(sql)) catalogQueries++;
        return pool.query(sql, params as never[]) as never;
      },
    };
    // L'horloge est injectee : deux appels dans la meme milliseconde ne
    // prouveraient rien d'une expiration.
    const t0 = Date.now();
    await evaluateReadiness(counting, { schemaTtlMs: 60_000, now: t0 });
    const afterFirst = catalogQueries;
    await evaluateReadiness(counting, { schemaTtlMs: 60_000, now: t0 + 61_000 });
    expect(catalogQueries).toBeGreaterThan(afterFirst);
  });
});

describe("garanties structurelles", () => {
  it("aucun appel reseau sortant dans la sonde", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.join(import.meta.dirname ?? __dirname, "readiness.ts"), "utf8");
    // C'est precisement ce qui disqualifie /healthz/deep comme health check.
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toMatch(/probeUrl|https:\/\//);
  });

  it("la sonde ne leve jamais", async () => {
    await expect(evaluateReadiness(downDb)).resolves.toBeDefined();
    await expect(evaluateReadiness(hangingDb, { timeoutMs: 50 })).resolves.toBeDefined();
  });
});
