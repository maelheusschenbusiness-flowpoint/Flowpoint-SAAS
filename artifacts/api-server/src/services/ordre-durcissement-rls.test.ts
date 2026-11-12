/**
 * ordre-durcissement-rls.test.ts
 *
 * DEFAUT MESURE LE 18/10/2026, en construisant la base de test depuis zero —
 * la premiere fois que ce chemin de code s'executait sur une base vide.
 *
 * Dans le chemin d'initialisation complet de `index.ts`, le durcissement RLS
 * (`runRlsMigrationIfNeeded`) passait AVANT les etapes qui creent les tables :
 * `init-data-tables`, `init-missions`, `init-automation`, `init-monitors` et
 * `init-agent-tables`. Sur une base neuve ces tables n'existent pas encore :
 * elles n'obtenaient donc ni RLS ni policy, et la sentinelle de la migration
 * etait posee ensuite comme si tout etait en ordre.
 *
 * Mesure sur la base de test apres ce demarrage : 105 tables, 97 portant
 * `org_id`, et 36 d'entre elles SANS RLS — precisement les tables missions,
 * monitors, automation, team et audits. `/api/healthz/ready` repondait 503 en
 * listant ces 36 tables, et il avait raison.
 *
 * Le defaut etait invisible en production, dont le schema est anterieur et a
 * ete durci par `migrate`, qui applique les etapes dans le bon ordre.
 *
 * Ce test verrouille l'ordre. Il lit la source parce que c'est le seul moyen
 * de le faire sans reconstruire une base entiere a chaque execution.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Les etapes qui CREENT des tables a `org_id`. */
const ETAPES_DE_CREATION = [
  "init-data-tables",
  "init-missions",
  "init-automation",
  "init-monitors",
  "init-agent-tables",
] as const;

function source(): string {
  return readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
}

/** Position du PREMIER appel a l'etape nommee. */
function positionEtape(src: string, nom: string): number {
  return src.indexOf(`runCriticalStartupStep("${nom}"`);
}

/** Position du DERNIER appel — les etapes de creation apparaissent deux fois,
 *  une par chemin d'initialisation (rapide et complet). */
function derniereePositionEtape(src: string, nom: string): number {
  return src.lastIndexOf(`runCriticalStartupStep("${nom}"`);
}

function nombreAppels(src: string, nom: string): number {
  return src.split(`runCriticalStartupStep("${nom}"`).length - 1;
}

describe("le durcissement RLS passe apres la creation des tables", () => {
  it("les etapes mesurees existent toujours sous ces noms", () => {
    const src = source();
    for (const etape of [...ETAPES_DE_CREATION, "rls-migration"]) {
      expect(positionEtape(src, etape), `l'etape « ${etape} » a disparu ou a ete renommee`)
        .toBeGreaterThan(-1);
    }
  });

  it("rls-migration n'est appelee QU'UNE FOIS", () => {
    // Le defaut d'origine etait un appel unique, place trop tot. Un second
    // appel tardif masquerait le premier a l'analyse : on exige l'unicite,
    // puis on verifie la position de cet appel unique.
    expect(nombreAppels(source(), "rls-migration"),
      "plusieurs appels a rls-migration : la position du durcissement devient ambiguë")
      .toBe(1);
  });

  it.each(ETAPES_DE_CREATION)("rls-migration passe apres %s", (etape) => {
    const src = source();
    const rls = positionEtape(src, "rls-migration");
    const creation = derniereePositionEtape(src, etape);
    expect(
      rls,
      `« rls-migration » passe AVANT « ${etape} » : sur une base neuve, les tables ` +
      "creees par cette etape n'obtiendront ni RLS ni policy, et la sentinelle de " +
      "la migration sera posee comme si tout etait en ordre."
    ).toBeGreaterThan(creation);
  });

  it("init-rls-setup, lui, reste AVANT : il cree le role et les droits par defaut", () => {
    const src = source();
    // Les DEFAULT PRIVILEGES qu'il pose couvrent les tables creees ensuite ;
    // c'est bien le durcissement, et lui seul, qui doit attendre.
    const setup = src.indexOf('runCriticalStartupStep("init-rls-setup"');
    // Derniere occurrence : `init-data-tables` figure dans les deux chemins
    // d'initialisation, et c'est celle du chemin complet qui nous interesse.
    const donnees = derniereePositionEtape(src, "init-data-tables");
    expect(setup).toBeGreaterThan(-1);
    expect(setup, "init-rls-setup doit preceder la creation des tables").toBeLessThan(donnees);
  });

  it("LE DURCISSEMENT COURT POUR LES DEUX CHEMINS, pas seulement le complet", () => {
    // DEFAUT MESURE LE 18/10/2026, apres une premiere correction incomplete.
    // Des que `audits` existe, le demarrage prend le chemin RAPIDE, qui ne
    // contenait AUCUNE etape de durcissement. Corriger l'ordre du chemin
    // complet ne suffisait donc pas : il ne sera plus jamais rejoue sur une
    // base deja initialisee, et les 36 tables seraient restees sans RLS.
    //
    // L'indentation le prouve : au niveau de la fonction (deux espaces),
    // l'appel est hors du `if/else` ; a quatre espaces, il est dans une
    // branche et ne couvre qu'un seul chemin.
    const lignes = source().split("\n");
    const appels = lignes.filter((l) => l.includes('runCriticalStartupStep("rls-migration"'));
    expect(appels.length, "un seul appel attendu").toBe(1);
    const indentation = appels[0]!.match(/^ */)![0].length;
    expect(
      indentation,
      "l'appel au durcissement RLS est imbrique dans une branche : il ne " +
      "couvrirait qu'un seul chemin d'initialisation, et une base deja " +
      "initialisee ne serait jamais reparee."
    ).toBe(2);
  });

  it("le durcissement est la DERNIERE etape de schema du chemin complet", () => {
    const src = source();
    const rls = positionEtape(src, "rls-migration");
    // Aucune etape d'initialisation ne doit etre appelee apres lui.
    const apres = src.slice(rls);
    for (const etape of ETAPES_DE_CREATION) {
      expect(apres, `« ${etape} » est appelee apres le durcissement RLS`)
        .not.toContain(`runCriticalStartupStep("${etape}"`);
    }
  });
});
