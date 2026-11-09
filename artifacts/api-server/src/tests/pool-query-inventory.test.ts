/**
 * C-08 — inventaire des acces BRUTS a la base (pool.query / pool.connect).
 *
 * POURQUOI. L'isolation entre organisations repose sur deux mecanismes :
 *   1. `req.orgDb` / `withOrgDb()` : transaction avec GUC `app.current_org_id` et,
 *      quand `SET ROLE app_user` fonctionne, evaluation reelle des policies RLS ;
 *   2. un filtre `WHERE org_id = $n` ECRIT A LA MAIN dans chaque requete brute.
 * En production le role de connexion (`postgres`, BYPASSRLS) ignore les policies :
 * toute requete `pool.query` brute n'est donc protegee QUE par son filtre manuel.
 * Un oubli de `org_id` dans un `pool.query` = fuite inter-organisations.
 *
 * Ce test ne pretend pas prouver que les ~300 requetes brutes existantes sont
 * correctes (c'est un travail de revue, voir la liste `noOrgFilter` du baseline).
 * Il EMPECHE LA DERIVE : il echoue quand un fichier gagne un appel brut, ou un
 * appel brut SANS mention d'org_id, par rapport au baseline revu.
 *
 * Heuristique (documentee, volontairement simple) : un appel est « filtre » si le
 * texte complet de l'appel contient `org_id` ou `organization_id`. Les requetes
 * volontairement non scopees (pre-compte, cron global, administration) sont celles
 * du baseline `noOrg` : elles ont ete inventoriees, pas validees une a une.
 *
 * Regenerer le baseline apres revue :
 *   UPDATE_POOL_QUERY_BASELINE=1 pnpm exec vitest run src/tests/pool-query-inventory.test.ts
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_PATH = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "pool-query-baseline.json");
const SCANNED_DIRS = ["routes", "services", "middlewares", "lib", "workers", "agent"] as const;

interface FileCount { total: number; noOrg: number }
type Inventory = Record<string, FileCount>;

/** Extrait le texte d'un appel `xxx(` en equilibrant les parentheses (chaines et gabarits compris). */
export function extractCall(src: string, openParenIdx: number): string {
  let depth = 0;
  for (let i = openParenIdx; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === "'" || ch === '"' || ch === "`") {
      i = skipString(src, i);
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i === -1) break; continue; }
    if (ch === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i + 2); if (i === -1) break; i += 1; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") { depth--; if (depth === 0) return src.slice(openParenIdx, i + 1); }
  }
  return src.slice(openParenIdx, openParenIdx + 4000);
}

function skipString(src: string, start: number): number {
  const quote = src[start]!;
  for (let i = start + 1; i < src.length; i++) {
    const ch = src[i]!;
    if (ch === "\\") { i++; continue; }
    if (quote === "`" && ch === "$" && src[i + 1] === "{") {
      let depth = 1; i += 2;
      for (; i < src.length && depth > 0; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") depth--;
        else if (src[i] === "'" || src[i] === '"' || src[i] === "`") i = skipString(src, i);
      }
      i--;
      continue;
    }
    if (ch === quote) return i;
  }
  return src.length;
}

export function countRawAccess(src: string): FileCount {
  let total = 0;
  let noOrg = 0;
  for (const m of src.matchAll(/\bpool\.(query|connect)\s*(?:<[^>(]*>)?\(/g)) {
    // Ignore les occurrences en commentaire de ligne.
    const lineStart = src.lastIndexOf("\n", m.index!) + 1;
    if (/^\s*(\/\/|\*)/.test(src.slice(lineStart, m.index!))) continue;
    total++;
    if (m[1] === "connect") { noOrg++; continue; } // un client brut : la requete suivante n'est pas analysable
    const call = extractCall(src, m.index! + m[0].length - 1);
    if (!/org_id|organization_id/i.test(call)) noOrg++;
  }
  return { total, noOrg };
}

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { out.push(...listTs(p)); continue; }
    if (name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

export function scanInventory(): Inventory {
  const inv: Inventory = {};
  for (const d of SCANNED_DIRS) {
    for (const file of listTs(join(srcDir, d))) {
      const c = countRawAccess(readFileSync(file, "utf8"));
      if (c.total > 0) inv[relative(srcDir, file).split("\\").join("/")] = c;
    }
  }
  return Object.fromEntries(Object.entries(inv).sort(([a], [b]) => a.localeCompare(b)));
}

describe("compteur d'acces bruts (outil de l'inventaire)", () => {
  it("compte pool.query et pool.connect, ignore les commentaires", () => {
    const src = [
      "await pool.query(`SELECT 1 FROM t WHERE org_id = $1`, [o]);",
      "await pool.query<{ a: number }>('SELECT 1 FROM t');",
      "// await pool.query('SELECT org_id')",
      "const c = await pool.connect();",
    ].join("\n");
    expect(countRawAccess(src)).toEqual({ total: 3, noOrg: 2 });
  });
  it("lit un appel sur plusieurs lignes avec gabarit imbrique", () => {
    const src = "await pool.query(\n  `SELECT * FROM t WHERE ${cond(`x`)} AND org_id = $1`,\n  [o],\n);";
    expect(countRawAccess(src)).toEqual({ total: 1, noOrg: 0 });
  });
  it("un org_id qui n'est PAS dans l'appel ne compte pas pour lui", () => {
    const src = "await pool.query('SELECT 1');\nconst x = 'org_id';";
    expect(countRawAccess(src)).toEqual({ total: 1, noOrg: 1 });
  });
});

describe("inventaire des acces bruts a la base (C-08)", () => {
  const current = scanInventory();

  if (process.env["UPDATE_POOL_QUERY_BASELINE"] === "1") {
    it("ecrit le baseline", () => {
      writeFileSync(BASELINE_PATH, JSON.stringify({
        _comment: "Inventaire revu des acces bruts pool.query/pool.connect. total = appels ; noOrg = appels dont le texte ne mentionne ni org_id ni organization_id (ou pool.connect). Ne peut que DECROITRE sans revue. Regeneration : voir pool-query-inventory.test.ts.",
        files: current,
      }, null, 2) + "\n");
    });
    return;
  }

  const baseline = (JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as { files: Inventory }).files;

  it("le baseline couvre un inventaire credible", () => {
    const total = Object.values(baseline).reduce((s, c) => s + c.total, 0);
    expect(total).toBeGreaterThan(300);
    expect(Object.keys(baseline).some((f) => f.startsWith("routes/"))).toBe(true);
  });

  it.each(Object.entries(current))("%s : aucun nouvel acces brut non revu", (file, c) => {
    const b = baseline[file];
    expect(b, `${file} gagne ${c.total} acces bruts (pool.query/pool.connect) absents du baseline. ` +
      "Utilisez req.orgDb / withOrgDb, ou — si l'acces brut est voulu — ajoutez-le au baseline apres revue du filtre org_id.").toBeTruthy();
    expect(c.total, `${file} : ${c.total} acces bruts, baseline ${b!.total}. Preferez req.orgDb ; sinon revoyez le filtre org_id puis regenerez le baseline.`).toBeLessThanOrEqual(b!.total);
    expect(c.noOrg, `${file} : ${c.noOrg} acces bruts SANS org_id, baseline ${b!.noOrg}. Une requete sans filtre d'organisation fuit entre locataires en production (role BYPASSRLS).`).toBeLessThanOrEqual(b!.noOrg);
  });
});
