import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
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
const missionRouteSource = readFileSync(
  resolve(process.cwd(), "src/routes/missions.ts"),
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

function objectArrayElementCount(variableName: string): number {
  let count = 0;
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
      if (ts.isPropertyAssignment(property) && ts.isArrayLiteralExpression(property.initializer)) {
        count += property.initializer.elements.length;
      }
    }
  });
  return count;
}

function arrayElementCountInFunctionVariable(functionName: string, variableName: string): number {
  let count = 0;
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
        !ts.isVariableDeclaration(part) ||
        !ts.isIdentifier(part.name) ||
        part.name.text !== variableName ||
        !part.initializer
      ) {
        return;
      }
      const array = ts.isArrayLiteralExpression(part.initializer)
        ? part.initializer
        : ts.isCallExpression(part.initializer) &&
            ts.isPropertyAccessExpression(part.initializer.expression) &&
            ts.isArrayLiteralExpression(part.initializer.expression.expression)
          ? part.initializer.expression.expression
          : null;
      if (array) count = array.elements.length;
    });
  });
  return count;
}

function stringValuesInObjectFields(variableName: string, fieldNames: string[]): Set<string> {
  const values = new Set<string>();
  const fields = new Set(fieldNames);
  walk(sourceFiles[0].source, (node) => {
    if (
      !ts.isVariableDeclaration(node) ||
      !ts.isIdentifier(node.name) ||
      node.name.text !== variableName ||
      !node.initializer
    ) {
      return;
    }
    walk(node.initializer, (part) => {
      if (
        !ts.isPropertyAssignment(part) ||
        (!ts.isStringLiteral(part.name) && !ts.isIdentifier(part.name)) ||
        !fields.has(part.name.text)
      ) {
        return;
      }
      const add = (value: ts.Expression) => {
        if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
          values.add(value.text);
        }
      };
      if (ts.isArrayLiteralExpression(part.initializer)) {
        for (const item of part.initializer.elements) add(item);
      } else {
        add(part.initializer);
      }
    });
  });
  return values;
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
      "Bibliothèque",
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
    expect(objectKeysInVariable("MISSION_LIBRARY")).toHaveLength(8);
    expect(objectArrayElementCount("MISSION_LIBRARY")).toBe(73);
    expect(dashboardSource).toContain("escHtml(fpT(cat))");
    expect(dashboardSource).toContain("renderLibCard({ ...t, category: cat })");
  });

  it("covers every mission-library field and translates only template-sourced mission content", () => {
    const libraryValues = stringValuesInObjectFields(
      "MISSION_LIBRARY",
      ["title", "impact", "effort", "gain", "steps"],
    );
    expect(libraryValues.size).toBe(301);
    expect([...libraryValues].filter((key) => !englishKeys.has(key))).toEqual([]);

    expect(dashboardSource).toContain("escHtml(fpT(t.title))");
    expect(dashboardSource).toContain("escHtml(fpT(t.impact))");
    expect(dashboardSource).toContain("escHtml(fpT(t.effort||'—'))");
    expect(dashboardSource).toContain("escHtml(fpT(t.gain))");
    expect(dashboardSource).toContain('data-lib-title="${escHtml(t.title)}"');
    expect(dashboardSource).toContain('data-lib-cat="${escHtml(t.category)}"');
    expect(dashboardSource).toContain('data-lib-impact="${escHtml(t.impact)}"');
    expect(dashboardSource).toContain('data-lib-steps="${escHtml(JSON.stringify(t.steps||[]))}"');
    expect(dashboardSource).toContain("return missionTemplateDisplayTitle(raw)");
    expect(dashboardSource).toContain("if (!mission || (mission.sourceType || mission.source_type) !== 'template') return raw");
    expect(dashboardSource).toContain("sourceType:'template'");
    expect(dashboardSource).toContain("escHtml(missionDisplayText(m, s.text))");
    expect(dashboardSource).toContain("missionDisplayStepTag(m, s.tag)");

    expect(backendSource).toContain("'/api/missions/from-template'");
    expect(backendSource).toContain("templateTitle: mission.title");
    expect(backendSource).toContain("steps: templateSteps");
    expect(backendSource).toContain("mission.steps.map(function (step) { return typeof step === 'string' ? step : (step && step.text) || ''; })");
    expect(missionRouteSource).toContain("'template',$10,NOW(),NOW(),NOW()");
  });

  it("translates known template copy at display time and preserves edited or manual text", () => {
    const displayKeys = new Set([
      "Corriger les balises title manquantes",
      "Créer des pages locales géociblées",
      "Répondre aux {count} avis Google sans réponse",
    ]);
    const translations: Record<string, string> = {
      "Corriger les balises title manquantes": "Fix missing title tags",
      "Créer des pages locales géociblées": "Create geo-targeted local pages",
      "Répondre aux {count} avis Google sans réponse": "Reply to {count} unanswered Google reviews",
      "Étape {count}": "Step {count}",
    };
    const fpT = (key: string, vars: Record<string, unknown> = {}) =>
      Object.entries(vars).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
        translations[key] || key,
      );
    const start = dashboardSource.indexOf("function missionTemplateDisplayTitle(raw)");
    const end = dashboardSource.indexOf("\nfunction missionPanelTitle(", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const helperSource = dashboardSource.slice(start, end);
    const helpers = runInNewContext(
      `${helperSource}; ({ missionDisplayText, missionDisplayStepTag })`,
      { MISSION_LIBRARY_DISPLAY_KEYS: displayKeys, fpT },
    ) as {
      missionDisplayText: (mission: Record<string, unknown>, value: string) => string;
      missionDisplayStepTag: (mission: Record<string, unknown>, tag: string) => string;
    };
    const templateMission = { sourceType: "template" };
    const rawWithDomain = "Corriger les balises title manquantes — example.com";
    const rawWithCity = "Créer des pages locales géociblées à Bruxelles";
    expect(helpers.missionDisplayText(templateMission, rawWithDomain))
      .toBe("Fix missing title tags — example.com");
    expect(helpers.missionDisplayText(templateMission, rawWithCity))
      .toBe("Create geo-targeted local pages in Bruxelles");
    expect(helpers.missionDisplayText(templateMission, "Répondre aux 3 avis Google sans réponse"))
      .toBe("Reply to 3 unanswered Google reviews");
    expect(helpers.missionDisplayText({ sourceType: "manual" }, rawWithDomain)).toBe(rawWithDomain);
    expect(helpers.missionDisplayText(templateMission, "Customer-edited mission title"))
      .toBe("Customer-edited mission title");
    expect(helpers.missionDisplayStepTag(templateMission, "Étape 2")).toBe("Step 2");
    expect(helpers.missionDisplayStepTag({ sourceType: "manual" }, "Étape 2")).toBe("Étape 2");
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
    const stepTagKeys = translationKeysInFunction("missionDisplayStepTag");
    expect(stepTagKeys.has("Étape {count}")).toBe(true);
    expect(englishKeys.has("Étape {count}")).toBe(true);

    for (const status of ["todo", "inprogress", "done"]) {
      expect(dashboardSource).toContain(`value="${status}"`);
    }
    for (const contentBinding of [
      "escHtml(missionDisplayText(m, m.title))",
      "badge(missionDisplayText(m, m.category),'#2563EB')",
      "badge(missionDisplayText(m, m.impact), impactColor(m.impact))",
      "escHtml(missionDisplayText(m, s.text))",
      "escHtml(missionDisplayStepTag(m, s.tag))",
      "escHtml(tm.name || tm.email || tm.id)",
    ]) {
      expect(dashboardSource).toContain(contentBinding);
    }
  });

  it("translates mission context-menu controls and the panel title", () => {
    const expectedKeys = [
      "Mission — {title}",
      "Voir les étapes",
      "Remettre à faire",
      "Marquer terminé",
    ];
    for (const key of expectedKeys) {
      expect(englishKeys.has(key), `English catalogue should contain "${key}"`).toBe(true);
    }
    expect(dashboardSource).toContain("openFloatPanel(missionPanelTitle(m), renderMissionDetail(m))");
    expect(dashboardSource).toContain("label:fpT('Voir les étapes')");
    expect(dashboardSource).toContain("fpT('Remettre à faire')");
    expect(dashboardSource).toContain("fpT('Marquer terminé')");
  });

  it("localizes AI mission suggestions while keeping saved template values raw", () => {
    const expectedKeys = [
      "Corriger les balises title manquantes",
      "Ajouter schema markup FAQ sur vos sites prioritaires",
      "Créer des pages locales géociblées",
      "Auditer et corriger les citations NAP incohérentes",
      "Configurer Google Posts hebdomadaires automatisés",
      "Répondre aux {count} avis Google sans réponse",
      "Audit et optimisation des photos Google Business",
      "Optimiser la vitesse mobile — site le plus lent (score <65)",
      "Corriger les images non optimisées (WebP) sur vos sites",
      "Configurer des alertes de temps de réponse avancées",
      "Mettre en place un programme de collecte d'avis automatisé",
      "Créer des backlinks locaux via annuaires sectoriels",
      "Optimiser le suivi de positions — {count} mot(s)-clé(s)",
      "Analyser et contrer les {count} concurrent(s) détectés",
      "Audit SEO · Score actuel : {score}/100",
      "Audit SEO · {count} site(s) analysé(s)",
      "Audit · {count} site(s)",
      "GBP · {count} avis en attente",
      "{count} monitor(s) actif(s)",
      "{count} mot(s)-clé(s) suivi(s)",
      "Analyse concurrentielle · {count} concurrent(s)",
      "+{count} pts (estimé)",
      "<strong>{count} recommandation{plural}</strong> générées depuis vos données réelles",
      " · <strong>{count} déjà créées</strong>",
      "Lancez un audit SEO ou connectez Google Business Profile pour des recommandations personnalisées.",
      "Tout créer en missions",
      "Voir les missions existantes",
      "Aucune suggestion disponible",
      "Lancez un audit SEO ou connectez Google Business Profile pour recevoir des missions IA personnalisées.",
      "Aucune mission pour cette catégorie.",
      "Résumé de vos missions",
      "Calculé depuis vos données réelles",
      "Impact non estimé",
      "MTTR réduit",
      "1h",
      "1h30",
      "2h",
      "3h",
    ];
    expect(expectedKeys).toHaveLength(38);
    expect(arrayElementCountInFunctionVariable("renderMissionsAI", "allSuggestions")).toBe(14);
    for (const key of expectedKeys) {
      expect(englishKeys.has(key), `English catalogue should contain "${key}"`).toBe(true);
    }

    expect(dashboardSource).toContain("m.displayTitle = missionTemplateDisplayTitle(m.title)");
    expect(dashboardSource).toContain("m.displayCat = fpT(m.cat)");
    expect(dashboardSource).toContain("m.displaySource = missionAIDisplaySource(m.source)");
    expect(dashboardSource).toContain("m.displayGain = missionAIDisplayGain(m.gain)");
    expect(dashboardSource).toContain("data-mission-title=\"' + escHtml(m.title) + '\"");
    expect(dashboardSource).toContain("apiAction('POST', '/api/missions/from-template', { templateTitle: m.title, priority: 'high', category: m.cat, steps: [] })");
    expect(dashboardSource).toContain("/api/missions/from-template");
    expect(dashboardSource).toContain("templateTitle:title,category:cat");
    expect(dashboardSource).toContain("steps:[]");
    expect(dashboardSource).toContain("r.sourceType = 'template'");
  });

  it("translates status-filter view controls and empty-state copy", () => {
    const expectedKeys = [
      "À démarrer",
      "En cours",
      "Complétées",
      "1 mission",
      "{count} missions",
      "Liste",
      "Kanban",
      "Calendrier",
      "Bibliothèque",
      "Aucune mission \"{status}\"",
      "Créez une nouvelle mission via le bouton + en bas à droite.",
    ];
    const referencedKeys = translationKeysInFunction("renderMissionsFiltered");
    for (const key of expectedKeys) {
      expect(referencedKeys.has(key), `filtered missions should translate "${key}"`).toBe(true);
      expect(englishKeys.has(key), `English catalogue should contain "${key}"`).toBe(true);
    }
  });

  it("localizes the manual mission form while preserving internal select values", () => {
    const expectedKeys = [
      "Titre",
      "Optimiser les balises title…",
      "Catégorie",
      "Impact",
      "Échéance",
      "Créer la mission",
      "Création…",
    ];
    const panelKeys = translationKeysInFunction("renderNewMissionPanel");
    for (const key of expectedKeys.slice(0, -1)) {
      expect(panelKeys.has(key), `new mission form should translate "${key}"`).toBe(true);
      expect(englishKeys.has(key), `English catalogue should contain "${key}"`).toBe(true);
    }
    expect(translationKeysInFunction("setupNewMissionPanel").has("Création…")).toBe(true);
    expect(englishKeys.has("Création…")).toBe(true);

    for (const category of ["Audits", "Local SEO", "Monitoring", "Rapports", "Équipe"]) {
      expect(englishKeys.has(category), `English catalogue should contain category "${category}"`).toBe(true);
    }
    expect(dashboardSource).toContain('value="${escHtml(c)}">${escHtml(fpT(c))}</option>');
    expect(dashboardSource).toContain('value="${escHtml(i)}">${escHtml(fpT(i))}</option>');
    expect(dashboardSource).toContain("openFloatPanel(fpT('Nouvelle mission'), renderNewMissionPanel())");
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

  it("audits Overview root and sub-pages while keeping dynamic values raw", () => {
    const overviewFunctions = [
      "renderOverview",
      "renderOverviewInsights",
      "renderOverviewQuickWins",
      "renderOverviewChecklist",
    ];
    const directKeys = new Set(
      overviewFunctions.flatMap((name) => [...translationKeysInFunction(name)]),
    );
    expect(directKeys.size).toBeGreaterThan(0);
    for (const key of directKeys) {
      expect(englishKeys.has(key), `Overview should translate "${key}"`).toBe(true);
    }

    const dynamicDisplayKeys = [
      "Santé Workspace",
      "Trafic GSC",
      "Taux conv.",
      "Audits SEO",
      "Concurrents",
      "Rapports",
      "Alertes",
      "IA Copilot",
      "IA Scoring",
      "IA Powered",
      "Silencieux",
      "Audit SEO",
      "Rapport Exécutif",
      "Analyser Concurrents",
      "Nouveau Monitor",
      "Créer Mission",
      "Conversion IA",
      "Local SEO",
      "Voir les Alertes",
      "Excellent",
      "Moyen",
      "À améliorer",
      "Clics GSC",
      "Impressions",
      "Sessions GA4",
      "Conversions",
      "30 derniers jours",
      "{count} pts",
      "Lun",
      "Mar",
      "Mer",
      "Jeu",
      "Ven",
      "Sam",
      "Dim",
      "Technique",
      "Performance",
      "CRO",
      "GBP",
      "Réputation",
      "Analytics",
      "Monitor",
      "Conversion",
      "Contenu",
      "Urgent",
      "Haute",
      "Normale",
      "Critique",
      "Élevé",
      "Moyen",
      "Tous",
      "Critiques",
      "Opportunités",
      "Premier audit",
      "5 audits réalisés",
      "10 audits réalisés",
      "Score moyen ≥ 80",
      "Premier moniteur configuré",
      "5 moniteurs actifs",
      "Première mission complétée",
      "10 missions complétées",
      "Premier rapport généré",
      "Premier mot-clé suivi",
      "10 mots-clés suivis",
      "Premier concurrent ajouté",
      "3 jours consécutifs",
      "7 jours consécutifs",
      "30 jours consécutifs",
      "Performance technique",
      "Présence locale",
      "Réputation & avis",
      "Contenus & engagement",
      "Score PageSpeed Mobile > 80 sur tous les sites",
      "Images converties en WebP",
      "Balise title unique sur chaque page",
      "Sitemap XML soumis à Google Search Console",
      "Schema markup LocalBusiness en place",
      "Fiche GBP complète à 100% (photos, horaires, description)",
      "Citations NAP cohérentes sur les 20 principaux annuaires",
      "Pages locales créées pour chaque zone géographique",
      "Mots-clés géolocalisés dans les balises h1",
      "Zone de chalandise définie sur GBP",
      "Note Google moyenne > 4.5 étoiles",
      "Réponse à tous les avis < 48h",
      "Processus de collecte d'avis en place",
      "Présence sur Trustpilot / PagesJaunes",
      "Alertes Google My Business configurées",
      "Google Posts publiés chaque semaine",
      "FAQ schema markup sur les pages clés",
      "Blog avec articles locaux (1/mois minimum)",
      'Page "Témoignages clients" à jour',
      "Voir les détails",
      "Voir les audits",
      "Corriger maintenant",
      "Voir Local SEO",
      "Voir le rapport SLA",
      "Partager les rapports",
      "Analyser le concurrent",
      "Voir mes missions",
      "Voir les mots-clés",
      "Renouveler maintenant",
      "Voir les alertes",
      "Optimiser les audits",
      "Répondre aux avis",
      "Créer pages locales",
      "Plan d'action complet",
      "Me guider sur la première",
      "Créer toutes les missions",
      "Trier par gain",
      "Qu'est-ce qui manque ?",
      "Plan d'action priorisé",
      "Corriger {site}",
    ];
    for (const key of dynamicDisplayKeys) {
      expect(englishKeys.has(key), `Overview dynamic label should translate "${key}"`).toBe(true);
    }

    expect(dashboardSource).toContain(
      "return OVERVIEW_DEFAULT_CHECKLIST_LABELS[item && item.id] === raw ? fpT(raw) : raw;",
    );
    expect(dashboardSource).toContain("data-qw-title=\"${escHtml(q.title||'Mission Quick Win')}\"");
    expect(dashboardSource).toContain('data-q="${escHtml(_chipQuery(c))}"');
    expect(dashboardSource).toContain("escHtml(fpT(_chipLabel(c)))");
    expect(dashboardSource).toContain("escHtml(fpT(m.name))");
    expect(dashboardSource).toContain("escHtml(quickWinDisplayGain(q.gain))");
    expect(dashboardSource).toContain("msg: STATE.activityEvents[0].label");
    expect(dashboardSource).toContain("competitor: STATE.competitors[0].name");
    expect(dashboardSource).toContain("STATE.overviewInsightFilter='${f}'");
  });

  it("audits every Audits view and interaction while preserving API values and customer content", () => {
    const auditFunctions = [
      "renderAudits",
      "renderAuditsAnalysis",
      "renderAuditsCompare",
      "renderAuditsHistory",
      "renderAuditsOpportunites",
      "historyLineChart",
      "renderAuditDetailPanel",
      "renderNewAuditPanel",
      "setupNewAuditPanel",
      "loadAuditHistory",
      "exportAuditsCsv",
      "bindAuditPanelBtns",
      "syncBulkBar",
    ];
    const directKeys = new Set(
      auditFunctions.flatMap((name) => [...translationKeysInFunction(name)]),
    );
    expect(directKeys.size).toBeGreaterThan(0);
    for (const key of directKeys) {
      expect(englishKeys.has(key), `Audits should translate "${key}"`).toBe(true);
    }

    const dynamicAuditKeys = [
      "Technique",
      "Contenu",
      "Performance",
      "Accessibilité",
      "Sécurité",
      "Excellent",
      "Bon",
      "Moyen",
      "Critique",
      "Important",
      "Modéré",
      "Info",
      "Balise title manquante ou dupliquée",
      "Les balises title sont le premier signal SEO lu par Google. Leur absence entraîne une perte directe de 10–20% de positionnement sur les mots-clés cibles.",
      "Ajouter une balise <title> unique de 50–60 caractères par page, incluant le mot-clé principal en début de chaîne.",
      "SEO Élevé",
      "Images non optimisées (>200 kb)",
      "Des images lourdes dégradent le LCP (Core Web Vitals). Un LCP > 2,5 s fait chuter le score PageSpeed de 20+ points et pénalise le ranking mobile.",
      "Convertir en WebP, redimensionner aux breakpoints réels (max-width CSS), ajouter loading=\"lazy\" sur les images hors viewport.",
      "Performance Élevé",
      "Maillage interne insuffisant",
      "Le maillage interne distribue le PageRank entre vos pages. Des pages orphelines ne sont pas bien crawlées et perdent leur potentiel de ranking.",
      "Créer au moins 3 liens internes contextuels vers chaque page stratégique depuis les pages à fort trafic.",
      "Autorité Moyen",
      "Ces problèmes ont un impact individuel limité mais s'accumulent pour pénaliser le score global sur la durée.",
      "Consulter le rapport complet pour la liste exhaustive et les corrections suggérées par l'IA.",
      "SEO Faible",
      "+12–18 pts vitesse",
      "{count} autres problèmes détectés",
      "Plan d'amélioration",
      "Analyse détaillée",
      "Créer toutes les missions",
      "Plan d'amélioration global",
      "Missions prioritaires",
      "Rapport comparatif PDF",
      "Créer une mission",
      "Créer plan de contenu IA",
      "Générer toutes les missions",
      "Rapport opportunités PDF",
      "Relancer",
      "1 audit sélectionné",
      "{count} audits sélectionnés",
      "1 audit relancé",
      "{count} audits relancés",
      "1 audit supprimé",
      "{count} audits supprimés",
      "1 audit a échoué",
      "{count} audits ont échoué",
      "{ok} audits relancés; {fail} échoués",
      "{ok} audits supprimés; {fail} échoués",
      "CSV exporté — {count} audit",
      "CSV exporté — {count} audits",
      "Relance de {count} audit en cours…",
      "Relance de {count} audits en cours…",
      "1 audit archivé — masqué de la vue principale",
      "{count} audits archivés — masqués de la vue principale",
      "Supprimer l’audit sélectionné ? Cette action est irréversible.",
      "Supprimer les {count} audits sélectionnés ? Cette action est irréversible.",
      "Supprimer l’audit",
      "Supprimer {count} audits",
    ];
    for (const key of dynamicAuditKeys) {
      expect(englishKeys.has(key), `Dynamic Audits text should translate "${key}"`).toBe(true);
    }

    const bulkBindingsStart = dashboardSource.indexOf("function bindBulkBarEvents()");
    const bulkMonitorsStart = dashboardSource.indexOf("// ── MONITORS ──", bulkBindingsStart);
    expect(bulkBindingsStart).toBeGreaterThanOrEqual(0);
    expect(bulkMonitorsStart).toBeGreaterThan(bulkBindingsStart);
    const auditBulkSource = dashboardSource.slice(bulkBindingsStart, bulkMonitorsStart);
    const auditBulkAst = ts.createSourceFile(
      "audit-bulk-actions.js",
      auditBulkSource,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.JS,
    );
    const auditBulkKeys = new Set<string>();
    walk(auditBulkAst, (node) => {
      if (!ts.isCallExpression(node) || callName(node.expression) !== "fpT") return;
      for (const key of staticStringKeys(node.arguments[0])) auditBulkKeys.add(key);
    });
    for (const key of auditBulkKeys) {
      expect(englishKeys.has(key), `Audit bulk action should translate "${key}"`).toBe(true);
    }
    expect(auditBulkSource).toContain("apiAction('POST', '/api/audits', { url: a.url, force: true })");
    expect(auditBulkSource).toContain("window.fpDarkConfirm(fpT(ids.length === 1 ? 'Supprimer l’audit sélectionné ?");
    expect(auditBulkSource).toContain("apiAction('DELETE', `/api/audits/${id}`)");

    const expectedTranslations = new Map([
      ["Audit lancé pour {url}", "Audit started for {url}"],
      ["Audit relancé pour {url}", "Audit rerun for {url}"],
      ["Analyse de {url} en cours…", "Analyzing {url}…"],
      ["{count} site en zone critique.", "{count} site in the critical range."],
      ["{count} sites en zone critique.", "{count} sites in the critical range."],
      ["{count} opportunité mot-clé identifiée.", "{count} keyword opportunity identified."],
      ["Opportunités Mots-clés", "Keyword opportunities"],
      ["SEO Local", "Local SEO"],
      ["Analyser tout", "Analyze all"],
      ["Hebdo", "Weekly"],
      ["1 autre problème détecté", "1 other issue detected"],
      ["Audit planifié activé — {frequency}", "Scheduled audit enabled — {frequency}"],
      ["Copier l'URL", "Copy URL"],
      ["Détacher", "Unpin"],
      ["Épingler", "Pin"],
      ["Source", "Source"],
      ["Comparer", "Compare"],
      ["Relancer", "Rerun"],
      ["Plan d'amélioration", "Improvement plan"],
      ["Analyse détaillée", "Detailed analysis"],
      ["Plan d'amélioration global", "Overall improvement plan"],
      ["Missions prioritaires", "Priority missions"],
      ["Rapport comparatif PDF", "Comparative PDF report"],
      ["Créer plan de contenu IA", "Create AI content plan"],
      ["Générer toutes les missions", "Generate all missions"],
      ["Rapport opportunités PDF", "Opportunities report PDF"],
    ]);
    for (const [key, translation] of expectedTranslations) {
      expect(englishTranslations.get(key), `Audits translation for "${key}"`).toBe(translation);
    }

    expect(dashboardSource).toContain('value="${escHtml(o)}">${escHtml(fpT(o))}</option>');
    expect(dashboardSource).toContain("const type = $('#na-type')?.value || 'SEO complet';");
    expect(dashboardSource).toContain("apiAction('POST', '/api/audits', { url, type })");
    expect(dashboardSource).toContain("data-audit-status-filter=\"${v}\"");
    expect(dashboardSource).toContain("const scoreStatus = a => a.score >= 70 ? 'good' : a.score >= 45 ? 'medium' : 'bad';");
    expect(dashboardSource).toContain("container.textContent = data.analysis;");
    expect(dashboardSource).toContain("${escHtml(a.url)}");
    expect(dashboardSource).toContain("${kw.kw}");
    expect(dashboardSource).toContain("title:o.title,desc:o.desc,site:o.site");
    expect(dashboardSource).toContain("${fpT('Détail par site')}");
    expect(dashboardSource).toContain("${fpT('Distribution des scores')}");
    expect(dashboardSource).toContain("${fpT('Aucun audit disponible pour comparer.')}");
    expect(dashboardSource).toContain("${fpT('Comparer →')}");
    expect(dashboardSource).toContain("${fpT('Historique du score SEO')}");
    expect(dashboardSource).toContain("escHtml(fpT(_chipLabel(c)))");
    expect(dashboardSource).toContain("fpT(issue.insight)");
    expect(dashboardSource).toContain("fpT(issue.fix)");
    expect(dashboardSource).toContain("exportCsv([fpT('Date'),fpT('Score SEO'),fpT('Delta'),fpT('Origine'),fpT('Vitesse')].join(',')");
    expect(dashboardSource).toContain("label:fpT('Voir les détails')");
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

  it("translates the Local SEO overview while preserving real location and ranking data", () => {
    const expectedKeys = [
      "Domination Locale",
      "Données GBP et résultats locaux enregistrés — sans estimation de classement",
      "Rapport local",
      "Mission locale",
      "Stratège IA Local — Plan Ultra requis",
      "Accédez aux recommandations IA personnalisées, aux prévisions de croissance et à la détection automatique des opportunités locales non exploitées.",
      "Passer Ultra",
      "Cartes suivies",
      "Classements locaux",
      "Couverture géographique",
      "Concurrents enregistrés",
      "{count} analyse(s) terminée(s)",
      "Aucune grille mesurée",
      "Aucune carte de positions réelles n’est disponible. Les résultats géographiques ne seront affichés qu’après l’enregistrement de mesures vérifiées.",
    ];
    const referencedKeys = translationKeysInFunction("renderLocalSEO");

    for (const key of expectedKeys) {
      expect(referencedKeys.has(key), `Local SEO overview should translate "${key}"`).toBe(true);
      expect(englishKeys.has(key), `English catalogue should contain "${key}"`).toBe(true);
    }

    expect(dashboardSource).toContain("STATE.route === 'reports' || STATE.route === 'competitor' || STATE.route === 'local-seo' ? fpT(t.label) : t.label");
    expect(dashboardSource).toContain("openFloatPanel(fpT('Nouveau rapport')");
    expect(englishKeys.has("Nouveau rapport")).toBe(true);
    expect(dashboardSource).toContain("escHtml(STATE.me&&STATE.me.location&&STATE.me.location.city");
    expect(dashboardSource).toContain("escHtml(STATE.localSeo.rankingKeyword||'')");
    expect(dashboardSource).toContain("escHtml(STATE.localSeo.rankingCity||'')");
  });

  it("translates Local SEO zone UI without changing organization-provided zone data", () => {
    const expectedKeys = [
      "Aucune zone locale configurée. Ajoutez vos zones géographiques cibles pour suivre votre couverture locale et identifier les opportunités.",
      "Couverture forte sur {top}. Zone à développer en priorité : {low} — faible couverture ({coverage}%). Score moyen : {average}%.",
      "Couverture forte sur {top}. Score moyen de couverture : <strong>{average}%</strong>.",
      "Score moyen de couverture locale : <strong>{average}%</strong>. Optimisez vos pages locales pour améliorer votre visibilité.",
      "Zones fortes",
      "à 70%+ couverture",
      "Trafic total",
      "par mois",
      "toutes zones",
      "Position moy.",
      "moyenne globale",
      "Zones à développer",
      "opportunités",
      "Couverture locale",
      "Mobile",
      "Mots-clés",
      "Tendance",
      "{count} page locale",
      "{count} pages locales",
      "Aucune page locale",
      "Mission pour cette zone",
      "Zone bien couverte",
      "Zones d'expansion prioritaires",
    ];
    const referencedKeys = translationKeysInFunction("renderLocalSEOZones");

    for (const key of expectedKeys) {
      expect(referencedKeys.has(key), `Local SEO zones should translate "${key}"`).toBe(true);
      expect(englishKeys.has(key), `English catalogue should contain "${key}"`).toBe(true);
    }

    expect(dashboardSource).toContain("escHtml(z.name)");
    expect(dashboardSource).toContain("escHtml(z.region)");
    expect(dashboardSource).toContain("fpT('Développer la zone')");
    expect(dashboardSource).toContain("z.status==='fort'");
    expect(dashboardSource).toContain("source:'expansion'");
  });

  it("audits every routed Local SEO view and its injected helper copy", () => {
    const localSeoFunctions = [
      "renderLocalSEO",
      "renderLocalSEOZones",
      "renderLocalLandingOpportunities",
      "renderLocalDominationMaps",
      "renderLocalCompetitorMap",
      "renderLocalSEOReviews",
      "renderLocalSEOGBP",
      "renderLocalPresenceOptimizer",
    ];
    const directKeys = new Set(
      localSeoFunctions.flatMap((name) => [...translationKeysInFunction(name)]),
    );
    expect(directKeys.size).toBeGreaterThan(0);
    for (const key of directKeys) {
      expect(englishKeys.has(key), `Local SEO should translate "${key}"`).toBe(true);
    }

    const injectedPanelKeys = [
      "🤖 Générateur de posts GBP IA",
      "Génération automatique de posts GBP par IA — planification, adaptation saisonnière et publication directe sur Google.",
      "Génération IA et publication directe sur Google — bientôt disponible.",
      "Nom exact de l’établissement",
      "Grille 5×5",
      "Grille 7×7",
      "Grille 9×9 (Ultra)",
      "Résultats Google Maps déjà enregistrés",
      "Cette vue réutilise les résultats en base et ne lance aucune nouvelle recherche payante.",
      "Aucun post programmé ce mois-ci.",
      "APERÇU — GOOGLE BUSINESS PROFILE",
      "J’ai relu et validé ce contenu pour publication à la date choisie.",
      "La génération prépare un brouillon. Vérifiez le texte, les médias et la fiche avant d’enregistrer ou de programmer.",
      "Concurrents identifiés dans votre zone : {count}. {packCount} en Local Pack Google. Concurrent dominant : <strong>{name}</strong> (autorité {authority}/100).",
      "Note moyenne : <strong>{rating}⭐</strong> · Score réputation : <strong>{score}/100</strong> · {pending} réponse(s) IA en attente · {alerts} alerte(s) critique(s)",
      "Critères de présence enregistrés.",
    ];
    for (const key of injectedPanelKeys) {
      expect(englishKeys.has(key), `Local SEO injected copy should translate "${key}"`).toBe(true);
    }

    expect(dashboardSource).toContain("escHtml(item.title)");
    expect(dashboardSource).toContain("escHtml(item.evidence)");
    expect(dashboardSource).toContain("escHtml(a.suggestedReply)");
    expect(dashboardSource).toContain("escHtml(_reviewText)");
    expect(dashboardSource).toContain("escHtml(c.name)");
    expect(dashboardSource).toContain("text:      r.comment || ''");
    expect(dashboardSource).toContain("value=\"${escHtml(_gKeyword)}\"");
    expect(dashboardSource).toContain("postType: document.getElementById('fp-gbp-post-type')?.value || 'standard'");
  });

  it("audits every Monitors view, panel, and action while preserving technical values", () => {
    const monitorFunctions = [
      "renderMonitors",
      "renderMonitorsPerformance",
      "renderMonitorsIncidents",
      "renderMonitorsConfig",
      "renderMonitorsSLA",
      "renderGlobalMonitoringPanel",
      "renderBetterStackSlaPanel",
      "openMonitorPanel",
      "renderNewEndpointPanel",
      "setupNewEndpointPanel",
      "renderNewMonitorPanel",
      "setupNewMonitorPanel",
      "syncBulkBar",
      "bindSectionEvents",
      "bindBulkBarEvents",
      "statusLabel",
      "_applyMonitorPreset",
      "_editMaintWindow",
      "_openMonitorEmailAlerts",
      "_fpSlaViewPage",
    ];
    const directKeys = new Set(
      monitorFunctions.flatMap((name) => [...translationKeysInFunction(name)]),
    );
    expect(directKeys.size).toBeGreaterThan(0);
    for (const key of directKeys) {
      expect(englishKeys.has(key), `Monitors should translate "${key}"`).toBe(true);
    }

    const expectedTranslations = new Map([
      ["Vérification de {count} monitor(s) en cours…", "Checking {count} monitor(s)…"],
      ["Vérification terminée — {ok} réussis ; {failed} échecs.", "Check complete — {ok} succeeded; {failed} failed."],
      ["Endpoint ajouté : {name}", "Endpoint added: {name}"],
      ["Monitor créé pour {url}", "Monitor created for {url}"],
      ["Indisponibilité totale ce mois", "Total downtime this month"],
    ]);
    for (const [key, translation] of expectedTranslations) {
      expect(englishTranslations.get(key), `Monitors translation for "${key}"`).toBe(translation);
    }

    const configTemplateKeys = [
      "E-commerce",
      "API / SaaS",
      "Local Biz",
      "Corporate",
      "Vérif. panier + paiement · LCP <2s · SSL",
      "Endpoints + webhooks + latence <200ms",
      "GBP + avis + présence locale + speed mobile",
      "Multi-régions + SLA 99.9% + alertes équipe",
      "Uptime",
      "Checkout",
      "Stripe",
      "SSL",
      "CWV",
      "Endpoints",
      "Webhooks",
      "Auth",
      "Rate limits",
      "Mobile",
      "GBP",
      "DNS",
      "Régions",
      "SLA",
      "Incidents",
      "Déploiement hebdo",
      "Dimanche 02:00–04:00",
      "Tous les sites",
      "Maintenance OVH",
      "Lundi 23:00–01:00",
      "🇫🇷 France (Paris)",
      "🇩🇪 Allemagne",
      "🇬🇧 Royaume-Uni",
      "🇳🇱 Pays-Bas",
      "🇺🇸 USA (East)",
      "🌏 Asie-Pacifique",
      "Début",
      "Détecté",
      "Notifié",
      "Résolu",
      "En attente",
      "Hors SLA",
      "À risque",
      "Conforme",
      "Impossible de charger le rapport SLA Better Stack.",
      "Lent",
    ];
    for (const key of configTemplateKeys) {
      expect(englishKeys.has(key), `Monitor configuration should translate "${key}"`).toBe(true);
    }
    for (const binding of [
      "fpT(p.name)",
      "fpT(p.desc)",
      "fpT(c)",
      "fpT(w.name)",
      "fpT(w.schedule)",
      "fpT(w.sites)",
      "fpT(r.name)",
      "fpT(step.label)",
      "fpT(risk)",
      "status.textContent = err?.message || fpT('Impossible de charger le rapport SLA Better Stack.')",
      'data-pname="${escHtml(p.name)}"',
      'data-pchecks="${p.checks.map(c => escHtml(c)).join(\',\')}"',
      'data-wname="${escHtml(w.name)}"',
      'data-wsched="${escHtml(w.schedule)}"',
    ]) {
      expect(dashboardSource).toContain(binding);
    }

    expect(dashboardSource).toContain("var currentEmail = (STATE.me && STATE.me.email) || '';");
    expect(dashboardSource).toContain("apiAction('PATCH', '/api/me/prefs', { settings: { alertEmail: value } });");
    expect(dashboardSource).toContain("badge(inc.type, '#94a3b8')");
    expect(dashboardSource).toContain("rootCause: ev.message ||");
    expect(dashboardSource).toContain("aiAnalysis: ev.message ||");
    expect(dashboardSource).toContain("escHtml(inc.rootCause)");
    expect(dashboardSource).toContain("escHtml(inc.aiAnalysis)");
    expect(dashboardSource).toContain("escHtml(inc.impact)");
    expect(dashboardSource).toContain("escHtml(m.name)");
    expect(dashboardSource).toContain("escHtml(m.url)");
    expect(dashboardSource).toContain("region.region + ': '");
    expect(dashboardSource).toContain("m.monitorName + ' (' + m.status + ')'");
    expect(dashboardSource).toContain("data-pchecks=\"${p.checks.map(c => escHtml(c)).join(',')}\"");
    expect(dashboardSource).toContain("apiAction('PATCH', `/api/monitors/${id}`, { alertEmail: emailVal })");
    expect(dashboardSource).toContain("apiAction('POST', `/api/monitors/${m.id}/check`)");
  });

  it("audits Reports views while preserving report, customer, and AI data", () => {
    const reportFunctions = [
      "renderReports",
      "renderNewReportPanel",
      "setupNewReportPanel",
      "renderAgencyPacksPanel",
    ];
    const directKeys = new Set(
      reportFunctions.flatMap((name) => [...translationKeysInFunction(name)]),
    );
    expect(directKeys.size).toBeGreaterThan(0);
    for (const key of directKeys) {
      expect(englishKeys.has(key), `Reports should translate "${key}"`).toBe(true);
    }

    const reportSubnavKeys = [
      "Centre de rapports",
      "Exécutif",
      "SEO",
      "Surveillance",
      "Local SEO",
      "Conversion",
      "Marque blanche",
      "Rapports IA",
    ];
    for (const key of reportSubnavKeys) {
      expect(englishKeys.has(key), `Reports sub-navigation should translate "${key}"`).toBe(true);
    }
    expect(dashboardSource).toContain("STATE.route === 'reports' || STATE.route === 'competitor' || STATE.route === 'local-seo' ? fpT(t.label) : t.label");

    const dynamicReportKeys = [
      "Simple",
      "Client",
      "Avancé",
      "2–3 pages · KPIs essentiels",
      "5–8 pages · standard",
      "10+ pages · analyse complète",
      "Rapport SEO",
      "Rapport Exécutif",
      "Monitoring SLA",
      "Rapport Conversion",
      "Local SEO",
      "Rapport IA Lab",
      "Score, positions, recommandations",
      "Vue globale business et KPIs",
      "Disponibilité et temps de réponse",
      "Funnel et taux de conversion",
      "GBP, avis et présence locale",
      "Analyse IA et recommandations",
      "Logo agence",
      "Couleur principale",
      "Couleur secondaire",
      "Nom agence",
      "Site agence",
      "Pied de page custom",
      "Signature email",
      "Domaine portail",
      "Typographie",
      "Export White-Label",
      "Appels depuis GBP",
      "Itineraires demandes",
      "Visites fiche",
      "Note moyenne",
      "Avis sans reponse",
      "Photos publiées",
      "Moyen",
      "Fort",
      "Tres fort",
      "Sites critiques à corriger",
      "Certains sites ont un score SEO inférieur à 50/100. Corrigez en priorité les balises manquantes et la vitesse mobile.",
      "À prioriser",
      "Monitors DOWN",
      "Des monitors sont actuellement hors ligne. Chaque minute de downtime impacte votre SEO et vos conversions.",
      "SLA protégé",
      "Optimiser Google Business Profile",
      "Votre fiche GBP n'est pas complète à 100%. Complétez photos, horaires et description, puis mesurez l’évolution de la visibilité locale.",
      "À mesurer",
      "Priorité absolue : conversion mobile",
      "Le taux de conversion mobile est 2.8x inférieur au desktop. Simplifier le formulaire de contact pourrait générer +12 clients/mois.",
      "+12 clients/mois",
      "Accélérer le Local SEO Maps",
      "Renforcez la fiche GBP et les avis, puis comparez la visibilité locale mesurée avant et après optimisation.",
      "Reconquérir le trafic référent",
      "Les référents ont baissé de -4% avec un taux de rebond de 58%. Revoir les partenariats et créer du contenu co-marque ciblé.",
      "+400 sessions/mois",
      "Exemple — friction de conversion",
      "Démo uniquement : les abandons de formulaire peuvent signaler un point de friction. Le revenu associé reste non mesuré sans données de commandes reliées.",
      "Corriger le formulaire",
      "Conversion mobile critique (0.12%)",
      "Le segment mobile (58% du trafic) convertit 14× moins bien que le desktop. La page Tarifs affiche 61% d'abandons. Chaque point de conversion mobile = +47 clients/mois.",
      "Plan UX mobile",
      "Opportunite Maps non capturee",
      "Google Maps est votre source la plus qualitative (conv. 3.2%, qualite 88/100) mais represente seulement 14% du trafic. Potentiel x3 si GBP renforce et avis manages.",
      "Renforcer GBP",
      "Declin referents accelere",
      "Le trafic referent a baisse 4% avec un taux de rebond 58% — source la moins qualitative. 3 partenaires cles ont reduit ou supprime leurs liens entrants ce trimestre.",
      "Analyser les referents",
      "Acceleration trafic organique",
      "Le trafic organique a progresse de +130% en 8 mois — acceleration confirmee depuis mars. Le 15e arrondissement domine deja 4 mots-cles cles. Continuer sur cette lancee.",
      "Amplifier la strategie",
      "Conversion",
      "Mobile UX",
      "Trafic",
      "Croissance",
      "Trafic M+3",
      "Conversion M+3",
      "Revenue M+3",
      "Local SEO M+3",
      "Avis Google M+3",
      "Avec maintien strategie SEO actuelle",
      "Si plan CRO mobile execute en juin",
      "Combinaison trafic + conversion optimisee",
      "Si renforcement GBP confirme en juin",
      "Avec réponse systématique aux avis",
      "IA",
      "Insight IA",
      "Analyser",
      "Priorité haute",
      "Rapport complet PDF",
      "Plan actions prioritaires",
      "Partager au client",
      "Générer rapport SEO PDF",
      "Plan mots-clés",
      "Optimiser les priorités",
      "Rapport local complet",
      "Plan zones cibles",
      "Répondre aux avis",
      "Rapport CRO complet",
      "Plan conversion mobile",
      "Générer rapport client",
      "Générer rapport groupe",
      "Config white-label",
      "Ajouter un client",
      "Rapport narratif complet",
      "Exporter en PDF",
      "Programmer envoi auto",
    ];
    for (const key of dynamicReportKeys) {
      expect(englishKeys.has(key), `Dynamic Reports text should translate "${key}"`).toBe(true);
    }

    const expectedTranslations = new Map([
      ["Centre de rapports", "Reports center"],
      ["Packs de rapports d’agence", "Agency reporting packs"],
      ["Générer rapport SEO PDF", "Generate SEO PDF report"],
      ["Rapport {format} « {name} » généré{notes}.", "{format} report “{name}” generated{notes}."],
      ["Sites sous SLA", "Sites below SLA"],
    ]);
    for (const [key, translation] of expectedTranslations) {
      expect(englishTranslations.get(key), `Reports translation for "${key}"`).toBe(translation);
    }

    for (const binding of [
      "apiAction('POST', '/api/reports', { name, auditId, format, whiteLabel, branding, reportType, meetingNotes, dateStart, dateEnd })",
      "clientName,\n              auditId: auditSelect.value || undefined,",
      "name: pack.name",
      "templateKey: pack.templateKey",
      "label.textContent = `${pack.name} — ${pack.description}`;",
      "escHtml(r.name)",
      "escHtml(c.name)",
      "aiInsightsArePreview || defaults[field] ? fpT(ins[field]) : ins[field]",
      "aiInsightsArePreview ? fpT(ins.body) : ins.body",
      "const reportType    = (STATE.settings && STATE.settings.reportType) || 'client';",
    ]) {
      expect(dashboardSource).toContain(binding);
    }
  });

  it("audits Competitors views while preserving provider, customer, and AI values", () => {
    const expectedKeys = [
      "Comparaison IA",
      "Ajoutez d’abord des concurrents puis lancez une analyse IA.",
      "Comparaison IA — Vous vs Concurrent",
      "Lancez une analyse IA sur un concurrent pour obtenir la comparaison détaillée.",
      "Analyse en cours…",
      "Analyser",
      "Concurrent analysé :",
      "Actualiser l’analyse",
      "Cliquez sur Analyser sur ce concurrent pour lancer l’analyse IA.",
      "Analyser {name}",
      "Ce que vous faites mieux",
      "Non déterminé — contexte de votre entreprise non fourni",
      "Ce qu’ils font mieux",
      "Aucun avantage détecté",
      "Opportunités recommandées",
      "Créée",
      "Créer une mission",
      "Matrice fonctionnalités",
      "Fonctionnalité",
      "Vous",
      "Concurrent",
      "Forces détectées",
      "Faiblesses détectées",
      "Non déterminé",
      "Positionnement",
      "Sources & niveau de confiance",
      "Analyse IA —",
      "Proposition de valeur",
      "Tarification",
      "Fonctionnalités détectées",
      "Forces",
      "{count} changement(s) depuis la dernière analyse",
      "Voir comparaison",
      "Actualiser",
    ];
    const referencedKeys = translationKeysInFunction("renderCompetitor");
    for (const key of expectedKeys) {
      expect(referencedKeys.has(key), `Competitors should translate "${key}"`).toBe(true);
      expect(englishKeys.has(key), `English catalogue should contain "${key}"`).toBe(true);
    }

    const analysisLabels = [
      "Proposition de valeur",
      "Cible",
      "Produits / Services",
      "Tarification",
      "Essai gratuit / Démo",
    ];
    for (const label of analysisLabels) {
      expect(englishKeys.has(label), `Competitor analysis label should translate "${label}"`).toBe(true);
    }
    for (const label of ["Aperçu", "Mots-clés", "Trafic", "Backlinks", "Local", "Alertes", "Comparaison"]) {
      expect(englishKeys.has(label), `Competitor sub-navigation should translate "${label}"`).toBe(true);
    }
    expect(objectKeysInVariable("SUB_NAVS")).toContain("competitor");
    expect(dashboardSource).toContain("STATE.route === 'reports' || STATE.route === 'competitor' || STATE.route === 'local-seo' ? fpT(t.label) : t.label");

    for (const binding of [
      "escHtml(String(op.title||''))",
      "escHtml(String(op.description||''))",
      "escHtml(String(s))",
      "escHtml(String(row.feature||''))",
      "escHtml(String(row.you||'—'))",
      "escHtml(String(row.competitor||'—'))",
      "escHtml(String(c.dataError))",
      "displayMetric(c.domainRating)",
      "displayMetric(c.keywords)",
      "displayMetric(c.traffic)",
      "escHtml(_displayNd(_a.value_prop))",
      "escHtml(_displayNd(_a.pricing))",
      "const _displayNd = value => !value || String(value) === _nd ? fpT(_nd) : String(value);",
    ]) {
      expect(dashboardSource).toContain(binding);
    }
  });

  it("audits Growth views, async copy, and customer or AI content boundaries", () => {
    for (const route of ["keywords", "projections", "objectives"]) {
      expect(dashboardSource).toContain(`if (sub === '${route}')`);
    }
    expect(dashboardSource).toContain("function renderGrowthCommandCenter()");
    expect(dashboardSource).toContain("function renderNewObjectivePanel()");
    expect(dashboardSource).toContain("function setupNewObjectivePanel()");

    const expectedByFunction: Record<string, string[]> = {
      renderGrowthProjections: [
        "Tendance mesurée {trend} : {points} pts estimés sur 30 jours. Score projeté : {score}/100 sur 60 jours, selon la tendance observée",
        "Aucune Quick Win active issue des données disponibles.",
        "En cours",
        "À démarrer",
      ],
      renderGrowthObjectives: [
        "Objectifs T{quarter} {year}",
        "{count} objectifs · {days} jours restants",
        "Sites suivis — quota plan ({count})",
        "Santé globale Q2 — {percent}%",
        "{count}/{total} objectifs sur la bonne trajectoire",
        "Votre trimestre est globalement positif : {onTrack} objectifs sur {total} sont en bonne voie. Attention aux {atRisk} objectifs à risque : monitors DOWN et avis Google nécessitent une action immédiate.",
        "{percent}% atteint",
        "Bilan Q{quarter} {year}",
      ],
      renderGrowthCommandCenter: [
        "Score SEO moyen : {score}/100. {monitorMessage} Exploitez les projections IA pour planifier votre croissance des 90 prochains jours.",
        "<strong>{count} monitor(s) DOWN</strong> — site(s) inaccessibles. Chaque minute de panne = perte de positionnement Google.",
        "<strong>{count} site(s)</strong> avec performance mobile < 60/100. Corriger = +{percent}% taux de contact estimé.",
        "Votre score actuel est {score}/100. De nombreuses optimisations techniques sont disponibles — commencez par les Quick Wins pour progresser rapidement.",
        "+{count} visites/mois",
        "{count} site inaccessible",
        "{count} sites inaccessibles",
        "{sites} — en panne.",
        "Performance mobile insuffisante sur {count} site",
        "Performance mobile insuffisante sur {count} sites",
        "Score < 60/100 — freine les conversions mobiles.",
        "Score SEO critique sur {count} site",
        "Score SEO critique sur {count} sites",
        "Score SEO < 60/100 — impact direct sur le positionnement.",
        "Taux de conversion faible : {rate}%",
        "En dessous de la moyenne secteur (2%). Optimisez vos CTAs et pages de destination.",
        "Visibilité locale insuffisante : {score}/100",
        "Votre présence dans les résultats locaux est faible. Optimisez Google Business Profile.",
      ],
      renderGrowthKeywords: [
        "Pages en recul",
        "Pages à faible CTR",
        "À vérifier : {validation}",
        "Aucune baisse significative détectée sur les pages analysées. Une synchronisation GSC récente est nécessaire pour comparer les deux périodes de 28 jours.",
        "<strong>{top3}</strong> mots-clés en Top 3, <strong>{top10}</strong> en Top 10. {gaining}{losing}",
      ],
      renderNewObjectivePanel: [
        "Valeur cible",
        "Prochaine action",
        "Enregistrer l'objectif",
      ],
      setupNewObjectivePanel: [
        "Entrez un libellé",
        "Objectif créé !",
        "Échec de l'enregistrement de l'objectif — réessayez.",
      ],
    };

    for (const [functionName, keys] of Object.entries(expectedByFunction)) {
      const referenced = translationKeysInFunction(functionName);
      for (const key of keys) {
        expect(referenced.has(key), `${functionName} should translate "${key}"`).toBe(true);
        expect(englishKeys.has(key), `Growth English catalogue should contain "${key}"`).toBe(true);
      }
    }

    for (const binding of [
      "escHtml(q.title)",
      "escHtml(co.title)",
      "escHtml(item.page)",
      "escHtml(item.recommendedAction || '')",
      "escHtml(strategy.summary)",
      "escHtml(action.title)",
      "escHtml(action.reason)",
      "escHtml(action.validation)",
      "escHtml(o.label||'Objectif')",
      "escHtml(o.next)",
      "escHtml(a.message||'')",
      "const sub = STATE.subRoute;",
    ]) {
      expect(dashboardSource).toContain(binding);
    }
    expect(dashboardSource).toContain("target.innerHTML = decayHtml + ctrHtml;");
    expect(dashboardSource).toContain("button.textContent = fpT('Recommandations générées')");
    expect(dashboardSource).toContain("fpT('⟳ Synchroniser…')");
    expect(dashboardSource).toContain("fpT('Objectif supprimé')");
  });

  it("audits Conversion routes, dynamic states, and customer data boundaries", () => {
    const expectedByFunction: Record<string, string[]> = {
      renderConversion: [
        "Bientôt disponible — visualisez votre entonnoir de conversion étape par étape depuis vos sources analytics.",
        "{hesitations} hésitations et {rageClicks} rage clicks détectés. Score UX mobile : {passed}/{total} points OK.",
        "CTA actuel : \"{cta}\"",
        "{count} opportunités observées",
        "Aucune prévision affichée : il faut des conversions observées et une période de référence suffisante.",
        "Taux de conversion observé : <strong>{rate}%</strong>. {health} Aucun gain financier n'est estimé sans revenus attribués.",
        "Taux global", "Pire chute", "Potentiel mobile", "Clients potentiels",
        "Entonnoir de conversion · 30 derniers jours", "Connectez analytics",
        "📱 Mobile vs 💻 Desktop", "Étape", "Écart", "⚡ Points de friction détectés",
        "Score friction :", "UX & Friction Lab — Pro requis",
        "Rage clicks, dead clicks, heatmaps de friction et analyse comportementale avancée.",
        "Opportunités majeures", "ce mois — critique", "abandon à mi-page", "En dessous du seuil",
        "Analyse de profondeur de scroll", "Rage clicks & Dead clicks détectés", "Checklist UX Mobile",
        "Tarifs (50–75%)", "Page formulaire", "Page contact", "Page accueil", "Page services",
        "Page tarifs", "Bouton Envoyer (inactif)", "Numéro de téléphone (non-cliquable)",
        "Logo partenaires", "Titre H2 (zone inactive)", "Colonne prix Pro vs Ultra",
        "🔥 Heatmap de friction — Page d'accueil", "CTA non cliquable",
        "CTA Intelligence — Pro requis",
        "Analyse de visibilité, CTR par CTA, performance mobile et suggestions IA.",
        "CTAs analysés", "CTAs critiques", "sur toutes vos pages",
        "visibilité < 50 ou CTR < 0.5%", "Meilleur CTR", "Nous contacter — Header",
        "CTR mobile moyen", "vs 1.63% desktop", "vs taux desktop actuel",
        "Performance de chaque CTA", "CTA", "Page", "Visibilité", "CTR Global",
        "CTR Mobile", "Position", "Impact", "Action", "Above fold", "Below fold",
        "Header", "Mid-page", "Hero", "Bottom",
        "🧪 Suggestions de tests A/B pour vos CTAs", "Gain estimé : {gain}", "Effort :",
        "Activer l'add-on", "Aucune opportunité observée",
        "A : {aExposures} expositions / {aConversions} conversions · B : {bExposures} / {bConversions}",
        "Observations fondées sur les événements réellement collectés. Les estimations financières et prévisions restent masquées tant qu’aucune conversion ni donnée de revenu n’est reliée.",
        "Les recommandations apparaîtront après la collecte de signaux comportementaux réels. Aucun taux ou gain n’est inventé.",
        "Examiner les observations", "Créer une mission", "Revoir les données",
        "Signaux observés", "30 derniers jours", "Sessions affectées",
        "sessions distinctes par signal", "Confiance élevée", "au moins 30 sessions",
        "Gain financier", "aucune conversion/revenu attribué",
        "Signaux comportementaux et actions CRO", "Mission", "🧪 Expériences A/B",
        "Créer une expérience", "Aucune expérience",
        "Créez un brouillon. Le démarrage reste bloqué tant que le nouveau snippet n’a pas confirmé sa collecte.",
        "Démarrer", "Arrêter", "Supprimer", "📈 Prévision de conversion",
        "{count} clients", "🎯 Objectif M+3 :", "clients/mois", "Levier principal",
        "Réduire le taux de rebond mobile de 32% à 22% = +8 clients/mois estimés",
        "Tendance", "+0.06 pts/mois en moyenne · Cohérent avec les actions CRO en cours",
        "Risque", "Sans optimisation formulaire, plafond estimé à 0.38% (vs 0.41% ciblé)",
        "Impact revenus", "Non mesuré; aucun revenu n’est attribué aux événements observés",
        "Conversion Command Center", "Gain estimé : {gain}", "Clics→Pages",
      ],
      renderConversionHeatmap: [
        "Heatmap & Analyse UX",
        "Me notifier",
        "Visualisez en temps réel où cliquent vos visiteurs, leurs mouvements de souris et zones de friction — page par page.",
      ],
      _fpConvLoadingSkeleton: ["Chargement des données…"],
      _fpConvErrorSkeleton: ["Erreur de chargement", "Réessayer"],
      renderGA4Conversion: [
        "Événements de conversion, revenus et landing pages — {days} derniers jours",
        "Aucun événement de conversion configuré ou aucune conversion enregistrée sur les {days} derniers jours.",
        "Conversions totales",
        "Moy./conv. {revenue}",
        "Landing pages — conversions",
        "Sources — conversions",
        "Appareils — conversions",
        "Géographie — conversions",
        "Événements de conversion, revenus et landing pages",
        "Fonctionnalité Premium",
        "La Conversion GA4 est réservée aux abonnés actifs. Reprenez un abonnement pour accéder à vos données.",
        "Choisir un abonnement", "7 jours", "30 jours", "90 jours", "Actualiser",
        "Connexion GA4 en cours de configuration",
        "Votre compte Google est connecté. La découverte de votre propriété GA4 est en cours — cela prend généralement moins d’une minute.",
        "Google Analytics 4 non connecté",
        "Connectez GA4 pour afficher vos conversions réelles, revenus, landing pages et analyses par source.",
        "Aucune conversion GA4 sur la période",
        "Aucun événement de conversion configuré ou aucune conversion enregistrée sur les {days} derniers jours.",
        "Configurez des <strong>Key Events</strong> dans GA4 pour commencer le suivi.",
        "{change}{percent}% taux vs période préc.",
        "Taux de conversion", "{count} sessions", "Revenus GA4", "Moy./conv. {revenue}",
        "Revenus non configurés", "Utilisateurs", "{count} type(s) d’événement",
        "Aucun événement de conversion trouvé.",
        "Configurez des <strong>Key Events</strong> dans votre propriété GA4.",
        "Landing pages — conversions", "Sources — conversions", "Appareils — conversions",
        "Géographie — conversions", "conversions · {count} sessions", "{rate} taux",
      ],
    };
    for (const [functionName, keys] of Object.entries(expectedByFunction)) {
      const referenced = translationKeysInFunction(functionName);
      for (const key of keys) {
        expect(referenced.has(key), `${functionName} should translate "${key}"`).toBe(true);
        expect(englishKeys.has(key), `Conversion English catalogue should contain "${key}"`).toBe(true);
      }
    }

    const dynamicCatalogKeys = [
      "Événement", "Conversions", "Revenu", "Revenu moy./conv.",
      "Page", "Sessions", "Utilisateurs", "Taux", "Canal", "Source / Medium", "Pays", "Ville",
      "Visibilité du CTA principal", "Clarté de l'offre (headline)", "Confiance (avis + logos)",
      "Vitesse perçue mobile", "Formulaire de contact", "CTA trop bas dans la page",
      "Message améliorable", "Bien positionné", "LCP > 2.5s", "Simple et efficace",
      "Header / Navigation", "Section services", "CTA \"Nous contacter\"", "Section avis clients",
      "Footer", "Élevée", "Moyenne", "Critique", "Faible",
      "72% des clics se perdent dans le menu", "Les visiteurs scrollent sans s'arrêter",
      "Non visible par 88% des visiteurs", "Bien lue, génère de la confiance",
      "Peu utilisé mais fonctionnel",
    ];
    for (const key of dynamicCatalogKeys) {
      expect(englishKeys.has(key), `Conversion dynamic label should translate "${key}"`).toBe(true);
    }

    const conversionActionMessages = [
      "Sélectionnez un site avec le snippet comportemental installé.",
      "Chemin de page à tester (ex. /tarifs):",
      "Nom de l’expérience:",
      "Sélecteur CSS de l’élément à modifier (ex. #cta-principal):",
      "Sélecteur CSS de conversion (ex. form#contact button[type=submit]):",
      "Texte témoin affiché avant toute modification du site:",
      "Proposition fondée sur les signaux observés. Raison : ",
      " Mesure : ",
      "Continuer sans suggestion IA et saisir les textes manuellement ?",
      "Hypothèse à valider:",
      "Texte de la variante B:",
      "Brouillon créé. Réinstallez le nouveau snippet, puis démarrez le test.",
      "Expérience démarrée : les variantes seront servies par le snippet.",
      "Expérience arrêtée.",
      "Supprimer définitivement ce brouillon ou ce test arrêté ?",
      "Expérience supprimée.",
      "Les événements comportementaux sont temporairement indisponibles.",
      "Fuite marquée comme résolue",
      "Nouveau rapport",
      "Optimiser CRO — {page}",
    ];
    for (const key of conversionActionMessages) {
      expect(
        dashboardSource.includes(`fpT('${key}'`) || dashboardSource.includes(`fpT("${key}"`),
        `Conversion action should translate "${key}"`,
      ).toBe(true);
      expect(englishKeys.has(key), `Conversion action English catalogue should contain "${key}"`).toBe(true);
    }

    const expectedTranslations = new Map([
      ["{amount}€/mois", "€{amount}/month"],
      ["{count} opportunités observées", "{count} observed opportunities"],
      ["CTA actuel : \"{cta}\"", "Current CTA: \"{cta}\""],
    ]);
    for (const [key, translation] of expectedTranslations) {
      expect(englishTranslations.get(key), `Conversion translation for "${key}"`).toBe(translation);
    }

    for (const binding of [
      "escHtml(l.recommendation)",
      "escHtml(ev.name)",
      "escHtml(p.path)",
      "escHtml(s.channel)",
      "escHtml(s.sourceMedium)",
      "escHtml(d.device)",
      "escHtml(g.country)",
      "escHtml(g.city)",
      "escHtml(ab.cta)",
      "escHtml(ab.varB)",
      "escHtml(c.name)",
      "escHtml(c.page)",
      "escHtml(positionLabel)",
      "escHtml(isPreviewClickData ? previewClickLabels[c.page] || c.page : c.page)",
      "escHtml(isPreviewClickData ? previewClickLabels[c.zone] || c.zone : c.zone)",
      "fpT('Optimiser CRO — {page}'",
      "const positionLabel = ({ 'Above fold':fpT('Above fold'), 'Below fold':fpT('Below fold'), Header:fpT('Header'), 'Mid-page':fpT('Mid-page'), Hero:fpT('Hero'), Bottom:fpT('Bottom') })[c.pos] || c.pos;",
      "const sub = STATE.subRoute;",
      "['funnel','ux-lab','cta','revenue-leak','cro'].includes(sub)",
      "impact:'Élevé'",
      "r?.error || fpT('Erreur')",
    ]) {
      expect(dashboardSource).toContain(binding);
    }

    const conversionAddon = sourceFiles.find(({ fileName }) => fileName === "conversion-opportunity-engine-addon.js")?.source.text || "";
    expect(conversionAddon).toContain("escapeHtml(item.landingPage)");
    expect(conversionAddon).toContain('String(error?.message || t("Impossible de charger les données GA4."))');
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
