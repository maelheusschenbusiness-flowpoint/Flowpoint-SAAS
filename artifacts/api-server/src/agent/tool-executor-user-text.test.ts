import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MISSION_TOOLS } from "./mission-tools.js";
import { CALENDAR_TOOLS } from "./calendar-tools.js";
import { AUDIT_TOOLS } from "./audit-tools.js";
import { MONITOR_TOOLS } from "./monitor-tools.js";
import { RECOMMENDATION_TOOLS } from "./recommendation-tools.js";

/**
 * Task #515 — les résultats d'outils affichés dans le chat ne doivent JAMAIS
 * contenir des identifiants d'outils bruts (run_audit, summarize_audit,
 * generate_recommendations…). Les utilisateurs voient ces textes tels quels ;
 * les instructions doivent être en langage naturel (« Demandez-moi de… »).
 *
 * Le test scanne le code source de tool-executor.ts : chaque littéral de
 * chaîne assigné à `content:` (le champ user-facing des résultats d'outils)
 * ne doit mentionner aucun nom d'outil du registre.
 */
describe("tool-executor — textes user-facing sans identifiants d'outils", () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const rawSrc = readFileSync(path.join(__dirname, "tool-executor.ts"), "utf8");

  // Mini state machine : retire les commentaires (// et /* */) SANS toucher aux
  // chaînes — un scan naïf prend les apostrophes/quotes des commentaires pour
  // des débuts de chaîne et produit des faux positifs.
  function stripComments(code: string): string {
    let out = "";
    let i = 0;
    let mode: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
    while (i < code.length) {
      const c = code[i], n = code[i + 1];
      if (mode === "code") {
        if (c === "/" && n === "/") { mode = "line"; i += 2; continue; }
        if (c === "/" && n === "*") { mode = "block"; i += 2; continue; }
        if (c === "'") mode = "sq";
        else if (c === '"') mode = "dq";
        else if (c === "`") mode = "tpl";
        out += c; i++; continue;
      }
      if (mode === "line") { if (c === "\n") { mode = "code"; out += c; } i++; continue; }
      if (mode === "block") { if (c === "*" && n === "/") { mode = "code"; i += 2; } else { if (c === "\n") out += c; i++; } continue; }
      // dans une chaîne : gérer l'échappement et la fermeture
      if (c === "\\") { out += c + (n ?? ""); i += 2; continue; }
      if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || (mode === "tpl" && c === "`")) mode = "code";
      out += c; i++;
    }
    return out;
  }
  const src = stripComments(rawSrc);

  const allToolNames = [
    ...MISSION_TOOLS, ...CALENDAR_TOOLS, ...AUDIT_TOOLS,
    ...MONITOR_TOOLS, ...RECOMMENDATION_TOOLS,
  ].map((t) => t.name);

  // Extrait TOUS les littéraux de chaîne du fichier (template, double, simple),
  // où qu'ils apparaissent — y compris ceux qui transitent par des tableaux ou
  // des variables intermédiaires avant d'atteindre `content`.
  const allLiterals: { line: number; text: string }[] = [];
  const re = /(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const line = src.slice(0, m.index).split("\n").length;
    allLiterals.push({ line, text: m[1].slice(1, -1) }); // sans les quotes
  }

  it("le scan trouve bien des littéraux (sanity)", () => {
    expect(allLiterals.length).toBeGreaterThan(500);
    expect(allToolNames.length).toBeGreaterThan(30);
  });

  it("aucun littéral de PROSE ne contient un nom d'outil du registre", () => {
    // Les seuls usages légitimes d'un nom d'outil dans une chaîne sont des
    // identifiants exacts (comparaisons `name2 === "x"`, batchType de snapshot,
    // clés de permission) — jamais entourés d'autre texte. Toute chaîne qui
    // contient un nom d'outil PLUS du texte (espace = prose) est du contenu
    // potentiellement affiché à l'utilisateur → violation.
    const offenders: string[] = [];
    for (const { line, text } of allLiterals) {
      for (const name of allToolNames) {
        if (text.includes(name) && text.trim() !== name && /\s/.test(text)) {
          offenders.push(`L${line}: contient "${name}" → ${text.slice(0, 120)}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
