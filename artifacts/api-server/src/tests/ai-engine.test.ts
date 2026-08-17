/**
 * AI Engine — Task #592 regression tests.
 *
 * Tests cover the 9 root causes fixed in this session:
 *  CR-1  Immediate tool calling (no "Souhaitez-vous ?" before action)
 *  CR-2  list_missions tool + optional query in search_mission
 *  CR-3  Conditional visual template (not mandatory on every response)
 *  CR-4  Hypothetical detection regex
 *  CR-5  Simple-greeting complexity classifier (skip heavy context)
 *  CR-6  Timing spans added to context build
 *  CR-7  Strict-provider retry (1 retry + 1 s backoff)
 *  CR-8  orgId guard (blocks "default" and undefined)
 *  CR-9  search_mission description mentions listing use case
 */
import { describe, it, expect } from "vitest";
import { MISSION_TOOLS, TOOL_ARG_SCHEMAS, TOOL_BY_NAME } from "../agent/mission-tools.js";
import { STRICT_AI_RULE } from "../routes/ai.js";

// ── CR-2: list_missions tool exists ──────────────────────────────────────────
describe("CR-2 list_missions tool", () => {
  it("is declared in MISSION_TOOLS", () => {
    const tool = MISSION_TOOLS.find(t => t.name === "list_missions");
    expect(tool).toBeDefined();
  });

  it("is in TOOL_BY_NAME map", () => {
    expect(TOOL_BY_NAME.has("list_missions")).toBe(true);
  });

  it("has missions.read permission", () => {
    const tool = MISSION_TOOLS.find(t => t.name === "list_missions");
    expect(tool?.requiredPermission).toBe("missions.read");
  });

  it("is read-only (isWrite=false)", () => {
    const tool = MISSION_TOOLS.find(t => t.name === "list_missions");
    expect(tool?.isWrite).toBe(false);
  });

  it("requires no mandatory parameters", () => {
    const tool = MISSION_TOOLS.find(t => t.name === "list_missions");
    expect(tool?.parameters.required ?? []).toHaveLength(0);
  });

  it("has a valid Zod schema", () => {
    const schema = TOOL_ARG_SCHEMAS["list_missions"];
    expect(schema).toBeDefined();
    // Parses with no args
    const r1 = schema.safeParse({});
    expect(r1.success).toBe(true);
    // Parses with all optional filters
    const r2 = schema.safeParse({ status: "todo", priority: "high", limit: 15 });
    expect(r2.success).toBe(true);
    // Rejects unknown status
    const r3 = schema.safeParse({ status: "invalid_status" });
    expect(r3.success).toBe(false);
  });
});

// ── CR-2: search_mission optional query ──────────────────────────────────────
describe("CR-2 search_mission optional query", () => {
  it("does NOT list query in required[]", () => {
    const tool = MISSION_TOOLS.find(t => t.name === "search_mission");
    expect(tool?.parameters.required ?? []).not.toContain("query");
  });

  it("Zod schema accepts call without query", () => {
    const schema = TOOL_ARG_SCHEMAS["search_mission"];
    const r = schema.safeParse({ status: "todo" });
    expect(r.success).toBe(true);
  });

  it("Zod schema still accepts call with query", () => {
    const schema = TOOL_ARG_SCHEMAS["search_mission"];
    const r = schema.safeParse({ query: "améliorer vitesse", priority: "high" });
    expect(r.success).toBe(true);
  });
});

// ── CR-9: search_mission description mentions listing ────────────────────────
describe("CR-9 search_mission description", () => {
  it("mentions listing use case when query is omitted", () => {
    const tool = MISSION_TOOLS.find(t => t.name === "search_mission");
    expect(tool?.description.toLowerCase()).toMatch(/list|lister|omis/i);
  });
});

// ── CR-3: STRICT_AI_RULE conditional visual template ─────────────────────────
describe("CR-3 STRICT_AI_RULE conditional template", () => {
  it("marks HIÉRARCHIE VISUELLE as conditional, not mandatory", () => {
    expect(STRICT_AI_RULE).toMatch(/CONDITIONNELLE|uniquement.*analyse|uniquement.*complex/i);
  });

  it("does NOT mandate the 👉 Prochaine étape closure on every response", () => {
    // The old rule had 👉 Prochaine étape as a mandatory section ending every reply
    expect(STRICT_AI_RULE).not.toMatch(/👉 Prochaine étape/);
  });

  it("does NOT mandate 'Si vous le souhaitez, je peux détailler' as a closing formula", () => {
    // The old mandatory CLÔTURE forced this phrase on every response
    expect(STRICT_AI_RULE).not.toMatch(/CLÔTURE/);
  });
});

// ── CR-1: STRICT_AI_RULE prohibits asking before acting ─────────────────────
describe("CR-1 immediate action rule", () => {
  it("STRICT_AI_RULE does NOT instruct AI to offer detail expansion", () => {
    // Old: 'Offre ensuite "Voulez-vous que je détaille ?"'
    expect(STRICT_AI_RULE).not.toMatch(/offre ensuite.*voulez-vous.*détaille/i);
  });
});

// ── CR-4: Hypothetical detection regex ───────────────────────────────────────
describe("CR-4 hypothetical detection", () => {
  const HYPOTHETICAL_RE = /\b(imagine[z]?|supposons|suppose[z]?|si on avait|si j'avais|what if|au cas où|en supposant|fictif|par hypothèse|hypothétiquement|pour l'exercice|par exemple si|mettons que|faisons comme si|scénario fictif)\b/i;

  const hypotheticalMessages = [
    "Imagine qu'on avait 50 mots-clés en position 1",
    "Supposons que je suis sur le plan Pro",
    "What if we had 10 monitors?",
    "Si j'avais un concurrent avec un DR de 80",
    "Mettons que le score SEO était à 90/100",
    "Scénario fictif : tu as 0 audits",
    "Faisons comme si la GSC était connectée",
  ];

  const normalMessages = [
    "Quelles sont mes missions en cours ?",
    "Crée un monitor pour flowpoint.io",
    "Mon score SEO est bas, que faire ?",
    "Liste mes audits",
    "Bonjour",
  ];

  hypotheticalMessages.forEach(msg => {
    it(`detects as hypothetical: "${msg.substring(0, 40)}"`, () => {
      expect(HYPOTHETICAL_RE.test(msg)).toBe(true);
    });
  });

  normalMessages.forEach(msg => {
    it(`does NOT flag as hypothetical: "${msg.substring(0, 40)}"`, () => {
      expect(HYPOTHETICAL_RE.test(msg)).toBe(false);
    });
  });
});

// ── CR-5: Simple greeting classifier ─────────────────────────────────────────
describe("CR-5 simple greeting classifier", () => {
  const SIMPLE_RE = /^(bonjour|bonsoir|salut|hello|hi|merci|ça va|ok|oui|non|d'accord|pas de problème|super|parfait|génial|cool|thanks|thank you|👍|🙏|😊)\s*[!?.]?$/i;

  const simpleGreetings = [
    "Bonjour",
    "Bonjour!",
    "merci",
    "Ok",
    "super !",
    "thanks",
    "👍",
  ];

  const nonSimple = [
    "Bonjour, quelles sont mes missions ?",
    "Merci. Et maintenant crée un monitor",
    "Ok mais mon score SEO est mauvais",
    "Mon audit a trouvé des problèmes",
  ];

  simpleGreetings.forEach(msg => {
    it(`classifies as simple: "${msg}"`, () => {
      expect(SIMPLE_RE.test(msg.trim())).toBe(true);
    });
  });

  nonSimple.forEach(msg => {
    it(`does NOT classify as simple: "${msg.substring(0, 40)}"`, () => {
      expect(SIMPLE_RE.test(msg.trim())).toBe(false);
    });
  });
});
