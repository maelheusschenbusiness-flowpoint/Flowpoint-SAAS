/**
 * url-base.test.ts
 *
 * Verrouille la configuration par variables separees, ajoutee le 18/10/2026
 * apres deux echecs de demarrage dus a la forme de `DATABASE_URL` :
 * `28P01` sur un utilisateur `postgres` au lieu de `postgres.<ref>`, puis un
 * refus de validation sur un caractere reserve non encode.
 *
 * Les tests couvrent les trois choses qui doivent tenir : l'encodage se fait
 * ici et correctement, `DATABASE_URL` l'emporte toujours, et le resultat passe
 * le validateur reel du serveur.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { construireDepuisVariablesPg, appliquerVariablesPg } from "./url-base.js";

/** Le validateur reel de `envSchema.DATABASE_URL`. */
const validateurReel = z.string().url();

const BASE = {
  PGHOST: "aws-0-eu-central-1.pooler.supabase.com",
  PGUSER: "postgres.rrjllaiodpvtsphrtdqd",
  PGPASSWORD: "motdepasse",
  PGDATABASE: "postgres",
} as const;

const env = (v: Record<string, string | undefined>) => v as NodeJS.ProcessEnv;

describe("construction depuis les variables separees", () => {
  it("assemble hote, port, base et sslmode, avec les defauts attendus", () => {
    const url = construireDepuisVariablesPg(env({ ...BASE }));
    expect(url).toBe(
      "postgresql://postgres.rrjllaiodpvtsphrtdqd:motdepasse@" +
      "aws-0-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require"
    );
  });

  it("le port et le mode SSL peuvent etre imposes", () => {
    const url = construireDepuisVariablesPg(env({ ...BASE, PGPORT: "6543", PGSSLMODE: "verify-full" }));
    expect(url).toContain(":6543/");
    expect(url).toContain("sslmode=verify-full");
  });

  it("TLS est exige par defaut — Supabase refuse une connexion en clair", () => {
    expect(construireDepuisVariablesPg(env({ ...BASE }))).toContain("sslmode=require");
  });

  it("il manque une variable : rien n'est construit", () => {
    for (const cle of ["PGHOST", "PGUSER", "PGPASSWORD", "PGDATABASE"] as const) {
      const partiel: Record<string, string | undefined> = { ...BASE };
      delete partiel[cle];
      expect(construireDepuisVariablesPg(env(partiel)), `${cle} manquante`).toBeNull();
    }
  });

  it("une variable vide vaut une variable absente", () => {
    expect(construireDepuisVariablesPg(env({ ...BASE, PGPASSWORD: "" }))).toBeNull();
  });
});

describe("LE PROBLEME RESOLU — l'encodage n'est plus a la charge de l'exploitant", () => {
  // Ce sont exactement les caracteres qui ont fait echouer le demarrage, plus
  // ceux qu'un generateur de mot de passe produit couramment.
  it.each([
    ["diese",        "mot#depasse"],
    ["slash",        "mot/depasse"],
    ["arobase",      "mot@depasse"],
    ["interrogation","mot?depasse"],
    ["plus",         "mot+depasse"],
    ["egal",         "mot=depasse"],
    ["deux-points",  "mot:depasse"],
    ["espace",       "mot depasse"],
    ["tout a la fois", "a#b/c@d?e+f=g:h i"],
  ])("un mot de passe contenant un %s produit une URL valide", (_nom, motDePasse) => {
    const url = construireDepuisVariablesPg(env({ ...BASE, PGPASSWORD: motDePasse }));
    expect(url).not.toBeNull();
    expect(validateurReel.safeParse(url!).success, "le validateur du serveur refuse l'URL construite").toBe(true);
    // Et la valeur se retrouve intacte apres analyse — l'encodage est reversible.
    expect(decodeURIComponent(new URL(url!).password)).toBe(motDePasse);
  });

  it("le point dans l'utilisateur du pooler est preserve", () => {
    const url = construireDepuisVariablesPg(env({ ...BASE }))!;
    expect(decodeURIComponent(new URL(url).username)).toBe("postgres.rrjllaiodpvtsphrtdqd");
  });
});

describe("precedence : DATABASE_URL l'emporte toujours", () => {
  it("une DATABASE_URL posee n'est jamais remplacee", () => {
    const e = env({ ...BASE, DATABASE_URL: "postgresql://autre:mdp@autre-hote:5432/autre" });
    const r = appliquerVariablesPg(e);
    expect(r).toEqual({ applique: false, raison: "deja_posee" });
    expect(e["DATABASE_URL"]).toBe("postgresql://autre:mdp@autre-hote:5432/autre");
  });

  it("une DATABASE_URL MALFORMEE n'est pas masquee en silence", () => {
    // Elle doit echouer avec son propre message, qui nomme la cause, plutot
    // que d'etre remplacee par une construction qui cacherait l'erreur.
    const malformee = "postgresql://postgres:mdp#42@hote:5432/base";
    const e = env({ ...BASE, DATABASE_URL: malformee });
    expect(appliquerVariablesPg(e).raison).toBe("deja_posee");
    expect(e["DATABASE_URL"]).toBe(malformee);
    expect(validateurReel.safeParse(malformee).success).toBe(false);
  });

  it("DATABASE_URL absente et variables completes : elle est construite", () => {
    const e = env({ ...BASE });
    expect(appliquerVariablesPg(e)).toEqual({ applique: true, raison: "construite" });
    expect(validateurReel.safeParse(e["DATABASE_URL"]!).success).toBe(true);
  });

  it("DATABASE_URL vide compte comme absente", () => {
    const e = env({ ...BASE, DATABASE_URL: "" });
    expect(appliquerVariablesPg(e).applique).toBe(true);
  });

  it("ni l'une ni les autres : rien n'est invente", () => {
    const e = env({});
    expect(appliquerVariablesPg(e)).toEqual({ applique: false, raison: "variables_incompletes" });
    expect(e["DATABASE_URL"]).toBeUndefined();
  });
});

describe("le resultat reste compatible avec la garde de cible", () => {
  it("lireCible retrouve l'hote et la base dans l'URL construite", async () => {
    const { lireCible } = await import("../services/garde-cible-base.js");
    const url = construireDepuisVariablesPg(env({ ...BASE, PGPASSWORD: "mot#de/passe" }))!;
    expect(lireCible(url)).toEqual({
      hote: "aws-0-eu-central-1.pooler.supabase.com",
      base: "postgres",
    });
  });
});
