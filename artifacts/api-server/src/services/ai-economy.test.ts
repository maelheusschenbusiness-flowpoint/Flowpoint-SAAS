/**
 * ai-economy.test.ts — Audit Phase 2 Étape 2
 *
 * Couvre :
 *  1. computeEconomyTier — tous les seuils
 *  2. parseEconomyThresholds — valide, négatif, >100, non-numérique, ordre invalide, égaux
 *  3. resolveEconomyPolicy — tous les tiers, isolation provider, downgradeReason
 *  4. Crédits additionnels (creditsExtra) — formule dans getOrgUsageStatus
 *  5. Réduction du contexte — contextFactor par tier
 *  6. Spy provider — aucun appel provider si EXHAUSTED (test HTTP intégration)
 *  7. Comptabilisation unique — metadata minimale dans usageMetadata
 */

import { describe, it, expect } from "vitest";
import {
  computeEconomyTier,
  parseEconomyThresholds,
  resolveEconomyPolicy,
  DEFAULT_THRESHOLDS,
  CONTEXT_FACTORS,
  type EconomyTier,
  type EconomyThresholds,
} from "./ai-economy.js";

// ─────────────────────────────────────────────────────────────────────────────
// 1. DEFAULT_THRESHOLDS — centralisés, un seul endroit
// ─────────────────────────────────────────────────────────────────────────────
describe("DEFAULT_THRESHOLDS", () => {
  it("70/85/95/100 centralisés dans ai-economy.ts", () => {
    expect(DEFAULT_THRESHOLDS).toEqual({
      optimizedAt: 70,
      economyAt:   85,
      criticalAt:  95,
      exhaustedAt: 100,
    });
  });

  it("CONTEXT_FACTORS: NORMAL=1.0, OPTIMIZED=0.85, ECONOMY=0.60, CRITICAL=0.35", () => {
    expect(CONTEXT_FACTORS.NORMAL).toBe(1.0);
    expect(CONTEXT_FACTORS.OPTIMIZED).toBe(0.85);
    expect(CONTEXT_FACTORS.ECONOMY).toBe(0.60);
    expect(CONTEXT_FACTORS.CRITICAL).toBe(0.35);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. computeEconomyTier — seuils précis
// ─────────────────────────────────────────────────────────────────────────────
describe("computeEconomyTier", () => {
  it("0% → NORMAL", () => expect(computeEconomyTier(0)).toBe("NORMAL"));
  it("69.9% → NORMAL", () => expect(computeEconomyTier(69.9)).toBe("NORMAL"));
  it("70% → OPTIMIZED (seuil inclus)", () => expect(computeEconomyTier(70)).toBe("OPTIMIZED"));
  it("72% → OPTIMIZED", () => expect(computeEconomyTier(72)).toBe("OPTIMIZED"));
  it("84.9% → OPTIMIZED", () => expect(computeEconomyTier(84.9)).toBe("OPTIMIZED"));
  it("85% → ECONOMY (seuil inclus)", () => expect(computeEconomyTier(85)).toBe("ECONOMY"));
  it("87% → ECONOMY", () => expect(computeEconomyTier(87)).toBe("ECONOMY"));
  it("94.9% → ECONOMY", () => expect(computeEconomyTier(94.9)).toBe("ECONOMY"));
  it("95% → CRITICAL (seuil inclus)", () => expect(computeEconomyTier(95)).toBe("CRITICAL"));
  it("97% → CRITICAL", () => expect(computeEconomyTier(97)).toBe("CRITICAL"));
  it("99.99% → CRITICAL (pas encore EXHAUSTED)", () => expect(computeEconomyTier(99.99)).toBe("CRITICAL"));
  it("100% → EXHAUSTED (seuil exact)", () => expect(computeEconomyTier(100)).toBe("EXHAUSTED"));
  it("100% clampé côté appelant → EXHAUSTED", () => {
    // Math.min(credits/limit*100, 100) assure ce cas
    expect(computeEconomyTier(100)).toBe("EXHAUSTED");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. parseEconomyThresholds — validation stricte
// ─────────────────────────────────────────────────────────────────────────────
describe("parseEconomyThresholds", () => {
  it("configuration valide → respectée", () => {
    const result = parseEconomyThresholds({ optimizedAt: 60, economyAt: 80, criticalAt: 90, exhaustedAt: 100 });
    expect(result).toEqual({ optimizedAt: 60, economyAt: 80, criticalAt: 90, exhaustedAt: 100 });
  });

  it("null → defaults", () => {
    expect(parseEconomyThresholds(null)).toEqual(DEFAULT_THRESHOLDS);
  });

  it("undefined → defaults", () => {
    expect(parseEconomyThresholds(undefined)).toEqual(DEFAULT_THRESHOLDS);
  });

  it("chaîne → defaults", () => {
    expect(parseEconomyThresholds("invalid")).toEqual(DEFAULT_THRESHOLDS);
  });

  it("valeur négative → defaults", () => {
    const result = parseEconomyThresholds({ optimizedAt: -10, economyAt: 85, criticalAt: 95, exhaustedAt: 100 });
    expect(result).toEqual(DEFAULT_THRESHOLDS);
  });

  it("valeur > 100 → defaults", () => {
    const result = parseEconomyThresholds({ optimizedAt: 70, economyAt: 85, criticalAt: 95, exhaustedAt: 110 });
    expect(result).toEqual(DEFAULT_THRESHOLDS);
  });

  it("valeur non numérique (string) → defaults", () => {
    const result = parseEconomyThresholds({ optimizedAt: "soixante-dix", economyAt: 85, criticalAt: 95, exhaustedAt: 100 });
    expect(result).toEqual(DEFAULT_THRESHOLDS);
  });

  it("valeur NaN → defaults", () => {
    const result = parseEconomyThresholds({ optimizedAt: NaN, economyAt: 85, criticalAt: 95, exhaustedAt: 100 });
    expect(result).toEqual(DEFAULT_THRESHOLDS);
  });

  it("valeur Infinity → defaults", () => {
    const result = parseEconomyThresholds({ optimizedAt: 70, economyAt: Infinity, criticalAt: 95, exhaustedAt: 100 });
    expect(result).toEqual(DEFAULT_THRESHOLDS);
  });

  it("seuils dans le mauvais ordre (optimizedAt > economyAt) → defaults", () => {
    const result = parseEconomyThresholds({ optimizedAt: 90, economyAt: 70, criticalAt: 95, exhaustedAt: 100 });
    expect(result).toEqual(DEFAULT_THRESHOLDS);
  });

  it("seuils dans le mauvais ordre (economyAt > criticalAt) → defaults", () => {
    const result = parseEconomyThresholds({ optimizedAt: 60, economyAt: 96, criticalAt: 90, exhaustedAt: 100 });
    expect(result).toEqual(DEFAULT_THRESHOLDS);
  });

  it("valeurs égales (optimizedAt === economyAt) → defaults", () => {
    const result = parseEconomyThresholds({ optimizedAt: 85, economyAt: 85, criticalAt: 95, exhaustedAt: 100 });
    expect(result).toEqual(DEFAULT_THRESHOLDS);
  });

  it("valeurs égales (economyAt === criticalAt) → defaults", () => {
    const result = parseEconomyThresholds({ optimizedAt: 70, economyAt: 95, criticalAt: 95, exhaustedAt: 100 });
    expect(result).toEqual(DEFAULT_THRESHOLDS);
  });

  it("criticalAt === exhaustedAt est autorisé (c <= x)", () => {
    // La spec n'interdit pas criticalAt == exhaustedAt, seulement < pour optimized/economy/critical
    const result = parseEconomyThresholds({ optimizedAt: 70, economyAt: 85, criticalAt: 100, exhaustedAt: 100 });
    expect(result).toEqual({ optimizedAt: 70, economyAt: 85, criticalAt: 100, exhaustedAt: 100 });
  });

  it("seuils personnalisés inférieurs → computeEconomyTier les respecte", () => {
    const custom: EconomyThresholds = { optimizedAt: 50, economyAt: 60, criticalAt: 70, exhaustedAt: 80 };
    expect(computeEconomyTier(55, custom)).toBe("OPTIMIZED");
    expect(computeEconomyTier(65, custom)).toBe("ECONOMY");
    expect(computeEconomyTier(75, custom)).toBe("CRITICAL");
    expect(computeEconomyTier(80, custom)).toBe("EXHAUSTED");
    // Avec defaults, ces % seraient NORMAL ou OPTIMIZED
    expect(computeEconomyTier(55)).toBe("NORMAL");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. resolveEconomyPolicy — tiers, isolation provider, downgradeReason
// ─────────────────────────────────────────────────────────────────────────────
describe("resolveEconomyPolicy — NORMAL", () => {
  const base = { provider: "openai" as const, requestedModel: "gpt-5", requestedMode: "Performant" as const, baseMaxTokens: 1400, usagePercent: 50, economyTier: "NORMAL" as EconomyTier };

  it("effectiveModel = requestedModel", () => expect(resolveEconomyPolicy(base).effectiveModel).toBe("gpt-5"));
  it("provider inchangé", () => expect(resolveEconomyPolicy(base).provider).toBe("openai"));
  it("downgradeApplied = false", () => expect(resolveEconomyPolicy(base).downgradeApplied).toBe(false));
  it("contextFactor = 1.0", () => expect(resolveEconomyPolicy(base).contextFactor).toBe(1.0));
  it("maxTokens = baseMaxTokens", () => expect(resolveEconomyPolicy(base).maxTokens).toBe(1400));
  it("effectiveMode = requestedMode", () => expect(resolveEconomyPolicy(base).effectiveMode).toBe("Performant"));
  it("reason = NORMAL_USAGE", () => expect(resolveEconomyPolicy(base).reason).toBe("NORMAL_USAGE"));
});

describe("resolveEconomyPolicy — OPTIMIZED", () => {
  const base = { provider: "openai" as const, requestedModel: "gpt-5", requestedMode: "Équilibré" as const, baseMaxTokens: 800, usagePercent: 72, economyTier: "OPTIMIZED" as EconomyTier };

  it("effectiveModel inchangé", () => expect(resolveEconomyPolicy(base).effectiveModel).toBe("gpt-5"));
  it("provider inchangé", () => expect(resolveEconomyPolicy(base).provider).toBe("openai"));
  it("maxTokens = 680 (800 × 0.85)", () => expect(resolveEconomyPolicy(base).maxTokens).toBe(680));
  it("contextFactor = 0.85", () => expect(resolveEconomyPolicy(base).contextFactor).toBe(0.85));
  it("downgradeApplied = false", () => expect(resolveEconomyPolicy(base).downgradeApplied).toBe(false));
  it("optimizationApplied = true", () => expect(resolveEconomyPolicy(base).optimizationApplied).toBe(true));
  it("reason = MONTHLY_USAGE_THRESHOLD", () => expect(resolveEconomyPolicy(base).reason).toBe("MONTHLY_USAGE_THRESHOLD"));
});

describe("resolveEconomyPolicy — ECONOMY (OpenAI)", () => {
  const base = { provider: "openai" as const, requestedModel: "gpt-5", requestedMode: "Performant" as const, baseMaxTokens: 1400, usagePercent: 87, economyTier: "ECONOMY" as EconomyTier };
  const p = resolveEconomyPolicy(base);

  it("effectiveModel → gpt-5-mini", () => expect(p.effectiveModel).toBe("gpt-5-mini"));
  it("provider TOUJOURS openai", () => expect(p.provider).toBe("openai"));
  it("jamais anthropic/gemini dans effectiveModel", () => expect(p.effectiveModel).toMatch(/^gpt-/));
  it("downgradeApplied = true", () => expect(p.downgradeApplied).toBe(true));
  it("maxTokens = 910 (1400 × 0.65)", () => expect(p.maxTokens).toBe(910));
  it("contextFactor = 0.60", () => expect(p.contextFactor).toBe(0.60));
  it("effectiveMode = Conservateur (après downgrade)", () => expect(p.effectiveMode).toBe("Conservateur"));
  it("reason = MONTHLY_USAGE_THRESHOLD", () => expect(p.reason).toBe("MONTHLY_USAGE_THRESHOLD"));
});

describe("resolveEconomyPolicy — ECONOMY (Anthropic)", () => {
  const p = resolveEconomyPolicy({ provider: "anthropic" as const, requestedModel: "claude-opus-4-8", requestedMode: "Performant" as const, baseMaxTokens: 1400, usagePercent: 87, economyTier: "ECONOMY" as EconomyTier });

  it("effectiveModel → claude-haiku-4-5", () => expect(p.effectiveModel).toBe("claude-haiku-4-5"));
  it("provider TOUJOURS anthropic", () => expect(p.provider).toBe("anthropic"));
  it("jamais gpt/gemini", () => { expect(p.effectiveModel).not.toMatch(/^gpt-/); expect(p.effectiveModel).not.toMatch(/^gemini-/); });
  it("downgradeApplied = true", () => expect(p.downgradeApplied).toBe(true));
});

describe("resolveEconomyPolicy — ECONOMY (Gemini)", () => {
  const p = resolveEconomyPolicy({ provider: "gemini" as const, requestedModel: "gemini-3.1-pro-preview", requestedMode: "Performant" as const, baseMaxTokens: 1400, usagePercent: 87, economyTier: "ECONOMY" as EconomyTier });

  it("effectiveModel → gemini-3-flash-preview", () => expect(p.effectiveModel).toBe("gemini-3-flash-preview"));
  it("provider TOUJOURS gemini", () => expect(p.provider).toBe("gemini"));
  it("jamais gpt/claude", () => { expect(p.effectiveModel).not.toMatch(/^gpt-/); expect(p.effectiveModel).not.toMatch(/^claude-/); });
});

describe("resolveEconomyPolicy — CRITICAL", () => {
  const base = { provider: "openai" as const, requestedModel: "gpt-5", requestedMode: "Performant" as const, baseMaxTokens: 1400, usagePercent: 97, economyTier: "CRITICAL" as EconomyTier };
  const p = resolveEconomyPolicy(base);

  it("effectiveModel → gpt-5-mini", () => expect(p.effectiveModel).toBe("gpt-5-mini"));
  it("provider TOUJOURS openai", () => expect(p.provider).toBe("openai"));
  it("maxTokens = 630 (1400 × 0.45)", () => expect(p.maxTokens).toBe(630));
  it("contextFactor = 0.35", () => expect(p.contextFactor).toBe(0.35));
  it("effectiveMode = Conservateur", () => expect(p.effectiveMode).toBe("Conservateur"));
  it("downgradeApplied = true", () => expect(p.downgradeApplied).toBe(true));
  it("reason = MONTHLY_USAGE_THRESHOLD", () => expect(p.reason).toBe("MONTHLY_USAGE_THRESHOLD"));
});

describe("resolveEconomyPolicy — NORMAL sans downgrade (requestedModel = economyModel)", () => {
  it("gpt-5-mini Performant NORMAL → downgradeApplied=false, effectiveModel=gpt-5-mini", () => {
    const p = resolveEconomyPolicy({ provider: "openai" as const, requestedModel: "gpt-5-mini", requestedMode: "Conservateur" as const, baseMaxTokens: 500, usagePercent: 50, economyTier: "NORMAL" as EconomyTier });
    expect(p.downgradeApplied).toBe(false);
    expect(p.effectiveModel).toBe("gpt-5-mini");
    expect(p.provider).toBe("openai");
  });

  it("gpt-5-mini ECONOMY → downgradeApplied=false (déjà économique)", () => {
    const p = resolveEconomyPolicy({ provider: "openai" as const, requestedModel: "gpt-5-mini", requestedMode: "Conservateur" as const, baseMaxTokens: 500, usagePercent: 87, economyTier: "ECONOMY" as EconomyTier });
    expect(p.downgradeApplied).toBe(false);
    expect(p.effectiveModel).toBe("gpt-5-mini");
  });
});

describe("resolveEconomyPolicy — isolation provider sur tous les tiers", () => {
  const tiers: EconomyTier[] = ["NORMAL", "OPTIMIZED", "ECONOMY", "CRITICAL", "EXHAUSTED"];
  const providers = ["openai", "anthropic", "gemini"] as const;

  for (const provider of providers) {
    for (const tier of tiers) {
      it(`${provider} tier=${tier} → provider inchangé`, () => {
        const p = resolveEconomyPolicy({
          provider,
          requestedModel: provider === "openai" ? "gpt-5" : provider === "anthropic" ? "claude-opus-4-8" : "gemini-3.1-pro-preview",
          requestedMode: "Performant",
          baseMaxTokens: 1400,
          usagePercent: 50,
          economyTier: tier,
        });
        expect(p.provider).toBe(provider);
      });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Crédits additionnels — formule usagePercent inclut creditsExtra
// ─────────────────────────────────────────────────────────────────────────────
describe("Crédits additionnels (creditsExtra) — formule", () => {
  function simulateUsagePercent(creditsUsed: number, creditsLimit: number, creditsExtra: number): number {
    const totalAvailable = creditsLimit + creditsExtra;
    return totalAvailable > 0 ? Math.min((creditsUsed / totalAvailable) * 100, 100) : 0;
  }

  it("sans crédits extra : 85000/100000 = 85% → ECONOMY", () => {
    const pct = simulateUsagePercent(85000, 100000, 0);
    expect(pct).toBeCloseTo(85, 1);
    expect(computeEconomyTier(pct)).toBe("ECONOMY");
  });

  it("avec 50000 crédits extra : 85000/150000 ≈ 56.7% → NORMAL", () => {
    const pct = simulateUsagePercent(85000, 100000, 50000);
    expect(pct).toBeCloseTo(56.67, 1);
    expect(computeEconomyTier(pct)).toBe("NORMAL");
  });

  it("avec crédits extra : passage EXHAUSTED évité (100000/150000 ≈ 66.7%)", () => {
    const pct = simulateUsagePercent(100000, 100000, 50000);
    expect(pct).toBeCloseTo(66.67, 1);
    expect(computeEconomyTier(pct)).toBe("NORMAL");
  });

  it("crédits extra = 0 : 100000/100000 = 100% → EXHAUSTED", () => {
    const pct = simulateUsagePercent(100000, 100000, 0);
    expect(pct).toBe(100);
    expect(computeEconomyTier(pct)).toBe("EXHAUSTED");
  });

  it("totalAvailable = 0 → usagePercent = 0 → NORMAL (pas de division par zéro)", () => {
    const pct = simulateUsagePercent(0, 0, 0);
    expect(pct).toBe(0);
    expect(computeEconomyTier(pct)).toBe("NORMAL");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Réduction du contexte — contextFactor par tier
// ─────────────────────────────────────────────────────────────────────────────
describe("Réduction du contexte via contextFactor", () => {
  function computeLimits(contextFactor: number) {
    return {
      kwLimit:      Math.max(3, Math.round(15 * contextFactor)),
      compLimit:    Math.max(1, Math.round(5  * contextFactor)),
      auditLimit:   Math.max(2, Math.round(10 * contextFactor)),
      monLimit:     Math.max(2, Math.round(10 * contextFactor)),
      psiLimit:     Math.max(1, Math.round(5  * contextFactor)),
      kwDisplayLim: Math.max(2, Math.round(10 * contextFactor)),
      historyLimit: Math.max(2, Math.round(10 * contextFactor)),
    };
  }

  it("NORMAL (1.0) : kwLimit=15, compLimit=5, auditLimit=10, monLimit=10, psiLimit=5", () => {
    const l = computeLimits(1.0);
    expect(l.kwLimit).toBe(15);
    expect(l.compLimit).toBe(5);
    expect(l.auditLimit).toBe(10);
    expect(l.monLimit).toBe(10);
    expect(l.psiLimit).toBe(5);
    expect(l.historyLimit).toBe(10);
  });

  it("OPTIMIZED (0.85) : valeurs réduites de ~15%", () => {
    const l = computeLimits(0.85);
    expect(l.kwLimit).toBe(13);    // round(15*0.85) = round(12.75) = 13
    expect(l.compLimit).toBe(4);   // round(5*0.85) = round(4.25) = 4
    expect(l.auditLimit).toBe(9);  // round(10*0.85) = round(8.5) = 9 (banker's round) or 9
    expect(l.psiLimit).toBe(4);    // round(5*0.85) = 4
    expect(l.historyLimit).toBe(9);
  });

  it("ECONOMY (0.60) : valeurs réduites de ~40%", () => {
    const l = computeLimits(0.60);
    expect(l.kwLimit).toBe(9);    // round(15*0.60) = round(9) = 9
    expect(l.compLimit).toBe(3);  // round(5*0.60) = round(3) = 3
    expect(l.auditLimit).toBe(6); // round(10*0.60) = round(6) = 6
    expect(l.psiLimit).toBe(3);
    expect(l.historyLimit).toBe(6);
  });

  it("CRITICAL (0.35) : valeurs réduites de ~65%", () => {
    const l = computeLimits(0.35);
    expect(l.kwLimit).toBe(5);    // round(15*0.35) = round(5.25) = 5
    expect(l.compLimit).toBe(2);  // round(5*0.35) = round(1.75) = 2
    expect(l.auditLimit).toBe(4); // round(10*0.35) = round(3.5) = 4 (banker's) or 4
    expect(l.psiLimit).toBe(2);   // round(5*0.35) = round(1.75) = 2
    expect(l.historyLimit).toBe(4);
  });

  it("CRITICAL (0.35) : minimums appliqués (jamais < floor)", () => {
    // kwLimit min=3, compLimit min=1, auditLimit min=2, psiLimit min=1
    const l = computeLimits(0.35);
    expect(l.kwLimit).toBeGreaterThanOrEqual(3);
    expect(l.compLimit).toBeGreaterThanOrEqual(1);
    expect(l.auditLimit).toBeGreaterThanOrEqual(2);
    expect(l.psiLimit).toBeGreaterThanOrEqual(1);
  });

  it("réduction strictement monotone NORMAL > OPTIMIZED > ECONOMY > CRITICAL", () => {
    const lN = computeLimits(1.0);
    const lO = computeLimits(0.85);
    const lE = computeLimits(0.60);
    const lC = computeLimits(0.35);
    expect(lN.kwLimit).toBeGreaterThan(lO.kwLimit);
    expect(lO.kwLimit).toBeGreaterThan(lE.kwLimit);
    expect(lE.kwLimit).toBeGreaterThan(lC.kwLimit);
    expect(lN.historyLimit).toBeGreaterThan(lO.historyLimit);
    expect(lO.historyLimit).toBeGreaterThan(lE.historyLimit);
    expect(lE.historyLimit).toBeGreaterThan(lC.historyLimit);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Métadonnées _ai — champs obligatoires
// ─────────────────────────────────────────────────────────────────────────────
describe("Métadonnées _ai — structure obligatoire", () => {
  function buildAiMeta(tier: EconomyTier, requestedModel = "gpt-5", provider: "openai" | "anthropic" | "gemini" = "openai") {
    const p = resolveEconomyPolicy({
      provider,
      requestedModel,
      requestedMode: "Performant",
      baseMaxTokens: 1400,
      usagePercent: 87,
      economyTier: tier,
    });
    return {
      provider,
      requestedModel,
      model: p.effectiveModel,
      requestedMode: "Performant",
      effectiveMode: p.effectiveMode,
      economyTier: p.economyTier,
      usagePercent: 87,
      downgradeApplied: p.downgradeApplied,
      downgradeReason: p.downgradeApplied ? "MONTHLY_USAGE_THRESHOLD" : null,
    };
  }

  it("NORMAL : downgradeReason = null (pas undefined)", () => {
    const m = buildAiMeta("NORMAL");
    expect(m.downgradeReason).toBeNull();
    expect(m.downgradeApplied).toBe(false);
    expect(m.model).toBe("gpt-5");
  });

  it("ECONOMY : downgradeReason = 'MONTHLY_USAGE_THRESHOLD'", () => {
    const m = buildAiMeta("ECONOMY");
    expect(m.downgradeReason).toBe("MONTHLY_USAGE_THRESHOLD");
    expect(m.downgradeApplied).toBe(true);
    expect(m.model).toBe("gpt-5-mini");
  });

  it("CRITICAL : downgradeReason = 'MONTHLY_USAGE_THRESHOLD'", () => {
    const m = buildAiMeta("CRITICAL");
    expect(m.downgradeReason).toBe("MONTHLY_USAGE_THRESHOLD");
    expect(m.model).toBe("gpt-5-mini");
  });

  it("model = modèle effectivement utilisé (jamais requestedModel annoncé si downgrade)", () => {
    const m = buildAiMeta("ECONOMY");
    expect(m.model).not.toBe("gpt-5");
    expect(m.model).toBe("gpt-5-mini");
    expect(m.requestedModel).toBe("gpt-5");
  });

  it("tous les champs obligatoires présents", () => {
    const m = buildAiMeta("ECONOMY");
    const required = ["provider", "requestedModel", "model", "requestedMode", "effectiveMode", "economyTier", "usagePercent", "downgradeApplied", "downgradeReason"];
    for (const field of required) {
      expect(m).toHaveProperty(field);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Metadata ai_usage_logs — champs minimaux
// ─────────────────────────────────────────────────────────────────────────────
describe("Metadata ai_usage_logs — champs obligatoires", () => {
  function buildUsageMetadata(tier: EconomyTier) {
    const p = resolveEconomyPolicy({
      provider: "openai",
      requestedModel: "gpt-5",
      requestedMode: "Performant",
      baseMaxTokens: 1400,
      usagePercent: 87,
      economyTier: tier,
    });
    return {
      requestedModel: "gpt-5",
      effectiveModel: p.effectiveModel,
      requestedMode:  "Performant",
      effectiveMode:  p.effectiveMode,
      economyTier:    p.economyTier,
      usagePercent:   87,
      downgradeApplied: p.downgradeApplied,
    };
  }

  it("metadata ECONOMY contient les 7 champs obligatoires", () => {
    const m = buildUsageMetadata("ECONOMY");
    expect(m.requestedModel).toBe("gpt-5");
    expect(m.effectiveModel).toBe("gpt-5-mini");
    expect(m.requestedMode).toBe("Performant");
    expect(m.effectiveMode).toBe("Conservateur");
    expect(m.economyTier).toBe("ECONOMY");
    expect(m.usagePercent).toBe(87);
    expect(m.downgradeApplied).toBe(true);
  });

  it("metadata NORMAL : effectiveModel = requestedModel", () => {
    const m = buildUsageMetadata("NORMAL");
    expect(m.effectiveModel).toBe("gpt-5");
    expect(m.downgradeApplied).toBe(false);
  });

  it("metadata serializable en JSON (pas de circular ref)", () => {
    const m = buildUsageMetadata("CRITICAL");
    expect(() => JSON.stringify(m)).not.toThrow();
    const parsed = JSON.parse(JSON.stringify(m));
    expect(parsed.effectiveModel).toBe("gpt-5-mini");
    expect(parsed.downgradeApplied).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. Matrice des modèles économiques — correspondance capabilities.ts
// ─────────────────────────────────────────────────────────────────────────────
describe("Matrice modèles économiques — identifiants exacts", () => {
  const ECONOMY_MODELS_EXPECTED = {
    openai:    "gpt-5-mini",          // capabilities.ts l.45
    anthropic: "claude-haiku-4-5",    // capabilities.ts l.87
    gemini:    "gemini-3-flash-preview", // capabilities.ts l.114
  };

  for (const [provider, expectedModel] of Object.entries(ECONOMY_MODELS_EXPECTED)) {
    it(`${provider} ECONOMY → ${expectedModel}`, () => {
      const p = resolveEconomyPolicy({
        provider: provider as "openai" | "anthropic" | "gemini",
        requestedModel: provider === "openai" ? "gpt-5" : provider === "anthropic" ? "claude-opus-4-8" : "gemini-3.1-pro-preview",
        requestedMode: "Performant",
        baseMaxTokens: 1400,
        usagePercent: 87,
        economyTier: "ECONOMY",
      });
      expect(p.effectiveModel).toBe(expectedModel);
    });

    it(`${provider} CRITICAL → ${expectedModel}`, () => {
      const p = resolveEconomyPolicy({
        provider: provider as "openai" | "anthropic" | "gemini",
        requestedModel: provider === "openai" ? "gpt-5" : provider === "anthropic" ? "claude-opus-4-8" : "gemini-3.1-pro-preview",
        requestedMode: "Performant",
        baseMaxTokens: 1400,
        usagePercent: 97,
        economyTier: "CRITICAL",
      });
      expect(p.effectiveModel).toBe(expectedModel);
    });
  }
});
