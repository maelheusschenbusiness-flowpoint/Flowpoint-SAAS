/**
 * Identifiants stables : plus aucune collision de cle primaire sur les trois tables ou l'ancien
 * identifiant tronque en produisait (gsc_sites, competitor_map_results, seo_forecasts).
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pool } from "@workspace/db";
import { stableId } from "./stable-id.js";

const org = randomUUID();
let ok = false;
beforeAll(async () => { try { await pool.query("SELECT 1 FROM gsc_sites LIMIT 1"); await pool.query("SELECT 1 FROM competitor_map_results LIMIT 1"); ok = true; } catch { ok = false; } });
afterAll(async () => { if (ok) { await pool.query("DELETE FROM gsc_sites WHERE org_id=$1", [org]); await pool.query("DELETE FROM competitor_map_results WHERE org_id=$1", [org]); } });

describe("stableId", () => {
  it("longueur fixe, stable, sensible à chaque partie et sans ambiguïté de séparateur", () => {
    const a = stableId("x", "a|b", "c");
    expect(a).toMatch(/^x_[0-9a-f]{40}$/);
    expect(stableId("x", "a|b", "c")).toBe(a);
    expect(stableId("x", "a", "b|c")).not.toBe(a);
    expect(stableId("y", "a|b", "c")).not.toBe(a);
  });
});

describe("clés primaires sur les vraies tables", () => {
  it("gsc_sites : deux propriétés d'un même client (préfixe d'URL commun) coexistent", async (ctx) => {
    if (!ok) return ctx.skip();
    const urls = ["https://www.agence-client-longue.fr/fr/", "https://www.agence-client-longue.fr/en/", "https://www.agence-client-longue.fr/de/"];
    for (const u of urls) {
      await pool.query(`INSERT INTO gsc_sites (id, org_id, site_url, display_name, is_active, created_at) VALUES ($1,$2,$3,$3,false,NOW())
        ON CONFLICT (org_id, site_url) DO UPDATE SET permission_level='x'`, [stableId("gsc", org, u), org, u]);
    }
    const r = await pool.query("SELECT count(*)::int n FROM gsc_sites WHERE org_id=$1", [org]);
    expect(r.rows[0].n).toBe(3);
  });
  it("competitor_map_results : dix concurrents d'une même recherche sont tous conservés", async (ctx) => {
    if (!ok) return ctx.skip();
    for (let i = 0; i < 10; i++) {
      const placeId = `ChIJplace${i}`.padEnd(24, "x");
      await pool.query(`INSERT INTO competitor_map_results (id,org_id,keyword,location,place_id,name,address,category,rating,review_count,rank,photo_url,authority_score,fetched_at)
        VALUES ($1,$2,'plombier paris','paris 75001',$3,$4,'adr','cat',4.5,10,$5,null,50,NOW())
        ON CONFLICT (org_id,keyword,location,place_id) DO UPDATE SET name=EXCLUDED.name`,
        [stableId("map", org, "plombier paris", "paris 75001", placeId), org, placeId, `Concurrent ${i}`, i + 1]);
    }
    const r = await pool.query("SELECT count(*)::int n, count(DISTINCT id)::int ids FROM competitor_map_results WHERE org_id=$1", [org]);
    expect(r.rows[0]).toEqual({ n: 10, ids: 10 });
  });
  it("le code n'utilise plus d'identifiant tronqué pour ces trois tables", () => {
    const read = (f: string) => readFileSync(join(process.cwd(), "src", f), "utf8");
    for (const f of ["services/gsc-service.ts", "routes/google-gsc-oauth.ts", "routes/local-maps.ts", "services/forecasting-service.ts"]) {
      expect(read(f), f).not.toMatch(/toString\("base64url"\)\.slice\(0, ?(40|64)\)|\.replace\(\/\[\^a-z0-9_\]\/gi, "_"\)\.slice\(0, 80\)/);
    }
  });
});
