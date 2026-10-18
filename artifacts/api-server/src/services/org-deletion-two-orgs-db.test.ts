/**
 * org-deletion-two-orgs-db.test.ts
 *
 * Revalidation demandee le 17/10/2026 : supprimer une organisation doit
 * effacer TOUTES ses donnees, sans toucher a celles d'une autre — tables
 * partagees et relations indirectes comprises.
 *
 * Le schema compte huit tables SANS `org_id` :
 *   users, organizations, organization_members (via organization_id),
 *   pending_signups et magic_link_tokens (clees par e-mail),
 *   my_table (rattachee a un utilisateur seulement),
 *   sellers et checkout_subscription_claims (ni organisation ni utilisateur),
 *   schema_migrations (infrastructure).
 * Chacune a un traitement different, et c'est la que les erreurs se cachent.
 *
 * DEFAUT TROUVE PAR CE TEST, et corrige : `users.status` vaut 'pending' PAR
 * DEFAUT dans ce schema, et le nettoyage des comptes non actives effacait tout
 * utilisateur portant l'e-mail du compte supprime — y compris celui que la
 * resolution venait de PRESERVER parce qu'il appartient a une autre
 * organisation. L'issue etait l'une ou l'autre, les deux fausses : soit
 * l'utilisateur multi-organisations perdait l'acces a son autre organisation,
 * soit une cle etrangere vers `users` faisait echouer la transaction entiere
 * et la suppression ne supprimait RIEN, en silence.
 *
 * Les tests tournent sur un CLONE DE SCHEMA de la production : aucune donnee
 * de production n'est lue ni ecrite.
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

vi.mock("@workspace/db", async (importOriginal) =>
  importOriginal<typeof import("@workspace/db")>()
);
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("./stripe-factory.js", () => ({ getStripe: () => null, stripeConfigured: () => false }));

import { pool } from "@workspace/db";
import { deleteAccount } from "./account-deletion.js";

const ORG_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const ORG_B = "bbbbbbbb-0000-4000-8000-00000000000b";
/** Membre de A seulement — doit disparaitre entierement. */
const U_SEUL  = "11111111-0000-4000-8000-000000000011";
/** Membre de A ET de B — doit survivre, et garder ses donnees dans B. */
const U_DEUX  = "22222222-0000-4000-8000-000000000022";
const MAIL_SEUL = "seul@flowpoint-test.internal";
const MAIL_DEUX = "deux@flowpoint-test.internal";

type Colonne = { nom: string; type: string; nullable: boolean; defaut: string | null };

async function colonnes(table: string): Promise<Colonne[]> {
  const r = await pool.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns WHERE table_schema='public' AND table_name=$1
      ORDER BY ordinal_position`, [table]);
  return r.rows.map((c) => ({ nom: c.column_name, type: c.data_type, nullable: c.is_nullable === "YES", defaut: c.column_default }));
}

function valeur(c: Colonne, orgId: string, userId: string): unknown {
  // Les valeurs doivent DIFFERER d'une organisation a l'autre : avec des
  // valeurs identiques, les contraintes d'unicite rejetaient silencieusement
  // la seconde organisation, qui ne recevait que 24 tables sur 113 — un test
  // qui n'aurait rien prouve sur la preservation de B.
  const suffixe = orgId.slice(0, 8);
  if (c.nom === "org_id" || c.nom === "organization_id") return orgId;
  if (["user_id","user_uuid","owner_id","created_by","member_id","invited_by","sender_id","author_id","user_id_v2"].includes(c.nom)) {
    return c.type === "uuid" ? userId : userId;
  }
  switch (c.type) {
    case "uuid":                        return userId;
    // eslint-disable-next-line no-fallthrough
    case "integer": case "bigint": case "smallint": case "numeric":
    case "double precision": case "real": return 1;
    case "boolean":                     return false;
    case "timestamp with time zone": case "timestamp without time zone":
    case "date":                        return new Date().toISOString();
    case "json": case "jsonb":          return "{}";
    case "ARRAY":                       return "{}";
    default:                            return `t-${c.nom}-${suffixe}`;
  }
}

async function tablesOrg(): Promise<string[]> {
  const r = await pool.query<{ table_name: string }>(
    `SELECT c.table_name FROM information_schema.columns c
       JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
      WHERE c.table_schema='public' AND c.column_name IN ('org_id','organization_id')
      GROUP BY c.table_name ORDER BY c.table_name`);
  return r.rows.map((x) => x.table_name).filter((t) => t !== "organizations");
}

/** Pose une ligne par table portant org_id, et compte combien ont abouti. */
async function peupler(orgId: string, userId: string): Promise<number> {
  let n = 0;
  for (const table of await tablesOrg()) {
    const cols = (await colonnes(table)).filter((c) => c.defaut === null || !c.nullable || /org_id|organization_id|user_id/.test(c.nom));
    const noms = cols.map((c) => c.nom);
    if (!noms.includes("org_id") && !noms.includes("organization_id")) continue;
    const vals = cols.map((c) => valeur(c, orgId, userId));
    const place = cols.map((_, i) => `$${i + 1}`).join(",");
    try {
      await pool.query(
        `INSERT INTO public.${table} (${noms.map((x) => `"${x}"`).join(",")}) VALUES (${place}) ON CONFLICT DO NOTHING`, vals);
      n += 1;
    } catch { /* contrainte trop stricte pour une ligne synthetique */ }
  }
  return n;
}

async function compterOrg(orgId: string): Promise<Array<[string, number]>> {
  const out: Array<[string, number]> = [];
  for (const table of await tablesOrg()) {
    const cols = (await colonnes(table)).map((c) => c.nom);
    const col = cols.includes("org_id") ? "org_id" : "organization_id";
    const r = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::int AS n FROM public.${table} WHERE ${col}::text = $1`, [orgId]);
    const n = Number(r.rows[0]?.n ?? 0);
    if (n > 0) out.push([table, n]);
  }
  return out;
}

/** `my_table` n'existe pas dans toutes les bases de test : on s'y adapte. */
async function tableExiste(nom: string): Promise<boolean> {
  const r = await pool.query<{ n: string }>(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_schema='public' AND table_name=$1`, [nom]);
  return Number(r.rows[0]?.n ?? 0) > 0;
}

async function un(sql: string, params: unknown[] = []): Promise<number> {
  const r = await pool.query<{ n: string }>(sql, params);
  return Number(r.rows[0]?.n ?? 0);
}

async function poser(): Promise<void> {
  for (const [id, nom] of [[ORG_A, "Organisation A"], [ORG_B, "Organisation B"]] as const) {
    await pool.query(
      `INSERT INTO organizations (id, name, owner_email, created_at) VALUES ($1::uuid,$2,$3,NOW())
       ON CONFLICT (id) DO NOTHING`, [id, nom, id === ORG_A ? MAIL_SEUL : MAIL_DEUX]);
  }
  for (const [id, mail] of [[U_SEUL, MAIL_SEUL], [U_DEUX, MAIL_DEUX]] as const) {
    await pool.query(
      `INSERT INTO users (id, email, created_at) VALUES ($1::uuid,$2,NOW())
       ON CONFLICT (id) DO NOTHING`, [id, mail]);
  }
  // U_SEUL n'est membre que de A ; U_DEUX est membre de A ET de B.
  const liens: Array<[string, string]> = [[ORG_A, U_SEUL], [ORG_A, U_DEUX], [ORG_B, U_DEUX]];
  for (const [org, u] of liens) {
    await pool.query(
      `INSERT INTO organization_members (id, organization_id, user_id, role, status, created_at)
       VALUES (gen_random_uuid(),$1::uuid,$2::uuid,'member','active',NOW()) ON CONFLICT DO NOTHING`,
      [org, u]);
  }
  // Relations indirectes : my_table n'a QUE user_id.
  if (await tableExiste("my_table")) {
    for (const u of [U_SEUL, U_DEUX]) {
      await pool.query(
        `INSERT INTO my_table (id, user_id, analyses_count) VALUES (gen_random_uuid(),$1::uuid,1)`, [u]).catch(() => undefined);
    }
  }
  // Tables clees par e-mail.
  for (const mail of [MAIL_SEUL, MAIL_DEUX]) {
    await pool.query(
      `INSERT INTO magic_link_tokens (token, email, expires_at, created_at)
       VALUES ($1,$2,NOW() + interval '1 hour',NOW()) ON CONFLICT DO NOTHING`,
      [`jeton-${mail}`, mail]).catch(() => undefined);
  }
  await peupler(ORG_A, U_SEUL);
  await peupler(ORG_B, U_DEUX);
}

async function nettoyer(): Promise<void> {
  for (const table of await tablesOrg()) {
    const cols = (await colonnes(table)).map((c) => c.nom);
    const col = cols.includes("org_id") ? "org_id" : "organization_id";
    await pool.query(`DELETE FROM public.${table} WHERE ${col}::text = ANY($1)`, [[ORG_A, ORG_B]]).catch(() => undefined);
  }
  await pool.query(`DELETE FROM my_table WHERE user_id::text = ANY($1)`, [[U_SEUL, U_DEUX]]).catch(() => undefined);
  await pool.query(`DELETE FROM magic_link_tokens WHERE email = ANY($1)`, [[MAIL_SEUL, MAIL_DEUX]]).catch(() => undefined);
  await pool.query(`DELETE FROM organization_members WHERE organization_id::text = ANY($1)`, [[ORG_A, ORG_B]]).catch(() => undefined);
  await pool.query(`DELETE FROM users WHERE id::text = ANY($1)`, [[U_SEUL, U_DEUX]]).catch(() => undefined);
  await pool.query(`DELETE FROM organizations WHERE id::text = ANY($1)`, [[ORG_A, ORG_B]]).catch(() => undefined);
}

beforeAll(nettoyer);
afterAll(nettoyer);
beforeEach(async () => { await nettoyer(); await poser(); });

describe("supprimer l'organisation A n'emporte rien de l'organisation B", () => {
  it("A disparait entierement de toutes les tables portant org_id", async () => {
    const avantA = await compterOrg(ORG_A);
    expect(avantA.length, "trop peu de tables peuplees pour que le test prouve quoi que ce soit").toBeGreaterThan(60);

    await deleteAccount({ orgId: ORG_A, userId: U_SEUL, email: MAIL_SEUL, stripeCustomerId: null });

    const apresA = await compterOrg(ORG_A);
    const restants = apresA.map(([t, n]) => `${t} (${n})`);
    expect(restants, `tables conservant des donnees de A : ${restants.join(", ")}`).toEqual([]);
  }, 180_000);

  it("B conserve exactement ses donnees, table par table", async () => {
    const avantB = new Map(await compterOrg(ORG_B));
    expect(avantB.size).toBeGreaterThan(60);

    await deleteAccount({ orgId: ORG_A, userId: U_SEUL, email: MAIL_SEUL, stripeCustomerId: null });

    const apresB = new Map(await compterOrg(ORG_B));
    const ecarts: string[] = [];
    for (const [table, n] of avantB) {
      const m = apresB.get(table) ?? 0;
      if (m !== n) ecarts.push(`${table} : ${n} -> ${m}`);
    }
    expect(ecarts, `donnees de B modifiees : ${ecarts.join(", ")}`).toEqual([]);
    expect(await un(`SELECT COUNT(*)::int AS n FROM organizations WHERE id::text=$1`, [ORG_B])).toBe(1);
  }, 180_000);
});

describe("tables partagees : chacune a son traitement, et il est verifie", () => {
  it("l'organisation A disparait de `organizations`, B reste", async () => {
    await deleteAccount({ orgId: ORG_A, userId: U_SEUL, email: MAIL_SEUL, stripeCustomerId: null });
    expect(await un(`SELECT COUNT(*)::int AS n FROM organizations WHERE id::text=$1`, [ORG_A])).toBe(0);
    expect(await un(`SELECT COUNT(*)::int AS n FROM organizations WHERE id::text=$1`, [ORG_B])).toBe(1);
  }, 180_000);

  it("les appartenances a A disparaissent, celles a B sont intactes", async () => {
    await deleteAccount({ orgId: ORG_A, userId: U_SEUL, email: MAIL_SEUL, stripeCustomerId: null });
    expect(await un(`SELECT COUNT(*)::int AS n FROM organization_members WHERE organization_id::text=$1`, [ORG_A])).toBe(0);
    expect(await un(`SELECT COUNT(*)::int AS n FROM organization_members WHERE organization_id::text=$1`, [ORG_B])).toBe(1);
  }, 180_000);

  it("l'utilisateur membre de A SEULEMENT est efface de `users`", async () => {
    await deleteAccount({ orgId: ORG_A, userId: U_SEUL, email: MAIL_SEUL, stripeCustomerId: null });
    expect(await un(`SELECT COUNT(*)::int AS n FROM users WHERE id::text=$1`, [U_SEUL]),
      "un utilisateur dont la seule organisation a disparu reste dans users").toBe(0);
  }, 180_000);

  it("l'utilisateur membre des DEUX organisations survit", async () => {
    await deleteAccount({ orgId: ORG_A, userId: U_DEUX, email: MAIL_DEUX, stripeCustomerId: null });
    expect(await un(`SELECT COUNT(*)::int AS n FROM users WHERE id::text=$1`, [U_DEUX]),
      "un utilisateur encore membre d'une autre organisation a ete efface").toBe(1);
    expect(await un(`SELECT COUNT(*)::int AS n FROM organization_members WHERE user_id::text=$1 AND organization_id::text=$2`, [U_DEUX, ORG_B]),
      "l'appartenance a l'autre organisation a ete perdue").toBe(1);
  }, 180_000);

  it("les jetons de connexion de l'utilisateur efface partent, ceux de l'autre restent", async () => {
    await deleteAccount({ orgId: ORG_A, userId: U_SEUL, email: MAIL_SEUL, stripeCustomerId: null });
    expect(await un(`SELECT COUNT(*)::int AS n FROM magic_link_tokens WHERE email=$1`, [MAIL_SEUL]),
      "un jeton de connexion rejouable survit a la suppression du compte").toBe(0);
    expect(await un(`SELECT COUNT(*)::int AS n FROM magic_link_tokens WHERE email=$1`, [MAIL_DEUX]),
      "le jeton d'un autre utilisateur a ete emporte").toBe(1);
  }, 180_000);
});

describe("relations indirectes : une table rattachee a un UTILISATEUR seulement", () => {
  it("`my_table` perd la ligne de l'utilisateur efface", async (ctx) => {
    // Vitest abandonne un test par le CONTEXTE ; `test.skip()` appele dans le
    // corps ne fait rien et le test echoue quand meme.
    if (!(await tableExiste("my_table"))) return ctx.skip();
    expect(await un(`SELECT COUNT(*)::int AS n FROM my_table WHERE user_id::text=$1`, [U_SEUL])).toBe(1);
    await deleteAccount({ orgId: ORG_A, userId: U_SEUL, email: MAIL_SEUL, stripeCustomerId: null });
    expect(await un(`SELECT COUNT(*)::int AS n FROM my_table WHERE user_id::text=$1`, [U_SEUL]),
      "une table sans org_id, rattachee au seul utilisateur efface, garde sa ligne").toBe(0);
  }, 180_000);

  it("`my_table` garde la ligne de l'utilisateur multi-organisations", async (ctx) => {
    if (!(await tableExiste("my_table"))) return ctx.skip();
    await deleteAccount({ orgId: ORG_A, userId: U_DEUX, email: MAIL_DEUX, stripeCustomerId: null });
    expect(await un(`SELECT COUNT(*)::int AS n FROM my_table WHERE user_id::text=$1`, [U_DEUX]),
      "les donnees d'un utilisateur encore actif ailleurs ont ete emportees").toBe(1);
  }, 180_000);
});

describe("ce que la suppression ne doit PAS toucher", () => {
  it("les tables sans rattachement ni organisation ni utilisateur sont epargnees", async () => {
    const avant = {
      sellers: await un(`SELECT COUNT(*)::int AS n FROM sellers`),
      migrations: await un(`SELECT COUNT(*)::int AS n FROM schema_migrations`).catch(() => 0),
      claims: await un(`SELECT COUNT(*)::int AS n FROM checkout_subscription_claims`).catch(() => 0),
    };
    await deleteAccount({ orgId: ORG_A, userId: U_SEUL, email: MAIL_SEUL, stripeCustomerId: null });
    expect(await un(`SELECT COUNT(*)::int AS n FROM sellers`)).toBe(avant.sellers);
    expect(await un(`SELECT COUNT(*)::int AS n FROM schema_migrations`).catch(() => 0)).toBe(avant.migrations);
    expect(await un(`SELECT COUNT(*)::int AS n FROM checkout_subscription_claims`).catch(() => 0)).toBe(avant.claims);
  }, 180_000);

  it("appelee sans utilisateur ni e-mail, la suppression est complete quand meme", async () => {
    // La liste des utilisateurs a effacer vient d'abord de
    // `organization_members` pour cette organisation ; `target.userId` et
    // `target.email` ne font que la completer pour les donnees legacy
    // incoherentes. Une suppression declenchee sans ces deux champs reste donc
    // complete — et l'e-mail est retrouve depuis la base.
    await deleteAccount({ orgId: ORG_A, userId: null, email: null, stripeCustomerId: null });
    expect(await un(`SELECT COUNT(*)::int AS n FROM organizations WHERE id::text=$1`, [ORG_A])).toBe(0);
    expect(await un(`SELECT COUNT(*)::int AS n FROM users WHERE id::text=$1`, [U_SEUL]),
      "l'utilisateur dont la seule organisation a disparu reste dans users").toBe(0);
    expect(await un(`SELECT COUNT(*)::int AS n FROM users WHERE id::text=$1`, [U_DEUX]),
      "l'utilisateur multi-organisations a ete emporte").toBe(1);
  }, 180_000);
});
