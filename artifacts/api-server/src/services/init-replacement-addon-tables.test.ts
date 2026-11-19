import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureReplacementAddonTables, REPLACEMENT_ADDON_TABLES } from "./init-replacement-addon-tables.js";

describe("ensureReplacementAddonTables", () => {
  it("covers the six replacement add-on tables with idempotent DDL and tenant RLS", async () => {
    const statements: string[] = [];
    await ensureReplacementAddonTables({ query: async (sql: string) => { statements.push(sql.replace(/\s+/g, " ").trim()); } });
    expect(REPLACEMENT_ADDON_TABLES.sort()).toEqual([
      "agency_portfolio_priority_settings",
      "local_landing_opportunity_settings",
      "local_presence_settings",
      "organic_campaign_goals",
      "seo_change_impact_settings",
      "technical_seo_fix_verifications",
    ]);
    for (const table of REPLACEMENT_ADDON_TABLES) {
      expect(statements.some(s => s.startsWith(`CREATE TABLE IF NOT EXISTS public.${table} `))).toBe(true);
      expect(statements).toContain(`ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY`);
      for (const op of ["select", "insert", "update", "delete"]) {
        expect(statements.some(s => s.startsWith(`CREATE POLICY "tenant_${op}" ON public."${table}" `))).toBe(true);
      }
    }
    // Additive only: never destructive on data.
    expect(statements.filter(s => /^(DROP TABLE|TRUNCATE|DELETE|UPDATE)/i.test(s))).toEqual([]);
    expect(statements.filter(s => /^CREATE (TABLE|INDEX)/.test(s) && !/IF NOT EXISTS/.test(s))).toEqual([]);
  });

  it("is wired on both startup paths (full init and stale-marker fast path)", () => {
    const src = path.resolve(__dirname, "..");
    expect(fs.readFileSync(path.join(src, "index.ts"), "utf8")).toContain("ensureReplacementAddonTables(client)");
    expect(fs.readFileSync(path.join(src, "services/init-data-tables.ts"), "utf8")).toContain("ensureReplacementAddonTables(client)");
  });
});
