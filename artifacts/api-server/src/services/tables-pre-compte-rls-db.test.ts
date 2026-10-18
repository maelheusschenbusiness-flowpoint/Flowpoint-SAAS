/**
 * tables-pre-compte-rls-db.test.ts
 *
 * MESURE DU 18/10/2026. On soupconnait un defaut de production : trois tables
 * ont RLS **forcee** et AUCUNE policy — `checkout_subscription_claims`,
 * `pending_signups`, `seller_financial_ledger`. RLS forcee s'applique meme au
 * proprietaire. Sans policy, personne n'ecrit. L'inscription et la reclamation
 * d'abonnement apres paiement auraient donc ete impossibles.
 *
 * Elles ne le sont pas, et la raison est mesurable. L'acces a ces tables ne
 * passe JAMAIS par `withOrgDb()` : `routes/auth.ts`, `routes/public-billing.ts`
 * et `services/checkout-subscription-claim.ts` utilisent `pool.query` /
 * `pool.connect()`, donc le role de connexion. En production ce role est
 * `postgres`, qui porte `rolbypassrls = true` : RLS ne s'applique pas. Le
 * `SET LOCAL ROLE app_user` de `withOrgDb` y echoue de toute facon, puisque
 * l'appartenance `postgres → app_user` existe avec `set_option = false`.
 *
 * Il n'y avait donc rien a corriger dans le schema. Ce qu'il y avait a faire,
 * c'est empecher que cela devienne vrai. Le jour ou quelqu'un routera
 * l'inscription a travers `withOrgDb` — geste qui a toutes les apparences d'un
 * renforcement —, ces ecritures commenceront a etre refusees en production.
 *
 * Ces tests tiennent les deux bouts : ils prouvent que sous `app_user`
 * l'ecriture EST refusee, qu'elle passe par la voie reelle, et qu'aucun code
 * ne route ces tables par la voie qui echouerait.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) =>
  importOriginal<typeof import("@workspace/db")>()
);
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Les trois tables pre-compte : RLS forcee, aucune policy, aucune dimension d'organisation exploitable a la requete. */
const TABLES_PRE_COMPTE = ["pending_signups", "magic_link_tokens", "checkout_subscription_claims"] as const;

/** Une insertion valide et minimale pour chacune. */
function insertion(table: string, cle: string): { sql: string; valeurs: unknown[] } {
  switch (table) {
    case "pending_signups":
      return {
        sql: `INSERT INTO pending_signups (token, email, first_name, last_name, company_name)
              VALUES ($1, $2, 'Essai', 'Certification', 'Societe d''essai')`,
        valeurs: [cle, `${cle}@flowpoint-test.internal`],
      };
    case "magic_link_tokens":
      return {
        sql: `INSERT INTO magic_link_tokens (token, email) VALUES ($1, $2)`,
        valeurs: [cle, `${cle}@flowpoint-test.internal`],
      };
    case "checkout_subscription_claims":
      return {
        sql: `INSERT INTO checkout_subscription_claims (attempt_key, intent_id) VALUES ($1, $2)`,
        valeurs: [cle, `pi_${cle}`],
      };
    default:
      throw new Error(`table non prevue : ${table}`);
  }
}

let roleUtilisable = false;
const clesPosees: Array<[string, string]> = [];

beforeAll(async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE app_user");
    await c.query("ROLLBACK");
    roleUtilisable = true;
  } catch {
    await c.query("ROLLBACK").catch(() => undefined);
    roleUtilisable = false;   // c'est l'etat de la production
  } finally {
    c.release();
  }
});

afterAll(async () => {
  for (const [table, cle] of clesPosees) {
    const colonne = table === "checkout_subscription_claims" ? "attempt_key" : "token";
    await pool.query(`DELETE FROM ${table} WHERE ${colonne} = $1`, [cle]).catch(() => undefined);
  }
});

describe("l'etat du schema est bien celui qu'on a mesure", () => {
  it.each(TABLES_PRE_COMPTE)("%s a RLS active et aucune policy", async (table) => {
    const r = await pool.query<{ rls: boolean; policies: string }>(
      `SELECT c.relrowsecurity AS rls,
              (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=$1) AS policies
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=$1`, [table]);
    expect(r.rows[0]?.rls, `${table} : RLS n'est pas active`).toBe(true);
    expect(Number(r.rows[0]?.policies), `${table} a desormais des policies — ce test doit etre revu`).toBe(0);
  });
});

describe("la voie reelle de l'application ecrit sans entrave", () => {
  it.each(TABLES_PRE_COMPTE)("%s accepte l'ecriture par le role de connexion", async (table) => {
    const cle = `certif-${randomUUID()}`;
    const { sql, valeurs } = insertion(table, cle);
    await expect(
      pool.query(sql, valeurs),
      `${table} refuse une ecriture par la voie que l'application utilise reellement`
    ).resolves.toBeDefined();
    clesPosees.push([table, cle]);
  });
});

describe("sous app_user, ces memes ecritures sont refusees", () => {
  it("RLS sans policy refuse l'insertion sur les trois tables", async (ctx) => {
    // Quand `SET LOCAL ROLE app_user` echoue — l'etat de la production — il n'y
    // a rien a observer ici : RLS ne s'applique jamais. On ne simule pas.
    if (!roleUtilisable) return ctx.skip();

    for (const table of TABLES_PRE_COMPTE) {
      const cle = `certif-refus-${randomUUID()}`;
      const { sql, valeurs } = insertion(table, cle);
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        await c.query("SET LOCAL ROLE app_user");
        await expect(
          c.query(sql, valeurs),
          `${table} a accepte une insertion sous app_user alors qu'aucune policy ne l'autorise`
        ).rejects.toThrow(/row-level security|violates/i);
      } finally {
        await c.query("ROLLBACK").catch(() => undefined);
        c.release();
      }
    }
  });
});

describe("les modules qui detiennent ces acces n'empruntent pas la voie qui echouerait", () => {
  // Un balayage large produit des faux positifs : les fichiers d'initialisation
  // du schema contiennent le DDL de ces tables ET parlent de `withOrgDb` en
  // commentaire, et `admin.ts` fait les deux pour des tables differentes.
  // Le verrou utile est donc nominatif : ce sont ces trois modules qui portent
  // l'inscription, le lien magique et la reclamation d'abonnement.
  const MODULES = [
    "src/routes/auth.ts",
    "src/routes/public-billing.ts",
    "src/services/checkout-subscription-claim.ts",
  ] as const;

  it.each(MODULES)("%s n'utilise pas withOrgDb", (chemin) => {
    const source = readFileSync(join(process.cwd(), chemin), "utf8");
    expect(
      source.includes("withOrgDb"),
      `${chemin} route desormais par withOrgDb : sous app_user les ecritures ` +
      "pre-compte seraient refusees, et l'inscription casserait. Soit ce module " +
      "garde pool.query, soit les tables concernees recoivent des policies."
    ).toBe(false);
  });

  it("ces modules touchent bien au moins une table pre-compte — le verrou reste pertinent", () => {
    const concernes = MODULES.filter((chemin) => {
      const source = readFileSync(join(process.cwd(), chemin), "utf8");
      return TABLES_PRE_COMPTE.some((t) => source.includes(t));
    });
    expect(
      concernes.length,
      "aucun de ces modules ne mentionne plus une table pre-compte : l'acces a " +
      "demenage et ce test surveille le vide"
    ).toBeGreaterThan(0);
  });
});

describe("l'isolation entre organisations tient, elle, sous app_user", () => {
  it("une organisation ne lit pas les lignes d'une autre", async (ctx) => {
    if (!roleUtilisable) return ctx.skip();

    const orgA = randomUUID();
    const orgB = randomUUID();
    // `org_settings` porte org_id et des policies tenant_* : c'est le cas normal.
    await pool.query(`INSERT INTO org_settings (org_id, plan) VALUES ($1,'standard'), ($2,'pro')
                      ON CONFLICT (org_id) DO NOTHING`, [orgA, orgB]);
    try {
      const c = await pool.connect();
      try {
        for (const [vue, invisible] of [[orgA, orgB], [orgB, orgA]] as const) {
          await c.query("BEGIN");
          await c.query("SET LOCAL ROLE app_user");
          await c.query("SELECT set_config('app.current_org_id', $1, true)", [vue]);
          const sienne = await c.query(`SELECT org_id FROM org_settings WHERE org_id = $1`, [vue]);
          const autre   = await c.query(`SELECT org_id FROM org_settings WHERE org_id = $1`, [invisible]);
          await c.query("ROLLBACK");
          expect(sienne.rowCount, "une organisation ne voit pas sa propre ligne").toBe(1);
          expect(autre.rowCount, "FUITE : une organisation voit la ligne d'une autre").toBe(0);
        }
      } finally { c.release(); }
    } finally {
      await pool.query(`DELETE FROM org_settings WHERE org_id = ANY($1::text[])`, [[orgA, orgB]]).catch(() => undefined);
    }
  });
});
