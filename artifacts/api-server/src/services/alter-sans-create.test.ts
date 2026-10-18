/**
 * alter-sans-create.test.ts
 *
 * DEFAUT MESURE LE 18/10/2026, en construisant la base de test depuis zero.
 *
 * `init-data-tables.ts` executait une vingtaine d'`ALTER TABLE
 * keyword_clusters / keyword_opportunities ADD COLUMN …` en supposant ces
 * tables existantes. Elles n'etaient creees QUE dans
 * `migrations/005_missing_tables.sql` — et les fichiers `migrations/*.sql` ne
 * sont executes par rien : ni par le demarrage, ni par `migrate.mjs`, qui ne
 * les mentionne que dans un commentaire.
 *
 * Sur une base heritant du schema historique, personne ne s'en apercevait. Sur
 * une base neuve, les journaux Render repetaient « relation
 * "keyword_opportunities" does not exist », et `routes/keywords.ts` — qui fait
 * `SELECT * FROM keyword_opportunities` puis une jointure sur
 * `keyword_clusters`, sans garde — echouait en 500.
 *
 * L'invariant verrouille ici : toute table que le demarrage ALTERe doit etre
 * une table que le demarrage sait CREER. Sinon le code suppose un schema qu'il
 * ne produit pas, et le defaut ne se revele qu'a la premiere base vide.
 *
 * On lit la source : reconstruire une base entiere a chaque execution serait
 * disproportionne, et l'ecart est entierement visible statiquement.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** Tous les fichiers TypeScript qui participent a la construction du schema. */
function sourcesDInitialisation(): string[] {
  const fichiers: string[] = [];
  const racine = join(process.cwd(), "src");
  const parcourir = (dossier: string): void => {
    for (const entree of readdirSync(dossier)) {
      const chemin = join(dossier, entree);
      if (statSync(chemin).isDirectory()) { parcourir(chemin); continue; }
      if (!chemin.endsWith(".ts") || chemin.includes(".test.")) continue;
      fichiers.push(chemin);
    }
  };
  parcourir(racine);
  return fichiers;
}

/**
 * Les commentaires sont retires avant toute analyse, et l'ORDRE compte.
 *
 * Deux pieges mesures en ecrivant ce test :
 *
 *   1. des phrases comme « ALTER TABLE on a fresh DB » ou « no ALTER TABLE
 *      required » produisaient quatre fausses tables : `add`, `on`,
 *      `required`, `uses` ;
 *   2. le texte `migrations/*.sql`, present dans plusieurs commentaires DE
 *      LIGNE, contient la sequence d'ouverture d'un commentaire de bloc. En
 *      retirant les blocs d'abord, cette sequence avalait des dizaines de
 *      milliers de caracteres — et avec eux de vrais `CREATE TABLE`, qui
 *      apparaissaient alors comme manquants.
 *
 * D'ou l'ordre : lignes d'abord, blocs ensuite.
 */
function sansCommentaires(source: string): string {
  const sansLignes = source
    .split("\n")
    .map((l) => l.replace(/^\s*\/\/.*$/, " ").replace(/\s\/\/.*$/, " "))
    .join("\n");
  return sansLignes.replace(/\/\*[\s\S]*?\*\//g, " ");
}

const TOUTE_LA_SOURCE = sourcesDInitialisation()
  .map((f) => sansCommentaires(readFileSync(f, "utf8")))
  .join("\n");

function extraire(expression: RegExp): Set<string> {
  const noms = new Set<string>();
  for (const m of TOUTE_LA_SOURCE.matchAll(expression)) {
    const nom = (m[1] ?? "").replace(/["`]/g, "").trim().toLowerCase();
    if (nom) noms.add(nom);
  }
  return noms;
}

const MOTIF_ALTER = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?/gi;
const CREEES = extraire(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z_][A-Za-z0-9_]*)["`]?/gi);

/**
 * Un ALTER peut etre volontairement conditionnel. Sept tables le sont,
 * enveloppees dans `DO $$ … IF EXISTS (SELECT 1 FROM pg_tables WHERE
 * tablename='X') …`, parce que les modules concernes ne sont pas deployes
 * partout. Elles n'exigent pas de CREATE : l'ALTER ne s'execute que si la
 * table existe deja.
 *
 * Critere retenu : la table est gardee si le code contient une garde
 * d'existence a son nom. Mesure faite en ecrivant ce test — une fenetre de
 * proximite serait fragile : pour `cro_recommendations`, cinq ALTER partagent
 * une meme garde situee jusqu'a 822 caracteres en amont.
 *
 * Limite assumee : une table gardee a un endroit et ALTEREe sans garde a un
 * autre passerait inapercue. C'est un garde-fou, pas une preuve.
 */
function alterNonGardes(): Set<string> {
  const noms = new Set<string>();
  for (const m of TOUTE_LA_SOURCE.matchAll(MOTIF_ALTER)) {
    const nom = (m[1] ?? "").replace(/["`]/g, "").trim().toLowerCase();
    if (!nom) continue;
    const garde = new RegExp(`tablename\\s*=\\s*'${nom}'`, "i").test(TOUTE_LA_SOURCE);
    if (!garde) noms.add(nom);
  }
  return noms;
}

const ALTEREES_NON_GARDEES = alterNonGardes();

describe("toute table ALTEREe au demarrage doit pouvoir etre CREEE au demarrage", () => {
  it("le relevé n'est pas vide — le test surveille bien quelque chose", () => {
    expect(ALTEREES_NON_GARDEES.size, "aucun ALTER TABLE non garde trouve : l'expression ne correspond plus").toBeGreaterThan(20);
    expect(CREEES.size, "aucun CREATE TABLE trouve").toBeGreaterThan(20);
  });

  it("les commentaires ne produisent pas de fausses tables", () => {
    // Ces quatre mots suivaient « ALTER TABLE » dans de la prose.
    for (const faux of ["add", "on", "required", "uses"]) {
      expect(ALTEREES_NON_GARDEES.has(faux), `« ${faux} » est pris pour une table`).toBe(false);
    }
  });

  it("les ALTER volontairement conditionnels sont reconnus comme tels", () => {
    // Sept tables de modules non deployes partout, enveloppees dans un
    // IF EXISTS. Elles ne doivent pas etre signalees.
    for (const garde of ["behavior_events", "behavior_sessions", "behavior_insights",
                         "cro_experiments", "cro_recommendations", "cro_scores",
                         "traffic_losses"]) {
      expect(ALTEREES_NON_GARDEES.has(garde), `${garde} devrait etre reconnue comme gardee`).toBe(false);
    }
  });

  it("aucune table n'est ALTEREe sans etre creee quelque part", () => {
    const orphelines = [...ALTEREES_NON_GARDEES].filter((t) => !CREEES.has(t)).sort();
    expect(
      orphelines,
      "ces tables sont ALTEREes au demarrage mais rien ne les cree. Sur une base " +
      "neuve elles n'existeront pas : l'ALTER echouera, et tout code qui les " +
      "interroge echouera aussi. Soit on les cree ici, soit on retire l'ALTER."
    ).toEqual([]);
  });

  it("les deux tables du defaut mesure sont bien creees", () => {
    // Verrou nominatif, pour que le cas precis ne puisse pas revenir.
    for (const t of ["keyword_clusters", "keyword_opportunities"]) {
      expect(CREEES.has(t), `${t} n'est plus creee par le demarrage`).toBe(true);
      expect(ALTEREES_NON_GARDEES.has(t), `${t} n'est plus ALTEREe — ce verrou est-il encore utile ?`).toBe(true);
    }
  });

  it("les fichiers migrations/*.sql ne comptent pas comme une creation", () => {
    // C'est la racine du defaut : ils ne sont executes par rien. Le test ne lit
    // donc que les sources TypeScript, et cette assertion le documente.
    const migrate = readFileSync(join(process.cwd(), "src/migrate.ts"), "utf8");
    const executeDesFichiersSql =
      /readdirSync|readFileSync/.test(migrate) && /\.sql/.test(migrate);
    expect(
      executeDesFichiersSql,
      "migrate.ts semble desormais executer des fichiers .sql : si c'est le cas, " +
      "les definitions de migrations/ redeviennent une source de verite et ce " +
      "test doit en tenir compte."
    ).toBe(false);
  });
});
