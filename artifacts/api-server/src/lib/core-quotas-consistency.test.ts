/**
 * core-quotas-consistency.test.ts — une seule source pour les quotas (B-07/B-09).
 *
 * - CORE_QUOTAS (config.ts) est DERIVE de PLAN_DEFINITIONS (plans.ts) pour les
 *   cinq quotas communs : un changement de prix/limite ne peut plus diverger.
 * - Les quotas propres a config.ts correspondent au tableau annonce dans
 *   FLOWPOINT_AI_CONTEXT.md §2.
 * - "agency" est un alias d'Ultra partout (limites, credits IA, add-ons
 *   inclus) et n'apparait jamais dans les catalogues publics.
 */
import { describe, it, expect } from "vitest";
import { CORE_QUOTAS, getQuota, getFeature, AI_LIMITS } from "./config.js";
import {
  PLAN_DEFINITIONS, PLAN_LIMITS, PLAN_AI_CREDITS, PLAN_AI_TOKENS, PLAN_INCLUDED_ADDONS, canonicalPlanId,
} from "./plans.js";
import { getKeywordLimit } from "../services/keyword-engine.js";
import { getCrmLimit } from "../services/crm-service.js";

const SHARED = ["audits", "monitors", "reports", "exports", "teamMembers"] as const;

describe("CORE_QUOTAS derive de PLAN_DEFINITIONS", () => {
  for (const id of Object.keys(PLAN_DEFINITIONS)) {
    it(`${id} : audits, monitors, reports, exports, teamMembers == PLAN_DEFINITIONS`, () => {
      const tier = id as "standard" | "pro" | "ultra";
      for (const k of SHARED) expect(CORE_QUOTAS[tier][k], `${id}.${k}`).toBe(PLAN_DEFINITIONS[id]!.limits[k]);
    });
  }

  it("quotas annonces dans FLOWPOINT_AI_CONTEXT.md §2 (mots-cles, concurrents, heatmaps, automatisations, missions, GBP, CRM)", () => {
    const pick = (t: "standard" | "pro" | "ultra") => {
      const q = CORE_QUOTAS[t];
      return [q.keywords, q.competitors, q.heatmaps, q.automations, q.missions, q.gbpPosts, q.crmIntegrations];
    };
    expect(pick("standard")).toEqual([50, 10, 2, 3, 20, 10, 1]);
    expect(pick("pro")).toEqual([500, 30, 10, 20, 200, 100, 3]);
    expect(pick("ultra")).toEqual([5000, 100, 50, 100, 999, 999, 10]);
  });

  it("modifier PLAN_DEFINITIONS se repercute dans CORE_QUOTAS (pas de copie)", () => {
    // Lecture a l'import : la valeur de CORE_QUOTAS est celle de PLAN_DEFINITIONS, pas un litteral.
    expect(CORE_QUOTAS.pro.audits).toBe(PLAN_DEFINITIONS["pro"]!.limits.audits);
    expect(getQuota("pro", "teamMembers")).toBe(PLAN_DEFINITIONS["pro"]!.limits.teamMembers);
  });
});

describe("plan 'agency' = alias d'Ultra", () => {
  it("canonicalPlanId", () => {
    expect(canonicalPlanId("agency")).toBe("ultra");
    expect(canonicalPlanId(" AGENCY ")).toBe("ultra");
    expect(canonicalPlanId("pro")).toBe("pro");
    expect(canonicalPlanId(null)).toBe("");
  });

  it("CORE_QUOTAS.agency == CORE_QUOTAS.ultra", () => {
    expect(CORE_QUOTAS.agency).toEqual(CORE_QUOTAS.ultra);
  });

  it("PLAN_LIMITS / credits IA / add-ons inclus : agency == ultra (et non Standard)", () => {
    expect(PLAN_LIMITS["agency"]).toEqual(PLAN_LIMITS["ultra"]);
    expect(PLAN_LIMITS["agency"]!.audits).toBe(1000);
    expect(PLAN_AI_CREDITS["agency"]).toBe(PLAN_AI_CREDITS["ultra"]);
    expect(PLAN_AI_TOKENS["agency"]).toBe(PLAN_AI_TOKENS["ultra"]);
    expect([...PLAN_INCLUDED_ADDONS["agency"]!].sort()).toEqual([...PLAN_INCLUDED_ADDONS["ultra"]!].sort());
    expect(AI_LIMITS.agency.creditsMonthly).toBe(10_000_000);
  });

  it("droits fonctionnels d'agency == ultra", () => {
    expect(getFeature("agency", "multiLocation")).toBe(true);
    expect(getFeature("agency", "gbpPosting")).toBe(true);
  });

  it("agency n'apparait JAMAIS dans les catalogues publics (cles non enumerables)", () => {
    expect(Object.keys(PLAN_LIMITS)).toEqual(Object.keys(PLAN_DEFINITIONS));
    expect(Object.keys(PLAN_INCLUDED_ADDONS)).not.toContain("agency");
    expect(Object.keys(PLAN_AI_CREDITS)).not.toContain("agency");
    expect(Object.keys(PLAN_DEFINITIONS)).not.toContain("agency");
  });
});

describe("limites uniques cote service", () => {
  it("getKeywordLimit suit CORE_QUOTAS (agency 5000 comme Ultra, plan inconnu = Standard)", () => {
    expect(getKeywordLimit("standard")).toBe(50);
    expect(getKeywordLimit("Pro")).toBe(500);
    expect(getKeywordLimit("ultra")).toBe(5000);
    expect(getKeywordLimit("agency")).toBe(5000);
    expect(getKeywordLimit("plan-inconnu")).toBe(50);
  });

  it("getCrmLimit renvoie le plafond d'integrations CRM annonce (1 / 3 / 10), pas le nombre de workspaces", () => {
    expect(getCrmLimit("standard")).toBe(1);
    expect(getCrmLimit("pro")).toBe(3);
    expect(getCrmLimit("ultra")).toBe(10);
    expect(getCrmLimit("agency")).toBe(10);
  });
});
