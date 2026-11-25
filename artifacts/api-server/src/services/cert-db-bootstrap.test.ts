/**
 * cert-db-bootstrap.test.ts — non-regression de l'amorce PostgreSQL de Flowpoint-Test.
 *
 * Couvre : composition de DATABASE_URL depuis PG* (module de config REEL), priorite de
 * DATABASE_URL explicite, erreur claire sans aucune des deux, refus de la base de
 * production par la garde d'identite, et absence de comportement hors service de test.
 * Aucun secret reel : toutes les valeurs sont fictives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  evaluateDbAttestation,
  isCertTestService,
  RENDER_TEST_PROJECT_REF_SHA256,
} from "./db-startup-attestation.js";

const TEST_REF = "rrjllaiodpvtsphrtdqd";
const PROD_REF = "sejbsuuaeokyuxuoaxzd";
const POOLER = "aws-1-eu-central-1.pooler.supabase.com";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");

const BASE_ENV = {
  NODE_ENV: "test",
  JWT_SECRET: "x".repeat(40),
};
const ENV_KEYS = ["DATABASE_URL", "PGHOST", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGPORT", "JWT_SECRET", "NODE_ENV",
  "STRIPE_LIVE_API_KEY", "STRIPE_SECRET_KEY"] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, BASE_ENV);
  vi.resetModules();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
});

async function loadEnv() {
  return (await import("../lib/env.js")).env;
}

describe("module de config reel : DATABASE_URL", () => {
  it("compose DATABASE_URL depuis PGHOST/PGUSER/PGPASSWORD/PGDATABASE sans DATABASE_URL", async () => {
    Object.assign(process.env, {
      PGHOST: POOLER, PGUSER: `postgres.${TEST_REF}`, PGPASSWORD: "p#ss/w@rd", PGDATABASE: "postgres", PGPORT: "6543",
    });
    const env = await loadEnv();
    const u = new URL(env.DATABASE_URL);
    expect(u.hostname).toBe(POOLER);
    expect(u.port).toBe("6543");
    expect(decodeURIComponent(u.username)).toBe(`postgres.${TEST_REF}`);
    expect(decodeURIComponent(u.password)).toBe("p#ss/w@rd");
    expect(u.pathname).toBe("/postgres");
  });

  it("PGPORT absent : 5432 par defaut", async () => {
    Object.assign(process.env, { PGHOST: "db.example.test", PGUSER: "u", PGPASSWORD: "p", PGDATABASE: "d" });
    expect(new URL((await loadEnv()).DATABASE_URL).port).toBe("5432");
  });

  it("DATABASE_URL explicite est prioritaire sur PG*", async () => {
    process.env["DATABASE_URL"] = "postgresql://explicit:pw@explicit.example.test:5432/explicitdb";
    Object.assign(process.env, { PGHOST: POOLER, PGUSER: "other", PGPASSWORD: "p", PGDATABASE: "other" });
    const env = await loadEnv();
    expect(env.DATABASE_URL).toBe("postgresql://explicit:pw@explicit.example.test:5432/explicitdb");
  });

  it("ni DATABASE_URL ni PG* : arret avec une erreur claire nommant DATABASE_URL", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => { throw new Error(`exit:${code}`); }) as never);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(loadEnv()).rejects.toThrow("exit:1");
    expect(exit).toHaveBeenCalledWith(1);
    expect(String(err.mock.calls[0]?.[0])).toContain("DATABASE_URL");
  });

  it("PG* incomplets : traites comme absents (erreur DATABASE_URL, pas d'URL partielle)", async () => {
    Object.assign(process.env, { PGHOST: POOLER, PGUSER: "u" });
    vi.spyOn(process, "exit").mockImplementation(((c?: number) => { throw new Error(`exit:${c}`); }) as never);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(loadEnv()).rejects.toThrow("exit:1");
    expect(process.env["DATABASE_URL"]).toBeUndefined();
  });
});

describe("garde d'identite : la base de production est refusee", () => {
  const guards = (host: string, user: string) => ({ DB_HOTE_ATTENDU: host, DB_UTILISATEUR_ATTENDU: user }) as NodeJS.ProcessEnv;

  it("l'empreinte attendue est celle du projet TEST, pas celle de la production", () => {
    expect(RENDER_TEST_PROJECT_REF_SHA256).toBe(sha(TEST_REF));
    expect(RENDER_TEST_PROJECT_REF_SHA256).not.toBe(sha(PROD_REF));
  });

  it("projet TEST (pooler, utilisateur postgres.<ref>) : PASS", () => {
    const id = { host: POOLER, database: "postgres", user: `postgres.${TEST_REF}` };
    expect(evaluateDbAttestation(id, guards(POOLER, id.user)).status).toBe("PASS");
  });

  it("projet de production (utilisateur du pooler) : FAIL meme si les gardes d'hote concordent", () => {
    const id = { host: POOLER, database: "postgres", user: `postgres.${PROD_REF}` };
    expect(evaluateDbAttestation(id, guards(POOLER, id.user)).status).toBe("FAIL");
  });

  it("projet de production (hote direct db.<ref>.supabase.co) : FAIL", () => {
    const id = { host: `db.${PROD_REF}.supabase.co`, database: "postgres", user: "postgres" };
    expect(evaluateDbAttestation(id, guards(id.host, "postgres")).status).toBe("FAIL");
  });

  it("hote et utilisateur de references contradictoires : FAIL", () => {
    const id = { host: `db.${PROD_REF}.supabase.co`, database: "postgres", user: `postgres.${TEST_REF}` };
    expect(evaluateDbAttestation(id, guards(id.host, id.user)).status).toBe("FAIL");
  });

  it("identite inconnue ou autre base : jamais PASS", () => {
    expect(evaluateDbAttestation(null, {}).status).toBe("UNKNOWN");
    const id = { host: "localhost", database: "x", user: "u" };
    expect(evaluateDbAttestation(id, guards("localhost", "u")).status).not.toBe("PASS");
  });

  it("ne divulgue aucun secret : seulement statuts et empreintes", () => {
    const id = { host: POOLER, database: "postgres", user: `postgres.${PROD_REF}` };
    const out = JSON.stringify(evaluateDbAttestation(id, guards(POOLER, id.user)));
    expect(out).not.toContain(PROD_REF);
    expect(out).not.toContain(TEST_REF);
    expect(out).not.toContain(POOLER);
  });
});

describe("hors service de test : aucun changement de comportement", () => {
  it("la garde ne s'active que pour RENDER_SERVICE_NAME=flowpoint-test", () => {
    expect(isCertTestService({ RENDER_SERVICE_NAME: "flowpoint-test" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isCertTestService({ RENDER_SERVICE_NAME: "Flowpoint-Test " } as NodeJS.ProcessEnv)).toBe(true);
    expect(isCertTestService({ RENDER_SERVICE_NAME: "flowpoint-main" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isCertTestService({ RENDER_SERVICE_NAME: "flowpoint" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isCertTestService({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("avec DATABASE_URL posee, la config n'est pas modifiee (production inchangee)", async () => {
    process.env["DATABASE_URL"] = "postgresql://u:p@prod.example.test:5432/db";
    expect((await loadEnv()).DATABASE_URL).toBe("postgresql://u:p@prod.example.test:5432/db");
  });
});
