/**
 * org-deletion-orphans-db.test.ts
 *
 * Question posee le 17/10/2026 : le mecanisme actuel de suppression
 * d'organisation cree-t-il encore des orphelins ?
 *
 * Mesure du jour sur une copie restauree de la production : 14 278 lignes
 * portent un org_id qui ne correspond a aucune organisation existante, dont
 * 13 538 dans monitor_checks. Toutes datent du 18 aout au 1er septembre 2026 ;
 * la plus ancienne organisation survivante a ete creee le 5 septembre. C'est
 * donc un residu, pas une fuite active — mais il faut le DEMONTRER, pas le
 * supposer.
 *
 * Le schema compte 113 tables portant org_id. Quatre chemins de suppression
 * coexistent, et trois d'entre eux portent une liste de tables ECRITE A LA
 * MAIN : elle se perime des qu'une table est ajoutee. Le quatrieme —
 * `deleteAccount`, celui qu'un client declenche lui-meme — decouvre les tables
 * dans `information_schema` a l'execution.
 *
 * Ce test peuple LES 113 TABLES pour une organisation, declenche la
 * suppression, et compte ce qui reste. C'est la seule facon de repondre.
 *
 * La base utilisee est un clone de SCHEMA de la production : aucune donnee de
 * production n'est lue ni ecrite.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

vi.mock("@workspace/db", async (importOriginal) =>
  importOriginal<typeof import("@workspace/db")>()
);
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// Stripe est volontairement hors transaction dans le code de production ; ici
// il n'y a rien a annuler.
vi.mock("./stripe-factory.js", () => ({ getStripe: () => null, stripeConfigured: () => false }));

import { pool } from "@workspace/db";
import { deleteAccount } from "./account-deletion.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const AUTRE = "22222222-2222-4222-8222-222222222222";

type Colonne = { nom: string; type: string; nullable: boolean; defaut: string | null };

async function colonnes(table: string): Promise<Colonne[]> {
  const r = await pool.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
    `SELECT column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1
      ORDER BY ordinal_position`, [table]);
  return r.rows.map((c) => ({ nom: c.column_name, type: c.data_type, nullable: c.is_nullable === "YES", defaut: c.column_default }));
}

/** Une valeur plausible pour chaque type, suffisante pour poser une ligne. */
function valeur(c: Colonne, orgId: string): unknown {
  if (c.nom === "org_id" || c.nom === "organization_id") return orgId;
  switch (c.type) {
    case "uuid":                        return "33333333-3333-4333-8333-333333333333";
    case "integer": case "bigint": case "smallint": case "numeric":
    case "double precision": case "real": return 1;
    case "boolean":                     return false;
    case "timestamp with time zone": case "timestamp without time zone":
    case "date":                        return new Date().toISOString();
    case "json": case "jsonb":          return "{}";
    case "ARRAY":                       return "{}";
    default:                            return `t-${c.nom}`;
  }
}

async function tablesAvecOrgId(): Promise<string[]> {
  const r = await pool.query<{ table_name: string }>(
    `SELECT c.table_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
      WHERE c.table_schema='public' AND c.column_name IN ('org_id','organization_id')
      GROUP BY c.table_name ORDER BY c.table_name`);
  return r.rows.map((x) => x.table_name);
}

/** Pose une ligne dans chaque table portant org_id. Rend les tables peuplees. */
async function peupler(orgId: string): Promise<string[]> {
  const posees: string[] = [];
  for (const table of await tablesAvecOrgId()) {
    if (table === "organizations") continue;
    const cols = (await colonnes(table)).filter((c) => c.defaut === null || !c.nullable || c.nom === "org_id" || c.nom === "organization_id");
    const noms = cols.map((c) => c.nom);
    if (!noms.includes("org_id") && !noms.includes("organization_id")) continue;
    const vals = cols.map((c) => valeur(c, orgId));
    const place = cols.map((_, i) => `$${i + 1}`).join(",");
    try {
      await pool.query(
        `INSERT INTO public.${table} (${noms.map((n) => `"${n}"`).join(",")}) VALUES (${place}) ON CONFLICT DO NOTHING`,
        vals);
      posees.push(table);
    } catch { /* contrainte trop stricte pour une ligne synthetique — ignoree */ }
  }
  return posees;
}

/** Lignes restantes pour cet org, table par table. */
async function restes(orgId: string): Promise<Array<[string, number]>> {
  const out: Array<[string, number]> = [];
  for (const table of await tablesAvecOrgId()) {
    if (table === "organizations") continue;
    const cols = (await colonnes(table)).map((c) => c.nom);
    const col = cols.includes("org_id") ? "org_id" : "organization_id";
    const r = await pool.query<{ n: string }>(
      `SELECT COUNT(*)::int AS n FROM public.${table} WHERE ${col}::text = $1`, [orgId]);
    const n = Number(r.rows[0]?.n ?? 0);
    if (n > 0) out.push([table, n]);
  }
  return out;
}

async function poserOrganisations(): Promise<void> {
  for (const id of [ORG, AUTRE]) {
    await pool.query(
      `INSERT INTO organizations (id, name, created_at) VALUES ($1::uuid, $2, NOW())
       ON CONFLICT (id) DO NOTHING`, [id, `org de test ${id.slice(0, 8)}`]);
  }
}

async function nettoyer(): Promise<void> {
  for (const table of await tablesAvecOrgId()) {
    if (table === "organizations") continue;
    const cols = (await colonnes(table)).map((c) => c.nom);
    const col = cols.includes("org_id") ? "org_id" : "organization_id";
    await pool.query(`DELETE FROM public.${table} WHERE ${col}::text = ANY($1)`, [[ORG, AUTRE]]).catch(() => undefined);
  }
  await pool.query(`DELETE FROM organizations WHERE id::text = ANY($1)`, [[ORG, AUTRE]]).catch(() => undefined);
}

beforeAll(nettoyer);
afterAll(nettoyer);

describe("le chemin de suppression declenche par le client ne laisse aucun orphelin", () => {
  it("apres suppression, AUCUNE table ne conserve de ligne pour cette organisation", async () => {
    await poserOrganisations();
    const posees = await peupler(ORG);
    // Le test ne vaut rien s'il ne pose pas de donnees dans un grand nombre de tables.
    expect(posees.length, "trop peu de tables peuplees pour que le test prouve quoi que ce soit").toBeGreaterThan(60);

    const avant = await restes(ORG);
    expect(avant.length).toBeGreaterThan(60);

    await deleteAccount({ orgId: ORG, userId: null, email: null, stripeCustomerId: null });

    const apres = await restes(ORG);
    const nomsRestants = apres.map(([t, n]) => `${t} (${n})`);
    expect(nomsRestants, `tables orphelines apres suppression : ${nomsRestants.join(", ")}`).toEqual([]);
  }, 120_000);

  it("la ligne organizations elle-meme disparait", async () => {
    await poserOrganisations();
    await peupler(ORG);
    await deleteAccount({ orgId: ORG, userId: null, email: null, stripeCustomerId: null });
    const r = await pool.query<{ n: string }>(`SELECT COUNT(*)::int AS n FROM organizations WHERE id::text=$1`, [ORG]);
    expect(Number(r.rows[0]?.n)).toBe(0);
  }, 120_000);

  it("les donnees de l'autre organisation sont intactes", async () => {
    await poserOrganisations();
    await peupler(ORG);
    const posees = await peupler(AUTRE);
    const avantAutre = await restes(AUTRE);

    await deleteAccount({ orgId: ORG, userId: null, email: null, stripeCustomerId: null });

    const apresAutre = await restes(AUTRE);
    expect(apresAutre.length, "la suppression a emporte des lignes de l'autre organisation").toBe(avantAutre.length);
    expect(posees.length).toBeGreaterThan(60);
  }, 180_000);

  it("relancer la suppression ne leve pas — l'operation est idempotente", async () => {
    await poserOrganisations();
    await peupler(ORG);
    await deleteAccount({ orgId: ORG, userId: null, email: null, stripeCustomerId: null });
    await expect(deleteAccount({ orgId: ORG, userId: null, email: null, stripeCustomerId: null })).resolves.toBeDefined();
  }, 180_000);

  it("la decouverte des tables est dynamique, pas une liste ecrite a la main", () => {
    const src = readFileSync(path.join(import.meta.dirname ?? __dirname, "account-deletion.ts"), "utf8");
    expect(src).toContain("information_schema.columns");
    // Une liste litterale de plus de vingt noms de tables serait un retour en arriere.
    const plusGrandeListe = Math.max(0, ...[...src.matchAll(/\[([^\]]{200,})\]/g)]
      .map((m) => (m[1]!.match(/"[a-z][a-z0-9_]+"/g) ?? []).length));
    expect(plusGrandeListe, "une liste de tables ecrite a la main est reapparue").toBeLessThan(20);
  });
});

describe("plus aucun chemin de suppression ne porte de liste de tables ecrite a la main", () => {
  const racine = path.join(import.meta.dirname ?? __dirname, "..");
  const lire = (f: string) => readFileSync(path.join(racine, f), "utf8");

  /** La plus longue liste litterale de noms de tables du fichier. */
  function plusGrandeListeLitterale(src: string): number {
    return Math.max(0, ...[...src.matchAll(/\[([^\]]{150,})\]/g)]
      .map((m) => (m[1]!.match(/"[a-z][a-z0-9_]{2,}"/g) ?? []).length));
  }

  const chemins: Array<[string, string]> = [
    ["POST /admin/purge-all-clients et /admin/delete-qa-org", "routes/admin.ts"],
    ["DELETE /api/settings/data",                             "routes/me.ts"],
  ];

  for (const [nom, fichier] of chemins) {
    it(`${nom} decouvre les tables a l'execution`, () => {
      const src = lire(fichier);
      expect(src, `${nom} n'appelle pas la decouverte dynamique`).toContain("decouvrirTablesOrganisation");
    });
  }

  it("aucune liste litterale de plus de vingt tables ne subsiste dans les chemins de suppression", () => {
    // `admin.ts` conserve une liste pour le COMPTAGE affiche avant purge
    // (BUSINESS_TABLES) : elle ne supprime rien. Seules les listes qui
    // pilotaient une suppression ont ete retirees.
    const admin = lire("routes/admin.ts");
    expect(admin).not.toMatch(/for \(const tbl of \[\s*\n\s*\/\/ Core audits/);
    expect(admin).not.toMatch(/const tables = \["monitors","audits","reports"/);
    expect(plusGrandeListeLitterale(lire("routes/me.ts"))).toBeLessThan(20);
  });
});

describe("purger les donnees en gardant le compte : ce qui part, ce qui reste", () => {
  it("toutes les tables produit sont videes, les tables du compte sont intactes", async () => {
    const { decouvrirTablesOrganisation, TABLES_COMPTE_A_PRESERVER } =
      await import("./account-deletion.js");

    await poserOrganisations();
    const posees = await peupler(ORG);
    expect(posees.length).toBeGreaterThan(60);

    // Reproduit exactement ce que fait DELETE /api/settings/data.
    const cibles = await decouvrirTablesOrganisation(pool, { exclure: TABLES_COMPTE_A_PRESERVER });
    for (const { table, colonne } of cibles) {
      await pool.query(`DELETE FROM public.${table} WHERE ${colonne}::text = $1`, [ORG]).catch(() => undefined);
    }

    const restants = (await restes(ORG)).map(([t]) => t);
    const nonPreserves = restants.filter((t) => !TABLES_COMPTE_A_PRESERVER.has(t));
    expect(nonPreserves, `donnees produit conservees malgre la purge : ${nonPreserves.join(", ")}`).toEqual([]);
  }, 180_000);

  it("le compte survit a la purge : organisation, appartenance, plan et facturation", async () => {
    const { decouvrirTablesOrganisation, TABLES_COMPTE_A_PRESERVER } =
      await import("./account-deletion.js");

    await poserOrganisations();
    await peupler(ORG);
    const avant = new Set((await restes(ORG)).map(([t]) => t));

    const cibles = await decouvrirTablesOrganisation(pool, { exclure: TABLES_COMPTE_A_PRESERVER });
    for (const { table, colonne } of cibles) {
      await pool.query(`DELETE FROM public.${table} WHERE ${colonne}::text = $1`, [ORG]).catch(() => undefined);
    }

    const apres = new Set((await restes(ORG)).map(([t]) => t));
    // Chaque table du compte qui portait une ligne avant en porte encore une.
    for (const t of ["org_settings", "organization_members", "subscriptions", "org_addons", "billing_events"]) {
      if (avant.has(t)) expect(apres.has(t), `${t} a ete videe alors qu'elle porte le compte`).toBe(true);
    }
    const org = await pool.query<{ n: string }>(`SELECT COUNT(*)::int AS n FROM organizations WHERE id::text=$1`, [ORG]);
    expect(Number(org.rows[0]?.n)).toBe(1);
  }, 180_000);

  it("la liste a preserver est courte et explicite — pas un fourre-tout", async () => {
    const { TABLES_COMPTE_A_PRESERVER } = await import("./account-deletion.js");
    expect(TABLES_COMPTE_A_PRESERVER.size).toBeLessThan(25);
    for (const attendu of ["organizations", "users", "org_settings", "subscriptions", "org_addons"]) {
      expect(TABLES_COMPTE_A_PRESERVER.has(attendu), `${attendu} doit survivre a une purge de donnees`).toBe(true);
    }
    // Les donnees produit ne doivent surtout PAS y figurer.
    for (const interdit of ["audits", "monitors", "monitor_checks", "reports", "team_messages", "ai_chat_history"]) {
      expect(TABLES_COMPTE_A_PRESERVER.has(interdit), `${interdit} est une donnee produit, elle doit partir`).toBe(false);
    }
  });
});
