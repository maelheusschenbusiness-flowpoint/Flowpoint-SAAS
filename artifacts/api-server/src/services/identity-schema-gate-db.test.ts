/**
 * identity-schema-gate-db.test.ts
 *
 * `users` et `organization_members` sont les tables d'identite : l'application
 * les interroge a chaque authentification. Elles n'etaient posees qu'au
 * demarrage du serveur, par une etape explicitement marquee non fatale, alors
 * que migrate.mjs — la porte de deploiement — ne les posait pas.
 *
 * Mesure sur base vierge, apres un migrate.mjs qui sort en 0 :
 *   SELECT id FROM users …                 → relation "users" does not exist
 *   SELECT role FROM organization_members  → relation … does not exist
 *   SELECT count(*) FROM organizations     → 0        (celle-la etait bien posee)
 *
 * Une porte ne peut pas refuser un schema qu'elle ne pose pas. Et comme le
 * run() d'init-phase1-users avale chaque erreur DDL en silence, l'appeler ne
 * suffit pas : la porte doit verifier le resultat. C'est ce que ces tests
 * fixent, avec l'ordre d'execution dont depend la reprise de l'existant.
 *
 * Consequence RLS, mesuree : avant, `users` finissait avec rowsecurity=false et
 * le role app_user — celui que withOrgDb active, NOSUPERUSER, sans BYPASSRLS —
 * voyait TOUTES les lignes d'identite. Apres, la table passe par le
 * durcissement RLS comme les autres et il n'en voit aucune. Aucune requete de
 * l'application sur `users` ne passe par withOrgDb, donc rien de legitime ne
 * perd l'acces : verifie par la certification navigateur, 17/17.
 */

import { vi, describe, it, expect, beforeAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) =>
  importOriginal<typeof import("@workspace/db")>()
);

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { pool } from "@workspace/db";
import fs from "node:fs";
import path from "node:path";
import { initPhase1Users } from "./init-phase1-users.js";

const migrateSrc = (): string =>
  fs.readFileSync(path.join(import.meta.dirname ?? __dirname, "../migrate.ts"), "utf8");

beforeAll(async () => {
  await initPhase1Users();
});

describe("les tables d'identite sont posees par le chemin autoritaire", () => {
  it("users et organization_members existent, comme TABLES, apres l'initialiseur", async () => {
    // relkind : une vue homonyme satisferait to_regclass et ferait sauter le
    // CREATE TABLE IF NOT EXISTS en silence, sans accepter les INSERT.
    const res = await pool.query<{ users: boolean; membres: boolean }>(`
      SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = 'public' AND c.relname = 'users'                AND c.relkind = 'r') AS users,
             EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = 'public' AND c.relname = 'organization_members' AND c.relkind = 'r') AS membres
    `);
    expect(res.rows[0]?.users).toBe(true);
    expect(res.rows[0]?.membres).toBe(true);
  });

  it("users porte la contrainte d'unicite dont dependent les ON CONFLICT (email)", async () => {
    const res = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'users' AND indexdef ~* 'UNIQUE.*\\(email\\)'`
    );
    expect(Number(res.rows[0]?.n)).toBeGreaterThanOrEqual(1);
  });

  it("organization_members est isolee sur organization_id, sa cle de tenant", async () => {
    const res = await pool.query<{ policyname: string; predicat: string }>(
      `SELECT policyname, coalesce(qual, with_check, '') AS predicat
         FROM pg_policies WHERE schemaname = 'public' AND tablename = 'organization_members'
        ORDER BY policyname`
    );
    expect(res.rows.map((r) => r.policyname)).toEqual([
      "tenant_delete", "tenant_insert", "tenant_select", "tenant_update",
    ]);
    for (const row of res.rows) expect(row.predicat).toContain("organization_id");
  });

  it("users n'est PAS une table de tenant : aucune policy ne doit l'isoler sur une organisation", async () => {
    // L'identite est globale — une personne peut appartenir a plusieurs
    // organisations. Une policy tenant_* sur `users` rendrait invisible
    // l'utilisateur qui n'est pas dans l'organisation courante.
    const cols = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'org_id'`
    );
    expect(Number(cols.rows[0]?.n)).toBe(0);
    const pols = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'users' AND policyname LIKE 'tenant_%'`
    );
    expect(Number(pols.rows[0]?.n)).toBe(0);
  });
});

describe("consequence RLS de l'identite sous durcissement", () => {
  it("RLS active sur users : le role app_user ne voit aucune ligne d'identite", async () => {
    // Le DDL est transactionnel sous PostgreSQL : la table est remise dans son
    // etat initial par le ROLLBACK, la base n'est pas modifiee.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO users (email, status) VALUES ('rls.gate.probe@flowpoint.test', 'active')
           ON CONFLICT (email) DO NOTHING`
      );
      const avant = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM users`);
      expect(avant.rows[0]!.n).toBeGreaterThanOrEqual(1);

      await client.query(`ALTER TABLE users ENABLE ROW LEVEL SECURITY`);
      await client.query(`SET LOCAL ROLE app_user`);
      const vu = await client.query<{ n: number }>(`SELECT count(*)::int AS n FROM users`);
      expect(vu.rows[0]!.n).toBe(0);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
  });
});

describe("la porte de deploiement verifie le resultat", () => {
  it("migrate.ts appelle l'initialiseur d'identite", () => {
    expect(migrateSrc()).toContain("await initPhase1Users()");
  });

  it("et refuse la migration si les deux tables manquent — appeler ne suffit pas", () => {
    // run() d'init-phase1-users a un catch vide : l'appel reussit meme si le
    // CREATE TABLE a echoue. Sans cette verification, la porte ne verifie rien.
    const src = migrateSrc();
    expect(src).toMatch(/relname = 'users'\s+AND c\.relkind = 'r'/);
    expect(src).toMatch(/relname = 'organization_members'\s+AND c\.relkind = 'r'/);
    expect(src).toContain("Les tables d'identite sont absentes — migration refusee");
  });

  it("l'etape vient APRES les tables de base et AVANT le durcissement RLS", () => {
    // Apres : la reprise de l'existant lit organizations, org_settings et
    // team_members. Avant : les deux tables doivent passer par le durcissement
    // comme toutes les autres, ce qui est precisement ce qui manquait.
    const src = migrateSrc();
    const base      = src.indexOf("init-data-tables (tables de base)");
    const identite  = src.indexOf("init-phase1-users (identite");
    const durciss   = src.indexOf("Durcissement RLS (apres creation des tables)");
    const audit     = src.indexOf("Audit d'isolation inter-organisations");
    expect(base).toBeGreaterThan(0);
    expect(identite).toBeGreaterThan(base);
    expect(durciss).toBeGreaterThan(identite);
    expect(audit).toBeGreaterThan(durciss);
  });
});
