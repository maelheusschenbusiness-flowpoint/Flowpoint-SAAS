/**
 * Plus aucun vestige MongoDB dans le backend.
 *
 * Six fichiers (`lib/mongo.ts` et cinq modeles) n'etaient importes QUE les uns
 * par les autres : du code mort, avec sa dependance `mongoose` encore installee
 * et une variable `MONGO_URI` encore annoncee par les diagnostics — une
 * configuration que plus rien ne lit.
 *
 * Ce test echoue si l'un des trois revient.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const api = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = JSON.parse(readFileSync(join(api, "package.json"), "utf8"));

const walk = (d: string, out: string[] = []): string[] => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
};

describe("le vestige MongoDB ne revient pas", () => {
  it("aucune dependance mongo n est declaree", () => {
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    expect(Object.keys(deps).filter((d) => /mongo/i.test(d))).toEqual([]);
  });

  it("les six fichiers morts n existent plus", () => {
    for (const f of ["src/lib/mongo.ts", "src/models/Audit.ts", "src/models/Competitor.ts",
                     "src/models/Monitor.ts", "src/models/Notification.ts", "src/models/UserProfile.ts"]) {
      expect(existsSync(join(api, f)), f).toBe(false);
    }
  });

  it("aucune source n importe mongoose", () => {
    const coupables = walk(join(api, "src")).filter((f) => {
      const s = readFileSync(f, "utf8");
      return /from ["'][^"']*mongoose|require\(["'][^"']*mongoose/.test(s);
    });
    expect(coupables).toEqual([]);
  });

  it("les diagnostics n annoncent plus une configuration morte", () => {
    // `MONGO_URI` ne sera plus jamais lue : l'exposer laissait croire a une
    // configuration manquante alors qu'elle n'a plus d'objet.
    const diag = readFileSync(join(api, "src/routes/diagnostics.ts"), "utf8");
    expect(diag).not.toContain("MONGO_URI");
  });
});
