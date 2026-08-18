/**
 * ai-intent-tools.test.ts — Task #608 fixes 2, 3, 4, 5.
 *
 * Couvre :
 *  - Fix 5 : selectToolsForIntent(HYBRID) sans famille détectée → set restreint
 *    URL + Audit + Missions cœur (≤15 outils), jamais les 44+ outils, jamais
 *    calendar/monitors/recommendations, jamais d'outil destructif.
 *  - Fix 4 : analyze_site existe dans URL_TOOLS avec la bonne sémantique.
 *  - Fixes 2 & 3 : STRICT_AI_RULE contient la discipline de portée (contraintes
 *    explicites respectées à la lettre, vérification finale) et l'interdiction
 *    du template unique.
 */

import { describe, it, expect } from "vitest";
import { selectToolsForIntent, _detectToolFamilies, STRICT_AI_RULE } from "./ai.js";
import { URL_TOOLS, URL_ARG_SCHEMAS } from "../agent/url-tools.js";

describe("Fix 5 — HYBRID sans famille détectée", () => {
  // Message HYBRID typique sans mot-clé de famille : verbe d'action + domaine nu
  const msg = "Regarde flowpoint.pro et ajoute ce qui manque";

  it("le message ne matche aucune famille (précondition du test)", () => {
    expect(_detectToolFamilies(msg)).toEqual([]);
  });

  it("retourne au plus 15 outils (jamais les 44+)", () => {
    const tools = selectToolsForIntent("HYBRID", msg);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.length).toBeLessThanOrEqual(15);
  });

  it("contient URL + audits + missions cœur", () => {
    const names = selectToolsForIntent("HYBRID", msg).map(t => t.name);
    expect(names).toContain("analyze_url");
    expect(names).toContain("analyze_site");
    expect(names).toContain("run_audit");
    expect(names).toContain("search_audits");
    expect(names).toContain("create_mission");
    expect(names).toContain("list_missions");
  });

  it("n'expose NI calendar, NI monitors, NI recommendations, NI outils destructifs", () => {
    const names = selectToolsForIntent("HYBRID", msg).map(t => t.name);
    expect(names).not.toContain("create_calendar_event");
    expect(names).not.toContain("search_calendar_event");
    expect(names).not.toContain("search_monitors");
    expect(names).not.toContain("delete_monitor");
    expect(names).not.toContain("generate_recommendations");
    expect(names.filter(n => n.startsWith("delete_"))).toEqual([]);
    expect(names).not.toContain("export_audit");
    expect(names).not.toContain("navigate_to");
  });

  it("aucun doublon dans le set retourné", () => {
    const names = selectToolsForIntent("HYBRID", msg).map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("Fix 5 — HYBRID avec famille explicite garde le comportement ciblé", () => {
  it("mot-clé mission → outils missions présents", () => {
    const msg = "Regarde https://exemple.com et crée une mission pour corriger";
    const names = selectToolsForIntent("HYBRID", msg).map(t => t.name);
    expect(names).toContain("create_mission");
    expect(names).toContain("analyze_url");
  });

  it("mot-clé calendrier → outils calendar exposés uniquement sur signal explicite", () => {
    const msg = "Regarde https://exemple.com et ajoute un événement au calendrier demain";
    const names = selectToolsForIntent("HYBRID", msg).map(t => t.name);
    expect(names).toContain("create_calendar_event");
  });
});

describe("Fix 5 — les autres intents ne régressent pas", () => {
  it("GENERAL_KNOWLEDGE / HYPOTHETICAL → aucun outil", () => {
    expect(selectToolsForIntent("GENERAL_KNOWLEDGE", "c'est quoi le SEO ?")).toEqual([]);
    expect(selectToolsForIntent("HYPOTHETICAL", "imagine un site parfait")).toEqual([]);
  });

  it("EXTERNAL_RESEARCH → URL + lectures audit/reco, pas d'écriture", () => {
    const tools = selectToolsForIntent("EXTERNAL_RESEARCH", "que dit le site https://exemple.com ?");
    const names = tools.map(t => t.name);
    expect(names).toContain("analyze_url");
    expect(tools.every(t => !t.isWrite)).toBe(true);
  });

  it("FLOWPOINT_READ sans famille → uniquement des lectures", () => {
    const tools = selectToolsForIntent("FLOWPOINT_READ", "où en est mon compte ?");
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.every(t => !t.isWrite)).toBe(true);
  });
});

describe("Fix 4 — outil analyze_site (crawl multi-pages)", () => {
  const analyzeSite = URL_TOOLS.find(t => t.name === "analyze_site");

  it("existe, lecture seule, permission web.read, sans confirmation", () => {
    expect(analyzeSite).toBeDefined();
    expect(analyzeSite!.isWrite).toBe(false);
    expect(analyzeSite!.requiredPermission).toBe("web.read");
    expect(analyzeSite!.confirmationLevel).toBe("none");
  });

  it("sa description annonce le crawl multi-pages (8 pages max) et le respect de robots.txt", () => {
    expect(analyzeSite!.description).toMatch(/8 pages/i);
    expect(analyzeSite!.description).toMatch(/robots\.txt/i);
    expect(analyzeSite!.description).toMatch(/pages réellement récupérées/i);
  });

  it("schéma d'arguments : URL valide acceptée, URL invalide refusée", () => {
    const schema = URL_ARG_SCHEMAS["analyze_site"]!;
    expect(schema.safeParse({ url: "https://exemple.com" }).success).toBe(true);
    expect(schema.safeParse({ url: "exemple.com", purpose: "seo" }).success).toBe(true);
    expect(schema.safeParse({ url: "javascript:alert(1)" }).success).toBe(false);
    expect(schema.safeParse({ url: "" }).success).toBe(false);
  });

  it("analyze_url reste mono-page (pas de crawl) dans sa description", () => {
    const analyzeUrl = URL_TOOLS.find(t => t.name === "analyze_url");
    expect(analyzeUrl).toBeDefined();
    expect(analyzeUrl!.description).toMatch(/une seule page|pas de crawl/i);
  });
});

describe("Fixes 2 & 3 — STRICT_AI_RULE : discipline de portée et variété de format", () => {
  it("exige le respect À LA LETTRE des contraintes explicites (exactement N, en X phrases)", () => {
    expect(STRICT_AI_RULE).toMatch(/DISCIPLINE DE PORTÉE/);
    expect(STRICT_AI_RULE).toMatch(/exactement N/i);
    expect(STRICT_AI_RULE).toMatch(/À LA LETTRE/);
    expect(STRICT_AI_RULE).toMatch(/en X phrases/i);
  });

  it("interdit les sections non demandées (Actions concrètes, Prochaines étapes)", () => {
    expect(STRICT_AI_RULE).toMatch(/JAMAIS de section non demandée/i);
    expect(STRICT_AI_RULE).toMatch(/Actions concrètes/);
    expect(STRICT_AI_RULE).toMatch(/Prochaines étapes/);
  });

  it("impose une vérification finale avant chaque réponse", () => {
    expect(STRICT_AI_RULE).toMatch(/VÉRIFICATION FINALE OBLIGATOIRE/);
    expect(STRICT_AI_RULE).toMatch(/rien de plus, rien de moins/i);
  });

  it("interdit le template unique et impose un format adapté à la nature de la demande", () => {
    expect(STRICT_AI_RULE).toMatch(/AUCUN TEMPLATE PAR DÉFAUT/);
    expect(STRICT_AI_RULE).toMatch(/INTERDIT de plaquer la structure/);
    expect(STRICT_AI_RULE).toMatch(/Diagnostic causal/i);
    expect(STRICT_AI_RULE).toMatch(/Comparaison/);
  });

  it("le plafond de 3 priorités cède devant une contrainte utilisateur explicite", () => {
    expect(STRICT_AI_RULE).toMatch(/3 PRIORITÉS MAXIMUM \(sauf contrainte explicite différente\)/);
    expect(STRICT_AI_RULE).toMatch(/SON nombre remplace ce plafond/);
  });

  it("les actions annexes ne sont proposées que si la demande appelle des conseils", () => {
    expect(STRICT_AI_RULE).toMatch(/UNIQUEMENT si la demande appelle des conseils/i);
  });
});
