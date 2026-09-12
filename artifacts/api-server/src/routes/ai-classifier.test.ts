/**
 * ai-classifier.test.ts
 *
 * Unit tests for classifyIntent() exported from ai.ts.
 * Verifies intent routing without running the full HTTP handler.
 *
 * Classification priority enforced: ACTION > HYPOTHETICAL > SIMPLE_KNOWLEDGE/GREETING > CONTEXTUAL
 *
 * Cases from user specification:
 *   A — hypothetical scenario containing "mon site" → skipHeavyContext, no tools
 *   B — real account query                          → FlowPoint context + tools
 *   C — hypothetical + explicit action verb         → tools (ACTION overrides HYPOTHETICAL)
 *   D — pure concept question                       → SIMPLE_KNOWLEDGE, no context, no tools
 *   E — real personal data query ("mon LCP actuel") → context needed, tools needed
 */

import { describe, it, expect } from "vitest";
import { classifyIntent } from "./ai.js";

describe("classifyIntent — routing decision", () => {
  // ── A: hypothetical with "mon site" ──────────────────────────────────────
  it("A — hypothetical scenario → isHypothetical=true, skipHeavyContext=true, needsTools=false", () => {
    const msg =
      "Faisons un exercice fictif. Imagine que mon site a un score SEO de 92/100, " +
      "un LCP de 4,8 secondes, une baisse de trafic organique de 31 % sur 30 jours " +
      "et 18 pages importantes sorties de l'index Google. Dans ce scénario uniquement, " +
      "quelle serait ta priorité absolue et pourquoi ? " +
      "Ne mélange pas ce scénario avec les données réelles de mon compte.";
    const r = classifyIntent(msg);
    expect(r.isHypothetical,   "isHypothetical").toBe(true);
    expect(r.isExplicitAction, "isExplicitAction").toBe(false);
    expect(r.isSimpleKnowledge,"isSimpleKnowledge").toBe(false);
    expect(r.isSimpleGreeting, "isSimpleGreeting").toBe(false);
    expect(r.skipHeavyContext, "skipHeavyContext").toBe(true);
    expect(r.needsTools,       "needsTools").toBe(false);
  });

  // ── B: real account query ─────────────────────────────────────────────────
  it("B — real account query → skipHeavyContext=false, needsTools=true", () => {
    const msg = "Analyse mon site actuel et identifie mes problèmes SEO.";
    const r = classifyIntent(msg);
    expect(r.isHypothetical,   "isHypothetical").toBe(false);
    expect(r.skipHeavyContext, "skipHeavyContext").toBe(false);
    expect(r.needsTools,       "needsTools").toBe(true);
  });

  // ── C: hypothetical + explicit action ────────────────────────────────────
  it("C — hypothetical + explicit action → needsTools=true (ACTION overrides HYPOTHETICAL)", () => {
    const msg = "Imagine que mon site est lent et crée une mission pour l'optimiser.";
    const r = classifyIntent(msg);
    expect(r.isHypothetical,   "isHypothetical").toBe(true);
    expect(r.isExplicitAction, "isExplicitAction").toBe(true);
    expect(r.skipHeavyContext, "skipHeavyContext").toBe(true);
    expect(r.needsTools,       "needsTools").toBe(true);
  });

  // ── D: pure concept question ──────────────────────────────────────────────
  it("D — pure concept question → isSimpleKnowledge=true, skipHeavyContext=true, needsTools=false", () => {
    const msg = "Qu'est-ce qu'un LCP ?";
    const r = classifyIntent(msg);
    expect(r.isSimpleKnowledge,"isSimpleKnowledge").toBe(true);
    expect(r.isHypothetical,   "isHypothetical").toBe(false);
    expect(r.skipHeavyContext, "skipHeavyContext").toBe(true);
    expect(r.needsTools,       "needsTools").toBe(false);
  });

  // ── E: real personal data query ──────────────────────────────────────────
  it("E — personal live-data query → skipHeavyContext=false, needsTools=true", () => {
    const msg = "Quel est mon LCP actuel ?";
    const r = classifyIntent(msg);
    expect(r.isSimpleKnowledge,"isSimpleKnowledge").toBe(false);
    expect(r.isHypothetical,   "isHypothetical").toBe(false);
    expect(r.skipHeavyContext, "skipHeavyContext").toBe(false);
    expect(r.needsTools,       "needsTools").toBe(true);
  });

  // ── Additional edge cases ─────────────────────────────────────────────────
  it("simple greeting → isSimpleGreeting=true, needsTools=false", () => {
    const r = classifyIntent("Bonjour !");
    expect(r.isSimpleGreeting, "isSimpleGreeting").toBe(true);
    expect(r.skipHeavyContext, "skipHeavyContext").toBe(true);
    expect(r.needsTools,       "needsTools").toBe(false);
  });

  it("'Qu'est-ce qu'un backlink ?' → SIMPLE_KNOWLEDGE despite being a question about SEO", () => {
    const r = classifyIntent("Qu'est-ce qu'un backlink ?");
    expect(r.isSimpleKnowledge,"isSimpleKnowledge").toBe(true);
    expect(r.needsTools,       "needsTools").toBe(false);
  });

  it("'Suppose que mon site est en top 3' → hypothetical despite 'mon site'", () => {
    const r = classifyIntent("Suppose que mon site est en top 3 pour 'restaurant Paris', que faire ensuite ?");
    expect(r.isHypothetical,   "isHypothetical").toBe(true);
    expect(r.needsTools,       "needsTools").toBe(false);
  });

  it("'Si j\\'avais 500 backlinks de plus' → hypothetical, no tools", () => {
    const r = classifyIntent("Si j'avais 500 backlinks de plus, est-ce que mon score passerait à 90 ?");
    expect(r.isHypothetical,   "isHypothetical").toBe(true);
    expect(r.needsTools,       "needsTools").toBe(false);
  });

  it("'Par hypothèse, si mon domaine était jeune' → hypothetical, no tools", () => {
    const r = classifyIntent("Par hypothèse, si mon domaine était jeune de 3 mois, est-ce normal de ne pas ranker ?");
    expect(r.isHypothetical,   "isHypothetical").toBe(true);
    expect(r.needsTools,       "needsTools").toBe(false);
  });

  it("explicit create without hypothetical → isExplicitAction=true, needsTools=true", () => {
    const r = classifyIntent("Crée une mission SEO pour améliorer mon LCP.");
    expect(r.isHypothetical,   "isHypothetical").toBe(false);
    expect(r.isExplicitAction, "isExplicitAction").toBe(true);
    expect(r.needsTools,       "needsTools").toBe(true);
  });

  it("'Supprime le monitor X' → ACTION, no hypothetical", () => {
    const r = classifyIntent("Supprime le monitor flowpoint.pro.");
    expect(r.isExplicitAction, "isExplicitAction").toBe(true);
    expect(r.isHypothetical,   "isHypothetical").toBe(false);
    expect(r.needsTools,       "needsTools").toBe(true);
  });

  it("'Comment fonctionne un backlink ?' → SIMPLE_KNOWLEDGE, no tools", () => {
    const r = classifyIntent("Comment fonctionne un backlink ?");
    expect(r.isSimpleKnowledge,"isSimpleKnowledge").toBe(true);
    expect(r.needsTools,       "needsTools").toBe(false);
  });

  it("'Quel est mon score SEO ?' → personal query, needsTools=true", () => {
    const r = classifyIntent("Quel est mon score SEO ?");
    // "mon" makes it personal — not SIMPLE_KNOWLEDGE (personal context present)
    // It's also not hypothetical
    expect(r.isHypothetical,   "isHypothetical").toBe(false);
    expect(r.needsTools,       "needsTools").toBe(true);
  });
});
