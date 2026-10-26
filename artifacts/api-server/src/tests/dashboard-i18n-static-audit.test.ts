import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  resolve(process.cwd(), "../flowpoint-export/dashboard.js"),
  "utf8",
);
const backendSource = readFileSync(
  resolve(process.cwd(), "../flowpoint-export/fp-backend.js"),
  "utf8",
);

const sourceFiles = [
  {
    fileName: "dashboard.js",
    source: ts.createSourceFile(
      "dashboard.js",
      dashboardSource,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    ),
  },
  {
    fileName: "fp-backend.js",
    source: ts.createSourceFile(
      "fp-backend.js",
      backendSource,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    ),
  },
];

function walk(node: ts.Node, visit: (node: ts.Node) => void) {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function callName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return "";
}

const englishKeys = new Set<string>();
walk(sourceFiles[0].source, (node) => {
  if (
    !ts.isVariableDeclaration(node) ||
    !ts.isIdentifier(node.name) ||
    !["FP_I18N_EN", "FP_I18N_EN_EXTRA"].includes(node.name.text) ||
    !node.initializer ||
    !ts.isObjectLiteralExpression(node.initializer)
  ) {
    return;
  }

  for (const property of node.initializer.properties) {
    if (
      !ts.isPropertyAssignment(property) ||
      !property.name ||
      (!ts.isStringLiteral(property.name) && !ts.isIdentifier(property.name))
    ) {
      continue;
    }
    englishKeys.add(property.name.text);
  }
});

const frenchUiText =
  /(?:[àâäçéèêëîïôöùûüÿœæ]|\b(?:supprimer|fichier|envoyer|envoyée|créé|créée|erreur|désactivé|activé|activation|en cours|canal|connecteur|surveillance|vérification|ajouter|ajouté|saisissez|adresse|données|réessayez|fréquence|quotidien|hebdo|mensuel|connexion|établissement|avis|coordonnées|opportunité|règle|assignation|rapport|mission|concurrent|sélectionné|sélectionnée|généré|générée|téléchargé|importé|chargement|inconnu|pause|prochain|formulaire|abandons|sessions|sortie|autorisation|dernière|instant|crédits|déconnecter|statut|thème|sombre|clair|manuellement|irréversible)\b)/i;

function isTranslationCall(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    ["fpT", "_fpBackendText", "fpPublicText"].includes(callName(node.expression))
  );
}

function isTranslatedWithin(node: ts.Node, boundary: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (isTranslationCall(current)) return true;
    if (current === boundary) break;
    current = current.parent;
  }
  return false;
}

function hasCompositionAncestor(node: ts.Node, boundary: ts.Node): boolean {
  let current = node.parent;
  while (current) {
    if (
      ts.isTemplateExpression(current) ||
      (ts.isBinaryExpression(current) &&
        current.operatorToken.kind === ts.SyntaxKind.PlusToken)
    ) {
      return true;
    }
    if (current === boundary) break;
    current = current.parent;
  }
  return false;
}

describe("private dashboard static English localization", () => {
  it("keeps every statically referenced fpT key in the English catalogue", () => {
    const missing: Array<{ file: string; line: number; key: string }> = [];

    for (const { fileName, source } of sourceFiles) {
      walk(source, (node) => {
        if (!ts.isCallExpression(node)) return;
        const name = callName(node.expression);

        if (name === "fpT") {
          const key = node.arguments[0];
          if (
            key &&
            (ts.isStringLiteral(key) || ts.isNoSubstitutionTemplateLiteral(key)) &&
            !englishKeys.has(key.text)
          ) {
            missing.push({
              file: fileName,
              line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
              key: key.text,
            });
          }
        }

        if (name === "showToast") {
          const message = node.arguments[1];
          if (!message) return;
          walk(message, (part) => {
            if (
              (ts.isStringLiteral(part) || ts.isNoSubstitutionTemplateLiteral(part)) &&
              frenchUiText.test(part.text) &&
              !isTranslatedWithin(part, message) &&
              !englishKeys.has(part.text)
            ) {
              missing.push({
                file: fileName,
                line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
                key: part.text,
              });
            }
          });
        }
      });
    }

    expect(missing).toEqual([]);
  });

  it("localizes French fragments in composed toasts and native dialogs", () => {
    const unlocalized: Array<{
      file: string;
      line: number;
      text: string;
      context: string;
    }> = [];

    for (const { fileName, source } of sourceFiles) {
      walk(source, (node) => {
        if (
          ts.isFunctionDeclaration(node) &&
          node.name &&
          ["fpPlanChangeSuccessMessage", "fpPlanChangeScheduledMessage"].includes(node.name.text) &&
          node.body
        ) {
          const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
          walk(node.body, (part) => {
            if (
              (ts.isStringLiteral(part) || ts.isNoSubstitutionTemplateLiteral(part)) &&
              frenchUiText.test(part.text) &&
              !isTranslatedWithin(part, node)
            ) {
              unlocalized.push({
                file: fileName,
                line,
                text: part.text,
                context: "plan-change helper",
              });
            }
            if (ts.isTemplateExpression(part) && !isTranslatedWithin(part, node)) {
              for (const quasi of [
                part.head,
                ...part.templateSpans.map((span) => span.literal),
              ]) {
                if (frenchUiText.test(quasi.text)) {
                  unlocalized.push({
                    file: fileName,
                    line,
                    text: quasi.text,
                    context: "plan-change helper template",
                  });
                }
              }
            }
          });
        }

        if (!ts.isCallExpression(node)) return;
        const name = callName(node.expression);
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

        if (name === "showToast") {
          const message = node.arguments[1];
          if (!message) return;
          walk(message, (part) => {
            if (
              (ts.isStringLiteral(part) || ts.isNoSubstitutionTemplateLiteral(part)) &&
              frenchUiText.test(part.text) &&
              hasCompositionAncestor(part, message) &&
              !isTranslatedWithin(part, message)
            ) {
              unlocalized.push({
                file: fileName,
                line,
                text: part.text,
                context: "composed toast",
              });
            }

            if (ts.isTemplateExpression(part)) {
              if (isTranslatedWithin(part, message)) return;
              for (const quasi of [
                part.head,
                ...part.templateSpans.map((span) => span.literal),
              ]) {
                if (frenchUiText.test(quasi.text)) {
                  unlocalized.push({
                    file: fileName,
                    line,
                    text: quasi.text,
                    context: "toast template",
                  });
                }
              }
            }
          });
        }

        if (["confirm", "prompt", "alert"].includes(name)) {
          const message = node.arguments[0];
          if (!message) return;
          walk(message, (part) => {
            if (
              (ts.isStringLiteral(part) || ts.isNoSubstitutionTemplateLiteral(part)) &&
              frenchUiText.test(part.text) &&
              !isTranslatedWithin(part, message)
            ) {
              unlocalized.push({
                file: fileName,
                line,
                text: part.text,
                context: "native dialog",
              });
            }

            if (ts.isTemplateExpression(part)) {
              if (isTranslatedWithin(part, message)) return;
              for (const quasi of [
                part.head,
                ...part.templateSpans.map((span) => span.literal),
              ]) {
                if (frenchUiText.test(quasi.text)) {
                  unlocalized.push({
                    file: fileName,
                    line,
                    text: quasi.text,
                    context: "native dialog template",
                  });
                }
              }
            }
          });
        }
      });
    }

    expect(unlocalized).toEqual([]);
  });
});
