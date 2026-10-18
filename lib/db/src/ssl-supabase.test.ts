/**
 * ssl-supabase.test.ts
 *
 * DEFAUT MESURE LE 18/10/2026 : la connexion au pooler Supabase echouait avec
 * `SELF_SIGNED_CERT_IN_CHAIN`, parce que la chaine se termine sur une racine
 * auto-signee — `Supabase Root 2021 CA` — absente du magasin public.
 *
 * La correction fournit cette racine. Ces tests verrouillent les trois
 * proprietes qui comptent : la verification reste ACTIVE, la racine est
 * AJOUTEE au magasin et ne le remplace pas, et le comportement de la
 * production — `DATABASE_URL` seule — n'est pas modifie.
 */
import { describe, it, expect } from "vitest";
import { rootCertificates } from "node:tls";
import { optionsSslPostgres, RACINE_SUPABASE_2021 } from "./ssl-supabase.js";

const env = (v: Record<string, string | undefined>) => v as NodeJS.ProcessEnv;
const SEPAREES = {
  PGHOST: "aws-1-eu-central-1.pooler.supabase.com",
  PGUSER: "postgres.ref",
  PGPASSWORD: "mdp",
  PGDATABASE: "postgres",
} as const;

describe("la racine epinglee est bien celle de Supabase", () => {
  it("c'est un certificat PEM unique et complet", () => {
    expect(RACINE_SUPABASE_2021.startsWith("-----BEGIN CERTIFICATE-----")).toBe(true);
    expect(RACINE_SUPABASE_2021.trimEnd().endsWith("-----END CERTIFICATE-----")).toBe(true);
    expect(RACINE_SUPABASE_2021.match(/BEGIN CERTIFICATE/g)?.length, "un seul certificat attendu").toBe(1);
  });

  it("elle ne contient rien qui ressemble a une cle privee", () => {
    expect(RACINE_SUPABASE_2021).not.toContain("PRIVATE KEY");
  });
});

describe("la verification reste active, et la racine est ajoutee", () => {
  it("variables separees completes : verification active par defaut", () => {
    const o = optionsSslPostgres(env({ ...SEPAREES }));
    expect(o).not.toBe(false);
    expect(o).not.toBeUndefined();
    expect((o as { rejectUnauthorized: boolean }).rejectUnauthorized,
      "la verification du certificat a ete desactivee").toBe(true);
  });

  it("le magasin par defaut est CONSERVE, la racine Supabase s'y ajoute", () => {
    const o = optionsSslPostgres(env({ ...SEPAREES })) as { ca: string[] };
    expect(o.ca[0]).toBe(RACINE_SUPABASE_2021);
    expect(o.ca.length, "le magasin par defaut a ete remplace au lieu d'etre complete")
      .toBe(rootCertificates.length + 1);
  });

  it("PGSSLMODE pose impose aussi la verification", () => {
    for (const mode of ["require", "verify-ca", "verify-full"]) {
      const o = optionsSslPostgres(env({ PGSSLMODE: mode }));
      expect((o as { rejectUnauthorized: boolean })?.rejectUnauthorized, mode).toBe(true);
    }
  });

  it("aucun contournement n'est expose : rejectUnauthorized ne vaut jamais false", () => {
    for (const e of [{ ...SEPAREES }, { PGSSLMODE: "require" }, { PGSSLMODE: "verify-full" }]) {
      const o = optionsSslPostgres(env(e));
      if (o && o !== false) expect(o.rejectUnauthorized).toBe(true);
    }
  });
});

describe("les cas ou l'on n'impose rien", () => {
  it("PGSSLMODE=disable : aucun chiffrement — bases locales de test", () => {
    expect(optionsSslPostgres(env({ ...SEPAREES, PGSSLMODE: "disable" }))).toBe(false);
  });

  it("DATABASE_URL seule, sans PGSSLMODE : comportement INCHANGE", () => {
    // C'est la configuration de la production. Rendre `undefined` garantit que
    // le pool est construit exactement comme avant.
    expect(optionsSslPostgres(env({ DATABASE_URL: "postgresql://u:p@h:5432/b" }))).toBeUndefined();
    expect(optionsSslPostgres(env({}))).toBeUndefined();
  });

  it("des variables separees incompletes n'imposent rien", () => {
    const partiel: Record<string, string | undefined> = { ...SEPAREES };
    delete partiel["PGPASSWORD"];
    expect(optionsSslPostgres(env(partiel))).toBeUndefined();
  });
});
