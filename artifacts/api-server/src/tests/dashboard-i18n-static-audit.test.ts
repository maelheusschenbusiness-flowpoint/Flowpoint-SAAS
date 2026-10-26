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
const addonSourceNames = [
  "agency-portfolio-priorities-addon.js",
  "content-optimization-addon.js",
  "conversion-opportunity-engine-addon.js",
  "organic-campaign-tracker-addon.js",
  "seo-change-impact-addon.js",
  "seo-missions-addon.js",
  "technical-seo-fix-verification-addon.js",
];

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
  ...addonSourceNames.map((fileName) => ({
    fileName,
    source: ts.createSourceFile(
      fileName,
      readFileSync(resolve(process.cwd(), `../flowpoint-export/${fileName}`), "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    ),
  })),
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

function staticStringKeys(expression?: ts.Expression): string[] {
  if (!expression) return [];
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return [expression.text];
  }
  if (ts.isConditionalExpression(expression)) {
    return [
      ...staticStringKeys(expression.whenTrue),
      ...staticStringKeys(expression.whenFalse),
    ];
  }
  return [];
}

function translationKeysInFunction(functionName: string): Set<string> {
  const keys = new Set<string>();
  walk(sourceFiles[0].source, (node) => {
    if (
      !ts.isFunctionDeclaration(node) ||
      node.name?.text !== functionName ||
      !node.body
    ) {
      return;
    }
    walk(node.body, (part) => {
      if (
        !ts.isCallExpression(part) ||
        callName(part.expression) !== "fpT"
      ) {
        return;
      }
      for (const key of staticStringKeys(part.arguments[0])) keys.add(key);
    });
  });
  return keys;
}

function objectKeysInVariable(variableName: string): string[] {
  const keys: string[] = [];
  walk(sourceFiles[0].source, (node) => {
    if (
      !ts.isVariableDeclaration(node) ||
      !ts.isIdentifier(node.name) ||
      node.name.text !== variableName ||
      !node.initializer ||
      !ts.isObjectLiteralExpression(node.initializer)
    ) {
      return;
    }
    for (const property of node.initializer.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        (ts.isStringLiteral(property.name) || ts.isIdentifier(property.name))
      ) {
        keys.push(property.name.text);
      }
    }
  });
  return keys;
}

function arrayStringValuesInVariable(variableName: string): string[] {
  const values: string[] = [];
  walk(sourceFiles[0].source, (node) => {
    if (
      !ts.isVariableDeclaration(node) ||
      !ts.isIdentifier(node.name) ||
      node.name.text !== variableName ||
      !node.initializer ||
      !ts.isArrayLiteralExpression(node.initializer)
    ) {
      return;
    }
    for (const element of node.initializer.elements) {
      if (ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)) {
        values.push(element.text);
      }
    }
  });
  return values;
}

const englishKeys = new Set<string>();
const englishTranslations = new Map<string, string>();
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
    if (
      (ts.isStringLiteral(property.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(property.initializer)) &&
      !englishTranslations.has(property.name.text)
    ) {
      englishTranslations.set(property.name.text, property.initializer.text);
    }
  }
});

const frenchUiText =
  /(?:[àâäçéèêëîïôöùûüÿœæ]|\b(?:supprimer|fichier|envoyer|envoyée|créé|créée|erreur|désactivé|activé|activation|en cours|canal|connecteur|surveillance|vérification|ajouter|ajouté|saisissez|adresse|données|réessayez|fréquence|quotidien|hebdo|mensuel|connexion|établissement|avis|coordonnées|opportunité|règle|assignation|rapport|mission|concurrent|sélectionné|sélectionnée|généré|générée|téléchargé|importé|chargement|inconnu|pause|prochain|formulaire|abandons|sessions|sortie|autorisation|dernière|instant|crédits|déconnecter|statut|thème|sombre|clair|manuellement|irréversible)\b)/i;

function isTranslationCall(node: ts.Node, fileName: string): boolean {
  return (
    ts.isCallExpression(node) &&
    (["fpT", "_fpBackendText", "fpPublicText"].includes(callName(node.expression)) ||
      (fileName.endsWith("-addon.js") && callName(node.expression) === "t"))
  );
}

function isTranslatedWithin(
  node: ts.Node,
  boundary: ts.Node,
  fileName: string,
): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (isTranslationCall(current, fileName)) return true;
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

function staticTemplateText(node: ts.Expression): string | null {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return null;
  return [
    node.head,
    ...node.templateSpans.map((span) => span.literal),
  ].map((part) => part.text).join(" __FP_DYNAMIC__ ");
}

describe("private dashboard static English localization", () => {
  it("translates Missions UI labels while keeping their exact catalog keys", () => {
    const expectedKeys = [
      "Missions IA",
      "Moteur IA",
      "1 mission active",
      "{count} missions actives",
      "1 mission complétée",
      "{count} missions complétées",
      "Scanner maintenant",
      "+ Mission",
      "1 mission IA",
      "{count} missions IA",
      "À démarrer : {todo} · En cours : {wip} · Complétées : {done}",
      "1 mission critique — action prioritaire requise.",
      "{count} missions critiques — action prioritaire requise.",
      "Continuez votre progression SEO en exécutant les missions planifiées.",
      "Générez vos premières missions IA pour obtenir un plan d'action personnalisé basé sur vos audits.",
      "Voir les Quick Wins",
      "Créer une mission",
      "Générer des missions IA",
      "Total actives",
      "Critiques",
      "Hautes",
      "Quick Wins IA",
      "{count} actions rapides à fort impact",
      "+{count} visites",
      "Kanban",
      "1 mission",
      "{count} missions",
      "SEO",
      "Conversion",
      "Toutes catégories",
      "Technique",
      "GBP",
      "Réputation",
      "Contenu",
      "À démarrer",
      "Bloqué",
      "{done}/{total} étapes",
    ];
    const referencedKeys = translationKeysInFunction("renderMissions");

    for (const key of expectedKeys) {
      expect(referencedKeys.has(key), `renderMissions should translate "${key}"`).toBe(true);
      expect(englishKeys.has(key), `English catalogue should contain "${key}"`).toBe(true);
    }

    const priorityKeys = translationKeysInFunction("_missionPriorityMeta");
    for (const key of ["Critique", "Haute", "Moyenne", "Basse"]) {
      expect(priorityKeys.has(key), `mission priority should translate "${key}"`).toBe(true);
      expect(englishKeys.has(key), `English catalogue should contain "${key}"`).toBe(true);
    }

    expect(dashboardSource).toContain('<option value="${escHtml(c.value)}">${c.label}</option>');
    expect(dashboardSource).toContain('data-mission-cat="${escHtml(cat.value)}"');
  });

  it("translates mission-library chrome and its app-authored category labels", () => {
    const expectedKeys = [
      "Bibliothèque de missions",
      "{count}+ templates • Cliquez pour ajouter à vos missions",
      "← Mes missions",
      "Ces templates sont <strong>personnalisés pour votre profil</strong> SEO local. Chaque mission inclut des étapes détaillées et actionnables directement dans le dashboard.",
      "Tout ajouter (recommandés)",
      "Bibliothèque",
      "Recommandés pour vous",
      "1 mission",
      "{count} missions",
    ];
    const referencedKeys = translationKeysInFunction("renderMissions_Library");

    for (const key of expectedKeys) {
      expect(referencedKeys.has(key), `mission library should translate "${key}"`).toBe(true);
      expect(englishKeys.has(key), `English catalogue should contain "${key}"`).toBe(true);
    }

    for (const category of objectKeysInVariable("MISSION_LIBRARY")) {
      expect(englishKeys.has(category), `English catalogue should contain category "${category}"`).toBe(true);
    }
    expect(dashboardSource).toContain("escHtml(fpT(cat))");
    expect(dashboardSource).toContain("renderLibCard({ ...t, category: cat })");
  });

  it("translates mission-detail controls without changing mission content or status IDs", () => {
    const expectedKeys = [
      "À faire",
      "En cours",
      "Terminé",
      "Statut",
      "Assigné à",
      "— Non assigné —",
      "Aucun siège d'équipe —",
      "ajouter des membres",
      "Étapes · {done}/{total}",
      "Aucune étape définie pour cette mission.",
      "Supprimer",
      "Échéance :",
    ];
    const referencedKeys = translationKeysInFunction("renderMissionDetail");

    for (const key of expectedKeys) {
      expect(referencedKeys.has(key), `mission detail should translate "${key}"`).toBe(true);
      expect(englishKeys.has(key), `English catalogue should contain "${key}"`).toBe(true);
    }

    for (const status of ["todo", "inprogress", "done"]) {
      expect(dashboardSource).toContain(`value="${status}"`);
    }
    for (const contentBinding of [
      "escHtml(m.title)",
      "badge(m.category,'#2563EB')",
      "badge(m.impact, impactColor(m.impact))",
      "escHtml(s.text)",
      "escHtml(s.tag)",
      "escHtml(tm.name || tm.email || tm.id)",
    ]) {
      expect(dashboardSource).toContain(contentBinding);
    }
  });

  it("translates calendar chrome while preserving mission and appointment data", () => {
    const expectedKeysByFunction: Record<string, string[]> = {
      renderMissionCalendar: [
        "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim",
        "Notes disponibles", "+1 autre", "+{count} autres",
        "1 mission", "{count} missions", "1 rendez-vous", "{count} rendez-vous",
        "Aujourd'hui", "Auj.", "Mois précédent", "Mois suivant",
        "Rechercher un RDV…", "Tous les types", "Effacer le filtre", "✕ Effacer",
        "À faire", "En cours", "Terminé", "RDV",
      ],
      renderDailyAgenda: [
        "1 rendez-vous", "{count} rendez-vous", "1 mission", "{count} missions",
        "Supprimer", "Terminé", "En cours", "À faire", "Aucun événement",
        "Aucun RDV ni mission", "planifiée pour cette journée.", "+ Nouveau RDV",
        "Rendez-vous · {count}", "Missions · {count}", "Ajouter un RDV",
        "+ RDV", "Fermer l'agenda",
      ],
      renderNewCalEventPanel: [
        "Titre du RDV", "Réunion mensuelle client…", "— Aucun —", "Créer le RDV",
      ],
      renderEditCalEventPanel: [
        "Titre du RDV", "— Aucun —", "Ordre du jour, participants, points à aborder…",
        "Enregistrer", "Supprimer",
      ],
      getCalendarDurationOptions: ["1 h", "1 h 30 min", "2 h", "3 h"],
    };

    for (const [functionName, expectedKeys] of Object.entries(expectedKeysByFunction)) {
      const referencedKeys = translationKeysInFunction(functionName);
      for (const key of expectedKeys) {
        expect(referencedKeys.has(key), `${functionName} should translate "${key}"`).toBe(true);
        expect(englishKeys.has(key), `English catalogue should contain "${key}"`).toBe(true);
      }
    }

    const typeTranslations = new Map([
      ["Réunion client", "Client meeting"],
      ["Audit SEO", "SEO audit"],
      ["Revue de rapport", "Report review"],
      ["Formation", "Training"],
      ["Appel téléphonique", "Phone call"],
      ["Autre", "Other"],
    ]);
    expect(arrayStringValuesInVariable("CAL_RDV_TYPES")).toEqual([...typeTranslations.keys()]);
    for (const [key, translation] of typeTranslations) {
      expect(englishTranslations.get(key)).toBe(translation);
    }

    expect(dashboardSource).toContain('value="${escHtml(t)}"');
    expect(dashboardSource).toContain("escHtml(fpT(ce.type))");
    expect(dashboardSource).toContain("escHtml(ce.title)");
    expect(dashboardSource).toContain("escHtml(ce.notes)");
    expect(dashboardSource).toContain("escHtml(m.title)");
    expect(dashboardSource).toContain("escHtml(m.category)");
    expect(dashboardSource).toContain("escHtml(ev.title)");
    expect(dashboardSource).toContain("escHtml(ev.notes||'')");
  });

  it("uses English translations for dynamic shell and opportunity counts", () => {
    const expected = new Map([
      ["{count} URLs gérées", "{count} managed URLs"],
      ["{count} missions actives", "{count} active missions"],
      ["{count} jours de suite", "{count}-day streak"],
      ["{count}j", "{count}d"],
      ["1 opportunité identifiée", "1 opportunity identified"],
      ["{count} opportunités identifiées", "{count} opportunities identified"],
      [
        "{completed} critères renseignés sur {total}",
        "{completed} of {total} criteria completed",
      ],
    ]);

    for (const [key, translation] of expected) {
      expect(dashboardSource).toContain(`fpT('${key}'`);
      expect(englishTranslations.get(key)).toBe(translation);
    }
  });

  it("translates Local Presence controls while preserving synchronized profile text", () => {
    const expectedKeys = [
      "Analyse des fiches GBP…",
      "Gérer les add-ons",
      "Priorités calculées à partir des champs présents dans votre fiche GBP synchronisée.",
      "Actualiser",
      "Aucune fiche GBP synchronisée. Connectez Google Business Profile puis synchronisez vos fiches.",
      "{completed} critères renseignés sur {total}",
      "Établissement",
      "Complet",
      "À compléter",
      "Enregistrer mes critères",
      "Prochaines actions",
      "Tous les critères suivis sont présents dans les dernières données synchronisées.",
      "Dernière synchronisation :",
      "Aucune synchronisation",
    ];
    const referencedKeys = translationKeysInFunction("renderLocalPresenceOptimizer");

    for (const key of expectedKeys) {
      expect(referencedKeys.has(key), `Local Presence should translate "${key}"`).toBe(true);
      expect(englishKeys.has(key), `English catalogue should contain "${key}"`).toBe(true);
    }

    expect(dashboardSource).toContain("escHtml(field.label)");
    expect(dashboardSource).toContain("escHtml(item.title)");
    expect(dashboardSource).toContain("escHtml(item.evidence)");
  });

  it("keeps static dashboard and add-on translation keys in the English catalogue", () => {
    const missing: Array<{ file: string; line: number; key: string }> = [];

    for (const { fileName, source } of sourceFiles) {
      walk(source, (node) => {
        if (
          ts.isVariableDeclaration(node) &&
          ts.isIdentifier(node.name) &&
          ["statusLabels", "priorities"].includes(node.name.text) &&
          node.initializer &&
          ts.isObjectLiteralExpression(node.initializer)
        ) {
          for (const entry of node.initializer.properties) {
            if (!ts.isPropertyAssignment(entry) || !ts.isArrayLiteralExpression(entry.initializer)) {
              continue;
            }
            const label = entry.initializer.elements[1];
            if (
              label &&
              (ts.isStringLiteral(label) || ts.isNoSubstitutionTemplateLiteral(label)) &&
              !englishKeys.has(label.text)
            ) {
              missing.push({
                file: fileName,
                line: source.getLineAndCharacterOfPosition(label.getStart(source)).line + 1,
                key: label.text,
              });
            }
          }
        }

        if (!ts.isCallExpression(node)) return;
        const name = callName(node.expression);

        if (
          name === "fpT" ||
          (fileName.endsWith("-addon.js") && name === "t")
        ) {
          for (const key of staticStringKeys(node.arguments[0])) {
            if (!englishKeys.has(key)) {
              missing.push({
                file: fileName,
                line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
                key,
              });
            }
          }
        }

        if (name === "showToast") {
          const message = node.arguments[1];
          if (!message) return;
          walk(message, (part) => {
            if (
              (ts.isStringLiteral(part) || ts.isNoSubstitutionTemplateLiteral(part)) &&
              frenchUiText.test(part.text) &&
              !isTranslatedWithin(part, message, fileName) &&
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
              !isTranslatedWithin(part, node, fileName)
            ) {
              unlocalized.push({
                file: fileName,
                line,
                text: part.text,
                context: "plan-change helper",
              });
            }
            if (
              ts.isTemplateExpression(part) &&
              !isTranslatedWithin(part, node, fileName)
            ) {
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
              !isTranslatedWithin(part, message, fileName)
            ) {
              unlocalized.push({
                file: fileName,
                line,
                text: part.text,
                context: "composed toast",
              });
            }

            if (ts.isTemplateExpression(part)) {
              if (isTranslatedWithin(part, message, fileName)) return;
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
              !isTranslatedWithin(part, message, fileName)
            ) {
              unlocalized.push({
                file: fileName,
                line,
                text: part.text,
                context: "native dialog",
              });
            }

            if (ts.isTemplateExpression(part)) {
              if (isTranslatedWithin(part, message, fileName)) return;
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

  it("does not leave unwrapped French text in add-on HTML or DOM text assignments", () => {
    const unlocalized: Array<{ file: string; line: number; text: string }> = [];

    for (const { fileName, source } of sourceFiles) {
      if (!fileName.endsWith("-addon.js")) continue;
      walk(source, (node) => {
        if (
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
          ts.isPropertyAccessExpression(node.left) &&
          node.left.name.text === "innerHTML"
        ) {
          const html = staticTemplateText(node.right);
          if (html !== null) {
            const withoutNonVisibleMarkup = html
              .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
              .replace(/<!--[\s\S]*?-->/g, " ")
              .replace(/<[^>]*>/g, "\n");
            for (const candidate of withoutNonVisibleMarkup.split("\n")) {
              const text = candidate.replace(/__FP_DYNAMIC__/g, " ").trim();
              if (
                text &&
                frenchUiText.test(text) &&
                !englishKeys.has(text)
              ) {
                unlocalized.push({
                  file: fileName,
                  line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
                  text,
                });
              }
            }

            for (const attribute of html.matchAll(
              /\b(?:placeholder|title|aria-label|alt)\s*=\s*(["'])(.*?)\1/gi,
            )) {
              const text = attribute[2].replace(/__FP_DYNAMIC__/g, " ").trim();
              if (
                text &&
                frenchUiText.test(text) &&
                !englishKeys.has(text)
              ) {
                unlocalized.push({
                  file: fileName,
                  line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
                  text,
                });
              }
            }
          }
        }

        if (
          !ts.isBinaryExpression(node) ||
          node.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
          !ts.isPropertyAccessExpression(node.left) ||
          !["textContent", "innerText"].includes(node.left.name.text) ||
          isTranslatedWithin(node.right, node, fileName)
        ) {
          return;
        }

        const parts: string[] = [];
        if (ts.isStringLiteral(node.right) || ts.isNoSubstitutionTemplateLiteral(node.right)) {
          parts.push(node.right.text);
        } else if (ts.isTemplateExpression(node.right)) {
          parts.push(
            node.right.head.text,
            ...node.right.templateSpans.map((span) => span.literal.text),
          );
        }
        for (const text of parts) {
          if (frenchUiText.test(text) && !englishKeys.has(text.trim())) {
            unlocalized.push({
              file: fileName,
              line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
              text,
            });
          }
        }
      });
    }

    expect(unlocalized).toEqual([]);
  });
});
