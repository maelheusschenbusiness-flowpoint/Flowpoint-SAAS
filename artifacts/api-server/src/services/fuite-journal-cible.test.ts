/**
 * fuite-journal-cible.test.ts
 *
 * FUITE REELLE, MESUREE LE 18/10/2026 — et c'est le defaut le plus grave de
 * cette serie.
 *
 * Le journal de demarrage de la garde de cible imprimait `hote/base` tels
 * qu'issus de l'analyse de `DATABASE_URL`. `PGHOST` ayant recu par erreur une
 * chaine de connexion complete au lieu du seul nom d'hote, l'URL composee par
 * `construireDepuisVariablesPg` devenait :
 *
 *   postgresql://<user>:<pass>@postgresql//postgres.<ref>:<MOT_DE_PASSE>@…/postgres:5432/postgres
 *
 * `new URL()` prend alors `postgresql` pour hote, et tout le reste — identifiant
 * compris — devient le CHEMIN. Le journal a donc imprime le mot de passe
 * PostgreSQL en clair dans les journaux Render.
 *
 * Deux verrous, aux deux etages :
 *   1. `construireDepuisVariablesPg` refuse un `PGHOST` qui n'est pas un hote ;
 *   2. `decrireCibleSurement` n'imprime que ce qui ressemble strictement a un
 *      hote et a un nom de base. Un journal ne doit pas pouvoir divulguer un
 *      secret, quelle que soit l'entree.
 */
import { describe, it, expect } from "vitest";
import { lireCible, decrireCibleSurement } from "./garde-cible-base.js";
import { construireDepuisVariablesPg, VariablesPgInvalides } from "../lib/url-base.js";

/** Le mot de passe de ce test. Il ne doit JAMAIS ressortir. */
const SECRET = "tIxham-nemqor-zuxto5";

/** La valeur exactement fautive qui a provoque la fuite. */
const PGHOST_FAUTIF =
  `postgresql//postgres.rrjllaiodpvtsphrtdqd:${SECRET}@aws-1-eu-central-1.pooler.supabase.com:5432/postgres`;

const env = (v: Record<string, string | undefined>) => v as NodeJS.ProcessEnv;

describe("etage 1 — la composition refuse un PGHOST qui n'est pas un hote", () => {
  it("la valeur exactement fautive est refusee, et le message ne contient pas le secret", () => {
    let message = "";
    expect(() => {
      try {
        construireDepuisVariablesPg(env({
          PGHOST: PGHOST_FAUTIF, PGUSER: "postgres.ref", PGPASSWORD: SECRET, PGDATABASE: "postgres",
        }));
      } catch (e) { message = (e as Error).message; throw e; }
    }).toThrow(VariablesPgInvalides);
    expect(message, "le message de refus divulgue le secret").not.toContain(SECRET);
    expect(message).toContain("PGHOST n'est pas un nom d'hote");
  });

  it.each([
    "postgresql://hote:5432/base",
    "postgres.ref:mdp@hote",
    "hote:5432",
    "hote/base",
    "hote avec espace",
  ])("PGHOST = %s est refuse", (hote) => {
    expect(() => construireDepuisVariablesPg(env({
      PGHOST: hote, PGUSER: "u", PGPASSWORD: "p", PGDATABASE: "postgres",
    }))).toThrow(VariablesPgInvalides);
  });

  it("un hote legitime passe, nom de domaine comme adresse IPv6", () => {
    for (const hote of ["aws-1-eu-central-1.pooler.supabase.com", "127.0.0.1", "[2a05:d014:1e9b::1]"]) {
      expect(() => construireDepuisVariablesPg(env({
        PGHOST: hote, PGUSER: "u", PGPASSWORD: "p", PGDATABASE: "postgres",
      })), hote).not.toThrow();
    }
  });
});

describe("etage 2 — le journal ne peut pas divulguer un secret", () => {
  it("L'URL EXACTE QUI A FUI ne produit plus aucun secret", () => {
    // On reconstitue l'URL telle qu'elle etait composee AVANT le correctif.
    const urlFautive =
      `postgresql://postgres.ref:${encodeURIComponent(SECRET)}@${PGHOST_FAUTIF}:5432/postgres?sslmode=require`;
    const decrit = decrireCibleSurement(lireCible(urlFautive));
    expect(decrit, "le journal divulgue encore le mot de passe").not.toContain(SECRET);
    expect(decrit).toContain("non journalisable");
  });

  it("une cible legitime reste lisible — la protection n'aveugle pas le journal", () => {
    const url = "postgresql://postgres.ref:mdp@aws-1-eu-central-1.pooler.supabase.com:5432/postgres?sslmode=require";
    expect(decrireCibleSurement(lireCible(url))).toBe("aws-1-eu-central-1.pooler.supabase.com/postgres");
  });

  it("une URL illisible le dit, sans rien imprimer d'autre", () => {
    expect(decrireCibleSurement(lireCible("pas#une#url"))).toBe("(illisible)");
    expect(decrireCibleSurement(null)).toBe("(illisible)");
  });

  it.each([
    ["un identifiant dans le chemin", "postgresql://a:b@hote:5432/base?x=1#frag"],
    ["une arobase dans le nom de base", "postgresql://a:b@hote:5432/base@secret"],
    ["un slash dans le nom de base", "postgresql://a:b@hote:5432/base/secret"],
  ])("%s n'est jamais imprime tel quel", (_nom, url) => {
    const d = decrireCibleSurement(lireCible(url));
    expect(d).not.toContain("secret");
  });

  it.each(["src/index.ts", "src/migrate.ts"])(
    "%s n'imprime la cible que par la description sure", async (fichier) => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(process.cwd(), fichier), "utf8");
    expect(source, `${fichier} interpole encore la cible brute dans un journal`)
      .not.toMatch(/\$\{\s*\w*(reelle|cible)\w*\.(hote|base)\s*\}/);
    expect(source, `${fichier} n'utilise pas la description sure`).toContain("decrireCibleSurement(");
  });

  it("plus aucun masquage artisanal de DATABASE_URL ne subsiste", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const fichier of ["src/index.ts", "src/migrate.ts"]) {
      const source = readFileSync(join(process.cwd(), fichier), "utf8");
      // Le masquage `//…@` ne coupait qu'au PREMIER `@` : un second laissait
      // passer l'identifiant. Il ne doit plus etre utilise.
      expect(source, `${fichier} masque encore DATABASE_URL a la main`)
        .not.toContain('"//***@"');
    }
  });
});
