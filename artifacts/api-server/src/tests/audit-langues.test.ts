/**
 * Non-regression de langue (cliquet). Logique : scripts/audit-langues.mjs ;
 * base committee : scripts/audit-langues-baseline.json.
 * Couvre : (a) messages d'erreur serveur francais par fichier de routes,
 * (b) traductions PUBLIC_ENGLISH manquantes sur les pages publiques redigees
 * en francais, (c) francais dans les valeurs des catalogues anglais.
 * Le tunnel anglais (8 pages) reste garde par tunnel-inscription-anglais-themes.test.ts.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const SCRIPT = pathToFileURL(resolve(process.cwd(), "../../scripts/audit-langues.mjs")).href;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let audit: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let resultat: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let base: any;

beforeAll(async () => {
  audit = await import(/* @vite-ignore */ SCRIPT);
  resultat = audit.auditer();
  base = audit.lireBase();
});

function verifierCliquet(reel: Record<string, number>, attendu: Record<string, { compte: number }>, constats: { fichier: string; ligne: number; texte: string }[]) {
  const { erreurs, baisses } = audit.comparer(reel, attendu);
  const detail = constats
    .filter((c) => erreurs.some((e: string) => e.startsWith(c.fichier.replace(/^artifacts\/flowpoint-export\//, ""))))
    .map((c) => `${c.fichier}:${c.ligne} ${JSON.stringify(c.texte)}`);
  expect(erreurs, `Francais ajoute :\n${detail.join("\n")}`).toEqual([]);
  // Base au-dessus du reel = traduction faite mais base non abaissee : le cliquet doit descendre.
  expect(baisses, "Abaisser la base : node scripts/audit-langues.mjs --update-baseline").toEqual([]);
}

describe("audit de langue (cliquet)", () => {
  it("le detecteur reste aligne sur celui du tunnel et respecte les exceptions", () => {
    expect(audit.estFrancais("Session expirée")).toBe(true);
    expect(audit.estFrancais("Votre compte")).toBe(true);
    expect(audit.estFrancais("Invalid request")).toBe(false);
    expect(audit.estFrancais("See https://exemple.fr/réglages")).toBe(false);
    for (const e of audit.EXCEPTIONS) expect(e.raison.length).toBeGreaterThan(10);
  });

  it("(a) messages d'erreur serveur : aucun fichier n'ajoute de francais", () => {
    verifierCliquet(resultat.serveur.parFichier, base.serveur, resultat.serveur.constats);
  });

  it("(b) pages publiques francaises : aucune traduction manquante nouvelle", () => {
    expect(resultat.pages.pages.length).toBeGreaterThan(0);
    verifierCliquet(resultat.pages.parPage, base.pages, resultat.pages.constats);
  });

  it("(c) catalogues anglais : aucune valeur ne contient de francais", () => {
    expect(resultat.melange.constats).toEqual([]);
  });

  it("chaque entree de la base porte une raison", () => {
    for (const groupe of [base.serveur, base.pages]) {
      for (const [f, v] of Object.entries(groupe) as [string, { compte: number; raison: string }][]) {
        expect(v.raison, f).toBeTruthy();
        expect(v.compte, f).toBeGreaterThan(0);
      }
    }
  });
});
