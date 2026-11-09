/**
 * rls-enforcement-status-db.test.ts — C-08
 *
 * Constat : quand `SET ROLE app_user` echouait, `probeAppUserRole()` basculait
 * silencieusement en « GUC-only RLS mode » et affirmait que c'etait « correct et
 * sur ». C'est faux des que le role de connexion est superuser ou BYPASSRLS (cas
 * de `postgres` sur Supabase) : les policies ne sont alors JAMAIS evaluees et
 * seul le filtre `org_id` ecrit a la main dans chaque requete isole les clients.
 *
 * Corrige : la sonde mesure l'etat reel (attributs du role de connexion, tables
 * possedees sans FORCE), le classe, le journalise en ERREUR s'il n'y a pas
 * d'isolation garantie, l'expose (`getRlsEnforcementStatus`, /admin/db-check) et,
 * avec RLS_ENFORCEMENT=strict, refuse de demarrer.
 *
 * Partie 1 : classification pure. Partie 2 : mesure sur la base PostgreSQL de la CI
 * avec de vrais roles de connexion crees pour le test.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) =>
  importOriginal<typeof import("@workspace/db")>()
);
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import {
  pool, classifyRlsEnforcement, inspectRlsFacts, resolveRlsEnforcementPolicy,
  probeAppUserRole, getRlsEnforcementStatus, reportRlsEnforcement, RlsEnforcementError,
  type RlsEnforcementFacts,
} from "@workspace/db";
import { randomBytes } from "node:crypto";
import pg from "pg";

const base: RlsEnforcementFacts = {
  appUserRoleExists: true,
  setRoleUsable: false,
  appUserBypassesRls: false,
  connectionRole: "postgres",
  connectionIsSuperuser: false,
  connectionBypassesRls: false,
  ownedUnforcedRlsTables: 0,
};

describe("classification de l'etat RLS (pure)", () => {
  it("SET ROLE utilisable + app_user soumis a RLS -> isolation garantie par la base", () => {
    const r = classifyRlsEnforcement({ ...base, setRoleUsable: true });
    expect(r).toMatchObject({ mode: "enforced", isolationGuaranteed: true });
  });

  it("SET ROLE utilisable mais app_user BYPASSRLS -> PAS garantie", () => {
    const r = classifyRlsEnforcement({ ...base, setRoleUsable: true, appUserBypassesRls: true });
    expect(r.isolationGuaranteed).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/app_user/);
  });

  it("GUC-only avec role de connexion superuser -> PAS garantie (le cas C-08)", () => {
    const r = classifyRlsEnforcement({ ...base, connectionIsSuperuser: true });
    expect(r.mode).toBe("guc-only");
    expect(r.isolationGuaranteed).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/superuser/);
  });

  it("GUC-only avec role BYPASSRLS (Supabase `postgres`) -> PAS garantie", () => {
    const r = classifyRlsEnforcement({ ...base, connectionBypassesRls: true });
    expect(r.isolationGuaranteed).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/BYPASSRLS/);
  });

  it("GUC-only avec un proprietaire de tables RLS sans FORCE -> PAS garantie", () => {
    const r = classifyRlsEnforcement({ ...base, ownedUnforcedRlsTables: 3 });
    expect(r.isolationGuaranteed).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/FORCE/);
  });

  it("GUC-only avec un role ordinaire qui ne possede rien -> garantie (soumis a RLS)", () => {
    const r = classifyRlsEnforcement(base);
    expect(r).toMatchObject({ mode: "guc-only", isolationGuaranteed: true });
  });

  it("app_user absent -> GUC-only, et le motif le dit", () => {
    const r = classifyRlsEnforcement({ ...base, appUserRoleExists: false, connectionBypassesRls: true });
    expect(r.reasons.join(" ")).toMatch(/app_user absent/);
    expect(r.isolationGuaranteed).toBe(false);
  });

  it("faits inconnus (sonde non executee) -> jamais « garantie »", () => {
    const r = classifyRlsEnforcement({
      appUserRoleExists: null, setRoleUsable: null, appUserBypassesRls: null,
      connectionRole: null, connectionIsSuperuser: null, connectionBypassesRls: null, ownedUnforcedRlsTables: null,
    });
    expect(r.isolationGuaranteed).not.toBe(true);
  });
});

describe("politique RLS_ENFORCEMENT", () => {
  it("par defaut : warn (decision documentee — ne casse pas un demarrage existant)", () => {
    expect(resolveRlsEnforcementPolicy({})).toBe("warn");
    expect(resolveRlsEnforcementPolicy({ NODE_ENV: "production" })).toBe("warn");
  });
  it("strict / off sont reconnus, insensibles a la casse", () => {
    expect(resolveRlsEnforcementPolicy({ RLS_ENFORCEMENT: "STRICT" })).toBe("strict");
    expect(resolveRlsEnforcementPolicy({ RLS_ENFORCEMENT: "off" })).toBe("off");
  });
  it("une valeur inconnue retombe sur warn (jamais sur off)", () => {
    expect(resolveRlsEnforcementPolicy({ RLS_ENFORCEMENT: "nope" })).toBe("warn");
  });
});

describe("reportRlsEnforcement : journal et echec de demarrage", () => {
  const unsafe = (policy: "strict" | "warn" | "off") => ({
    ...classifyRlsEnforcement({ ...base, connectionBypassesRls: true }),
    facts: { ...base, connectionBypassesRls: true },
    policy,
    probedAt: "2026-11-08T00:00:00.000Z",
    runtimeSetRoleFailure: false,
  });
  const logs = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

  it("warn (defaut) : journalise en ERREUR, ne leve pas", () => {
    const log = logs();
    expect(() => reportRlsEnforcement(unsafe("warn"), log)).not.toThrow();
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(String(log.error.mock.calls[0]![0])).toContain("NOT guaranteed");
    expect(String(log.error.mock.calls[0]![0])).toContain("BYPASSRLS");
  });

  it("strict : leve RlsEnforcementError (le demarrage echoue)", () => {
    const log = logs();
    expect(() => reportRlsEnforcement(unsafe("strict"), log)).toThrow(RlsEnforcementError);
    expect(log.error).toHaveBeenCalled();
  });

  it("off : ni erreur journalisee ni exception", () => {
    const log = logs();
    expect(() => reportRlsEnforcement(unsafe("off"), log)).not.toThrow();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("isolation garantie : aucune erreur, meme en strict", () => {
    const log = logs();
    const ok = { ...classifyRlsEnforcement({ ...base, setRoleUsable: true }), facts: { ...base, setRoleUsable: true }, policy: "strict" as const, probedAt: null, runtimeSetRoleFailure: false };
    expect(() => reportRlsEnforcement(ok, log)).not.toThrow();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("le message ne contient ni mot de passe ni URL de connexion", () => {
    const log = logs();
    reportRlsEnforcement(unsafe("warn"), log);
    expect(String(log.error.mock.calls[0]![0])).not.toMatch(/postgres(ql)?:\/\/|password/i);
  });
});

// ── Partie 2 : de vrais roles sur la base de la CI ────────────────────────────
const SUFFIX = randomBytes(4).toString("hex");
const ROLE_PLAIN = `fp_rls_plain_${SUFFIX}`;
const ROLE_BYPASS = `fp_rls_bypass_${SUFFIX}`;
const ROLE_MEMBER = `fp_rls_member_${SUFFIX}`;
const ROLE_OWNER = `fp_rls_owner_${SUFFIX}`;
const TABLE_OWNED = `fp_rls_owned_${SUFFIX}`;
const PASSWORD = `pw_${SUFFIX}`;
let canCreateRoles = false;

function urlFor(role: string): string {
  const u = new URL(process.env["DATABASE_URL"]!);
  u.username = role;
  u.password = PASSWORD;
  return u.toString();
}

async function factsAs(role: string): Promise<RlsEnforcementFacts> {
  const c = new pg.Client({ connectionString: urlFor(role) });
  await c.connect();
  try { return await inspectRlsFacts(c); } finally { await c.end(); }
}

beforeAll(async () => {
  try {
    await pool.query(`CREATE ROLE "${ROLE_PLAIN}"  LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
    await pool.query(`CREATE ROLE "${ROLE_BYPASS}" LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER BYPASSRLS`);
    await pool.query(`CREATE ROLE "${ROLE_MEMBER}" LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
    await pool.query(`CREATE ROLE "${ROLE_OWNER}"  LOGIN PASSWORD '${PASSWORD}' NOSUPERUSER NOBYPASSRLS`);
    await pool.query(`GRANT app_user TO "${ROLE_MEMBER}"`);
    await pool.query(`GRANT CREATE ON SCHEMA public TO "${ROLE_OWNER}"`);
    await pool.query(`CREATE TABLE public."${TABLE_OWNED}" (id int)`);
    await pool.query(`ALTER TABLE public."${TABLE_OWNED}" OWNER TO "${ROLE_OWNER}"`);
    await pool.query(`ALTER TABLE public."${TABLE_OWNED}" ENABLE ROW LEVEL SECURITY`);
    canCreateRoles = true;
  } catch {
    canCreateRoles = false;
  }
}, 60_000);

afterAll(async () => {
  await pool.query(`DROP TABLE IF EXISTS public."${TABLE_OWNED}"`).catch(() => {});
  await pool.query(`REVOKE CREATE ON SCHEMA public FROM "${ROLE_OWNER}"`).catch(() => {});
  for (const r of [ROLE_PLAIN, ROLE_BYPASS, ROLE_MEMBER, ROLE_OWNER]) {
    await pool.query(`DROP ROLE IF EXISTS "${r}"`).catch(() => {});
  }
}, 60_000);

describe("mesure sur la base de la CI", () => {
  it("la CI peut creer des roles de test (sinon cette partie ne prouve rien)", () => {
    expect(canCreateRoles, "le role de connexion de la CI doit pouvoir CREATE ROLE").toBe(true);
  });

  it("role de connexion de la CI : SET ROLE app_user fonctionne -> enforced", async () => {
    await probeAppUserRole();
    const s = getRlsEnforcementStatus();
    expect(s.mode).toBe("enforced");
    expect(s.isolationGuaranteed).toBe(true);
    expect(s.facts.appUserRoleExists).toBe(true);
    expect(s.facts.setRoleUsable).toBe(true);
    expect(s.facts.appUserBypassesRls).toBe(false);
  });

  it("role ordinaire, non membre d'app_user -> SET ROLE impossible, mais soumis a RLS : garantie", async () => {
    const f = await factsAs(ROLE_PLAIN);
    expect(f).toMatchObject({ setRoleUsable: false, connectionIsSuperuser: false, connectionBypassesRls: false, ownedUnforcedRlsTables: 0 });
    expect(classifyRlsEnforcement(f)).toMatchObject({ mode: "guc-only", isolationGuaranteed: true });
  });

  it("role BYPASSRLS, non membre d'app_user -> GUC-only SANS isolation (cas Supabase)", async () => {
    const f = await factsAs(ROLE_BYPASS);
    expect(f.connectionBypassesRls).toBe(true);
    expect(f.setRoleUsable).toBe(false);
    const c = classifyRlsEnforcement(f);
    expect(c.mode).toBe("guc-only");
    expect(c.isolationGuaranteed).toBe(false);
  });

  it("role membre d'app_user -> SET ROLE fonctionne -> enforced", async () => {
    const f = await factsAs(ROLE_MEMBER);
    expect(f.setRoleUsable).toBe(true);
    expect(classifyRlsEnforcement(f)).toMatchObject({ mode: "enforced", isolationGuaranteed: true });
  });

  it("role proprietaire d'une table RLS sans FORCE -> detecte, PAS garantie", async () => {
    const f = await factsAs(ROLE_OWNER);
    expect(f.ownedUnforcedRlsTables).toBeGreaterThanOrEqual(1);
    expect(classifyRlsEnforcement(f).isolationGuaranteed).toBe(false);
  });
});
