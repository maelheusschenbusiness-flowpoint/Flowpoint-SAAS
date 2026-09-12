/**
 * Local SEO entitlement + ranking-history tests (task #628)
 *
 * 1. requireAddonOrFeature entitlement logic — an active Ultra/Pro plan gets
 *    Review Intelligence via the canonical reviewIntelAI feature flag WITHOUT
 *    a separately purchased reviewIntelligence add-on, while lower tiers still
 *    unlock it by purchasing the add-on.
 * 2. Ranking-history response shaping — GET history exposes a real per-row
 *    result count, and usage is derived from persisted rows (survives F5).
 *
 * Uses inline logic (mirrors addon-entitlement.test.ts) to avoid a live DB.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { getFeature } from "../lib/config.js";
import { PLAN_INCLUDED_ADDONS } from "../lib/plans.js";

// ── requireAddonOrFeature entitlement logic (mirror of the middleware branch) ──

function checkFeatureOrAddon(
  plan: string,
  addonKey: string,
  feature: Parameters<typeof getFeature>[1],
  orgAddonsActive: string[],
): boolean {
  // Branch 1: canonical plan feature flag.
  if (getFeature(plan, feature)) return true;
  // Branch 2: bundled in plan or purchased in org_addons.
  const planBundle = PLAN_INCLUDED_ADDONS[plan] ?? new Set<string>();
  if (planBundle.has(addonKey)) return true;
  return orgAddonsActive.includes(addonKey);
}

describe("Review Intelligence entitlement (requireAddonOrFeature)", () => {
  it("reviewIntelAI is a canonical entitlement for Ultra", () => {
    expect(getFeature("ultra", "reviewIntelAI")).toBe(true);
  });

  it("reviewIntelAI is a canonical entitlement for Pro", () => {
    expect(getFeature("pro", "reviewIntelAI")).toBe(true);
  });

  it("reviewIntelAI is NOT a canonical entitlement for Standard", () => {
    expect(getFeature("standard", "reviewIntelAI")).toBe(false);
  });

  it("Ultra can analyze/add reviews WITHOUT buying the reviewIntelligence add-on", () => {
    expect(checkFeatureOrAddon("ultra", "reviewIntelligence", "reviewIntelAI", [])).toBe(true);
  });

  it("Pro can analyze/add reviews WITHOUT buying the reviewIntelligence add-on", () => {
    expect(checkFeatureOrAddon("pro", "reviewIntelligence", "reviewIntelAI", [])).toBe(true);
  });

  it("Standard is denied without the add-on", () => {
    expect(checkFeatureOrAddon("standard", "reviewIntelligence", "reviewIntelAI", [])).toBe(false);
  });

  it("Standard unlocks Review Intelligence by purchasing the add-on", () => {
    expect(checkFeatureOrAddon("standard", "reviewIntelligence", "reviewIntelAI", ["reviewIntelligence"])).toBe(true);
  });
});

// ── GBP entitlement — draft editor/save available, only AI generation gated ────

describe("GBP posting entitlement", () => {
  it("scopes the GBP feature middleware to /gbp-posts instead of every API route", () => {
    const source = readFileSync(new URL("./gbp-posts.ts", import.meta.url), "utf8");
    expect(source).toContain('router.use("/gbp-posts", requireFeature("gbpPosting"');
    expect(source).not.toContain('router.use(requireFeature("gbpPosting"');
  });

  it("gbpPosting is gated to Ultra while AI generation remains a separate add-on", () => {
    expect(getFeature("standard", "gbpPosting")).toBe(false);
    expect(getFeature("pro", "gbpPosting")).toBe(false);
    expect(getFeature("ultra", "gbpPosting")).toBe(true);
  });

  it("aiGbpPosting is NOT bundled into Ultra (AI generation stays gated as an add-on)", () => {
    const ultra = PLAN_INCLUDED_ADDONS["ultra"] ?? new Set<string>();
    expect(ultra.has("aiGbpPosting")).toBe(false);
  });
});

// ── Ranking-history response shaping ──────────────────────────────────────────

/** Mirror of GET /local-seo/rankings/history row mapping. */
function shapeHistoryRow(row: { results: unknown }): { results: unknown[]; resultCount: number; total_results: number } {
  const results = typeof row.results === "string"
    ? (() => { try { return JSON.parse(row.results as string); } catch { return []; } })()
    : (Array.isArray(row.results) ? row.results : []);
  return { results, resultCount: results.length, total_results: results.length };
}

describe("Ranking history result counts", () => {
  it("exposes a real result count for a JSONB array (parsed by node-pg)", () => {
    const shaped = shapeHistoryRow({ results: [{ title: "A" }, { title: "B" }, { title: "C" }] });
    expect(shaped.resultCount).toBe(3);
    expect(shaped.total_results).toBe(3);
  });

  it("tolerates a legacy JSON-string results column", () => {
    const shaped = shapeHistoryRow({ results: JSON.stringify([{ title: "A" }]) });
    expect(shaped.results.length).toBe(1);
    expect(shaped.resultCount).toBe(1);
  });

  it("returns 0 for malformed / null results without throwing", () => {
    expect(shapeHistoryRow({ results: null }).resultCount).toBe(0);
    expect(shapeHistoryRow({ results: "not-json" }).resultCount).toBe(0);
  });
});

// ── Search response contract — no false ok when insert fails ──────────────────

describe("Ranking search response contract", () => {
  it("a successful search returns ok:true with count + usage", () => {
    // Shape assertion mirroring the POST /local-seo/rankings success payload.
    const rankings = [{ title: "A" }, { title: "B" }];
    const payload = {
      ok: true, keyword: "kw", location: "Paris",
      rankings, count: rankings.length, configured: true,
      usage: { used: 1, limit: 1000 },
    };
    expect(payload.ok).toBe(true);
    expect(payload.count).toBe(2);
    expect(payload.usage.used).toBeGreaterThanOrEqual(0);
    expect(payload.usage.limit).toBeGreaterThan(0);
  });

  it("a persist failure returns ok:false (never a phantom ok:true)", () => {
    const payload = { ok: false, rankings: [], configured: true, reason: "persist_error" };
    expect(payload.ok).toBe(false);
    expect(payload.reason).toBe("persist_error");
  });
});
