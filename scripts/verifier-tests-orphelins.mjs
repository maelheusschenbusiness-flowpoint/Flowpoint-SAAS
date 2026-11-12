#!/usr/bin/env node
/**
 * Garde-fou : aucun fichier de test orphelin dans artifacts/api-server.
 *
 * Contexte : `vitest.config.ts` etait une liste blanche de ~130 fichiers. Un
 * test ajoute sans etre liste ne tournait JAMAIS, et personne ne le voyait :
 * 22 fichiers etaient dans ce cas (voir docs/TESTS-ORPHELINS.md).
 *
 * Regle appliquee ici. Tout fichier `*.test.*` / `*.spec.*` du paquet doit
 * etre soit
 *   - execute par vitest (il correspond a un motif de `include`), soit
 *   - declare dans `vitest.exclusions.mjs` AVEC sa raison.
 * Sinon la verification echoue. Les exclusions elles-memes sont verifiees : une
 * entree sans raison, ou qui ne designe plus aucun fichier, fait echouer aussi
 * (sinon la liste pourrirait en silence).
 *
 *   node scripts/verifier-tests-orphelins.mjs
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { INCLUDE, EXCLUSIONS } from "../artifacts/api-server/vitest.exclusions.mjs";

const racine = resolve(dirname(fileURLToPath(import.meta.url)), "../artifacts/api-server");
// Dossiers parcourus : le paquet lui-meme et le paquet voisin dont vitest.config.ts
// inclut les tests (../../lib/db/src).
const RACINES = [racine, resolve(racine, "../../lib/db")];
const IGNORER = new Set(["node_modules", "dist", ".git", "coverage"]);
const EST_TEST = /\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/;

function parcourir(dossier, sortie = []) {
  for (const nom of readdirSync(dossier)) {
    if (IGNORER.has(nom)) continue;
    const chemin = join(dossier, nom);
    if (statSync(chemin).isDirectory()) parcourir(chemin, sortie);
    else if (EST_TEST.test(nom)) sortie.push(relative(racine, chemin).split("\\").join("/"));
  }
  return sortie;
}

/** Convertit un glob simple (`**`, `*`) en expression reguliere. */
function glob(motif) {
  const re = motif
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "(?:.*/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`^${re}$`);
}

const inclus = INCLUDE.map(glob);
const exclus = EXCLUSIONS.map((e) => ({ ...e, re: glob(e.fichier) }));
const fichiers = RACINES.flatMap((r) => parcourir(r)).sort();
const erreurs = [];

for (const e of exclus) {
  if (!e.raison || e.raison.trim().length < 20) {
    erreurs.push(`Exclusion sans raison explicite : ${e.fichier}`);
  }
  if (!fichiers.some((f) => e.re.test(f))) {
    erreurs.push(`Exclusion obsolete (aucun fichier ne correspond) : ${e.fichier}`);
  }
}

const orphelins = [];
let nbExecutes = 0;
for (const f of fichiers) {
  const exclu = exclus.some((e) => e.re.test(f));
  const execute = !exclu && inclus.some((re) => re.test(f));
  if (execute) nbExecutes += 1;
  else if (!exclu) orphelins.push(f);
}

if (orphelins.length) {
  erreurs.push(
    `${orphelins.length} fichier(s) de test ORPHELIN(S) : hors \`include\` ET hors exclusions declarees.\n  ` +
      orphelins.join("\n  ") +
      "\n\nSoit le fichier doit tourner (renommez-le *.test.ts sous src/ ou tests/), soit " +
      "ajoutez-le a artifacts/api-server/vitest.exclusions.mjs avec la raison de son exclusion.",
  );
}

console.log(
  `${fichiers.length} fichiers de test trouves : ${nbExecutes} executes par vitest, ` +
    `${fichiers.length - nbExecutes - orphelins.length} exclus avec raison, ${orphelins.length} orphelin(s).`,
);
if (erreurs.length) {
  for (const e of erreurs) console.error(`\n✗ ${e}`);
  process.exit(1);
}
console.log("✓ Aucun test orphelin.");
