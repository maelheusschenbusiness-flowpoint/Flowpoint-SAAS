import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import * as ts from "typescript";
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

  const allToolNames = [
    ...MISSION_TOOLS, ...CALENDAR_TOOLS, ...AUDIT_TOOLS,
    ...MONITOR_TOOLS, ...RECOMMENDATION_TOOLS,
  ].map((t) => t.name);

  // Extrait les vrais nœuds de chaîne TypeScript. Contrairement à une regex,
  // l'AST ne confond pas les templates imbriqués avec du code adjacent.
  const allLiterals: { line: number; text: string }[] = [];
  const sourceFile = ts.createSourceFile(
    "tool-executor.ts",
    rawSrc,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  function isLoggerArgument(node: ts.Node): boolean {
    let current: ts.Node | undefined = node.parent;
    while (current && !ts.isSourceFile(current)) {
      if (ts.isCallExpression(current)) {
        const expression = current.expression;
        return ts.isPropertyAccessExpression(expression)
          && expression.expression.getText(sourceFile) === "logger";
      }
      current = current.parent;
    }
    return false;
  }
  function visit(node: ts.Node): void {
    if (
      (ts.isStringLiteral(node)
        || ts.isNoSubstitutionTemplateLiteral(node)
        || ts.isTemplateHead(node)
        || ts.isTemplateMiddle(node)
        || ts.isTemplateTail(node))
      && !isLoggerArgument(node)
    ) {
      const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      allLiterals.push({ line, text: node.text });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

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
