/**
 * seo_forecasts sur la vraie table : 270 lignes (90 jours x 3 scenarios) pour un site reel,
 * sans violation de cle primaire, sans doublon, idempotent, isole par organisation.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }));
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { forecastRowId, persistForecastRows } from "./forecasting-service.js";

const SITE = "https://www.agence-seo-paris.com/blog";
const orgA = randomUUID(), orgB = randomUUID();
let ok = false;

function rows(base: number) {
  const out: Array<{ date: string; predictedTraffic: number; predictedConversions: number; predictedRevenue: number; confidence: number; scenario: string }> = [];
  for (let d = 1; d <= 90; d++) {
    const date = new Date(Date.UTC(2031, 0, d)).toISOString().slice(0, 10);
    for (const scenario of ["pessimistic", "realistic", "optimistic"]) out.push({ date, predictedTraffic: base + d, predictedConversions: 0, predictedRevenue: 0, confidence: 70, scenario });
  }
  return out;
}
async function tx<T>(fn: (c: { query: (s: string, p?: unknown[]) => Promise<unknown> }) => Promise<T>) {
  const c = await pool.connect();
  try { await c.query("BEGIN"); const r = await fn(c); await c.query("COMMIT"); return r; }
  catch (e) { await c.query("ROLLBACK").catch(() => {}); throw e; } finally { c.release(); }
}
beforeAll(async () => { try { await pool.query("SELECT 1 FROM seo_forecasts LIMIT 1"); ok = true; } catch { ok = false; } });
afterAll(async () => { if (ok) await pool.query("DELETE FROM seo_forecasts WHERE org_id = ANY($1)", [[orgA, orgB]]); });

describe("forecastRowId", () => {
  it("est unique sur 270 lignes d'un site réel et de longueur fixe", () => {
    const ids = new Set(rows(1).map(r => forecastRowId(orgA, SITE, r.date, r.scenario)));
    expect(ids.size).toBe(270);
    for (const id of ids) expect(id).toMatch(/^fc_[0-9a-f]{40}$/);
  });
  it("distingue organisation, site, date et scénario ; reste stable", () => {
    const base = forecastRowId(orgA, SITE, "2031-01-01", "realistic");
    expect(forecastRowId(orgA, SITE, "2031-01-01", "realistic")).toBe(base);
    for (const other of [forecastRowId(orgB, SITE, "2031-01-01", "realistic"), forecastRowId(orgA, SITE + "x", "2031-01-01", "realistic"),
      forecastRowId(orgA, SITE, "2031-01-02", "realistic"), forecastRowId(orgA, SITE, "2031-01-01", "optimistic")]) expect(other).not.toBe(base);
  });
});

describe("persistForecastRows (SQL réel)", () => {
  it("écrit 270 lignes pour un site long, puis met à jour sans doublon", async (ctx) => {
    if (!ok) return ctx.skip();
    await tx(c => persistForecastRows(c, orgA, SITE, rows(100)));
    await tx(c => persistForecastRows(c, orgA, SITE, rows(500))); // rejeu : mise a jour
    const r = await pool.query(`SELECT count(*)::int n, count(DISTINCT id)::int ids, min(predicted_traffic)::int mn FROM seo_forecasts WHERE org_id=$1 AND site_url=$2`, [orgA, SITE]);
    expect(r.rows[0]).toMatchObject({ n: 270, ids: 270, mn: 501 });
  });
  it("deux organisations peuvent prévoir le même site sans collision", async (ctx) => {
    if (!ok) return ctx.skip();
    await tx(c => persistForecastRows(c, orgB, SITE, rows(7)));
    const a = await pool.query(`SELECT count(*)::int n FROM seo_forecasts WHERE org_id=$1`, [orgA]);
    const b = await pool.query(`SELECT count(*)::int n FROM seo_forecasts WHERE org_id=$1`, [orgB]);
    expect([a.rows[0].n, b.rows[0].n]).toEqual([270, 270]);
  });
});
