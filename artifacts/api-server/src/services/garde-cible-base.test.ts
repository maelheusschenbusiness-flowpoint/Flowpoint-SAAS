/**
 * garde-cible-base.test.ts
 *
 * Tests de non-regression de la garde de cible, demandes le 18/10/2026.
 *
 * Le scenario a empecher, mesure : les deux services Render n'ont AUCUN
 * `preDeployCommand`, mais `index.ts` modifie le schema a chaque demarrage.
 * Un `DATABASE_URL` copie du service de production vers le service de test
 * suffit donc a faire reecrire le schema de la production par un deploiement
 * de test. La garde refuse ce demarrage.
 */
import { describe, it, expect } from "vitest";
import { verifierCibleBase, lireCible, CibleBaseRefusee } from "./garde-cible-base.js";

const URL_TEST = "postgresql://utilisateur:motdepasse@db.base-de-test.example.com:5432/postgres";
const URL_PROD = "postgresql://utilisateur:motdepasse@db.base-de-production.example.com:5432/postgres";

/** Un environnement minimal et isole : on ne touche jamais a process.env. */
function env(valeurs: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return valeurs as NodeJS.ProcessEnv;
}

describe("lireCible n'extrait que l'hote et la base", () => {
  it("rend l'hote et le nom de base, jamais les identifiants", () => {
    const c = lireCible(URL_PROD);
    expect(c).toEqual({ hote: "db.base-de-production.example.com", base: "postgres" });
    // La preuve que rien d'autre ne ressort :
    expect(JSON.stringify(c)).not.toContain("motdepasse");
    expect(JSON.stringify(c)).not.toContain("utilisateur");
  });

  it("rend null sur une URL absente ou illisible", () => {
    expect(lireCible(undefined)).toBeNull();
    expect(lireCible("")).toBeNull();
    expect(lireCible("pas-une-url")).toBeNull();
    expect(lireCible("postgresql://hote-sans-base")).toBeNull();
  });
});

describe("garde non armee : rien ne change", () => {
  it("sans DB_HOTE_ATTENDU, la verification ne s'impose pas", () => {
    expect(verifierCibleBase(env({ DATABASE_URL: URL_PROD }))).toEqual({ verifiee: false });
  });

  it("une declaration vide equivaut a une garde non armee", () => {
    expect(verifierCibleBase(env({ DB_HOTE_ATTENDU: "   ", DATABASE_URL: URL_PROD })))
      .toEqual({ verifiee: false });
  });
});

describe("garde armee : la destination conforme passe", () => {
  it("hote seul declare", () => {
    const r = verifierCibleBase(env({
      DB_HOTE_ATTENDU: "db.base-de-test.example.com", DATABASE_URL: URL_TEST,
    }));
    expect(r.verifiee).toBe(true);
    expect(r.cible?.hote).toBe("db.base-de-test.example.com");
  });

  it("hote et base declares", () => {
    expect(verifierCibleBase(env({
      DB_HOTE_ATTENDU: "db.base-de-test.example.com/postgres", DATABASE_URL: URL_TEST,
    })).verifiee).toBe(true);
  });

  it("la casse de la declaration est sans effet", () => {
    expect(verifierCibleBase(env({
      DB_HOTE_ATTENDU: "DB.Base-De-Test.Example.COM", DATABASE_URL: URL_TEST,
    })).verifiee).toBe(true);
  });

  it("plusieurs cibles acceptees, le temps d'une bascule d'hote", () => {
    expect(verifierCibleBase(env({
      DB_HOTE_ATTENDU: "db.ancien-hote.example.com, db.base-de-test.example.com",
      DATABASE_URL: URL_TEST,
    })).verifiee).toBe(true);
  });
});

describe("LE SCENARIO A EMPECHER", () => {
  it("le DATABASE_URL de la production pose sur le service de test : REFUS", () => {
    expect(() => verifierCibleBase(env({
      DB_HOTE_ATTENDU: "db.base-de-test.example.com",   // ce que le service declare
      DATABASE_URL: URL_PROD,                            // ce qu'on y a copie
    }))).toThrow(CibleBaseRefusee);
  });

  it("le message nomme l'hote attendu et l'hote atteint, sans aucun identifiant", () => {
    try {
      verifierCibleBase(env({
        DB_HOTE_ATTENDU: "db.base-de-test.example.com", DATABASE_URL: URL_PROD,
      }));
      throw new Error("la garde n'a pas refuse");
    } catch (err) {
      const m = (err as Error).message;
      expect(m).toContain("db.base-de-test.example.com");
      expect(m).toContain("db.base-de-production.example.com");
      expect(m, "le message expose un identifiant").not.toContain("motdepasse");
      expect(m, "le message expose un identifiant").not.toContain("utilisateur");
    }
  });

  it("meme hote mais autre base : REFUS quand la base est declaree", () => {
    expect(() => verifierCibleBase(env({
      DB_HOTE_ATTENDU: "db.base-de-test.example.com/base_de_test",
      DATABASE_URL: URL_TEST,   // .../postgres
    }))).toThrow(CibleBaseRefusee);
  });
});

describe("garde armee qui ne peut pas conclure : elle refuse", () => {
  it("DATABASE_URL absente alors que la garde est armee", () => {
    expect(() => verifierCibleBase(env({ DB_HOTE_ATTENDU: "db.test.example.com" })))
      .toThrow(CibleBaseRefusee);
  });

  it("DATABASE_URL illisible alors que la garde est armee", () => {
    expect(() => verifierCibleBase(env({
      DB_HOTE_ATTENDU: "db.test.example.com", DATABASE_URL: "pas-une-url",
    }))).toThrow(CibleBaseRefusee);
  });

  it("declaration posee mais inexploitable : refus plutot que passage silencieux", () => {
    expect(() => verifierCibleBase(env({ DB_HOTE_ATTENDU: ",,,", DATABASE_URL: URL_TEST })))
      .toThrow(CibleBaseRefusee);
  });
});

describe("la garde est bien branchee avant toute ecriture", () => {
  it("index.ts et migrate.ts l'appellent", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const fichier of ["src/index.ts", "src/migrate.ts"]) {
      const source = readFileSync(join(process.cwd(), fichier), "utf8");
      expect(source, `${fichier} n'appelle plus la garde de cible`).toContain("verifierCibleBase");
    }
  });

  it("dans index.ts, la garde precede les initialisations de schema", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    const garde = source.indexOf("verifierCibleBase()");
    for (const init of ["initDataTables)", "initRlsSetup)", "initPhase1Users)"]) {
      const position = source.indexOf(init);
      if (position === -1) continue;
      expect(garde, `la garde passe apres ${init} : des ecritures auraient deja eu lieu`)
        .toBeLessThan(position);
    }
  });
});
