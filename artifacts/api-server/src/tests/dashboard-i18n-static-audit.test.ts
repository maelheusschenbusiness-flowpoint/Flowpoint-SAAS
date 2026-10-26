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
