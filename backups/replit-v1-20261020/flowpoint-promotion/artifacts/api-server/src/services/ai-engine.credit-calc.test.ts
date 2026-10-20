/**
 * Unit tests for AI credit calculation engine
 * Tests: base cost, real cost floor, model multipliers, unknown model fallback
 */

import { describe, it, expect } from "vitest";
import {
  computeRealCostEur,
  computeCreditsDebited,
  getModelMultiplier,
  getFeatureBaseCost,
  CREDIT_EUR_RATE,
  DEFAULT_MODEL_MULTIPLIER,
} from "../config/ai-config.js";

describe("computeRealCostEur", () => {
  it("calculates OpenAI gpt-5-mini cost correctly", () => {
    const cost = computeRealCostEur({
      model: "gpt-5-mini",
      tokensIn: 1000,
      tokensOut: 500,
    });
    // input: 1k * 0.0002 = 0.0002; output: 0.5k * 0.0008 = 0.0004; total = 0.0006
    expect(cost).toBeCloseTo(0.0006, 6);
  });

  it("applies cached token discount", () => {
    const cost = computeRealCostEur({
      model: "gpt-5",
      tokensIn: 2000,
      tokensOut: 1000,
      cachedTokens: 1000,
    });
    // uncached input: 1k * 0.005 = 0.005; output: 1k * 0.015 = 0.015
    // cached: 1k * 0.00125 = 0.00125
    // total = 0.02125
    expect(cost).toBeCloseTo(0.02125, 6);
  });

  it("returns 0 for unknown model", () => {
    const cost = computeRealCostEur({ model: "unknown-model", tokensIn: 1000, tokensOut: 500 });
    expect(cost).toBe(0);
  });
});

describe("computeCreditsDebited", () => {
  it("small chat stays at base cost for cheap model", () => {
    // gpt-5-mini multiplier = 0.5; base chat = 800; multiplied = 400
    // real cost ~0.0006 EUR -> credits = 0.0006 / 0.00005 = 12
    const credits = computeCreditsDebited({
      feature: "chat",
      model: "gpt-5-mini",
      realCostEur: 0.0006,
    });
    expect(credits).toBe(400); // max(400, 12) = 400
  });

  it("huge tokens trigger real-cost floor", () => {
    // gpt-5 multiplier = 1.5; base chat = 800; multiplied = 1200
    // but real cost for 500k input + 200k output = very high
    const realCost = computeRealCostEur({
      model: "gpt-5",
      tokensIn: 500_000,
      tokensOut: 200_000,
    });
    const credits = computeCreditsDebited({
      feature: "chat",
      model: "gpt-5",
      realCostEur: realCost,
    });
    const multiplied = getFeatureBaseCost("chat") * getModelMultiplier("gpt-5");
    const realCostCredits = Math.round(realCost / CREDIT_EUR_RATE);
    expect(credits).toBe(Math.max(multiplied, realCostCredits));
    expect(credits).toBeGreaterThan(multiplied); // floor triggers
  });

  it("multiplier is applied per model", () => {
    const chatBase = getFeatureBaseCost("chat");
    const miniMult = getModelMultiplier("gpt-5-mini");
    const opusMult = getModelMultiplier("claude-4-opus");
    expect(miniMult).toBe(0.5);
    expect(opusMult).toBe(2.5);

    const miniCredits = computeCreditsDebited({
      feature: "chat",
      model: "gpt-5-mini",
      realCostEur: 0.0001, // low real cost, base wins
    });
    const opusCredits = computeCreditsDebited({
      feature: "chat",
      model: "claude-4-opus",
      realCostEur: 0.0001,
    });
    expect(miniCredits).toBe(Math.round(chatBase * miniMult));
    expect(opusCredits).toBe(Math.round(chatBase * opusMult));
    expect(opusCredits).toBeGreaterThan(miniCredits);
  });
});

describe("getModelMultiplier", () => {
  it("returns exact multiplier for known models", () => {
    expect(getModelMultiplier("gpt-5")).toBe(1.5);
    expect(getModelMultiplier("gemini-2.5-flash")).toBe(0.3);
    expect(getModelMultiplier("deepseek-v3")).toBe(0.25);
  });

  it("returns default for unknown models", () => {
    expect(getModelMultiplier("some-new-model")).toBe(DEFAULT_MODEL_MULTIPLIER);
  });
});

describe("getFeatureBaseCost", () => {
  it("returns correct base costs", () => {
    expect(getFeatureBaseCost("chat")).toBe(800);
    expect(getFeatureBaseCost("strategist")).toBe(2400);
    expect(getFeatureBaseCost("audit_summary")).toBe(500);
  });

  it("returns fallback for unknown feature", () => {
    expect(getFeatureBaseCost("new_feature")).toBe(500);
  });
});

describe("CREDIT_EUR_RATE", () => {
  it("converts correctly", () => {
    // 1 EUR = 20,000 credits
    expect(Math.round(1 / CREDIT_EUR_RATE)).toBe(20000);
  });
});
